import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppConfig } from "../../config.js";
import type { TextGenerationClient } from "../llm/text-generation-client.js";
import { QueryRewriterService } from "./query-rewriter.js";

describe("QueryRewriterService", () => {
  it("uses the configured text generation client", async () => {
    let operation: string | undefined;
    const llm: TextGenerationClient = {
      provider: "openai-codex",
      complete: async (request) => {
        operation = request.operation;
        assert.equal(request.user, "reloj fichaje");
        assert.equal(request.maxTokens, 300);
        return "reloj fichaje control horario time attendance";
      }
    };
    const service = new QueryRewriterService({} as AppConfig, llm);
    assert.equal(
      await service.rewrite("reloj fichaje"),
      "reloj fichaje control horario time attendance"
    );
    assert.equal(operation, "query-rewrite");
  });

  for (const failure of [
    Object.assign(new Error("rate limited"), { status: 429 }),
    Object.assign(new Error("upstream unavailable"), { status: 503 }),
    Object.assign(new Error("authentication failed"), { status: 401 }),
    Object.assign(new Error("timed out"), { failureType: "timeout" })
  ]) {
    it(`falls back to the original query after ${failure.message}`, async () => {
      const llm: TextGenerationClient = {
        provider: "openai-codex-subscription",
        complete: async () => {
          throw failure;
        }
      };
      const service = new QueryRewriterService({} as AppConfig, llm);
      const originalInfo = console.info;
      const lines: string[] = [];
      console.info = (message?: unknown) => lines.push(String(message));
      try {
        assert.equal(await service.rewrite("original query"), "original query");
      } finally {
        console.info = originalInfo;
      }
      assert.equal(lines.length, 1);
      assert.match(lines[0], /outcome=fallback/);
      assert.doesNotMatch(lines[0], /rate limited|upstream unavailable|authentication failed|timed out/);
    });
  }

  it("does not hide deterministic rewrite failures", async () => {
    const llm: TextGenerationClient = {
      provider: "openai-codex-subscription",
      complete: async () => {
        throw Object.assign(new Error("bad request"), { status: 400 });
      }
    };
    const service = new QueryRewriterService({} as AppConfig, llm);
    await assert.rejects(service.rewrite("original query"), /bad request/);
  });
});
