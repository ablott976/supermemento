import assert from "node:assert/strict";
import test from "node:test";

import {
  batchClassifyRelations,
  batchCreateMemories,
  parallelExtractMemories,
  type MemoryBatchInput,
} from "../src/services/ingestion/batching.js";
import { IngestionPipeline } from "../src/services/ingestion/pipeline.js";
import { ContentType, DocumentStatus, MemoryType } from "../src/types/enums.js";
import type { ChunkPayload } from "../src/services/ingestion/chunker.js";
import type { ExtractedMemory } from "../src/services/ingestion/memory-extractor.js";

type FakeRecord = { get: (key: string) => unknown };

test("batchCreateMemories returns [] and does not open a session when there are no memories", async () => {
  let sessionCalled = false;

  const neo4jClient = {
    getDriver: () => ({
      session: () => {
        sessionCalled = true;
        throw new Error("session should not be called");
      },
    }),
  };

  const result = await batchCreateMemories(neo4jClient as never, []);

  assert.deepEqual(result, []);
  assert.equal(sessionCalled, false);
});

test("batchCreateMemories runs a single UNWIND query and returns created memory ids", async () => {
  const runCalls: Array<{ query: string; params: Record<string, unknown> }> = [];
  let closeCalled = 0;

  const records: FakeRecord[] = [
    { get: (key: string) => (key === "id" ? "memory-1" : undefined) },
    { get: (key: string) => (key === "id" ? "memory-2" : undefined) },
  ];

  const session = {
    run: async (query: string, params: Record<string, unknown>) => {
      runCalls.push({ query, params });
      return { records };
    },
    close: async () => {
      closeCalled += 1;
    },
  };

  const neo4jClient = {
    getDriver: () => ({
      session: () => session,
    }),
  };

  const memories: MemoryBatchInput[] = [
    {
      content: "Memory A",
      memoryType: MemoryType.Fact,
      containerTag: "inbox",
      confidence: 0.91,
      embedding: [0.1, 0.2, 0.3],
      sourceDocId: "doc-123",
      validFrom: "2025-01-01T00:00:00.000Z",
      validTo: null,
    },
    {
      content: "Memory B",
      memoryType: MemoryType.Preference,
      containerTag: "inbox",
      confidence: 0.87,
      embedding: [0.4, 0.5, 0.6],
      sourceDocId: "doc-123",
      validFrom: undefined,
      validTo: "2025-12-31T23:59:59.000Z",
    },
  ];

  const ids = await batchCreateMemories(neo4jClient as never, memories);

  assert.deepEqual(ids, ["memory-1", "memory-2"]);
  assert.equal(runCalls.length, 1);
  assert.equal(closeCalled, 1);

  const { query, params } = runCalls[0];
  assert.match(query, /UNWIND\s+\$memories\s+as\s+memory/i);
  assert.match(query, /ORDER BY idx ASC/i);

  const batch = params.memories as Array<Record<string, unknown>>;
  assert.equal(batch.length, 2);
  assert.deepEqual(
    batch.map((memory) => memory.idx),
    [0, 1]
  );

  assert.equal(typeof batch[0].id, "string");
  assert.equal(typeof batch[0].createdAt, "string");
  assert.equal(typeof batch[0].updatedAt, "string");
  assert.equal(batch[0].content, "Memory A");
  assert.equal(batch[0].memoryType, MemoryType.Fact);
  assert.equal(batch[0].containerTag, "inbox");
  assert.equal(batch[0].confidence, 0.91);
  assert.deepEqual(batch[0].embedding, [0.1, 0.2, 0.3]);
  assert.equal(batch[0].sourceDocId, "doc-123");
  assert.equal(batch[0].validFrom, "2025-01-01T00:00:00.000Z");
  assert.equal(batch[0].validTo, null);

  assert.equal(batch[1].content, "Memory B");
  assert.equal(batch[1].memoryType, MemoryType.Preference);
  assert.equal(batch[1].validFrom, null);
  assert.equal(batch[1].validTo, "2025-12-31T23:59:59.000Z");
});

test("batchCreateMemories closes the session when the query fails", async () => {
  let closeCalled = 0;

  const session = {
    run: async () => {
      throw new Error("neo4j write failed");
    },
    close: async () => {
      closeCalled += 1;
    },
  };

  const neo4jClient = {
    getDriver: () => ({
      session: () => session,
    }),
  };

  const memories: MemoryBatchInput[] = [
    {
      content: "Memory C",
      memoryType: MemoryType.Fact,
      containerTag: "inbox",
      confidence: 0.9,
      embedding: [0.7],
      sourceDocId: "doc-456",
    },
  ];

  await assert.rejects(
    batchCreateMemories(neo4jClient as never, memories),
    /neo4j write failed/
  );

  assert.equal(closeCalled, 1);
});

test("batchCreateMemories propagates close errors after a successful query", async () => {
  const session = {
    run: async () => ({
      records: [{ get: () => "memory-ok" }],
    }),
    close: async () => {
      throw new Error("session close failed");
    },
  };

  const neo4jClient = {
    getDriver: () => ({
      session: () => session,
    }),
  };

  const memories: MemoryBatchInput[] = [
    {
      content: "Memory D",
      memoryType: MemoryType.Fact,
      containerTag: "inbox",
      confidence: 0.93,
      embedding: [0.9],
      sourceDocId: "doc-789",
    },
  ];

  await assert.rejects(
    batchCreateMemories(neo4jClient as never, memories),
    /session close failed/
  );
});

test("batchCreateMemories stamps all rows with one timestamp and defaults validity windows to null", async () => {
  let capturedParams: Record<string, unknown> | null = null;

  const session = {
    run: async (_query: string, params: Record<string, unknown>) => {
      capturedParams = params;
      return {
        records: [
          { get: () => "memory-1" },
          { get: () => "memory-2" },
          { get: () => "memory-3" },
        ],
      };
    },
    close: async () => undefined,
  };

  const neo4jClient = {
    getDriver: () => ({
      session: () => session,
    }),
  };

  const memories: MemoryBatchInput[] = [
    {
      content: "m1",
      memoryType: MemoryType.Fact,
      containerTag: "inbox",
      confidence: 0.8,
      embedding: [0.1],
      sourceDocId: "doc-1",
    },
    {
      content: "m2",
      memoryType: MemoryType.Preference,
      containerTag: "inbox",
      confidence: 0.81,
      embedding: [0.2],
      sourceDocId: "doc-1",
      validFrom: undefined,
      validTo: undefined,
    },
    {
      content: "m3",
      memoryType: MemoryType.Episode,
      containerTag: "inbox",
      confidence: 0.82,
      embedding: [0.3],
      sourceDocId: "doc-1",
      validFrom: null,
      validTo: null,
    },
  ];

  await batchCreateMemories(neo4jClient as never, memories);

  assert.ok(capturedParams);
  const rows = capturedParams.memories as Array<Record<string, unknown>>;
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.validFrom),
    [null, null, null]
  );
  assert.deepEqual(
    rows.map((row) => row.validTo),
    [null, null, null]
  );

  const createdAtValues = new Set(rows.map((row) => row.createdAt));
  const updatedAtValues = new Set(rows.map((row) => row.updatedAt));
  assert.equal(createdAtValues.size, 1);
  assert.equal(updatedAtValues.size, 1);
  assert.match(String(rows[0].createdAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(rows[0].createdAt, rows[0].updatedAt);
});

test("parallelExtractMemories returns [] and does not call extractor when chunks are empty", async () => {
  let callCount = 0;
  const memoryExtractorService = {
    extractFromChunk: async () => {
      callCount += 1;
      return [] as ExtractedMemory[];
    },
  };

  const result = await parallelExtractMemories([], memoryExtractorService as never, "filter", 3);

  assert.deepEqual(result, []);
  assert.equal(callCount, 0);
});

test("parallelExtractMemories flattens results in chunk order and passes filterPrompt", async () => {
  const chunks: ChunkPayload[] = [
    { content: "chunk-a", chunkIndex: 0, metadata: {} },
    { content: "chunk-b", chunkIndex: 1, metadata: {} },
    { content: "chunk-c", chunkIndex: 2, metadata: {} },
  ];

  const calls: Array<{ chunkText: string; filterPrompt: string | null | undefined }> = [];
  const memoryExtractorService = {
    extractFromChunk: async (
      chunkText: string,
      options?: { filterPrompt?: string | null }
    ): Promise<ExtractedMemory[]> => {
      calls.push({ chunkText, filterPrompt: options?.filterPrompt });
      if (chunkText === "chunk-a") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [
          {
            content: "a-1",
            memoryType: MemoryType.Fact,
            confidence: 0.9,
            validFrom: null,
            validTo: null,
          },
        ];
      }
      if (chunkText === "chunk-b") {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [
          {
            content: "b-1",
            memoryType: MemoryType.Preference,
            confidence: 0.8,
            validFrom: null,
            validTo: null,
          },
          {
            content: "b-2",
            memoryType: MemoryType.Episode,
            confidence: 0.7,
            validFrom: null,
            validTo: null,
          },
        ];
      }
      return [];
    },
  };

  const result = await parallelExtractMemories(chunks, memoryExtractorService as never, "only food", 3);

  assert.deepEqual(
    result.map((memory) => memory.content),
    ["a-1", "b-1", "b-2"]
  );
  assert.deepEqual(
    calls.map((call) => call.filterPrompt),
    ["only food", "only food", "only food"]
  );
});

test("parallelExtractMemories passes null filterPrompt when omitted", async () => {
  const chunks: ChunkPayload[] = [{ content: "chunk-a", chunkIndex: 0, metadata: {} }];
  const seenFilterPrompts: Array<string | null | undefined> = [];

  const memoryExtractorService = {
    extractFromChunk: async (
      _chunkText: string,
      options?: { filterPrompt?: string | null }
    ): Promise<ExtractedMemory[]> => {
      seenFilterPrompts.push(options?.filterPrompt);
      return [];
    },
  };

  const result = await parallelExtractMemories(chunks, memoryExtractorService as never);

  assert.deepEqual(result, []);
  assert.deepEqual(seenFilterPrompts, [null]);
});

test("parallelExtractMemories respects maxConcurrency", async () => {
  const chunks: ChunkPayload[] = Array.from({ length: 6 }, (_, index) => ({
    content: `chunk-${index}`,
    chunkIndex: index,
    metadata: {},
  }));

  let active = 0;
  let maxActive = 0;
  const memoryExtractorService = {
    extractFromChunk: async (): Promise<ExtractedMemory[]> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return [];
    },
  };

  await parallelExtractMemories(chunks, memoryExtractorService as never, null, 2);

  assert.equal(maxActive, 2);
});

test("parallelExtractMemories rejects when extraction fails for any chunk", async () => {
  const chunks: ChunkPayload[] = [
    { content: "chunk-ok-1", chunkIndex: 0, metadata: {} },
    { content: "chunk-fail", chunkIndex: 1, metadata: {} },
    { content: "chunk-ok-2", chunkIndex: 2, metadata: {} },
  ];

  const memoryExtractorService = {
    extractFromChunk: async (chunkText: string): Promise<ExtractedMemory[]> => {
      if (chunkText === "chunk-fail") {
        throw new Error("llm extraction failed");
      }
      return [];
    },
  };

  await assert.rejects(
    parallelExtractMemories(chunks, memoryExtractorService as never, null, 3),
    /llm extraction failed/
  );
});

test("parallelExtractMemories validates maxConcurrency", async () => {
  const chunks: ChunkPayload[] = [{ content: "chunk-a", chunkIndex: 0, metadata: {} }];
  const memoryExtractorService = {
    extractFromChunk: async (): Promise<ExtractedMemory[]> => [],
  };

  await assert.rejects(
    parallelExtractMemories(chunks, memoryExtractorService as never, null, 0),
    /concurrency must be a positive integer/
  );
  await assert.rejects(
    parallelExtractMemories(chunks, memoryExtractorService as never, null, 1.5),
    /concurrency must be a positive integer/
  );
});

test("batchClassifyRelations returns [] and does not call classifier when memories are empty", async () => {
  let callCount = 0;
  const classifier = async () => {
    callCount += 1;
    return [] as const;
  };

  const result = await batchClassifyRelations([], classifier, 3, 2);

  assert.deepEqual(result, []);
  assert.equal(callCount, 0);
});

test("batchClassifyRelations batches memories and flattens results in input order", async () => {
  const memories = ["m1", "m2", "m3", "m4", "m5"];
  const batchCalls: string[][] = [];
  const classifier = async (batch: readonly string[]) => {
    batchCalls.push([...batch]);
    if (batch[0] === "m1") {
      await new Promise((resolve) => setTimeout(resolve, 20));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return batch.map((memory) => `${memory}-classified`);
  };

  const result = await batchClassifyRelations(memories, classifier, 2, 3);

  assert.deepEqual(batchCalls, [["m1", "m2"], ["m3", "m4"], ["m5"]]);
  assert.deepEqual(result, [
    "m1-classified",
    "m2-classified",
    "m3-classified",
    "m4-classified",
    "m5-classified",
  ]);
});

test("batchClassifyRelations passes correct batchIndex values", async () => {
  const memories = ["m1", "m2", "m3", "m4", "m5"];
  const seenBatchIndexes: number[] = [];

  const classifier = async (_batch: readonly string[], batchIndex: number) => {
    seenBatchIndexes.push(batchIndex);
    return [] as const;
  };

  await batchClassifyRelations(memories, classifier, 2, 2);

  assert.deepEqual(seenBatchIndexes, [0, 1, 2]);
});

test("batchClassifyRelations uses default batchSize and maxConcurrency", async () => {
  const memories = Array.from({ length: 21 }, (_, index) => `m${index}`);
  let maxActive = 0;
  let active = 0;
  const batchSizes: number[] = [];

  const classifier = async (batch: readonly string[]) => {
    batchSizes.push(batch.length);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return batch.map((memory) => `${memory}-ok`);
  };

  const result = await batchClassifyRelations(memories, classifier);

  assert.equal(result.length, 21);
  assert.deepEqual(batchSizes, [10, 10, 1]);
  assert.equal(maxActive, 3);
});

test("batchClassifyRelations respects maxConcurrency for batch processing", async () => {
  const memories = Array.from({ length: 12 }, (_, index) => `m${index}`);
  let active = 0;
  let maxActive = 0;

  const classifier = async (batch: readonly string[]) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return batch.map((memory) => `${memory}-ok`);
  };

  await batchClassifyRelations(memories, classifier, 2, 2);

  assert.equal(maxActive, 2);
});

test("batchClassifyRelations rejects when any classification batch fails", async () => {
  const memories = ["m1", "m2", "m3", "m4"];

  const classifier = async (batch: readonly string[]) => {
    if (batch.includes("m3")) {
      throw new Error("llm classification failed");
    }
    return batch.map((memory) => `${memory}-ok`);
  };

  await assert.rejects(
    batchClassifyRelations(memories, classifier, 2, 2),
    /llm classification failed/
  );
});

test("batchClassifyRelations validates batchSize", async () => {
  const classifier = async (batch: readonly string[]) => batch;

  await assert.rejects(
    batchClassifyRelations(["m1"], classifier, 0, 1),
    /batchSize must be a positive integer/
  );
  await assert.rejects(
    batchClassifyRelations(["m1"], classifier, 1.5, 1),
    /batchSize must be a positive integer/
  );
});

test("batchClassifyRelations validates maxConcurrency", async () => {
  const classifier = async (batch: readonly string[]) => batch;

  await assert.rejects(
    batchClassifyRelations(["m1"], classifier, 1, 0),
    /maxConcurrency must be a positive integer/
  );
  await assert.rejects(
    batchClassifyRelations(["m1"], classifier, 1, 1.5),
    /maxConcurrency must be a positive integer/
  );
});

test("processDocument sets error status when memory extraction fails", async () => {
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const now = new Date().toISOString();
  const document = {
    id: "doc-llm-fail",
    title: "Test Doc",
    contentType: ContentType.Text,
    rawContent: "alpha\n\nbeta",
    sourceUrl: null,
    filePath: null,
    containerTag: "inbox",
    metadata: {},
    status: DocumentStatus.Queued,
    createdAt: now,
    updatedAt: now,
  };

  const neo4jClient = {
    getDocument: async () => document,
    updateDocument: async (id: string, payload: Record<string, unknown>) => {
      updateCalls.push({ id, payload });
      return { ...document, ...payload };
    },
    getContainerFilterPrompt: async () => null,
    createChunks: async () => undefined,
    getDriver: () => ({
      session: () => ({
        run: async () => ({ records: [] }),
        close: async () => undefined,
      }),
    }),
  };

  const embeddingService = {
    generateEmbeddings: async (_inputs: readonly string[]) => [],
  };

  const relationClassifierService = {
    classifyAndApply: async () => undefined,
  };

  const memoryExtractorService = {
    extractFromChunk: async () => {
      throw new Error("llm extraction failed");
    },
  };

  const pipeline = new IngestionPipeline(
    neo4jClient as never,
    embeddingService as never,
    relationClassifierService as never,
    memoryExtractorService as never
  );

  await assert.rejects(
    pipeline.processDocument(document.id),
    /llm extraction failed/
  );

  const errorUpdate = updateCalls.at(-1);
  assert.ok(errorUpdate);
  assert.equal(errorUpdate.id, document.id);
  assert.equal(errorUpdate.payload.status, DocumentStatus.Error);
  assert.match(String(errorUpdate.payload.metadata), /llm extraction failed/);
});

test("processDocument sets error status when batch memory creation fails", async () => {
  const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const createdChunkBatches: unknown[] = [];
  const now = new Date().toISOString();
  const document = {
    id: "doc-db-fail",
    title: "Test Doc",
    contentType: ContentType.Text,
    rawContent: "alpha\n\nbeta",
    sourceUrl: null,
    filePath: null,
    containerTag: "inbox",
    metadata: {},
    status: DocumentStatus.Queued,
    createdAt: now,
    updatedAt: now,
  };

  const neo4jClient = {
    getDocument: async () => document,
    updateDocument: async (id: string, payload: Record<string, unknown>) => {
      updateCalls.push({ id, payload });
      return { ...document, ...payload };
    },
    getContainerFilterPrompt: async () => null,
    createChunks: async (chunks: unknown) => {
      createdChunkBatches.push(chunks);
    },
    getDriver: () => ({
      session: () => ({
        run: async () => {
          throw new Error("neo4j write failed");
        },
        close: async () => undefined,
      }),
    }),
  };

  const embeddingService = {
    generateEmbeddings: async (inputs: readonly string[]) => inputs.map(() => [0.01, 0.02]),
  };

  const relationClassifierService = {
    classifyAndApply: async () => undefined,
  };

  const memoryExtractorService = {
    extractFromChunk: async () => [
      {
        content: "memory from chunk",
        memoryType: MemoryType.Fact,
        confidence: 0.94,
        validFrom: null,
        validTo: null,
      },
    ],
  };

  const pipeline = new IngestionPipeline(
    neo4jClient as never,
    embeddingService as never,
    relationClassifierService as never,
    memoryExtractorService as never
  );

  await assert.rejects(
    pipeline.processDocument(document.id),
    /neo4j write failed/
  );

  assert.equal(createdChunkBatches.length, 1);
  const errorUpdate = updateCalls.at(-1);
  assert.ok(errorUpdate);
  assert.equal(errorUpdate.id, document.id);
  assert.equal(errorUpdate.payload.status, DocumentStatus.Error);
  assert.match(String(errorUpdate.payload.metadata), /neo4j write failed/);
});
