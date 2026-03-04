import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { MemoryType } from "../../types/enums.js";

const EXTRACTION_SYSTEM_PROMPT = `Eres un extractor de hechos. Dado un fragmento de texto, extrae TODOS los hechos atómicos. Cada hecho debe ser una afirmación independiente y autónoma que tenga sentido sin contexto adicional.

Para cada hecho, determina:
- content (el hecho en lenguaje natural)
- memoryType (fact, preference, episode)
- confidence (0.0-1.0)
- validFrom (fecha actual)
- validTo (null si permanente, fecha si temporal)

Reglas:
- No incluyas opiniones del texto, solo hechos verificables.
- Resuelve pronombres ('ella' -> nombre concreto si disponible).
- Detecta referencias temporales y calcula fechas absolutas.
- Si el hecho es una preferencia del usuario, marca como 'preference'.

Responde SOLO en JSON: {memories: [{content, memoryType, confidence, validFrom, validTo}]}`;

const extractedMemorySchema = z.object({
  content: z.string().min(1),
  memoryType: z.nativeEnum(MemoryType),
  confidence: z.number().min(0).max(1),
  validFrom: z.string().datetime().nullable(),
  validTo: z.string().datetime().nullable()
});

const extractionResponseSchema = z.object({
  memories: z.array(extractedMemorySchema)
});

export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;

/** Extracts atomic memories from chunk text using Anthropic Haiku. */
export class MemoryExtractorService {
  private readonly anthropic: Anthropic;
  private readonly model: string;

  /**
   * Creates the memory extractor service.
   * @param config Parsed application configuration.
   */
  public constructor(config: AppConfig) {
    this.anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    this.model = config.ANTHROPIC_MODEL;
  }

  /**
   * Extracts memories from one chunk.
   * @param chunkText Chunk content.
   * @param options Optional filter prompt.
   */
  public async extractFromChunk(
    chunkText: string,
    options?: { filterPrompt?: string | null }
  ): Promise<ExtractedMemory[]> {
    const userPrompt = JSON.stringify(
      {
        filterPrompt: options?.filterPrompt ?? null,
        chunk: chunkText,
        currentDate: new Date().toISOString()
      },
      null,
      2
    );

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1200,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    });

    const combinedText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const parsed = extractionResponseSchema.parse(this.extractJson(combinedText));
    return parsed.memories;
  }

  private extractJson(raw: string): unknown {
    const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    const payload = fenced?.[1] ?? raw;
    return JSON.parse(payload.trim());
  }
}
