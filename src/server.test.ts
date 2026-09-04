import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryInputSchema } from "./server.js";

describe("Supermemento MCP tool schemas", () => {
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
