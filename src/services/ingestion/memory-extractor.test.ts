import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppConfig } from "../../config.js";
import { MemoryExtractorService } from "./memory-extractor.js";

type ExtractorInternals = {
  anthropic: {
    messages: {
      create: () => Promise<{ content: Array<{ type: "text"; text: string }> }>;
    };
  };
  extractFromChunk: MemoryExtractorService["extractFromChunk"];
};

function makeService(response: string | Error): ExtractorInternals {
  const service = new MemoryExtractorService({
    ANTHROPIC_API_KEY: "test-key",
    ANTHROPIC_MODEL: "test-model"
  } as AppConfig) as unknown as ExtractorInternals;
  service.anthropic = {
    messages: {
      create: async () => {
        if (response instanceof Error) {
          throw response;
        }
        return { content: [{ type: "text", text: response }] };
      }
    }
  };
  return service;
}

describe("MemoryExtractorService failure handling", () => {
  it("accepts a valid response with no durable memories", async () => {
    const service = makeService('{"memories":[]}');
    assert.deepEqual(await service.extractFromChunk("No durable facts"), []);
  });

  it("propagates provider failures instead of returning an empty success", async () => {
    const error = Object.assign(new Error("provider failed"), { status: 429 });
    const service = makeService(error);
    await assert.rejects(
      service.extractFromChunk("Some content"),
      /Anthropic extraction request failed \(HTTP 429\)/
    );
  });

  it("rejects malformed JSON instead of returning an empty success", async () => {
    const service = makeService("not json");
    await assert.rejects(
      service.extractFromChunk("Some content"),
      /response was not valid JSON/
    );
  });

  it("recovers valid memories from a partially invalid response", async () => {
    const service = makeService(JSON.stringify({
      memories: [
        { content: "Durable fact", memoryType: "fact", confidence: 0.9 },
        { content: "", memoryType: "fact", confidence: 0.9 }
      ]
    }));
    const memories = await service.extractFromChunk("Some content");
    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.content, "Durable fact");
  });
});