import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AppConfig } from "../../config.js";
import {
  AnthropicTextGenerationClient,
  ObservedTextGenerationClient,
  OpenAiCodexSubscriptionTextGenerationClient,
  OpenAiCodexTextGenerationClient,
  buildCodexSubscriptionEnvironment,
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
    CODEX_HOME: "/tmp/supermemento-codex-tests",
    OPENAI_CODEX_WORKDIR: "/app",
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

  it("retries one transient stream failure and discards partial output", async () => {
    let calls = 0;
    const logLines: string[] = [];
    const originalInfo = console.info;
    console.info = (message?: unknown) => logLines.push(String(message));
    try {
      const client = new OpenAiCodexTextGenerationClient(
        config({
          LLM_PROVIDER: "openai-codex",
          OPENAI_CODEX_BASE_URL: "http://100.104.0.187:8646/v1",
          OPENAI_CODEX_RELAY_KEY: "relay-key"
        }),
        {
          responses: {
            create: async () => {
              calls += 1;
              if (calls === 1) {
                return {
                  async *[Symbol.asyncIterator]() {
                    yield { type: "response.output_text.delta", delta: "discard-me" };
                    throw new Error("sensitive transport timeout");
                  }
                };
              }
              return {
                async *[Symbol.asyncIterator]() {
                  yield { type: "response.output_text.delta", delta: '{"ok":true}' };
                  yield { type: "response.completed" };
                }
              };
            }
          }
        },
        0
      );

      const result = await client.complete({
        operation: "memory-extraction",
        system: "s",
        user: "u",
        maxTokens: 64
      });

      assert.equal(result, '{"ok":true}');
      assert.equal(calls, 2);
    } finally {
      console.info = originalInfo;
    }
    assert.equal(logLines.length, 1);
    assert.match(logLines[0], /retry=1 reason=transient/);
    assert.doesNotMatch(logLines[0], /sensitive|discard-me/);
  });

  it("stops after one transient retry is exhausted", async () => {
    let calls = 0;
    const client = new OpenAiCodexTextGenerationClient(
      config({
        LLM_PROVIDER: "openai-codex",
        OPENAI_CODEX_BASE_URL: "http://100.104.0.187:8646/v1",
        OPENAI_CODEX_RELAY_KEY: "relay-key"
      }),
      {
        responses: {
          create: async () => {
            calls += 1;
            return {
              async *[Symbol.asyncIterator]() {
                throw new Error("connection lost");
              }
            };
          }
        }
      },
      0
    );

    await assert.rejects(
      client.complete({ operation: "extract", system: "s", user: "u", maxTokens: 64 }),
      /openai-codex stream failed/
    );
    assert.equal(calls, 2);
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

  it("rejects a truncated Codex stream even when it contains text", async () => {
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
              yield { type: "response.output_text.delta", delta: '{"partial":true}' };
            }
          })
        }
      }
    );
    await assert.rejects(
      client.complete({ operation: "extract", system: "s", user: "u", maxTokens: 64 }),
      /ended without completion/
    );
  });

  it("rejects explicit incomplete and interrupted Codex streams", async () => {
    const makeClient = (eventFactory: () => AsyncIterable<Record<string, unknown>>) =>
      new OpenAiCodexTextGenerationClient(
        config({
          LLM_PROVIDER: "openai-codex",
          OPENAI_CODEX_BASE_URL: "http://100.104.0.187:8646/v1",
          OPENAI_CODEX_RELAY_KEY: "relay-key"
        }),
        { responses: { create: async () => eventFactory() } }
      );

    await assert.rejects(
      makeClient(() => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "response.incomplete" };
        }
      })).complete({ operation: "extract", system: "s", user: "u", maxTokens: 64 }),
      /response was incomplete/
    );

    await assert.rejects(
      makeClient(() => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "response.output_text.delta", delta: "partial" };
          throw new Error("connection lost");
        }
      })).complete({ operation: "extract", system: "s", user: "u", maxTokens: 64 }),
      /openai-codex stream failed/
    );
  });

  it("does not leak upstream response bodies in errors", async () => {
    let calls = 0;
    const upstream = Object.assign(new Error("secret provider body"), { status: 401 });
    const client = new OpenAiCodexTextGenerationClient(
      config({
        LLM_PROVIDER: "openai-codex",
        OPENAI_CODEX_BASE_URL: "http://100.104.0.187:8646/v1",
        OPENAI_CODEX_RELAY_KEY: "relay-key"
      }),
      {
        responses: { create: async () => { calls += 1; throw upstream; } }
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
    assert.equal(calls, 1);
  });

  it("does not retry deterministic output-limit failures", async () => {
    let calls = 0;
    const client = new OpenAiCodexTextGenerationClient(
      config({
        LLM_PROVIDER: "openai-codex",
        OPENAI_CODEX_BASE_URL: "http://100.104.0.187:8646/v1",
        OPENAI_CODEX_RELAY_KEY: "relay-key"
      }),
      {
        responses: {
          create: async () => {
            calls += 1;
            return {
              async *[Symbol.asyncIterator]() {
                yield { type: "response.output_text.delta", delta: "x".repeat(1025) };
              }
            };
          }
        }
      },
      0
    );

    await assert.rejects(
      client.complete({ operation: "extract", system: "s", user: "u", maxTokens: 1 }),
      /exceeded the configured output limit/
    );
    assert.equal(calls, 1);
  });

  it("requires relay configuration when Codex is selected", () => {
    assert.throws(
      () => createTextGenerationClient(config({ LLM_PROVIDER: "openai-codex" })),
      /OPENAI_CODEX_BASE_URL/
    );
  });

  it("uses the official Codex SDK with a locked-down local thread", async () => {
    let threadOptions: Record<string, unknown> | undefined;
    let prompt: string | undefined;
    const client = new OpenAiCodexSubscriptionTextGenerationClient(
      config({ LLM_PROVIDER: "openai-codex-subscription" }),
      {
        startThread: (options) => {
          threadOptions = options;
          return {
            run: async (input) => {
              prompt = input;
              return { finalResponse: "expanded query" };
            }
          };
        }
      }
    );

    const result = await client.complete({
      operation: "query-rewrite",
      system: "Expand the query",
      user: "reloj fichaje",
      maxTokens: 300
    });

    assert.equal(result, "expanded query");
    assert.deepEqual(threadOptions, {
      model: "gpt-5.6-luna",
      modelReasoningEffort: "low",
      sandboxMode: "read-only",
      workingDirectory: "/app",
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never"
    });
    assert.match(prompt ?? "", /Expand the query/);
    assert.match(prompt ?? "", /reloj fichaje/);
  });

  it("restricts an existing Codex home to owner-only permissions", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "supermemento-codex-permissions-"));
    chmodSync(codexHome, 0o755);
    try {
      new OpenAiCodexSubscriptionTextGenerationClient(
        config({ LLM_PROVIDER: "openai-codex-subscription", CODEX_HOME: codexHome }),
        {
          startThread: () => ({
            run: async () => ({ finalResponse: "unused" })
          })
        }
      );

      assert.equal(statSync(codexHome).mode & 0o777, 0o700);
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("does not pass embedding or relay credentials to the Codex child process", () => {
    const originalEmbeddingKey = process.env.OPENAI_API_KEY;
    const originalRelayKey = process.env.OPENAI_CODEX_RELAY_KEY;
    const originalRelayUrl = process.env.OPENAI_CODEX_BASE_URL;
    try {
      process.env.OPENAI_API_KEY = "embedding-secret";
      process.env.OPENAI_CODEX_RELAY_KEY = "relay-secret";
      process.env.OPENAI_CODEX_BASE_URL = "http://codex-oauth-bridge:18646/v1";
      const environment = buildCodexSubscriptionEnvironment(
        config({ LLM_PROVIDER: "openai-codex-subscription" })
      );

      assert.equal(environment.CODEX_HOME, "/tmp/supermemento-codex-tests");
      assert.equal(environment.OPENAI_API_KEY, undefined);
      assert.equal(environment.OPENAI_CODEX_RELAY_KEY, undefined);
      assert.equal(environment.OPENAI_CODEX_BASE_URL, undefined);
      assert.equal(environment.CODEX_API_KEY, undefined);
    } finally {
      if (originalEmbeddingKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalEmbeddingKey;
      if (originalRelayKey === undefined) delete process.env.OPENAI_CODEX_RELAY_KEY;
      else process.env.OPENAI_CODEX_RELAY_KEY = originalRelayKey;
      if (originalRelayUrl === undefined) delete process.env.OPENAI_CODEX_BASE_URL;
      else process.env.OPENAI_CODEX_BASE_URL = originalRelayUrl;
    }
  });

  it("sanitizes Codex subscription auth failures", async () => {
    const client = new OpenAiCodexSubscriptionTextGenerationClient(
      config({ LLM_PROVIDER: "openai-codex-subscription" }),
      {
        startThread: () => ({
          run: async () => {
            throw Object.assign(new Error("sensitive OAuth response"), { status: 401 });
          }
        })
      }
    );

    await assert.rejects(
      client.complete({ operation: "query-rewrite", system: "s", user: "u", maxTokens: 30 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /openai-codex-subscription request failed \(HTTP 401\)/);
        assert.doesNotMatch(error.message, /sensitive/);
        assert.equal((error as Error & { failureType?: string }).failureType, "auth");
        return true;
      }
    );
  });

  it("selects the subscription provider without relay configuration", () => {
    const client = createTextGenerationClient(
      config({
        LLM_PROVIDER: "openai-codex-subscription",
        OPENAI_CODEX_BASE_URL: undefined,
        OPENAI_CODEX_RELAY_KEY: undefined
      })
    );
    assert.equal(client.provider, "openai-codex-subscription");
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
