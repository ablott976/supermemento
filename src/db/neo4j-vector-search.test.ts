import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AppConfig } from "../config.js";
import { MemoryType } from "../types/enums.js";
import { Neo4jClient } from "./neo4j-client.js";

// Opt in only against a disposable Neo4j 5.26 instance, never the application DB.
// NEO4J_VECTOR_TEST_URI=bolt://127.0.0.1:<port> npm test
const uri = process.env.NEO4J_VECTOR_TEST_URI;

describe("Container vector search (real Neo4j)", { skip: !uri }, () => {
  const containerTag = `chatgpt-mcp-canary-${randomUUID()}`;
  const otherContainer = `${containerTag}-other`;
  const embedding = [1, 0, 0];
  const client = new Neo4jClient({
    NEO4J_URI: uri,
    NEO4J_USER: "neo4j",
    NEO4J_PASSWORD: "vector-test-only"
  } as AppConfig);
  const session = client.getDriver().session();
  const params = { embedding, containerTag, limit: 3, isLatestOnly: true };

  before(async () => {
    await client.verifyConnectivity();
    for (const [index, label] of [["memory_embeddings", "Memory"], ["chunk_embeddings", "Chunk"]]) {
      await session.run(`CREATE VECTOR INDEX ${index} IF NOT EXISTS FOR (node:${label})
        ON node.embedding OPTIONS {indexConfig: {
          \`vector.dimensions\`: 3, \`vector.similarity_function\`: 'cosine'}}`);
    }
    await session.run("CREATE INDEX memory_container IF NOT EXISTS FOR (node:Memory) ON node.containerTag");
    await session.run("CALL db.awaitIndexes()");
    const rows = [
      ...Array.from({ length: 80 }, (_, i) => ({
        id: `other-${i}`, containerTag: otherContainer, embedding,
        createdAt: "2099-01-01T00:00:00Z"
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `valid-${i}`, containerTag, embedding: [0.6 + i * 0.02, 0.8, 0]
      })),
      { id: "expired", containerTag, embedding, validTo: "2020-01-01T00:00:00Z" },
      { id: "forgotten", containerTag, embedding, forgottenAt: "2021-01-01T00:00:00Z" },
      { id: "obsolete", containerTag, embedding, isLatest: false },
      { id: "preference", containerTag, embedding, memoryType: "preference" },
      { id: "future", containerTag, embedding, createdAt: "2099-01-01T00:00:00Z" },
      { id: "future-validity", containerTag, embedding, validFrom: "2099-01-01T00:00:00Z" },
      { id: "wrong-dimension", containerTag, embedding: [1, 0] },
      { id: "zero-vector", containerTag, embedding: [0, 0, 0] },
      { id: "missing-embedding", containerTag },
      {
        id: "historical", containerTag, embedding, isLatest: false,
        validTo: "2024-01-01T00:00:00Z", forgottenAt: "2024-01-01T00:00:00Z"
      },
      { id: "superseding", containerTag, createdAt: "2024-01-01T00:00:00Z" }
    ].map((row) => row.containerTag === containerTag && row.embedding === embedding
      ? { ...row, embedding: [row.id === "historical" ? 0.95 : 0.9, 0.1, 0] }
      : row);
    await session.run(`UNWIND $rows AS row CREATE (node:Memory)
      SET node = row, node.id = $prefix + row.id, node.content = row.id,
          node.memoryType = coalesce(row.memoryType, 'fact'),
          node.isLatest = coalesce(row.isLatest, true), node.confidence = 0.9,
          node.createdAt = datetime(coalesce(row.createdAt, '2019-01-01T00:00:00Z')),
          node.validFrom = datetime(row.validFrom), node.validTo = datetime(row.validTo),
          node.forgottenAt = datetime(row.forgottenAt), node.sourceDocId = 'test-document'`,
    { rows, prefix: containerTag });
    await session.run(`MATCH (new:Memory {id: $new}), (old:Memory {id: $old})
      CREATE (new)-[:UPDATES]->(old)`,
    { new: `${containerTag}superseding`, old: `${containerTag}historical` });
    await session.run(`UNWIND $rows AS row CREATE (node:Chunk)
      SET node = row, node.id = $prefix + row.id, node.content = row.id,
          node.chunkIndex = 0, node.sourceDocId = 'test-document'`,
    { rows: rows.filter((row) => row.id.startsWith("other-") || row.id.startsWith("valid-")
      || ["zero-vector", "wrong-dimension", "missing-embedding"].includes(row.id)), prefix: containerTag });
    // Verify the skew really starves the former limit * 10 candidate window.
    for (const index of ["memory_embeddings", "chunk_embeddings"]) {
      const candidates = await session.run(`CALL db.index.vector.queryNodes($index, 30, $embedding)
        YIELD node RETURN node.containerTag AS tag`, { index, embedding });
      assert.equal(candidates.records.length, 30);
      assert.ok(candidates.records.every((record) => record.get("tag") === otherContainer));
    }
  });

  after(async () => {
    try {
      await session.run("MATCH (node) WHERE node.containerTag IN $tags DETACH DELETE node",
        { tags: [containerTag, otherContainer] });
    } finally {
      await session.close();
      await client.close();
    }
  });

  function checkHits(hits: Array<{ score: number }>, ids: string[], expected: string[]) {
    assert.deepEqual(ids, expected.map((id) => containerTag + id));
    assert.ok(hits.every((hit, i) => i === 0 || hits[i - 1]!.score >= hit.score));
  }

  it("fills ordinary memory searches despite globally closer matches", async () => {
    // Current search deliberately permits future createdAt/validFrom without asOf.
    const hits = await client.semanticSearchMemories(params);
    assert.equal(hits.length, 3);
    assert.ok(hits.every((hit) => hit.memory.containerTag === containerTag));
    assert.ok(hits.every((hit) => !["expired", "forgotten", "obsolete", "historical"]
      .some((id) => hit.memory.id === containerTag + id)));
    const all = await client.semanticSearchMemories({ ...params, limit: 20 });
    assert.equal(all.length, 9);
  });

  it("fills advanced filtered searches and preserves expiry/type/latest filters", async () => {
    const hits = await client.semanticSearchMemoriesAdvanced({ ...params, memoryTypes: [MemoryType.Fact] });
    assert.equal(hits.length, 3);
    assert.ok(hits.every((hit) => hit.memory.containerTag === containerTag));
    assert.ok(hits.every((hit) => hit.memory.memoryType === MemoryType.Fact && hit.memory.isLatest));
    assert.ok(hits.every((hit) => !hit.memory.forgottenAt && !hit.memory.validTo));
    const all = await client.semanticSearchMemoriesAdvanced({ ...params, memoryTypes: [MemoryType.Fact], limit: 20 });
    assert.equal(all.length, 8);
    const expired = await client.semanticSearchMemoriesAdvanced({ ...params, includeExpired: true, limit: 20 });
    assert.ok(expired.some((hit) => hit.memory.id === containerTag + "expired"));
    assert.ok(expired.every((hit) => !hit.memory.forgottenAt));
    const obsolete = await client.semanticSearchMemoriesAdvanced({ ...params, isLatestOnly: false, limit: 20 });
    assert.ok(obsolete.some((hit) => hit.memory.id === containerTag + "obsolete"));
  });

  it("fills chunk searches in similarity order and returns all available hits", async () => {
    const hits = await client.semanticSearchChunks(params);
    checkHits(hits, hits.map((hit) => hit.chunk.id), ["valid-5", "valid-4", "valid-3"]);
    assert.ok(hits.every((hit) => hit.chunk.containerTag === containerTag));
    const all = await client.semanticSearchChunks({ ...params, limit: 10 });
    assert.equal(all.length, 6);
  });

  it("preserves historical validity and supersession within the container", async () => {
    const hits = await client.semanticSearchMemories({ ...params, asOf: "2023-01-01T00:00:00Z" });
    assert.equal(hits[0]?.memory.id, containerTag + "historical");
    assert.deepEqual(hits.map((hit) => hit.memory.id).sort(),
      ["historical", "obsolete", "preference"].map((id) => containerTag + id).sort());
    const later = await client.semanticSearchMemories({ ...params, asOf: "2025-01-01T00:00:00Z", limit: 20 });
    assert.ok(later.every((hit) => hit.memory.id !== containerTag + "historical"));
    assert.ok(later.every((hit) => !hit.memory.id.endsWith("future") && !hit.memory.id.endsWith("future-validity")));
  });

  it("keeps global vector search and historical candidate expansion available", async () => {
    const global = await client.semanticSearchChunks({ embedding, limit: 3 });
    assert.equal(global.length, 3);
    assert.ok(global.every((hit) => hit.chunk.containerTag === otherContainer));
    const historical = await client.semanticSearchMemories({ embedding, limit: 3, asOf: "2023-01-01T00:00:00Z" });
    assert.equal(historical.length, 3);
    assert.ok(historical.every((hit) => hit.memory.containerTag === containerTag));
  });

  it("respects minimum score and returns no hits for an absent container", async () => {
    for (const search of [client.semanticSearchMemories, client.semanticSearchMemoriesAdvanced, client.semanticSearchChunks]) {
      assert.deepEqual(await search.call(client, { ...params, containerTag: `${containerTag}-absent` }), []);
      assert.deepEqual(await search.call(client, { ...params, minScore: 1.1 }), []);
    }
  });
});
