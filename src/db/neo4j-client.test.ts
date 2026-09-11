import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppConfig } from "../config.js";
import { Neo4jClient } from "./neo4j-client.js";
import { memoryContentHash } from "../services/memory-policy.js";
import { MemoryType, RelationType } from "../types/enums.js";

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

describe("Memory metadata persistence", () => {
  const metadata = { source: "gmail", messageId: "mail-123", nested: { tags: ["pmm"], processed: true, value: null } };
  const input = {
    content: "Metadata regression test",
    memoryType: MemoryType.Fact,
    containerTag: "test",
    confidence: 0.9,
    embedding: [0.1, 0.2],
    sourceDocId: "document-1"
  };
  const record = (stored: unknown) => ({
    get: () => ({ properties: { ...input, id: "memory-1", createdAt: "2026-01-01T00:00:00Z", metadata: stored } })
  });

  it("serializes nested metadata for Neo4j and returns an object", async () => {
    const client = clientWithSession({
      run: async (query, params) => {
        assert.match(query, /metadata: \$metadata/);
        assert.equal(params.metadata, JSON.stringify(metadata));
        return { records: [record(params.metadata)] };
      },
      close: async () => undefined
    });
    assert.deepEqual((await client.createMemory({ ...input, metadata })).metadata, metadata);
  });

  it("defaults new memories without metadata to an empty object", async () => {
    const client = clientWithSession({
      run: async (_query, params) => {
        assert.equal(params.metadata, "{}");
        return { records: [record(params.metadata)] };
      },
      close: async () => undefined
    });
    assert.deepEqual((await client.createMemory(input)).metadata, {});
  });

  it("preserves independent metadata on each batch item", async () => {
    const client = clientWithSession({
      run: async (query, params) => {
        assert.match(query, /metadata: row.metadata/);
        const rows = params.rows as { metadata: string }[];
        assert.deepEqual(rows.map((row) => row.metadata), [JSON.stringify(metadata), "{}"]);
        return { records: rows.map((row) => record(row.metadata)) };
      },
      close: async () => undefined
    });
    assert.deepEqual((await client.batchCreateMemories([{ ...input, metadata }, input])).map((m) => m.metadata), [metadata, {}]);
  });

  it("replaces, preserves, and clears metadata on update", async () => {
    let stored = JSON.stringify({ original: true });
    const client = clientWithSession({
      run: async (query, params) => {
        assert.match(query, /m.metadata = COALESCE\(\$metadata, m.metadata\)/);
        assert.match(query, /m.embedding = COALESCE\(\$embedding, m.embedding\)/);
        assert.deepEqual(params.embedding, null);
        assert.ok(params.metadata === null || typeof params.metadata === "string");
        stored = params.metadata as string | null ?? stored;
        return { records: [record(stored)] };
      },
      close: async () => undefined
    });
    assert.deepEqual((await client.updateMemory("memory-1", { metadata }))?.metadata, metadata);
    assert.deepEqual((await client.updateMemory("memory-1", { confidence: 0.8 }))?.metadata, metadata);
    assert.deepEqual((await client.updateMemory("memory-1", { metadata: {} }))?.metadata, {});
  });

  it("reads legacy memories without metadata without a migration", async () => {
    const client = clientWithSession({
      run: async () => ({ records: [record(undefined)] }),
      close: async () => undefined
    });
    assert.deepEqual((await client.listMemories({}))[0]?.metadata, {});
  });
});

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
          assert.match(query, /size\(node\.embedding\) = size\(\$embedding\)/);
          assert.ok(
            query.indexOf("size(node.embedding) = size($embedding)")
              < query.indexOf("vector.similarity.cosine")
          );
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


describe("Exact dedup support in Neo4jClient", () => {
  const input = {
    content: "GTC significa GoTimeCloud.",
    memoryType: MemoryType.Fact,
    containerTag: "test",
    confidence: 0.9,
    embedding: [0.1, 0.2],
    sourceDocId: "document-1"
  };
  const expectedHash = memoryContentHash("test", input.content);
  const record = (props: Record<string, unknown>) => ({
    get: () => ({ properties: { ...input, id: "memory-1", createdAt: "2026-01-01T00:00:00Z", metadata: "{}", ...props } })
  });

  it("stores contentHash on single, batch and derived creation", async () => {
    const single = clientWithSession({
      run: async (query, params) => {
        assert.match(query, /contentHash: \$contentHash/);
        assert.equal(params.contentHash, expectedHash);
        return { records: [record({ contentHash: params.contentHash })] };
      },
      close: async () => undefined
    });
    assert.equal((await single.createMemory(input)).contentHash, expectedHash);

    const batch = clientWithSession({
      run: async (query, params) => {
        assert.match(query, /contentHash: row.contentHash/);
        const rows = params.rows as { contentHash: string; content: string }[];
        assert.deepEqual(rows.map((row) => row.contentHash), [expectedHash, memoryContentHash("test", "otra")]);
        return { records: rows.map((row) => record({ contentHash: row.contentHash, content: row.content })) };
      },
      close: async () => undefined
    });
    assert.deepEqual((await batch.batchCreateMemories([input, { ...input, content: "otra" }])).map((m) => m.contentHash), [expectedHash, memoryContentHash("test", "otra")]);

    const derived = clientWithSession({
      executeWrite: async (work) => work({
        run: async (query: string, params: Record<string, unknown>) => {
          if (query.includes("DERIVES]->(source:Memory)")) return { records: [] };
          assert.match(query, /derived\.contentHash = \$contentHash/);
          assert.equal(params.contentHash, memoryContentHash("test", "Hecho derivado"));
          return { records: [record({ content: "Hecho derivado", memoryType: "derived", contentHash: params.contentHash })] };
        }
      }),
      close: async () => undefined
    });
    const derivedMemory = await derived.createDerivedMemory({ content: "Hecho derivado", containerTag: "test", sourceDocId: "document-1", sourceMemoryIds: ["m-a"], embedding: [0.1] });
    assert.equal(derivedMemory.contentHash, memoryContentHash("test", "Hecho derivado"));
  });

  it("lists midnight-UTC validity memories not yet normalised, pages by id and writes reversible changes", async () => {
    const queries: string[] = [];
    let seen: Record<string, unknown> = {};
    const row = (columns: Record<string, unknown>) => ({ get: (key: string) => columns[key] });
    const client = clientWithSession({
      run: async (query, params) => {
        queries.push(query);
        seen = params;
        if (query.includes("RETURN m.id AS id, m.validFrom AS validFrom, m.validTo AS validTo")) {
          return { records: [row({ id: "m-1", validFrom: null, validTo: new Date("2026-09-11T00:00:00Z") })] };
        }
        return { records: [row({ count: 1 })] };
      },
      close: async () => undefined
    });
    const listed = await client.listMidnightValidityMemories(10, "m-0");
    assert.deepEqual(listed, [{ id: "m-1", validFrom: null, validTo: "2026-09-11T00:00:00.000Z" }]);
    assert.match(queries[0]!, /m\.validityRunId IS NULL AND m\.id > \$afterId/);
    assert.match(queries[0]!, /m\.validTo\.hour = 0 AND m\.validTo\.minute = 0 AND m\.validTo\.second = 0 AND m\.validTo\.nanosecond = 0/);
    assert.equal(seen.afterId, "m-0");
    assert.equal(await client.setValidityDates([{ id: "m-1", validFrom: null, validTo: "2026-09-11T21:59:59.999Z" }], "validity-1"), 1);
    assert.match(queries[1]!, /m\.validityLegacyValidFrom = m\.validFrom/);
    assert.match(queries[1]!, /m\.validityLegacyValidTo = m\.validTo/);
    assert.match(queries[1]!, /WHERE m\.validityRunId IS NULL/);
    assert.equal(seen.runId, "validity-1");
    assert.equal(await client.setValidityDates([], "validity-1"), 0, "no query for an empty batch");
    assert.equal(await client.restoreValidityDates("validity-1"), 1);
    assert.match(queries[2]!, /SET m\.validFrom = m\.validityLegacyValidFrom/);
    assert.match(queries[2]!, /REMOVE m\.validityRunId, m\.validityNormalizedAt, m\.validityLegacyValidFrom, m\.validityLegacyValidTo/);
  });

  it("looks up only active memories by container and hash", async () => {
    let seen: Record<string, unknown> = {};
    const client = clientWithSession({
      run: async (query, params) => {
        seen = params;
        assert.match(query, /MATCH \(m:Memory \{containerTag: \$containerTag, contentHash: \$contentHash\}\)/);
        assert.match(query, /m\.isLatest = true/);
        assert.match(query, /m\.forgottenAt IS NULL/);
        assert.match(query, /m\.validTo IS NULL OR m\.validTo >= datetime\(\)/);
        assert.match(query, /ORDER BY m\.createdAt ASC/);
        return { records: params.contentHash === expectedHash ? [record({ contentHash: expectedHash })] : [] };
      },
      close: async () => undefined
    });
    const hit = await client.findActiveMemoryByContentHash("test", expectedHash);
    assert.equal(hit?.id, "memory-1");
    assert.deepEqual(seen, { containerTag: "test", contentHash: expectedHash });
    assert.equal(await client.findActiveMemoryByContentHash("test", "missing"), null);
  });

  it("backfills hashes in batches and reports duplicate groups oldest first", async () => {
    const queries: string[] = [];
    let pending = 2;
    const client = clientWithSession({
      run: async (query, params) => {
        queries.push(query);
        if (query.includes("m.contentHash IS NULL")) {
          if (pending === 0) return { records: [] };
          pending = 0;
          return { records: [
            { get: (key: string) => ({ id: "a", containerTag: "test", content: "GTC" })[key] },
            { get: (key: string) => ({ id: "b", containerTag: "test", content: "gtc " })[key] }
          ] };
        }
        if (query.includes("SET m.contentHash = row.contentHash")) {
          const rows = params.rows as { id: string; contentHash: string }[];
          assert.deepEqual(rows.map((row) => row.contentHash), [memoryContentHash("test", "GTC"), memoryContentHash("test", "gtc ")]);
          return { records: [{ get: () => rows.length }] };
        }
        if (query.includes("size(members) > 1")) {
          assert.match(query, /ORDER BY m\.createdAt ASC/);
          return { records: [{ get: (key: string) => ({
            containerTag: "test", contentHash: expectedHash,
            members: [{ id: "old", createdAt: "2026-01-01T00:00:00Z", content: "GTC", sourceDocId: "d1" }, { id: "new", createdAt: "2026-02-01T00:00:00Z", content: "gtc", sourceDocId: "d2" }]
          })[key] }] };
        }
        throw new Error(`unexpected query: ${query}`);
      },
      close: async () => undefined
    });
    assert.deepEqual(await client.listMemoriesMissingContentHash(500), [
      { id: "a", containerTag: "test", content: "GTC" }, { id: "b", containerTag: "test", content: "gtc " }
    ]);
    assert.equal(await client.setMemoryContentHashes([
      { id: "a", contentHash: memoryContentHash("test", "GTC") }, { id: "b", contentHash: memoryContentHash("test", "gtc ") }
    ]), 2);
    assert.equal(await client.setMemoryContentHashes([]), 0);
    const groups = await client.findDuplicateMemoryGroups();
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]?.members.map((member) => member.id), ["old", "new"]);
  });

  it("retires duplicates reversibly and restores them by run", async () => {
    const queries: Array<[string, Record<string, unknown>]> = [];
    const client = clientWithSession({
      run: async (query, params) => {
        queries.push([query, params]);
        return { records: [{ get: () => 2 }] };
      },
      close: async () => undefined
    });
    assert.equal(await client.retireDuplicateMemories({ canonicalId: "old", duplicateIds: ["new", "newer"], runId: "dedupe-2026-09-10" }), 2);
    const [retireQuery, retireParams] = queries[0]!;
    assert.match(retireQuery, /SET duplicate\.isLatest = false/);
    assert.match(retireQuery, /duplicate\.dedupRunId = \$runId/);
    assert.match(retireQuery, /MERGE \(duplicate\)-\[r:DUPLICATE_OF\]->\(canonical\)/);
    assert.doesNotMatch(retireQuery, /DELETE/);
    assert.deepEqual({ canonicalId: retireParams.canonicalId, duplicateIds: retireParams.duplicateIds, runId: retireParams.runId },
      { canonicalId: "old", duplicateIds: ["new", "newer"], runId: "dedupe-2026-09-10" });
    assert.equal(await client.retireDuplicateMemories({ canonicalId: "old", duplicateIds: [], runId: "x" }), 0);

    assert.equal(await client.restoreRetiredDuplicates("dedupe-2026-09-10"), 2);
    const [restoreQuery, restoreParams] = queries[1]!;
    assert.match(restoreQuery, /MATCH \(m:Memory \{dedupRunId: \$runId\}\)/);
    assert.match(restoreQuery, /SET m\.isLatest = true/);
    assert.match(restoreQuery, /REMOVE m\.dedupRunId, m\.dedupCanonicalId, m\.dedupRetiredAt/);
    assert.deepEqual(restoreParams, { runId: "dedupe-2026-09-10" });
  });

  it("returns document metadata as an object even when Neo4j stores a JSON string", async () => {
    const document = (metadata: unknown) => ({
      get: () => ({ properties: {
        id: "document-1", title: "Doc", contentType: "text", rawContent: "x", containerTag: "test",
        metadata, status: "done", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z"
      } })
    });
    const cases: Array<[unknown, Record<string, unknown>]> = [
      ['{"temporal_class":"pricing","valid_to":"2026-12-31T00:00:00Z"}', { temporal_class: "pricing", valid_to: "2026-12-31T00:00:00Z" }],
      ["{}", {}],
      ["not json", {}],
      [undefined, {}],
      [{ already: "object" }, { already: "object" }]
    ];
    for (const [stored, expected] of cases) {
      const client = clientWithSession({ run: async () => ({ records: [document(stored)] }), close: async () => undefined });
      assert.deepEqual((await client.getDocument("document-1"))?.metadata, expected);
    }
  });
});
