import OpenAI from "openai";
import type { AppConfig } from "../config.js";

/** OpenAI embedding service wrapper. */
export class EmbeddingService {
  private static readonly MAX_CACHE_ENTRIES = 1_000;

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly embeddingCache = new Map<string, number[]>();

  /**
   * Creates the embedding service.
   * @param config Parsed application configuration.
   */
  public constructor(config: AppConfig) {
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    this.model = config.OPENAI_EMBEDDING_MODEL;
  }

  /**
   * Generates one embedding vector.
   * @param text Text to embed.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    const embedding = embeddings[0];
    if (!embedding) {
      throw new Error("Embedding generation returned no data");
    }
    return embedding;
  }

  /**
   * Generates embeddings for multiple texts in a single request.
   * @param texts Texts to embed.
   */
  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const embeddingsByIndex: Array<number[] | undefined> = new Array(texts.length);
    const uncachedTexts: string[] = [];
    const uncachedByText = new Map<string, number[]>();

    for (const [index, text] of texts.entries()) {
      const cached = this.getCachedEmbedding(text);
      if (cached) {
        embeddingsByIndex[index] = cached;
        continue;
      }

      let indexes = uncachedByText.get(text);
      if (!indexes) {
        indexes = [];
        uncachedByText.set(text, indexes);
        uncachedTexts.push(text);
      }
      indexes.push(index);
    }

    if (uncachedTexts.length > 0) {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: uncachedTexts
      });

      const orderedEmbeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);

      for (const [uncachedIndex, text] of uncachedTexts.entries()) {
        const embedding = orderedEmbeddings[uncachedIndex];
        if (!embedding) {
          throw new Error("Embedding generation returned no data");
        }

        this.setCachedEmbedding(text, embedding);
        const indexes = uncachedByText.get(text) ?? [];
        for (const resultIndex of indexes) {
          embeddingsByIndex[resultIndex] = embedding.slice();
        }
      }
    }

    const completedEmbeddings = embeddingsByIndex.map((embedding) => {
      if (!embedding) {
        throw new Error("Embedding generation returned no data");
      }
      return embedding;
    });

    return completedEmbeddings;
  }

  private getCachedEmbedding(text: string): number[] | undefined {
    const cached = this.embeddingCache.get(text);
    if (!cached) {
      return undefined;
    }

    this.embeddingCache.delete(text);
    this.embeddingCache.set(text, cached);
    return cached.slice();
  }

  private setCachedEmbedding(text: string, embedding: number[]): void {
    if (this.embeddingCache.has(text)) {
      this.embeddingCache.delete(text);
    }
    this.embeddingCache.set(text, embedding.slice());

    if (this.embeddingCache.size > EmbeddingService.MAX_CACHE_ENTRIES) {
      const oldestKey = this.embeddingCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.embeddingCache.delete(oldestKey);
      }
    }
  }
}
