import assert from "node:assert/strict";
import test from "node:test";

import { batchCreateMemories, type MemoryBatchInput } from "../src/services/ingestion/batching.js";
import { MemoryType } from "../src/types/enums.js";

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

  const batch = params.memories as Array<Record<string, unknown>>;
  assert.equal(batch.length, 2);

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
