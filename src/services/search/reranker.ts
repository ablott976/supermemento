import type { AppConfig } from "../../config.js";
import type { RankedResult, SearchResult } from "./types.js";

/** Result reranker contract. */
export interface Reranker {
  /**
   * Reranks search results against the original query.
   * @param query User query.
   * @param results Retrieved results.
   */
  rerank(query: string, results: SearchResult[]): Promise<RankedResult[]>;
}

/** Fallback reranker that preserves original vector scores. */
export class SimpleReranker implements Reranker {
  public async rerank(_query: string, results: SearchResult[]): Promise<RankedResult[]> {
    return [...results].sort((a, b) => b.score - a.score);
  }
}

/** Cohere API-based reranker implementation. */
export class CohereReranker implements Reranker {
  private readonly apiKey: string;
  private readonly model: string;

  /**
   * Creates Cohere reranker service.
   * @param config Parsed application configuration.
   */
  public constructor(config: AppConfig) {
    if (!config.COHERE_API_KEY) {
      throw new Error("COHERE_API_KEY is required for Cohere reranking");
    }

    this.apiKey = config.COHERE_API_KEY;
    this.model = config.COHERE_RERANK_MODEL;
  }

  public async rerank(query: string, results: SearchResult[]): Promise<RankedResult[]> {
    if (results.length === 0) {
      return [];
    }

    const response = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        query,
        top_n: results.length,
        documents: results.map((result) => result.content)
      })
    });

    if (!response.ok) {
      throw new Error(`Cohere rerank failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      results?: Array<{ index: number; relevance_score?: number }>;
    };

    const ranked = (payload.results ?? [])
      .map((row) => {
        const base = results[row.index];
        if (!base) {
          return null;
        }

        return {
          ...base,
          rerankScore: row.relevance_score ?? base.score,
          score: row.relevance_score ?? base.score
        } as RankedResult;
      })
      .filter((row): row is RankedResult => row !== null)
      .sort((a, b) => b.score - a.score);

    return ranked;
  }
}
