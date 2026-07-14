import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppConfig } from "../../config.js";
import { MemoryType } from "../../types/enums.js";
import type { TextGenerationClient } from "../llm/text-generation-client.js";
import { ProfileService } from "./profile-service.js";

describe("ProfileService", () => {
  it("generates and persists a structured profile through the configured LLM", async () => {
    let persisted: string[] = [];
    const neo4jClient = {
      getLatestMemoriesByContainer: async () => [{
        content: "Arturo trabaja en ZKTeco Europe",
        memoryType: MemoryType.Fact
      }],
      upsertProfile: async (
        containerTag: string,
        staticProfile: string,
        dynamicProfile: string,
        generatedAt: string
      ) => {
        persisted = [containerTag, staticProfile, dynamicProfile, generatedAt];
        return {
          containerTag,
          static: staticProfile,
          dynamic: dynamicProfile,
          generatedAt
        };
      }
    };
    const llm: TextGenerationClient = {
      provider: "openai-codex",
      complete: async (request) => {
        assert.equal(request.operation, "profile-generation");
        assert.equal(request.maxTokens, 1200);
        return JSON.stringify({ static: "PMM en ZKTeco", dynamic: "Proyecto activo" });
      }
    };
    const service = new ProfileService({} as AppConfig, neo4jClient as never, llm);

    const result = await service.generateProfile("zkteco-pmm");
    assert.equal(result.static, "PMM en ZKTeco");
    assert.equal(result.dynamic, "Proyecto activo");
    assert.deepEqual(persisted.slice(0, 3), ["zkteco-pmm", "PMM en ZKTeco", "Proyecto activo"]);
  });
});
