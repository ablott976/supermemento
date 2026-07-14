import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppConfig } from "../../config.js";
import {
  AnthropicTextGenerationClient,
  ObservedTextGenerationClient,
  OpenAiCodexTextGenerationClient,
  createTextGenerationClient
} from "./text-generation-client.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NEO4J_URI: "bolt://test",
    NEO4J_USER: "neo4j",
    NEO4J_PASSWORD: "test",
    OPENAI_API_KEY: "embedding-key",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
    LLM_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "anthropic-key",
    ANTHROPIC_MODEL: "claude-test",
    OPENAI_CODEX_MODEL: "gpt-5.6-luna",
    OPENAI_CODEX_BASE_URL: undefined,
    OPENAI_CODEX_RELAY_KEY: undefined,
    LLM_REQUEST_TIMEOUT_MS: 120000,
    LLM_REASONING_EFFORT: "low",
    COHERE_API_KEY: undefined,
    COHERE_RERANK_MODEL: "rerank-v3.5",
    ...overrides
  } as AppConfig;
}

describe("text generation providers", () => {
  it("keeps Anthropic as the default provider", async () => {
    let captured: Record<string, unknown> | undefined;
    const client = new AnthropicTextGenerationClient(
      config(),
      {
        messages: {
          create: async (request: Record<string, unknown>) => {
            captured = request;
            return { content: [{ type: "text", text: "answer" }] };
          }
        }
      }
    );

    const result = await client.complete({
      operation: "test",
      system: "system",
      user: "user",
      maxTokens: 123
    });

    assert.equal(result, "answer");
    assert.equal(captured?.model, "claude-test");
    assert.equal(captured?.max_tokens, 123);
  });

  it("streams Codex Responses requests with storage disabled", async () => {
    let captured: Record<string, unknown> | undefined;
    const events = {
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: '{"ok":' };
        yield { type: "response.output_text.delta", delta: "true}" };
        yield { type: "response.completed" };
      }
    };
    const client = new OpenAiCodexTextGenerationClient(
      config({
        LLM_PROVIDER: "openai-codex",
        OPENAI_CODEX_BASE_URL: "http://100.104.0.187:8646/v1",
        OPENAI_CODEX_RELAY_KEY: "relay-key"
      }),
      {
        responses: {
          create: async (request: Record<string, unknown>) => {
            captured = request;
            return events;
          }
        }
      }
    );

    const result = await client.complete({
      operation: "extract",
      system: "Return JSON",
      user: "payload",
      maxTokens: 4096
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(captured?.model, "gpt-5.6-luna");
    assert.equal(captured?.stream, true);
    assert.equal(captured?.store, false);
    assert.deepEqual(captured?.reasoning, { effort: "low", summary: "auto" });
    assert.equal("max_output_tokens" in (captured ?? {}), false);
    assert.equal("tools" in (captured ?? {}), false);
  });

  it("fails closed when the Codex stream has no text", async () => {
    const client = new OpenAiCodexTextGenerationClient(
      config({
        LLM_PROVIDER: "openai-codex",
        OPENAI_CODEX_BASE_URL: "http://100.104.0.187:8646/v1",
        OPENAI_CODEX_RELAY_KEY: "relay-key"
      }),
      {
        responses: {
          create: async () => ({
            async *[Symbol.asyncIterator]() {
              yield { type: "response.completed" };
            }
          })
        }
      }
    );

    await assert.rejects(
      client.complete({ operation: "extract", system: "s", user: "u", maxTokens: 10 }),
      /returned no text/
    );
  });

  it("does not leak upstream response bodies in errors", async () => {
    const upstream = Object.assign(new Error("secret provider body"), { status: 401 });
    const client = new OpenAiCodexTextGenerationClient(
      config({
        LLM_PROVIDER: "openai-codex",
        OPENAI_CODEX_BASE_URL: "http://100.104.0.187:8646/v1",
        OPENAI_CODEX_RELAY_KEY: "relay-key"
      }),
      {
        responses: { create: async () => { throw upstream; } }
      }
    );

    await assert.rejects(
      client.complete({ operation: "extract", system: "s", user: "u", maxTokens: 10 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /openai-codex request failed \(HTTP 401\)/);
        assert.doesNotMatch(error.message, /secret provider body/);
        return true;
      }
    );
  });

  it("requires relay configuration when Codex is selected", () => {
    assert.throws(
      () => createTextGenerationClient(config({ LLM_PROVIDER: "openai-codex" })),
      /OPENAI_CODEX_BASE_URL/
    );
  });

  it("logs safe provider metrics without request or error content", async () => {
    const lines: string[] = [];
    const originalInfo = console.info;
    console.info = (message?: unknown) => lines.push(String(message));
    try {
      const observed = new ObservedTextGenerationClient(
        {
          provider: "openai-codex",
          complete: async () => {
            throw Object.assign(new Error("sensitive upstream body"), { status: 429 });
          }
        },
        "gpt-5.6-luna"
      );
      await assert.rejects(
        observed.complete({
          operation: "safe-metrics",
          system: "sensitive system prompt",
          user: "sensitive user text",
          maxTokens: 64
        })
      );
    } finally {
      console.info = originalInfo;
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /provider=openai-codex/);
    assert.match(lines[0], /operation=safe-metrics/);
    assert.match(lines[0], /http_status=429/);
    assert.doesNotMatch(lines[0], /sensitive/);
  });
});
