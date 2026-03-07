/**
 * Batching utilities for ingestion pipeline.
 * Provides concurrency-limited parallel execution and batch database operations to optimize N+1 query patterns.
 */

import { v4 as uuidv4 } from "uuid";
import type { Neo4jClient } from "../../db/neo4j-client.js";
import type { MemoryType } from "../../types/enums.js";
import type { ChunkPayload } from "./chunker.js";
import type { ExtractedMemory, MemoryExtractorService } from "./memory-extractor.js";

/**
 * Input type for batch memory creation.
 */
export interface MemoryBatchInput {
  content: string;
  memoryType: MemoryType;
  containerTag: string;
  confidence: number;
  embedding: number[];
  sourceDocId: string;
  validFrom?: string | null;
  validTo?: string | null;
}

/**
 * Simple semaphore for concurrency control.
 */
class Semaphore {
  private permits: number;
  private resolvers: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  release(): void {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}

/**
 * Execute async function over items with limited concurrency.
 * Replaces sequential loops (for...await) with parallel execution while respecting resource constraints.
 * 
 * @param items Items to process
 * @param asyncFunc Async function to apply to each item
 * @param maxConcurrency Maximum number of concurrent operations
 * @returns List of results in the same order as input items
 */
export async function gatherWithLimit<T, R>(
  items: readonly T[],
  asyncFunc: (item: T) => Promise<R>,
  maxConcurrency: number = 10
): Promise<R[]> {
  const semaphore = new Semaphore(maxConcurrency);

  async function wrap(item: T): Promise<R> {
    await semaphore.acquire();
    try {
      return await asyncFunc(item);
    } finally {
      semaphore.release();
    }
  }

  return Promise.all(items.map(wrap));
}

/**
 * Split sequence into chunks of specified size.
 * 
 * @param items Items to chunk
 * @param chunkSize Maximum size of each chunk
 * @returns List of chunks
 */
export function chunkList<T>(items: readonly T[], chunkSize: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Process items in batches.
 * Useful for database batch operations (e.g., Neo4j UNWIND).
 * 
 * @param items Items to process
 * @param batchProcessor Async function that processes a batch of items
 * @param batchSize Size of each batch
 * @returns List of results from each batch
 */
export async function processBatches<T, R>(
  items: readonly T[],
  batchProcessor: (batch: readonly T[]) => Promise<R>,
  batchSize: number = 100
): Promise<R[]> {
  const batches = chunkList(items, batchSize);
  return Promise.all(batches.map((batch) => batchProcessor(batch)));
}

/**
 * Extract memories from chunks in parallel with a configurable concurrency limit.
 * Flattens per-chunk extraction results into a single memory list.
 *
 * @param chunks Chunk payloads to extract from
 * @param memoryExtractorService Memory extractor service instance
 * @param filterPrompt Optional filter prompt
 * @param maxConcurrency Maximum number of concurrent extraction calls
 * @returns Flat list of extracted memories
 */
export async function parallelExtractMemories(
  chunks: readonly ChunkPayload[],
  memoryExtractorService: MemoryExtractorService,
  filterPrompt?: string | null,
  maxConcurrency: number = 5
): Promise<ExtractedMemory[]> {
  if (chunks.length === 0) {
    return [];
  }

  const extractedPerChunk = await gatherWithLimit(
    chunks,
    async (chunk) =>
      memoryExtractorService.extractFromChunk(chunk.content, {
        filterPrompt: filterPrompt ?? null,
      }),
    maxConcurrency
  );

  return extractedPerChunk.flat();
}

/**
 * Batch create memories using Neo4j UNWIND for optimal performance.
 * Creates multiple Memory nodes and their relationships to source documents in a single query.
 * 
 * @param neo4jClient Neo4j client instance
 * @param memories Array of memory data to create
 * @returns Array of created memory IDs
 */
export async function batchCreateMemories(
  neo4jClient: Neo4jClient,
  memories: readonly MemoryBatchInput[]
): Promise<string[]> {
  if (memories.length === 0) {
    return [];
  }

  const driver = neo4jClient.getDriver();
  const session = driver.session();
  const now = new Date().toISOString();

  // Prepare data with generated IDs and timestamps
  const memoriesWithIds = memories.map((memory) => ({
    id: uuidv4(),
    content: memory.content,
    memoryType: memory.memoryType,
    containerTag: memory.containerTag,
    confidence: memory.confidence,
    embedding: memory.embedding,
    sourceDocId: memory.sourceDocId,
    validFrom: memory.validFrom ?? null,
    validTo: memory.validTo ?? null,
    createdAt: now,
    updatedAt: now,
  }));

  try {
    const result = await session.run(
      `
      UNWIND $memories as memory
      CREATE (m:Memory {
        id: memory.id,
        content: memory.content,
        memoryType: memory.memoryType,
        containerTag: memory.containerTag,
        confidence: memory.confidence,
        embedding: memory.embedding,
        validFrom: CASE WHEN memory.validFrom IS NULL THEN NULL ELSE datetime(memory.validFrom) END,
        validTo: CASE WHEN memory.validTo IS NULL THEN NULL ELSE datetime(memory.validTo) END,
        isLatest: true,
        createdAt: datetime(memory.createdAt),
        updatedAt: datetime(memory.updatedAt)
      })
      WITH m, memory
      MATCH (d:Document {id: memory.sourceDocId})
      CREATE (m)-[:EXTRACTED_FROM]->(d)
      RETURN m.id as id
      `,
      { memories: memoriesWithIds }
    );

    return result.records.map((record) => record.get("id") as string);
  } finally {
    await session.close();
  }
}

/**
 * Classify memory relations in batches to reduce LLM round-trips.
 * Each batch should be handled by a classifier implementation that performs
 * one multi-memory classification call.
 *
 * @param memories Memories to classify
 * @param batchClassifier Classifier function invoked once per batch
 * @param batchSize Number of memories per classification batch
 * @param maxConcurrency Maximum number of batches processed in parallel
 * @returns Flattened list of per-memory classification results
 */
export async function batchClassifyRelations<TMemory, TResult>(
  memories: readonly TMemory[],
  batchClassifier: (batch: readonly TMemory[]) => Promise<readonly TResult[]>,
  batchSize: number = 10,
  maxConcurrency: number = 3
): Promise<TResult[]> {
  if (memories.length === 0) {
    return [];
  }

  const batches = chunkList(memories, batchSize);
  const resultsPerBatch = await gatherWithLimit(
    batches,
    async (batch) => batchClassifier(batch),
    maxConcurrency
  );

  return resultsPerBatch.flat() as TResult[];
}
