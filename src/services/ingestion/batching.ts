import { v4 as uuidv4 } from "uuid";

import type { Neo4jClient } from "../../db/neo4j-client.js";
import type { MemoryType } from "../../types/enums.js";
import type { ChunkPayload } from "./chunker.js";
import type { ExtractedMemory, MemoryExtractorService } from "./memory-extractor.js";

export type AsyncMapper<TInput, TOutput> = (item: TInput, index: number) => Promise<TOutput>;
export type MemoryBatchInput = {
  content: string;
  memoryType: MemoryType;
  containerTag: string;
  confidence: number;
  embedding: number[];
  sourceDocId: string;
  validFrom?: string | null;
  validTo?: string | null;
};

/**
 * Splits an array into fixed-size batches.
 */
export function chunkIntoBatches<T>(items: readonly T[], batchSize: number): T[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Maps items with an async mapper while enforcing a max concurrency.
 */
export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  mapper: AsyncMapper<TInput, TOutput>,
  concurrency: number
): Promise<TOutput[]> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("concurrency must be a positive integer");
  }

  if (items.length === 0) {
    return [];
  }

  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;

      const item = items[index];
      if (item === undefined) {
        continue;
      }

      results[index] = await mapper(item, index);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/**
 * Runs batch operations in sequence while each batch executes in parallel.
 */
export async function mapInBatches<TInput, TOutput>(
  items: readonly TInput[],
  mapper: AsyncMapper<TInput, TOutput>,
  batchSize: number
): Promise<TOutput[]> {
  const batches = chunkIntoBatches(items, batchSize);
  const output: TOutput[] = [];

  let offset = 0;
  for (const batch of batches) {
    const mapped = await Promise.all(batch.map((item, index) => mapper(item, offset + index)));
    output.push(...mapped);
    offset += batch.length;
  }

  return output;
}

/**
 * Creates many memories in a single write query via UNWIND.
 */
export async function batchCreateMemories(
  neo4jClient: Neo4jClient,
  memories: readonly MemoryBatchInput[]
): Promise<string[]> {
  if (memories.length === 0) {
    return [];
  }

  const session = neo4jClient.getDriver().session();
  const now = new Date().toISOString();

  const rows = memories.map((memory, idx) => ({
    idx,
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
      MATCH (d:Document {id: memory.sourceDocId})
      CREATE (m:Memory {
        id: memory.id,
        content: memory.content,
        memoryType: memory.memoryType,
        containerTag: memory.containerTag,
        isLatest: true,
        confidence: memory.confidence,
        originalConfidence: NULL,
        embedding: memory.embedding,
        validFrom: CASE WHEN memory.validFrom IS NULL THEN NULL ELSE datetime(memory.validFrom) END,
        validTo: CASE WHEN memory.validTo IS NULL THEN NULL ELSE datetime(memory.validTo) END,
        forgottenAt: NULL,
        createdAt: datetime(memory.createdAt),
        updatedAt: datetime(memory.updatedAt),
        sourceDocId: memory.sourceDocId
      })
      CREATE (m)-[:EXTRACTED_FROM]->(d)
      RETURN memory.idx AS idx, m.id AS id
      ORDER BY idx ASC
      `,
      { memories: rows }
    );

    return result.records.map((record) => String(record.get("id")));
  } finally {
    await session.close();
  }
}

/**
 * Extracts memories from chunks concurrently and preserves chunk order.
 */
export async function parallelExtractMemories(
  chunks: readonly ChunkPayload[],
  memoryExtractorService: MemoryExtractorService,
  filterPrompt?: string | null,
  maxConcurrency = 5
): Promise<ExtractedMemory[]> {
  const extractedByChunk = await mapWithConcurrency(
    chunks,
    async (chunk) => memoryExtractorService.extractFromChunk(chunk.content, { filterPrompt: filterPrompt ?? null }),
    maxConcurrency
  );

  return extractedByChunk.flat();
}
