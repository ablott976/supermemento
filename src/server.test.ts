import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { batchCreateMemoriesInputSchema, createMemoryInputSchema, SupermementoServer, updateMemoryInputSchema } from "./server.js";
import { memoryContentHash } from "./services/memory-policy.js";

const CATCH_ALL = { id: "d54b705e-06d9-4fc9-8a60-b45e306ef1c7", title: "Manual memories: test", containerTag: "test" };

/** Wires the real MCP handlers to in-memory fakes; no embeddings, LLM or Neo4j. */
async function connectFakeServer(overrides: Record<string, unknown> = {}, saved: Record<string, unknown>[] = []) {
  const store = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const createMemory = async (input: Record<string, unknown>) => {
    counter += 1;
    const memory = { id: `memory-${counter}`, isLatest: true, forgottenAt: null, ...input };
    saved.push(input);
    store.set(memoryContentHash(String(input.containerTag), String(input.content)), memory);
    return memory;
  };
  const documents: Record<string, unknown>[] = [];
  const app = Object.assign(Object.create(SupermementoServer.prototype), {
    neo4jClient: {
      createMemory,
      batchCreateMemories: async (inputs: Record<string, unknown>[]) => {
        const results = [];
        for (const input of inputs) results.push(await createMemory(input));
        return results;
      },
      findActiveMemoryByContentHash: async (_tag: string, hash: string) => store.get(hash) ?? null,
      semanticSearchMemoriesAdvanced: async () => [],
      listDocuments: async () => [CATCH_ALL],
      createDocument: async (input: Record<string, unknown>) => {
        const document = { id: `document-${documents.length + 1}`, status: "queued", ...input };
        documents.push(document);
        return document;
      },
      updateDocument: async (id: string, input: Record<string, unknown>) => ({ id, ...input }),
      updateMemory: async (_id: string, input: Record<string, unknown>) => { saved.push(input); return { id: "memory-1", ...input }; },
      ...overrides
    },
    embeddingService: {
      generateEmbedding: async () => [0.1],
      generateEmbeddings: async (contents: string[]) => contents.map(() => [0.1])
    },
    relationClassifierService: {
      classifyAndApply: async () => ({}),
      batchClassifyAndApply: async () => undefined
    },
    ingestionPipeline: { processDocument: async () => ({ chunkCount: 0, memoryCount: 0 }) }
  });
  const server = new Server({ name: "test", version: "1" }, { capabilities: { tools: {} } });
  app.registerHandlersOnServer(server);
  const client = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    return { isError: Boolean(result.isError), text, payload: result.isError ? null : JSON.parse(text) };
  };
  const close = async () => { await client.close(); await server.close(); };
  return { call, close, saved, documents };
}

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
        findActiveMemoryByContentHash: async () => null,
        semanticSearchMemoriesAdvanced: async () => [],
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
        assert.ok(!result.isError, JSON.stringify(result.content));
        const content = result.content as { type: string; text: string }[];
        const payload = JSON.parse(content[0]!.text);
        // Creation records the declared temporal class ("none" by default); update_memory replaces metadata as given.
        const expected = request.name === "update_memory" ? metadata : { ...metadata, temporal_class: "none" };
        assert.deepEqual((payload.memory ?? payload.memories[0]).metadata, expected);
        assert.deepEqual(received.at(-1)?.metadata, expected);
      }
      for (const invalid of ["not an object", [], null]) {
        const result = await client.callTool({ name: "create_memory", arguments: { ...input, metadata: invalid } });
        assert.equal(result.isError, true);
      }
      assert.equal(received.length, 3);
      assert.ok(!(await client.callTool({ name: "create_memory", arguments: { ...input, content: "Second" } })).isError);
      assert.deepEqual(received.at(-1)?.metadata, { temporal_class: "none" });
      const updated = await client.callTool({ name: "update_memory", arguments: {
        memoryId: sourceDocId, content: "Corrected fact", validTo: "2026-09-01"
      } });
      assert.ok(!updated.isError);
      assert.deepEqual(received.at(-1)?.embedding, [0.1]);
      // Date-only validTo is the end of that Europe/Madrid business day (CEST = UTC+2).
      assert.equal(received.at(-1)?.validTo, "2026-09-01T21:59:59.999Z");
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


describe("Memory policy: temporal_class, validTo and exact dedup", () => {
  const base = { memoryType: "fact", containerTag: "test" };

  it("exposes temporal_class on create, batch items and ingestion tools", () => {
    const enumSchema = { type: "string", enum: ["pricing", "roadmap", "pipeline", "none"] };
    assert.deepEqual(createMemoryInputSchema.properties?.temporal_class, enumSchema);
    assert.ok(!createMemoryInputSchema.required?.includes("temporal_class"));
    const memories = batchCreateMemoriesInputSchema.properties?.memories as { items: { properties: Record<string, unknown> } };
    assert.deepEqual(memories.items.properties.temporal_class, enumSchema);
  });

  it("rejects temporal intelligence without validTo before writing anything", async () => {
    const fake = await connectFakeServer();
    try {
      for (const temporalClass of ["pricing", "roadmap", "pipeline"]) {
        const result = await fake.call("create_memory", { ...base, content: `Precio ${temporalClass}`, temporal_class: temporalClass });
        assert.equal(result.isError, true);
        assert.match(result.text, new RegExp(`validTo is required when temporal_class is ${temporalClass}`));
        const viaMetadata = await fake.call("create_memory", { ...base, content: "Precio", metadata: { temporal_class: temporalClass } });
        assert.equal(viaMetadata.isError, true);
      }
      assert.equal((await fake.call("create_memory", { ...base, content: "Precio", temporal_class: "price" })).isError, true);
      assert.equal(fake.saved.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("creates temporal intelligence with validTo and records the class in metadata", async () => {
    const fake = await connectFakeServer();
    try {
      const result = await fake.call("create_memory", {
        ...base, content: "GTC Cloud 12,50 €/usuario/mes", temporal_class: "pricing", validTo: "2026-12-31", metadata: { source: "price-list" }
      });
      assert.equal(result.isError, false, result.text);
      assert.equal(result.payload.created, true);
      assert.deepEqual(result.payload.memory.metadata, { source: "price-list", temporal_class: "pricing" });
      // Date-only validTo lasts until Madrid midnight (CET = UTC+1), not until midnight UTC.
      assert.equal(fake.saved[0]?.validTo, "2026-12-31T22:59:59.999Z");
      assert.equal(result.payload.relationClassification, "async");
      assert.equal("possibleDuplicates" in result.payload, false);
      const none = await fake.call("create_memory", { ...base, content: "Hecho permanente" });
      assert.equal(none.payload.created, true);
      assert.deepEqual(none.payload.memory.metadata, { temporal_class: "none" });
    } finally {
      await fake.close();
    }
  });

  it("does not create an exact duplicate: created=false with duplicateOf and no embedding", async () => {
    const fake = await connectFakeServer();
    try {
      const first = await fake.call("create_memory", { ...base, content: "GTC significa GoTimeCloud." });
      assert.equal(first.payload.created, true);
      const embeddings = fake.saved.length;
      const second = await fake.call("create_memory", { ...base, content: "  gtc SIGNIFICA gotimecloud " });
      assert.equal(second.isError, false, second.text);
      assert.deepEqual({ created: second.payload.created, duplicateOf: second.payload.duplicateOf }, { created: false, duplicateOf: first.payload.memory.id });
      assert.equal(second.payload.memory.id, first.payload.memory.id);
      assert.equal(fake.saved.length, embeddings, "no second node was written");
      const other = await fake.call("create_memory", { ...base, containerTag: "other", content: "GTC significa GoTimeCloud." });
      assert.equal(other.payload.created, true, "same content in another container is a different memory");
    } finally {
      await fake.close();
    }
  });

  it("reports semantic near-duplicates without blocking creation", async () => {
    const fake = await connectFakeServer({
      semanticSearchMemoriesAdvanced: async (params: { minScore: number }) => {
        assert.equal(params.minScore, 0.95);
        return [
          { memory: { id: "memory-1", content: "GTC significa GoTimeCloud." }, score: 0.99 },
          { memory: { id: "existing-near", content: "GoTimeCloud se abrevia GTC" }, score: 0.97 }
        ];
      }
    });
    try {
      const result = await fake.call("create_memory", { ...base, content: "GTC significa GoTimeCloud." });
      assert.equal(result.payload.created, true);
      assert.deepEqual(result.payload.possibleDuplicates, [{ id: "existing-near", score: 0.97, content: "GoTimeCloud se abrevia GTC" }]);
    } finally {
      await fake.close();
    }
  });

  it("batch: validates every item first, dedupes inside the batch and against the store", async () => {
    const fake = await connectFakeServer();
    try {
      const invalid = await fake.call("batch_create_memories", {
        containerTag: "test",
        memories: [
          { content: "ok", memoryType: "fact" },
          { content: "roadmap Q4", memoryType: "fact", temporal_class: "roadmap" }
        ]
      });
      assert.equal(invalid.isError, true);
      assert.match(invalid.text, /memories\[1\]: validTo is required when temporal_class is roadmap/);
      assert.equal(fake.saved.length, 0, "nothing written when one item is invalid");

      await fake.call("create_memory", { ...base, content: "Ya existente" });
      const result = await fake.call("batch_create_memories", {
        containerTag: "test",
        memories: [
          { content: "Nueva A", memoryType: "fact" },
          { content: "ya existente!", memoryType: "fact" },
          { content: "nueva a", memoryType: "fact" },
          { content: "Nueva B", memoryType: "episode", temporal_class: "pipeline", validTo: "2026-11-30" }
        ]
      });
      assert.equal(result.isError, false, result.text);
      assert.equal(result.payload.count, 2);
      assert.deepEqual(result.payload.memories.map((m: { content: string }) => m.content), ["Nueva A", "Nueva B"]);
      assert.deepEqual(result.payload.duplicates, [
        { index: 1, duplicateOf: "memory-1" },
        { index: 2, duplicateOf: result.payload.memories[0].id }
      ]);
      assert.deepEqual(result.payload.memories[1].metadata, { temporal_class: "pipeline" });
      assert.match(result.payload.message, /2 memories created, 2 exact duplicates skipped/);

      const allDuplicates = await fake.call("batch_create_memories", { containerTag: "test", memories: [{ content: "NUEVA A", memoryType: "fact" }] });
      assert.equal(allDuplicates.payload.count, 0);
      assert.equal(allDuplicates.payload.duplicates.length, 1);
    } finally {
      await fake.close();
    }
  });

  it("batch accepts up to 50 memories and rejects 51", async () => {
    const fake = await connectFakeServer();
    try {
      const fifty = Array.from({ length: 50 }, (_, i) => ({ content: `Memoria ${i}`, memoryType: "fact" }));
      const ok = await fake.call("batch_create_memories", { containerTag: "test", memories: fifty });
      assert.equal(ok.isError, false, ok.text);
      assert.equal(ok.payload.count, 50);
      const tooMany = await fake.call("batch_create_memories", { containerTag: "test", memories: [...fifty, { content: "x", memoryType: "fact" }] });
      assert.equal(tooMany.isError, true);
    } finally {
      await fake.close();
    }
  });

  it("ingestion and crawl tools apply the validTo rule and carry the policy on the document", async () => {
    const fake = await connectFakeServer();
    try {
      const ingestCalls: Array<[string, Record<string, unknown>]> = [
        ["ingest_document", { content: "Lista de precios", contentType: "text", containerTag: "test" }],
        ["ingest_url", { url: "https://example.com/pricing", containerTag: "test" }],
        ["ingest_conversation", { messages: [{ speaker: "a", message: "hola" }], containerTag: "test" }],
        ["crawl_url", { url: "https://example.com/roadmap", containerTag: "test" }],
        ["crawl_urls", { urls: ["https://example.com/roadmap"], containerTag: "test" }]
      ];
      for (const [name, args] of ingestCalls) {
        const rejected = await fake.call(name, { ...args, temporal_class: "pricing" });
        assert.equal(rejected.isError, true, name);
        assert.match(rejected.text, /validTo is required when temporal_class is pricing/);
      }
      assert.equal(fake.documents.length, 0, "no document created for rejected ingestion");

      const accepted = await fake.call("ingest_document", {
        content: "Lista de precios", contentType: "text", containerTag: "test",
        temporal_class: "pricing", validTo: "2026-12-31", metadata: { origin: "flyer" }
      });
      assert.equal(accepted.isError, false, accepted.text);
      assert.deepEqual(fake.documents[0]?.metadata, { origin: "flyer", temporal_class: "pricing", valid_to: "2026-12-31T22:59:59.999Z" });

      const plain = await fake.call("ingest_conversation", { messages: [{ speaker: "a", message: "hola" }], containerTag: "test" });
      assert.equal(plain.isError, false, plain.text);
      assert.deepEqual(fake.documents[1]?.metadata, { temporal_class: "none" });
    } finally {
      await fake.close();
    }
  });
});
