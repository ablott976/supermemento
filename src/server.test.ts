import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { batchCreateMemoriesInputSchema, createMemoryInputSchema, SupermementoServer, updateMemoryInputSchema } from "./server.js";

describe("Supermemento MCP tool schemas", () => {
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
    } finally {
      await client.close();
      await server.close();
    }
  });
});
