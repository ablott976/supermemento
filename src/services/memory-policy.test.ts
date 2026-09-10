import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MemoryPolicyError,
  assertValidToForTemporalClass,
  documentTemporalPolicy,
  memoryContentHash,
  normalizeMemoryContent,
  resolveTemporalClass,
  withTemporalClass
} from "./memory-policy.js";

describe("normalizeMemoryContent", () => {
  it("ignores whitespace, case and punctuation but keeps diacritics", () => {
    assert.equal(normalizeMemoryContent("  GoTimeCloud:   precio 12,50 €/usuario.  "), "gotimecloud precio 12 50 usuario");
    assert.equal(normalizeMemoryContent("GTC = GoTimeCloud"), normalizeMemoryContent("gtc   gotimecloud!"));
    assert.notEqual(normalizeMemoryContent("año"), normalizeMemoryContent("ano"));
    assert.equal(normalizeMemoryContent("ﬁrma"), "firma"); // NFKC compatibility fold
    assert.equal(normalizeMemoryContent("\n\t"), "");
  });
});

describe("memoryContentHash", () => {
  it("is stable across trivial variations and differs by container", () => {
    const base = memoryContentHash("zkteco-pmm", "GTC significa GoTimeCloud.");
    assert.equal(memoryContentHash("zkteco-pmm", "  gtc SIGNIFICA gotimecloud "), base);
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.notEqual(memoryContentHash("other", "GTC significa GoTimeCloud."), base);
    assert.notEqual(memoryContentHash("zkteco-pmm", "GBC significa GoBridgeCloud."), base);
  });
});

describe("resolveTemporalClass", () => {
  it("prefers the explicit argument, then metadata, then none", () => {
    assert.equal(resolveTemporalClass(undefined, undefined), "none");
    assert.equal(resolveTemporalClass(undefined, { temporal_class: "roadmap" }), "roadmap");
    assert.equal(resolveTemporalClass("pricing", { temporal_class: "roadmap" }), "pricing");
    assert.equal(resolveTemporalClass("none", { temporal_class: "pipeline" }), "none");
  });

  it("rejects unknown classes from either source", () => {
    for (const invalid of ["price", 3, { a: 1 }]) {
      assert.throws(() => resolveTemporalClass(invalid, undefined), (error: unknown) =>
        error instanceof MemoryPolicyError && error.code === "invalid_temporal_class");
      assert.throws(() => resolveTemporalClass(undefined, { temporal_class: invalid }), MemoryPolicyError);
    }
  });
});

describe("assertValidToForTemporalClass", () => {
  it("requires validTo for pricing, roadmap and pipeline only", () => {
    for (const temporalClass of ["pricing", "roadmap", "pipeline"] as const) {
      for (const missing of [undefined, null, ""]) {
        assert.throws(() => assertValidToForTemporalClass(temporalClass, missing), (error: unknown) =>
          error instanceof MemoryPolicyError && error.code === "validTo_required" && error.message.includes(temporalClass));
      }
      assert.doesNotThrow(() => assertValidToForTemporalClass(temporalClass, "2026-12-31T00:00:00Z"));
    }
    assert.doesNotThrow(() => assertValidToForTemporalClass("none", undefined));
  });
});

describe("metadata helpers", () => {
  it("records the declared class without losing caller metadata", () => {
    assert.deepEqual(withTemporalClass({ message_id: "m1" }, "pricing"), { message_id: "m1", temporal_class: "pricing" });
    assert.deepEqual(withTemporalClass(undefined, "none"), { temporal_class: "none" });
  });

  it("reads the document policy with legacy defaults", () => {
    assert.deepEqual(documentTemporalPolicy(undefined), { temporalClass: "none", validTo: null });
    assert.deepEqual(documentTemporalPolicy({ contentHash: "abc" }), { temporalClass: "none", validTo: null });
    assert.deepEqual(
      documentTemporalPolicy({ temporal_class: "pipeline", valid_to: "2026-10-01T00:00:00Z" }),
      { temporalClass: "pipeline", validTo: "2026-10-01T00:00:00Z" }
    );
    assert.deepEqual(documentTemporalPolicy({ temporal_class: "none", valid_to: "   " }), { temporalClass: "none", validTo: null });
  });
});
