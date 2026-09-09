import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { batchCreateMemoriesInputSchema, createMemoryInputSchema, SupermementoServer, updateMemoryInputSchema } from "./server.js";

describe("Supermemento MCP tool schemas", () => {
  it("keeps update validity dates optional and nullable", () => {
    assert.deepEqual(updateMemoryInputSchema.required, ["memoryId"]);
    for (const field of ["validFrom", "validTo", "forgottenAt"]) {
      assert.deepEqual(updateMemoryInputSchema.properties?.[field], { anyOf: [{ type: "string" }, { type: "null" }] });
    }
  });
  it("exposes optional object metadata on create and update", () => {
    for (const schema of [createMemoryInputSchema, updateMemoryInputSchema]) {
      assert.deepEqual(schema.properties?.metadata, { type: "object", additionalProperties: true });
      assert.ok(!schema.required?.includes("metadata"));
    }
  });

  it("exposes optional metadata per batch item", () => {
    const memories = batchCreateMemoriesInputSchema.properties?.memories as {
      items: { properties: Record<string, unknown>; required: string[] };
    };
    assert.deepEqual(memories.items.properties.metadata, { type: "object", additionalProperties: true });
    assert.ok(!memories.items.required.includes("metadata"));
  });
  it("keeps optional validity dates optional in create_memory", () => {
    assert.deepEqual(createMemoryInputSchema.required, [
      "content",
      "memoryType",
      "containerTag"
    ]);
    assert.deepEqual(createMemoryInputSchema.properties?.validFrom, { type: "string" });
    assert.deepEqual(createMemoryInputSchema.properties?.validTo, { type: "string" });
  });
});

describe("Memory metadata MCP requests", () => {
  it("forwards metadata through validation and handlers and rejects non-objects", async () => {
    const received: Record<string, unknown>[] = [];
    const save = async (input: Record<string, unknown>) => {
      received.push(input);
      return { id: "memory-1", ...input };
    };
    // Exercise the real MCP handlers without external embeddings or database calls.
    const app = Object.assign(Object.create(SupermementoServer.prototype), {
      neo4jClient: {
        createMemory: save,
        batchCreateMemories: async (inputs: Record<string, unknown>[]) => {
          const results = [];
          for (const input of inputs) results.push(await save(input));
          return results;
        },
        updateMemory: async (_id: string, input: Record<string, unknown>) => save(input)
      },
      embeddingService: {
        generateEmbedding: async () => [0.1],
        generateEmbeddings: async (contents: string[]) => contents.map(() => [0.1])
      },
      relationClassifierService: {
        classifyAndApply: async () => ({}),
        batchClassifyAndApply: async () => undefined
      }
    });
    const server = new Server({ name: "test", version: "1" }, { capabilities: { tools: {} } });
    app.registerHandlersOnServer(server);
    const client = new Client({ name: "test-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const metadata = { messageId: "mail-123", nested: { tags: ["pmm"], enabled: true, value: null } };
      const sourceDocId = "d54b705e-06d9-4fc9-8a60-b45e306ef1c7";
      const input = { content: "Test", memoryType: "fact", containerTag: "test", sourceDocId };
      const requests = [
        { name: "create_memory", arguments: { ...input, metadata } },
        { name: "batch_create_memories", arguments: {
          containerTag: "test", sourceDocId,
          memories: [{ content: "Test", memoryType: "fact", metadata }]
        } },
        { name: "update_memory", arguments: { memoryId: sourceDocId, metadata } }
      ];
      for (const request of requests) {
        const result = await client.callTool(request);
        assert.ok(!result.isError);
        const content = result.content as { type: string; text: string }[];
        const payload = JSON.parse(content[0]!.text);
        assert.deepEqual((payload.memory ?? payload.memories[0]).metadata, metadata);
        assert.deepEqual(received.at(-1)?.metadata, metadata);
      }
      for (const invalid of ["not an object", [], null]) {
        const result = await client.callTool({ name: "create_memory", arguments: { ...input, metadata: invalid } });
        assert.equal(result.isError, true);
      }
      assert.equal(received.length, 3);
      assert.ok(!(await client.callTool({ name: "create_memory", arguments: input })).isError);
      assert.equal(received.at(-1)?.metadata, undefined);
      const updated = await client.callTool({ name: "update_memory", arguments: {
        memoryId: sourceDocId, content: "Corrected fact", validTo: "2026-09-01"
      } });
      assert.ok(!updated.isError);
      assert.deepEqual(received.at(-1)?.embedding, [0.1]);
      assert.equal(received.at(-1)?.validTo, "2026-09-01T00:00:00Z");
      assert.ok(!JSON.parse((updated.content as { text: string }[])[0]!.text).memory.embedding);
      assert.ok(!(await client.callTool({ name: "update_memory", arguments: { memoryId: sourceDocId, validTo: null } })).isError);
      assert.equal(received.at(-1)?.validTo, null);
      const before = received.length;
      assert.equal((await client.callTool({ name: "update_memory", arguments: { memoryId: sourceDocId, validTo: "invalid" } })).isError, true);
      assert.equal(received.length, before);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("Explicit memory relations", () => {
  it("validates memory ownership and relation types before using the atomic writer", async () => {
    const from = "d54b705e-06d9-4fc9-8a60-b45e306ef1c7";
    const to = "d54b705e-06d9-4fc9-8a60-b45e306ef1c8";
    const other = "d54b705e-06d9-4fc9-8a60-b45e306ef1c9";
    const calls: unknown[][] = [];
    const app = Object.assign(Object.create(SupermementoServer.prototype), {
      neo4jClient: {
        getMemory: async (id: string) => id === from || id === to
          ? { id, containerTag: "test" } : { id, containerTag: "other" },
        createMemoryRelation: async (...args: unknown[]) => { calls.push(args); return calls.length === 1; }
      }
    });
    const server = new Server({ name: "test", version: "1" }, { capabilities: { tools: {} } });
    app.registerHandlersOnServer(server);
    const client = new Client({ name: "test-client", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
      assert.ok((await client.listTools()).tools.some(t => t.name === "create_memory_relation"));
      const args = { fromMemoryId: from, toMemoryId: to, relationType: "UPDATES" };
      for (let i = 0; i < 2; i += 1) {
        assert.ok(!(await client.callTool({ name: "create_memory_relation", arguments: args })).isError);
      }
      assert.deepEqual(calls[0], [from, to, "UPDATES", { markTargetNotLatest: true }]);
      for (const invalid of [{ toMemoryId: from }, { toMemoryId: other }, { relationType: "INJECTED" }]) {
        assert.equal((await client.callTool({ name: "create_memory_relation", arguments: { ...args, ...invalid } })).isError, true);
      }
      assert.equal(calls.length, 2);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
