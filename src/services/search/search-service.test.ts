import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";

import type { AppConfig } from "../../config.js";
import type { Neo4jClient } from "../../db/neo4j-client.js";
import type { EmbeddingService } from "../embedding.js";
import type { TextGenerationClient } from "../llm/text-generation-client.js";
import { QueryRewriterService } from "./query-rewriter.js";
import { SearchService } from "./search-service.js";

describe("SearchService retrieval concurrency", () => {
  const config = { ANTHROPIC_API_KEY: "test" } as AppConfig;
  for (const searchMode of ["hybrid", undefined] as const) {
    it(`starts both searches before either finishes in ${searchMode ?? "default"} mode`, async () => {
      const started: string[] = [];
      let releaseMemories!: () => void;
      const memoryGate = new Promise<void>((resolve) => { releaseMemories = resolve; });
      let releaseChunks!: () => void;
      const chunkGate = new Promise<void>((resolve) => { releaseChunks = resolve; });
      const neo4jClient = {
        semanticSearchMemoriesAdvanced: async () => {
          started.push("memory");
          await memoryGate;
          return [];
        },
        semanticSearchChunks: async () => {
          started.push("chunk");
          await chunkGate;
          return [];
        }
      } as unknown as Neo4jClient;
      const embeddingService = {
        generateEmbedding: async () => [0.1, 0.2]
      } as unknown as EmbeddingService;
      const service = new SearchService(config, neo4jClient, embeddingService);
      let finished = false;
      const search = service.search({ query: "fact", searchMode }).then((response) => {
        finished = true;
        return response;
      });

      try {
        await setImmediate();
        assert.deepEqual([...started], ["memory", "chunk"]);
        releaseChunks();
        await setImmediate();
        assert.equal(finished, false, "search must wait for memory results too");
      } finally {
        releaseMemories();
        releaseChunks();
        await search;
      }
      assert.deepEqual((await search).results, []);
    });
  }

  for (const searchMode of ["memory", "rag"] as const) {
    it(`only queries the selected source in ${searchMode} mode`, async () => {
      const started: string[] = [];
      const neo4jClient = {
        semanticSearchMemoriesAdvanced: async () => { started.push("memory"); return []; },
        semanticSearchChunks: async () => { started.push("chunk"); return []; }
      } as unknown as Neo4jClient;
      const embeddingService = {
        generateEmbedding: async () => [0.1, 0.2]
      } as unknown as EmbeddingService;
      const service = new SearchService(config, neo4jClient, embeddingService);

      assert.deepEqual((await service.search({ query: "fact", searchMode })).results, []);
      assert.deepEqual(started, [searchMode === "memory" ? "memory" : "chunk"]);
    });
  }
});

describe("SearchService query rewrite fallback", () => {
  it("includes memory metadata in memory and hybrid search results", async () => {
    const metadata = { messageId: "mail-123", nested: { tags: ["pmm"] } };
    const neo4jClient = {
      semanticSearchMemoriesAdvanced: async () => [
        { memory: { id: "new", content: "New fact", metadata, confidence: 0.8, validFrom: "2026-01-01T00:00:00.000Z", validTo: "2026-06-30T00:00:00.000Z", isLatest: true, forgottenAt: null }, score: 0.95 },
        { memory: { id: "legacy", content: "Legacy fact", confidence: 0.9, isLatest: false }, score: 0.9 }
      ],
      semanticSearchChunks: async () => [
        { chunk: { id: "chunk-1", content: "chunk", containerTag: "zkteco-pmm", sourceDocId: "doc", chunkIndex: 0, metadata: {} }, score: 0.7 }
      ]
    } as unknown as Neo4jClient;
    const embeddingService = {
      generateEmbedding: async () => [0.1, 0.2]
    } as unknown as EmbeddingService;
    const queryRewriter = { rewrite: async (query: string) => query } as QueryRewriterService;
    const service = new SearchService({} as AppConfig, neo4jClient, embeddingService, queryRewriter);
    for (const searchMode of ["memory", "hybrid"] as const) {
      const response = await service.search({ query: "fact", searchMode });
      const fresh = response.results.find((item) => item.id === "new");
      const legacy = response.results.find((item) => item.id === "legacy");
      assert.deepEqual(fresh?.metadata, metadata);
      assert.deepEqual(legacy?.metadata, {});
      // MEM-01: validity metadata travels with every memory result, so an expired validTo is visible directly.
      assert.deepEqual(
        { confidence: fresh?.confidence, validFrom: fresh?.validFrom, validTo: fresh?.validTo, isLatest: fresh?.isLatest, forgottenAt: fresh?.forgottenAt },
        { confidence: 0.8, validFrom: "2026-01-01T00:00:00.000Z", validTo: "2026-06-30T00:00:00.000Z", isLatest: true, forgottenAt: null }
      );
      assert.deepEqual(
        { confidence: legacy?.confidence, validFrom: legacy?.validFrom, validTo: legacy?.validTo, isLatest: legacy?.isLatest, forgottenAt: legacy?.forgottenAt },
        { confidence: 0.9, validFrom: null, validTo: null, isLatest: false, forgottenAt: null }
      );
      const serialized = JSON.parse(JSON.stringify(response.results));
      for (const item of serialized.filter((row: { type: string }) => row.type === "memory")) {
        for (const key of ["confidence", "validFrom", "validTo", "isLatest", "forgottenAt"]) {
          assert.ok(key in item, `${key} must be present in the JSON payload`);
        }
      }
      if (searchMode === "hybrid") {
        const chunk = serialized.find((row: { type: string }) => row.type === "chunk");
        assert.ok(chunk && !("validTo" in chunk), "chunk results do not carry memory validity fields");
      }
    }
  });

  it("continues semantic search with the original query after a rewrite 429", async () => {
    let embeddedText: string | undefined;
    const llm: TextGenerationClient = {
      provider: "openai-codex-subscription",
      complete: async () => {
        throw Object.assign(new Error("rate limited"), { status: 429 });
      }
    };
    const queryRewriter = new QueryRewriterService({} as AppConfig, llm);
    const embeddingService = {
      generateEmbedding: async (text: string) => {
        embeddedText = text;
        return [0.1, 0.2];
      }
    } as unknown as EmbeddingService;
    const neo4jClient = {
      semanticSearchMemoriesAdvanced: async () => [],
      semanticSearchChunks: async () => []
    } as unknown as Neo4jClient;
    const config = { COHERE_API_KEY: undefined } as AppConfig;
    const service = new SearchService(config, neo4jClient, embeddingService, queryRewriter);
    const originalInfo = console.info;
    console.info = () => undefined;
    try {
      const response = await service.search({
        query: "GoTimeCloud nuevas altas septiembre",
        containerTag: "zkteco-pmm",
        rewriteQuery: true,
        searchMode: "hybrid"
      });

      assert.equal(embeddedText, "GoTimeCloud nuevas altas septiembre");
      assert.equal(response.query, "GoTimeCloud nuevas altas septiembre");
      assert.equal(response.rewrittenQuery, "GoTimeCloud nuevas altas septiembre");
      assert.deepEqual(response.results, []);
    } finally {
      console.info = originalInfo;
    }
  });
});
