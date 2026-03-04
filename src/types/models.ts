import type { ContentType, DocumentStatus, MemoryType } from "./enums.js";

/** JSON-like metadata payload. */
export type Metadata = Record<string, unknown>;

/** :Document node schema in Neo4j. */
export interface Document {
  id: string;
  title: string;
  contentType: ContentType;
  rawContent: string;
  sourceUrl?: string | null;
  filePath?: string | null;
  containerTag: string;
  metadata: Metadata;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}

/** :Memory node schema in Neo4j. */
export interface Memory {
  id: string;
  content: string;
  memoryType: MemoryType;
  containerTag: string;
  isLatest: boolean;
  confidence: number;
  embedding: number[];
  validFrom?: string | null;
  validTo?: string | null;
  forgottenAt?: string | null;
  createdAt: string;
  sourceDocId: string;
}

/** :Chunk node schema in Neo4j. */
export interface Chunk {
  id: string;
  content: string;
  embedding: number[];
  chunkIndex: number;
  containerTag: string;
  metadata: Metadata;
  sourceDocId: string;
}

/** Relationship record returned by relation lookup. */
export interface MemoryRelation {
  fromMemoryId: string;
  toMemoryId: string;
  relationType: string;
}

/** Vector search hit with score. */
export interface MemorySearchHit {
  memory: Memory;
  score: number;
}
