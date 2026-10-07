import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AppConfig } from "../config.js";
import { SupermementoServer } from "../server.js";
import { ContentType, DocumentStatus, MemoryType } from "../types/enums.js";
import type { Document, Memory } from "../types/models.js";
import { Neo4jClient } from "./neo4j-client.js";

// Run against a disposable Neo4j instance; never use a production database.
describe("Neo4j list projections", { skip: !process.env.TEST_NEO4J_URI }, () => {
  const database = new Neo4jClient({
    NEO4J_URI: process.env.TEST_NEO4J_URI,
    NEO4J_USER: process.env.TEST_NEO4J_USER ?? "neo4j",
    NEO4J_PASSWORD: process.env.TEST_NEO4J_PASSWORD ?? "test"
  } as AppConfig);
  const containerTag = "chatgpt-mcp-canary";
  const documents: Document[] = [];
  const memories: Memory[] = [];
  const ids: string[] = [];

  before(async () => {
    await database.verifyConnectivity();
    for (let index = 0; index < 3; index += 1) {
      const document = await database.createDocument({
        title: `List projection ${index}`,
        contentType: ContentType.Text,
        rawContent: "Large document body. ".repeat(50_000),
        containerTag,
        metadata: { nested: { tags: ["canary"], enabled: true, value: null } },
        sourceUrl: "https://example.com/document",
        filePath: "/canary/document.txt"
      });
      ids.push(document.id);
      const memory = await database.createMemory({
        content: `List projection memory ${index}`,
        memoryType: index === 2 ? MemoryType.Episode : MemoryType.Fact,
        containerTag,
        confidence: 0.9,
        embedding: Array.from({ length: 3072 }, () => 0.1),
        sourceDocId: document.id,
        metadata: { nested: { tags: ["canary"] } },
        validFrom: "2026-01-01T00:00:00Z",
        validTo: "2026-12-31T00:00:00Z"
      });
      ids.push(memory.id);
      const session = database.getDriver().session();
      try {
        await session.run(`
          MATCH (d:Document {id: $documentId}), (m:Memory {id: $memoryId})
          SET d.createdAt = datetime($createdAt), m.createdAt = datetime($createdAt),
              d.status = $status, m.isLatest = $isLatest,
              m.originalConfidence = 0.95,
              m.forgottenAt = CASE WHEN $isLatest THEN null ELSE datetime($createdAt) END
        `, {
          documentId: document.id,
          memoryId: memory.id,
          createdAt: `2026-01-0${index + 1}T00:00:00Z`,
          status: index === 2 ? DocumentStatus.Done : DocumentStatus.Queued,
          isLatest: index !== 2
        });
      } finally {
        await session.close();
      }
      documents.push((await database.getDocument(document.id))!);
      memories.push((await database.getMemory(memory.id))!);
    }
  });

  after(async () => {
    const session = database.getDriver().session();
    try {
      await session.run("MATCH (n) WHERE n.id IN $ids DETACH DELETE n", { ids });
    } finally {
      await session.close();
      await database.close();
    }
  });

  it("lists document metadata without rawContent and preserves filters, order and limit", async () => {
    const listed = await database.listDocuments({ containerTag, status: DocumentStatus.Queued, limit: 1 });
    const { rawContent, ...expected } = documents[1]!;
    assert.deepEqual(listed, [expected]);
    assert.equal(rawContent.length, 1_050_000, "individual reads retain the full document");
    assert.deepEqual(await database.listDocuments({ containerTag: "missing-canary" }), []);
    assert.equal((await database.listDocuments({ containerTag })).length, 3);
  });

  it("lists memory fields without embedding and preserves filters, order and limit", async () => {
    const listed = await database.listMemories({ containerTag, memoryType: MemoryType.Fact, isLatest: true, limit: 1 });
    const { embedding, ...expected } = memories[1]!;
    assert.deepEqual(listed, [expected]);
    assert.equal(embedding.length, 3072, "individual reads retain the embedding");
    assert.deepEqual(await database.listMemories({ containerTag, memoryType: MemoryType.Fact, isLatest: false }), []);
    assert.deepEqual(await database.listMemories({ containerTag: "missing-canary" }), []);
    const historical = await database.listMemories({ containerTag, isLatest: false });
    const { embedding: historicalEmbedding, ...historicalExpected } = memories[2]!;
    assert.deepEqual(historical, [historicalExpected]);
    assert.equal(historicalEmbedding.length, 3072);
    assert.equal((await database.listMemories({ containerTag })).length, 3);
  });

  it("returns compact lists and correct counts through the real MCP handlers", async () => {
    const app = Object.assign(Object.create(SupermementoServer.prototype), { neo4jClient: database });
    const server = new Server({ name: "list-test", version: "1" }, { capabilities: { tools: {} } });
    app.registerHandlersOnServer(server);
    const client = new Client({ name: "list-test-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      for (const [name, key, omitted] of [
        ["list_documents", "documents", "rawContent"],
        ["list_memories", "memories", "embedding"]
      ]) {
        const result = await client.callTool({ name: name!, arguments: { containerTag, limit: 2 } });
        assert.ok(!result.isError, JSON.stringify(result.content));
        const text = (result.content as { type: string; text: string }[])[0]!.text;
        const payload = JSON.parse(text);
        assert.equal(payload.count, 2);
        assert.equal(payload[key!].length, 2);
        assert.ok(payload[key!].every((item: Record<string, unknown>) => !(omitted! in item)));
        assert.ok(text.length < 5000, "large stored fields do not bloat list responses");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
