import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { MemoryType } from "../../types/enums.js";

const EXTRACTION_SYSTEM_PROMPT = `You are a fact extractor. Given a text chunk, extract ALL atomic facts. Each fact must be an independent, self-contained statement that makes sense without additional context.

For each fact, determine:
- content (the fact in natural language)
- memoryType ("fact", "preference", or "episode")
- confidence (0.0-1.0)
- validFrom (ISO date string or null)
- validTo (null if permanent, ISO date string if temporal)

Rules:
- Only extract verifiable facts, not opinions.
- Resolve pronouns to concrete names when available.
- Detect temporal references and calculate absolute dates.
- If the fact is a user preference, mark as "preference".
- If the fact describes an event, mark as "episode".

IMPORTANT: Respond with ONLY a JSON object, no markdown fences, no explanation:
{"memories": [{"content": "...", "memoryType": "fact", "confidence": 0.9, "validFrom": null, "validTo": null}]}`;

const extractedMemorySchema = z.object({
  content: z.string().min(1),
  memoryType: z.nativeEnum(MemoryType),
  confidence: z.number().min(0).max(1),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional()
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

    let response;
    try {
      response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }]
      });
    } catch (apiError) {
      const status = (apiError as { status?: unknown }).status;
      const suffix = typeof status === "number" ? ` (HTTP ${status})` : "";
      throw new Error(`Anthropic extraction request failed${suffix}`);
    }

    const combinedText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const jsonData = this.extractJson(combinedText);
    if (!jsonData) {
      throw new Error("Anthropic extraction response was not valid JSON");
    }

    try {
      const parsed = extractionResponseSchema.parse(jsonData);
      return parsed.memories;
    } catch {
      if (
        jsonData &&
        typeof jsonData === "object" &&
        "memories" in (jsonData as Record<string, unknown>) &&
        Array.isArray((jsonData as Record<string, unknown>).memories)
      ) {
        const memories = (jsonData as { memories: unknown[] }).memories;
        const validMemories: ExtractedMemory[] = [];
        for (const memory of memories) {
          const parsedMemory = extractedMemorySchema.safeParse(memory);
          if (parsedMemory.success) {
            validMemories.push(parsedMemory.data);
          }
        }
        if (validMemories.length > 0) {
          console.log(`[extractor] Lenient parse recovered ${validMemories.length}/${memories.length} memories`);
          return validMemories;
        }
      }
      throw new Error("Anthropic extraction response failed schema validation");
    }
  }

  private extractJson(raw: string): unknown | null {
    let text = raw.trim();

    // Strip ```json ... ``` fences (common LLM output)
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) text = fenced[1].trim();

    // Try to find a JSON object directly
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];

    try {
      return JSON.parse(text);
    } catch {
      // Try fixing common JSON issues: trailing commas
      try {
        const fixed = text.replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(fixed);
      } catch {
        return null;
      }
    }
  }
}
