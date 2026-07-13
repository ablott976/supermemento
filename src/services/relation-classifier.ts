import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { Neo4jClient } from "../db/neo4j-client.js";
import { MemoryType, RelationType, type Memory } from "../types/index.js";
import { EmbeddingService } from "./embedding.js";
import { ForgettingService } from "./forgetting.js";

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

const optionalDerivedFactSchema = z.preprocess(
  (value) =>
    value === null || (typeof value === "string" && value.trim() === "")
      ? undefined
      : value,
  z.string().trim().min(1).optional()
);

const relationSchema = z
  .object({
    existingMemoryId: z.string().min(1),
    relationType: z.enum(["UPDATE", "EXTEND", "DERIVE", "NONE"]),
    confidence: z.number().min(0).max(1),
    derivedFact: optionalDerivedFactSchema
  })
  .superRefine((relation, context) => {
    if (relation.relationType === "DERIVE" && !relation.derivedFact) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["derivedFact"],
        message: "DERIVE relations require a non-empty derivedFact"
      });
    }
  });

const responseSchema = z.object({
  relations: z.array(relationSchema)
});

const BATCH_CLASSIFICATION_SYSTEM_PROMPT = `Eres un clasificador de relaciones entre memorias. Se te darán MÚLTIPLES hechos nuevos y, para cada uno, una lista de hechos existentes candidatos. Determina para cada par qué relación aplica. Responde SOLO en JSON.

Relaciones posibles:
- UPDATE (el nuevo contradice/reemplaza el existente)
- EXTEND (el nuevo añade detalle sin contradecir)
- DERIVE (se puede inferir un nuevo hecho de la combinación)
- NONE (no hay relación significativa)

Para UPDATE: el nuevo hecho debe contradecir directamente el existente. Ejemplo: 'trabaja en Google' -> 'trabaja en Stripe'.
Para EXTEND: el nuevo hecho añade información al mismo tema. Ejemplo: 'trabaja en Stripe' -> 'lidera equipo de pagos en Stripe'.
Para DERIVE: la combinación de hechos permite inferir algo nuevo. Ejemplo: 'es PM en Stripe' + 'habla frecuentemente de APIs de pago' -> 'probablemente trabaja en el producto core de pagos de Stripe'.

Responde con: {classifications: [{newMemoryId, relations: [{existingMemoryId, relationType, confidence, derivedFact?}]}]}
Incluye una entrada por cada newMemoryId recibido, incluso si todas sus relaciones son NONE.`;

const batchRelationSchema = relationSchema;

const batchResponseSchema = z.object({
  classifications: z.array(
    z.object({
      newMemoryId: z.string().min(1),
      relations: z.array(batchRelationSchema)
    })
  )
});

/** Service that classifies and applies intelligent relations for new memories. */
export class RelationClassifierService {
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private readonly neo4jClient: Neo4jClient;
  private readonly embeddingService: EmbeddingService;
  private readonly forgettingService: ForgettingService;

  /**
   * Creates a relation classifier service.
   * @param config Parsed application configuration.
   * @param neo4jClient Database client.
   * @param embeddingService Embedding service for derived memories.
   * @param forgettingService Forgetting service for preference reinforcement.
   */
  public constructor(
    config: AppConfig,
    neo4jClient: Neo4jClient,
    embeddingService: EmbeddingService,
    forgettingService: ForgettingService
  ) {
    this.anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    this.model = config.ANTHROPIC_MODEL;
    this.neo4jClient = neo4jClient;
    this.embeddingService = embeddingService;
    this.forgettingService = forgettingService;
  }

  /**
   * Classifies relations for a new memory and applies resulting graph updates.
   * @param newMemory Newly created memory.
   */
  public async classifyAndApply(
    newMemory: Memory,
    options: { asOf?: string } = {}
  ): Promise<{
    candidateCount: number;
    applied: Array<{ relationType: string; existingMemoryId?: string; derivedMemoryId?: string }>;
  }> {
    const candidates = await this.neo4jClient.semanticSearchMemories({
      embedding: newMemory.embedding,
      containerTag: newMemory.containerTag,
      minScore: 0.75,
      limit: 10,
      isLatestOnly: true,
      asOf: options.asOf
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
          RelationType.Updates,
          { markTargetNotLatest: true }
        );
        applied.push({ relationType: "UPDATE", existingMemoryId: relation.existingMemoryId });
        continue;
      }

      if (relation.relationType === "EXTEND") {
        const targetMemory = filteredCandidates
          .map((candidate) => candidate.memory)
          .find((candidate) => candidate.id === relation.existingMemoryId);
        await this.neo4jClient.createMemoryRelation(
          newMemory.id,
          relation.existingMemoryId,
          RelationType.Extends,
          { reinforceTargetPreference: targetMemory?.memoryType === MemoryType.Preference }
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

  /**
   * Classifies relations for multiple new memories in a single LLM call and applies graph updates.
   * @param newMemories Array of newly created memories.
   */
  public async batchClassifyAndApply(newMemories: Memory[]): Promise<void> {
    if (newMemories.length === 0) {
      return;
    }

    // 1. Search candidates for each new memory in parallel
    const candidateResults = await Promise.all(
      newMemories.map(async (memory) => {
        const candidates = await this.neo4jClient.semanticSearchMemories({
          embedding: memory.embedding,
          containerTag: memory.containerTag,
          minScore: 0.75,
          limit: 10,
          isLatestOnly: true
        });
        const filtered = candidates
          .filter((c) => c.memory.id !== memory.id)
          .slice(0, 10);
        return { newMemory: memory, candidates: filtered };
      })
    );

    // 2. Filter out memories with no candidates
    const withCandidates = candidateResults.filter(
      (result) => result.candidates.length > 0
    );

    if (withCandidates.length === 0) {
      return;
    }

    // 3. Single batch LLM call
    const batchResult = await this.batchClassify(withCandidates);

    // 4. Apply relations for each classification
    for (const classification of batchResult.classifications) {
      const entry = withCandidates.find(
        (e) => e.newMemory.id === classification.newMemoryId
      );
      if (!entry) continue;

      const { newMemory: mem, candidates: cands } = entry;

      for (const relation of classification.relations) {
        if (relation.relationType === "UPDATE") {
          await this.neo4jClient.createMemoryRelation(
            mem.id,
            relation.existingMemoryId,
            RelationType.Updates,
            { markTargetNotLatest: true }
          );
          continue;
        }

        if (relation.relationType === "EXTEND") {
          const targetMemory = cands
            .map((c) => c.memory)
            .find((c) => c.id === relation.existingMemoryId);
          await this.neo4jClient.createMemoryRelation(
            mem.id,
            relation.existingMemoryId,
            RelationType.Extends,
            { reinforceTargetPreference: targetMemory?.memoryType === MemoryType.Preference }
          );
          continue;
        }

        if (relation.relationType === "DERIVE" && relation.derivedFact) {
          const derivedEmbedding =
            await this.embeddingService.generateEmbedding(relation.derivedFact);
          await this.neo4jClient.createDerivedMemory({
            content: relation.derivedFact,
            containerTag: mem.containerTag,
            sourceDocId: mem.sourceDocId,
            sourceMemoryIds: [mem.id, relation.existingMemoryId],
            embedding: derivedEmbedding
          });
        }
      }
    }
  }

  private async batchClassify(
    entries: Array<{ newMemory: Memory; candidates: Array<{ memory: Memory; score: number }> }>
  ): Promise<z.infer<typeof batchResponseSchema>> {
    // Build a flat map of all candidate memories for ID resolution later
    const allCandidateMemories = new Map<string, Memory>();
    for (const entry of entries) {
      for (const c of entry.candidates) {
        allCandidateMemories.set(c.memory.id, c.memory);
      }
    }

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4000,
      system: BATCH_CLASSIFICATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            newFacts: entries.map((entry) => ({
              id: entry.newMemory.id,
              content: entry.newMemory.content,
              memoryType: entry.newMemory.memoryType,
              containerTag: entry.newMemory.containerTag,
              existingCandidates: entry.candidates.map((c) => ({
                id: c.memory.id,
                content: c.memory.content,
                memoryType: c.memory.memoryType,
                isLatest: c.memory.isLatest
              }))
            }))
          })
        }
      ]
    });

    const combinedText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const parsed = batchResponseSchema.parse(this.extractJson(combinedText));
    return {
      classifications: parsed.classifications.map((cls) => ({
        newMemoryId: cls.newMemoryId,
        relations: cls.relations.map((rel) => ({
          ...rel,
          existingMemoryId: this.resolveExistingMemoryId(
            rel.existingMemoryId,
            Array.from(allCandidateMemories.values())
          )
        }))
      }))
    };
  }

  private async classify(
    newMemory: Memory,
    candidates: Memory[]
  ): Promise<z.infer<typeof responseSchema>> {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4000,
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
    const payload = raw.trim();

    try {
      return this.parseJsonPayload(payload);
    } catch (directError) {
      const objectPayload = this.extractFirstJsonObject(payload);
      if (!objectPayload) {
        throw directError;
      }
      return this.parseJsonPayload(objectPayload);
    }
  }

  private parseJsonPayload(payload: string): unknown {
    try {
      return JSON.parse(payload);
    } catch (error) {
      const withoutTrailingCommas = this.removeTrailingCommas(payload);
      if (withoutTrailingCommas === payload) {
        throw error;
      }
      return JSON.parse(withoutTrailingCommas);
    }
  }

  private extractFirstJsonObject(raw: string): string | null {
    let objectStart = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < raw.length; index += 1) {
      const character = raw.charAt(index);

      if (objectStart < 0) {
        if (character === "{") {
          objectStart = index;
          depth = 1;
        }
        continue;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          return raw.slice(objectStart, index + 1);
        }
      }
    }

    return null;
  }

  private removeTrailingCommas(raw: string): string {
    let normalized = "";
    let inString = false;
    let escaped = false;

    for (let index = 0; index < raw.length; index += 1) {
      const character = raw.charAt(index);

      if (inString) {
        normalized += character;
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
        normalized += character;
        continue;
      }

      if (character === ",") {
        let nextIndex = index + 1;
        while (nextIndex < raw.length && /\s/.test(raw.charAt(nextIndex))) {
          nextIndex += 1;
        }
        const nextCharacter = raw.charAt(nextIndex);
        if (nextCharacter === "}" || nextCharacter === "]") {
          continue;
        }
      }

      normalized += character;
    }

    return normalized;
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
