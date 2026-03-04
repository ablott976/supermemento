import OpenAI from "openai";
import type { AppConfig } from "../config.js";

/** OpenAI embedding service wrapper. */
export class EmbeddingService {
  private readonly client: OpenAI;
  private readonly model: string;

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

    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts
    });

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
