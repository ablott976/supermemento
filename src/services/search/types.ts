import type { Chunk, Memory } from "../../types/models.js";

export type SearchMode = "memory" | "rag" | "hybrid";

export interface VectorSearchFilter {
  containerTag?: string;
  memoryTypes?: Memory["memoryType"][];
  minSimilarity?: number;
  metadata?: Record<string, unknown>;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

export interface SearchParams {
  query: string;
  containerTag?: string;
  searchMode?: SearchMode;
  rerank?: boolean;
  rewriteQuery?: boolean;
  limit?: number;
  min_similarity?: number;
  memoryTypes?: Memory["memoryType"][];
  includeExpired?: boolean;
  vectorFilter?: VectorSearchFilter;
}

export interface SearchResult {
  id: string;
  type: "memory" | "chunk";
  score: number;
  content: string;
  containerTag: string;
  sourceDocId: string;
  memoryType?: Memory["memoryType"];
  chunkIndex?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  rewrittenQuery?: string;
  results: SearchResult[];
}

export interface RankedResult extends SearchResult {
  rerankScore?: number;
}

export type SearchMemoryHit = {
  memory: Memory;
  score: number;
};

export type SearchChunkHit = {
  chunk: Chunk;
  score: number;
};

export interface FilteredVectorSearchRequest {
  query: string;
  embedding?: number[];
  filters?: VectorSearchFilter;
  limit?: number;
  offset?: number;
}

export interface FilteredVectorSearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  filtersApplied: VectorSearchFilter;
}
