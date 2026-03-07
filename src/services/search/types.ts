/**
 * Type definitions for filtered vector search functionality.
 */

export interface SearchFilters {
  /** Container ID to filter results by */
  containerId?: string;
  /** Content type filter (e.g., 'document', 'image', etc.) */
  contentType?: string;
  /** Metadata key-value pairs for filtering */
  metadata?: Record<string, unknown>;
  /** Date range filter */
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface FilteredVectorSearchRequest {
  /** Search query text */
  query: string;
  /** Optional filters to apply */
  filters?: SearchFilters;
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Whether to rewrite the query for better recall */
  rewriteQuery?: boolean;
}

export interface SearchResult {
  /** Unique identifier for the result */
  id: string;
  /** Content text */
  content: string;
  /** Similarity score (0-1) */
  score: number;
  /** Associated metadata */
  metadata: Record<string, unknown>;
  /** Source container ID */
  containerId?: string;
}

export interface FilteredVectorSearchResponse {
  /** Search results */
  results: SearchResult[];
  /** Total number of matches */
  total: number;
  /** Original query */
  query: string;
  /** Rewritten query (if rewriteQuery was true) */
  rewrittenQuery?: string;
}

export interface VectorSearchOptions {
  /** Vector embedding to search with */
  embedding?: number[];
  /** Text query to embed (alternative to providing embedding) */
  queryText?: string;
  /** Filters to apply */
  filters?: SearchFilters;
  /** Number of results */
  topK?: number;
}
