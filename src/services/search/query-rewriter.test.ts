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
});
