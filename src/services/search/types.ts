import type { Chunk, Memory } from "../../types/models.js";

export type SearchMode = "memory" | "rag" | "hybrid";

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
