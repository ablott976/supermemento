import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { Neo4jClient } from "../db/neo4j-client.js";
import { RelationType, type Memory } from "../types/index.js";
import { EmbeddingService } from "./embedding.js";

const CLASSIFICATION_SYSTEM_PROMPT = `Eres un clasificador de relaciones entre memorias. Dado un NUEVO HECHO y una lista de HECHOS EXISTENTES, determina para cada par qué relación aplica. Responde SOLO en JSON.

Relaciones posibles:
- UPDATE (el nuevo contradice/reemplaza el existente)
- EXTEND (el nuevo añade detalle sin contradecir)
- DERIVE (se puede inferir un nuevo hecho de la combinación)
- NONE (no hay relación significativa)

Para UPDATE: el nuevo hecho debe contradecir directamente el existente. Ejemplo: 'trabaja en Google' -> 'trabaja en Stripe'.
Para EXTEND: el nuevo hecho añade información al mismo tema. Ejemplo: 'trabaja en Stripe' -> 'lidera equipo de pagos en Stripe'.
Para DERIVE: la combinación de hechos permite inferir algo nuevo. Ejemplo: 'es PM en Stripe' + 'habla frecuentemente de APIs de pago' -> 'probablemente trabaja en el producto core de pagos de Stripe'.

Responde con: {relations: [{existingMemoryId, relationType, confidence, derivedFact?}]}`;

const relationSchema = z.object({
  existingMemoryId: z.string().min(1),
  relationType: z.enum(["UPDATE", "EXTEND", "DERIVE", "NONE"]),
  confidence: z.number().min(0).max(1),
  derivedFact: z.string().optional()
});

const responseSchema = z.object({
  relations: z.array(relationSchema)
});

/** Service that classifies and applies intelligent relations for new memories. */
export class RelationClassifierService {
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private readonly neo4jClient: Neo4jClient;
  private readonly embeddingService: EmbeddingService;

  /**
   * Creates a relation classifier service.
   * @param config Parsed application configuration.
   * @param neo4jClient Database client.
   * @param embeddingService Embedding service for derived memories.
   */
  public constructor(
    config: AppConfig,
    neo4jClient: Neo4jClient,
    embeddingService: EmbeddingService
  ) {
    this.anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    this.model = config.ANTHROPIC_MODEL;
    this.neo4jClient = neo4jClient;
    this.embeddingService = embeddingService;
  }

  /**
   * Classifies relations for a new memory and applies resulting graph updates.
   * @param newMemory Newly created memory.
   */
  public async classifyAndApply(newMemory: Memory): Promise<{
    candidateCount: number;
    applied: Array<{ relationType: string; existingMemoryId?: string; derivedMemoryId?: string }>;
  }> {
    const candidates = await this.neo4jClient.semanticSearchMemories({
      embedding: newMemory.embedding,
      containerTag: newMemory.containerTag,
      minScore: 0.75,
      limit: 10,
      isLatestOnly: true
    });

    const filteredCandidates = candidates
      .filter((candidate) => candidate.memory.id !== newMemory.id)
      .slice(0, 10);

    if (filteredCandidates.length === 0) {
      return { candidateCount: 0, applied: [] };
    }

    const classification = await this.classify(newMemory, filteredCandidates.map((c) => c.memory));
    const applied: Array<{ relationType: string; existingMemoryId?: string; derivedMemoryId?: string }> = [];

    for (const relation of classification.relations) {
      if (relation.relationType === "UPDATE") {
        await this.neo4jClient.createMemoryRelation(
          newMemory.id,
          relation.existingMemoryId,
          RelationType.Updates
        );
        await this.neo4jClient.markMemoryNotLatest(relation.existingMemoryId);
        applied.push({ relationType: "UPDATE", existingMemoryId: relation.existingMemoryId });
        continue;
      }

      if (relation.relationType === "EXTEND") {
        await this.neo4jClient.createMemoryRelation(
          newMemory.id,
          relation.existingMemoryId,
          RelationType.Extends
        );
        applied.push({ relationType: "EXTEND", existingMemoryId: relation.existingMemoryId });
        continue;
      }

      if (relation.relationType === "DERIVE" && relation.derivedFact) {
        const derivedEmbedding = await this.embeddingService.generateEmbedding(relation.derivedFact);
        const derivedMemory = await this.neo4jClient.createDerivedMemory({
          content: relation.derivedFact,
          containerTag: newMemory.containerTag,
          sourceDocId: newMemory.sourceDocId,
          sourceMemoryIds: [newMemory.id, relation.existingMemoryId],
          embedding: derivedEmbedding
        });
        applied.push({
          relationType: "DERIVE",
          existingMemoryId: relation.existingMemoryId,
          derivedMemoryId: derivedMemory.id
        });
      }
    }

    return {
      candidateCount: filteredCandidates.length,
      applied
    };
  }

  private async classify(
    newMemory: Memory,
    candidates: Memory[]
  ): Promise<z.infer<typeof responseSchema>> {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1000,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            newFact: {
              id: newMemory.id,
              content: newMemory.content,
              memoryType: newMemory.memoryType,
              containerTag: newMemory.containerTag
            },
            existingFacts: candidates.map((candidate) => ({
              id: candidate.id,
              content: candidate.content,
              memoryType: candidate.memoryType,
              isLatest: candidate.isLatest
            }))
          })
        }
      ]
    });

    const combinedText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const parsed = responseSchema.parse(this.extractJson(combinedText));
    return {
      relations: parsed.relations.map((relation) => ({
        ...relation,
        existingMemoryId: this.resolveExistingMemoryId(relation.existingMemoryId, candidates)
      }))
    };
  }

  private extractJson(raw: string): unknown {
    const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    const payload = fenced?.[1] ?? raw;
    return JSON.parse(payload.trim());
  }

  private resolveExistingMemoryId(value: string, candidates: Memory[]): string {
    if (candidates.some((candidate) => candidate.id === value)) {
      return value;
    }

    const byContent = candidates.find((candidate) => candidate.content === value);
    if (byContent) {
      return byContent.id;
    }

    throw new Error(`Classifier returned unknown existingMemoryId: ${value}`);
  }
}
