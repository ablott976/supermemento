import type { AppConfig } from "../../config.js";
import { Neo4jClient } from "../../db/neo4j-client.js";
import { EmbeddingService } from "../embedding.js";
import { QueryRewriterService } from "./query-rewriter.js";
import { CohereReranker, SimpleReranker, type Reranker } from "./reranker.js";
import type { SearchParams, SearchResponse, SearchResult } from "./types.js";

/** SuperRAG search service with hybrid retrieval, rewriting, and reranking. */
export class SearchService {
  private readonly neo4jClient: Neo4jClient;
  private readonly embeddingService: EmbeddingService;
  private readonly queryRewriter: QueryRewriterService;
  private readonly defaultReranker: Reranker;
  private readonly fallbackReranker: Reranker;

  /**
   * Creates search service.
   */
  public constructor(
    config: AppConfig,
    neo4jClient: Neo4jClient,
    embeddingService: EmbeddingService
  ) {
    this.neo4jClient = neo4jClient;
    this.embeddingService = embeddingService;
    this.queryRewriter = new QueryRewriterService(config);
    this.fallbackReranker = new SimpleReranker();
    this.defaultReranker = config.COHERE_API_KEY ? new CohereReranker(config) : this.fallbackReranker;
  }

  /**
   * Executes semantic search according to requested mode.
   * @param params Search params.
   */
  public async search(params: SearchParams): Promise<SearchResponse> {
    const mode = params.searchMode ?? "hybrid";
    const limit = params.limit ?? 10;
    const minScore = params.min_similarity ?? 0.6;
    const query = params.query.trim();

    if (!query) {
      throw new Error("Search query cannot be empty");
    }

    const rewrittenQuery = params.rewriteQuery ? await this.queryRewriter.rewrite(query) : query;
    const embedding = await this.embeddingService.generateEmbedding(rewrittenQuery);

    // Execute memory and chunk searches in parallel using Promise.all
    const memorySearchPromise = mode === "rag"
      ? Promise.resolve([])
      : this.neo4jClient.semanticSearchMemoriesAdvanced({
          embedding,
          containerTag: params.containerTag,
          minScore,
          limit,
          isLatestOnly: true,
          memoryTypes: params.memoryTypes,
          includeExpired: params.includeExpired ?? false
        });

    const chunkSearchPromise = mode === "memory"
      ? Promise.resolve([])
      : this.neo4jClient.semanticSearchChunks({
          embedding,
          containerTag: params.containerTag,
          minScore,
          limit
        });

    const [memoryResults, chunkResults] = await Promise.all([
      memorySearchPromise,
      chunkSearchPromise
    ]);

    const merged: SearchResult[] = [
      ...memoryResults.map((hit) => ({
        id: hit.memory.id,
        type: "memory" as const,
        score: hit.score,
        content: hit.memory.content,
        containerTag: hit.memory.containerTag,
        sourceDocId: hit.memory.sourceDocId,
        memoryType: hit.memory.memoryType
      })),
      ...chunkResults.map((hit) => ({
        id: hit.chunk.id,
        type: "chunk" as const,
        score: hit.score,
        content: hit.chunk.content,
        containerTag: hit.chunk.containerTag,
        sourceDocId: hit.chunk.sourceDocId,
        chunkIndex: hit.chunk.chunkIndex,
        metadata: hit.chunk.metadata
      }))
    ];

    const deduped = this.dedupe(merged);
    const ranked = params.rerank
      ? await this.defaultReranker.rerank(query, deduped)
      : await this.fallbackReranker.rerank(query, deduped);

    return {
      query,
      rewrittenQuery: params.rewriteQuery ? rewrittenQuery : undefined,
      results: ranked.slice(0, limit)
    };
  }

  private dedupe(results: SearchResult[]): SearchResult[] {
    const byId = new Map<string, SearchResult>();
    for (const result of results) {
      const key = `${result.type}:${result.id}`;
      const existing = byId.get(key);
      if (!existing || result.score > existing.score) {
        byId.set(key, result);
      }
    }
    return [...byId.values()].sort((a, b) => b.score - a.score);
  }
}
