import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppConfig } from "../config.js";
import { Neo4jClient } from "./neo4j-client.js";
import { RelationType } from "../types/enums.js";

const config = {
  NEO4J_URI: "bolt://127.0.0.1:7687",
  NEO4J_USER: "test",
  NEO4J_PASSWORD: "test",
  OPENAI_API_KEY: "test",
  ANTHROPIC_API_KEY: "test",
  ANTHROPIC_MODEL: "test",
  OPENAI_EMBEDDING_MODEL: "test",
  COHERE_RERANK_MODEL: "test"
} as AppConfig;

type FakeSession = {
  run?: (query: string, params: Record<string, unknown>) => Promise<unknown>;
  executeWrite?: (work: (transaction: { run: FakeSession["run"] }) => Promise<unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

function clientWithSession(session: FakeSession): Neo4jClient {
  const client = new Neo4jClient(config);
  (client as unknown as { driver: { session: () => FakeSession } }).driver = {
    session: () => session
  };
  return client;
}

function counters(nodesDeleted = 0, relationshipsCreated = 0) {
  return {
    updates: () => ({ nodesDeleted, relationshipsCreated })
  };
}

function memoryRecord(id: string, score: number, content = "Historical fact") {
  return {
    get: (key: string) => key === "score"
      ? score
      : {
        properties: {
          id,
          content,
          memoryType: "fact",
          containerTag: "test",
          isLatest: true,
          confidence: 0.9,
          embedding: [0.1, 0.2],
          createdAt: "2026-01-01T00:00:00.000Z",
          sourceDocId: "document-1"
        }
      }
  };
}

describe("Neo4jClient repair relation idempotency", () => {
  it("expands historical vector search past newer filtered candidates", async () => {
    const vectorLimits: number[] = [];
    const client = clientWithSession({
      run: async (query, params = {}) => {
        if (query.includes("count(node) AS count")) {
          return { records: [{ get: () => 250 }] };
        }
        if (query.includes("vector.similarity.cosine")) {
          return { records: [memoryRecord("historical-memory", 0.91)] };
        }
        const vectorLimit = Number(String(params.vectorLimit));
        vectorLimits.push(vectorLimit);
        if (vectorLimit < 250) {
          return { records: [] };
        }
        return { records: [memoryRecord("historical-memory", 0.91)] };
      },
      close: async () => undefined
    });

    const result = await client.semanticSearchMemories({
      embedding: [0.1, 0.2],
      asOf: "2026-01-02T00:00:00.000Z",
      limit: 10
    });

    assert.deepEqual(vectorLimits, [100, 200, 250]);
    assert.equal(result[0]?.memory.id, "historical-memory");
  });

  it("falls back to exact similarity when the approximate historical index underfills", async () => {
    const vectorLimits: number[] = [];
    let exactFallbacks = 0;
    const client = clientWithSession({
      run: async (query, params = {}) => {
        if (query.includes("count(node) AS count")) {
          return { records: [{ get: () => 250 }] };
        }
        if (query.includes("vector.similarity.cosine")) {
          exactFallbacks += 1;
          assert.match(query, /MATCH \(node:Memory \{containerTag: \$containerTag\}\)/);
          assert.match(query, /node\.containerTag = \$containerTag/);
          assert.match(query, /node\.createdAt <= datetime\(\$asOf\)/);
          assert.match(query, /node\.validFrom IS NULL/);
          assert.match(query, /node\.validTo IS NULL/);
          assert.match(query, /node\.forgottenAt > datetime\(\$asOf\)/);
          assert.match(query, /\$isLatestOnly = false/);
          assert.match(query, /score >= \$minScore/);
          return {
            records: [memoryRecord(
              "exact-historical-memory",
              0.88,
              "Historical fact outside the approximate neighborhood"
            )]
          };
        }
        vectorLimits.push(Number(String(params.vectorLimit)));
        return { records: [] };
      },
      close: async () => undefined
    });

    const result = await client.semanticSearchMemories({
      embedding: [0.1, 0.2],
      containerTag: "test",
      minScore: 0.8,
      asOf: "2026-01-02T00:00:00.000Z",
      limit: 10
    });

    assert.deepEqual(vectorLimits, [100, 200, 250]);
    assert.equal(exactFallbacks, 1);
    assert.equal(result[0]?.memory.id, "exact-historical-memory");
  });

  it("keeps the exact fallback behind every historical underfill gate", async () => {
    const cases = [
      {
        name: "missing asOf",
        params: { containerTag: "test" },
        approximateRecords: []
      },
      {
        name: "missing containerTag",
        params: { asOf: "2026-01-02T00:00:00.000Z" },
        approximateRecords: []
      },
      {
        name: "approximate search already full",
        params: {
          asOf: "2026-01-02T00:00:00.000Z",
          containerTag: "test"
        },
        approximateRecords: Array.from(
          { length: 10 },
          (_, index) => memoryRecord(`approximate-${index}`, 0.9 - index / 100)
        )
      }
    ];

    for (const testCase of cases) {
      let exactFallbacks = 0;
      const client = clientWithSession({
        run: async (query) => {
          if (query.includes("count(node) AS count")) {
            return { records: [{ get: () => 1 }] };
          }
          if (query.includes("vector.similarity.cosine")) {
            exactFallbacks += 1;
          }
          return { records: testCase.approximateRecords };
        },
        close: async () => undefined
      });

      await client.semanticSearchMemories({
        embedding: [0.1, 0.2],
        minScore: 0.8,
        limit: 10,
        ...testCase.params
      });

      assert.equal(exactFallbacks, 0, testCase.name);
    }
  });

  it("preserves EXTENDS evidence before deleting generated memories", async () => {
    const queries: string[] = [];
    const transaction = {
      run: async (query: string) => {
        queries.push(query);
        if (query.includes("repairLockVersion")) {
          return {
            records: [{ get: (key: string) => key === "existingRepairId" ? "repair-1" : null }]
          };
        }
        if (query.includes("DETACH DELETE m")) {
          return { records: [], summary: { counters: counters(1) } };
        }
        if (query.includes("DETACH DELETE c")) {
          return { records: [], summary: { counters: counters(2) } };
        }
        if (query.includes("SET d.repairRunId")) {
          return {
            records: [{
              get: () => ({
                properties: {
                  id: "document-1",
                  title: "Document",
                  contentType: "text",
                  rawContent: "content",
                  containerTag: "test",
                  metadata: {},
                  status: "extracting",
                  createdAt: "2026-07-13T00:00:00.000Z",
                  updatedAt: "2026-07-13T00:00:00.000Z"
                }
              })
            }]
          };
        }
        return { records: [], summary: { counters: counters() } };
      }
    };
    const client = clientWithSession({
      executeWrite: async (work) => work(transaction),
      close: async () => undefined
    });

    const result = await client.prepareDocumentForReprocessing("document-1", "repair-1");

    const preserveIndex = queries.findIndex((query) => query.includes("REPAIR_EXTENDS"));
    const deleteIndex = queries.findIndex((query) => query.includes("DETACH DELETE m"));
    assert.ok(preserveIndex >= 0);
    assert.ok(deleteIndex > preserveIndex);
    assert.equal(result.deletedMemoryCount, 1);
    assert.equal(result.deletedChunkCount, 2);
  });

  it("gates atomic preference reinforcement when an EXTENDS repair marker exists", async () => {
    const queries: string[] = [];
    const parameters: Array<Record<string, unknown>> = [];
    const markedClient = clientWithSession({
      run: async (query, params) => {
        queries.push(query);
        parameters.push(params);
        return {
          records: [{ get: (key: string) => key === "created" }],
          summary: { counters: counters(0, 1) }
        };
      },
      close: async () => undefined
    });

    assert.equal(
      await markedClient.createMemoryRelation(
        "new-memory",
        "preference",
        RelationType.Extends,
        { reinforceTargetPreference: true }
      ),
      true
    );
    assert.match(queries[0] ?? "", /source\.id = from\.sourceDocId/);
    assert.match(queries[0] ?? "", /NOT preservedFromRepair/);
    assert.match(queries[0] ?? "", /to\.forgottenAt IS NULL/);
    assert.equal(parameters[0]?.checkRepairMarker, true);
    assert.equal(parameters[0]?.reinforceTargetPreference, true);

    const updateParameters: Array<Record<string, unknown>> = [];
    const updateClient = clientWithSession({
      run: async (_query, params) => {
        updateParameters.push(params);
        return {
          records: [{ get: (key: string) => key === "created" }],
          summary: { counters: counters(0, 1) }
        };
      },
      close: async () => undefined
    });
    assert.equal(
      await updateClient.createMemoryRelation(
        "other-memory",
        "existing-memory",
        RelationType.Updates,
        { markTargetNotLatest: true }
      ),
      true
    );
    assert.equal(updateParameters[0]?.checkRepairMarker, false);
  });

  it("retains repair markers on release and removes them only on completion", async () => {
    const queries: string[] = [];
    const client = clientWithSession({
      run: async (query) => {
        queries.push(query);
        return { records: [{}], summary: { counters: counters() } };
      },
      close: async () => undefined
    });

    await client.releaseDocumentReprocessing("document-1", "repair-1");
    await client.completeDocumentReprocessing("document-1", "repair-1");

    assert.doesNotMatch(queries[0] ?? "", /DELETE preserved/);
    assert.match(queries[1] ?? "", /DELETE preserved/);
    assert.match(queries[1] ?? "", /repairRunId: \$repairId/);
  });
});
