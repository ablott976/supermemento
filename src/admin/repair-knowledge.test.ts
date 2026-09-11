import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeValidityDates } from "./repair-knowledge.js";

type Row = { id: string; validFrom: string | null; validTo: string | null };

function fakeClient(stored: Row[]) {
  const writes: Array<{ rows: Row[]; runId: string }> = [];
  return {
    writes,
    listMidnightValidityMemories: async (limit: number, afterId: string) =>
      stored.filter((row) => row.id > afterId).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit),
    setValidityDates: async (rows: Row[], runId: string) => {
      writes.push({ rows, runId });
      return rows.length;
    }
  };
}

describe("repair-knowledge normalize-validity-dates", () => {
  const stored: Row[] = [
    { id: "m-1", validFrom: null, validTo: "2026-09-11T00:00:00Z" },
    { id: "m-2", validFrom: "2026-01-10T00:00:00Z", validTo: null },
    { id: "m-3", validFrom: "2026-09-01T10:00:00Z", validTo: "2026-12-31T00:00:00Z" }
  ];

  it("only reports without --apply", async () => {
    const client = fakeClient(stored);
    const result = await normalizeValidityDates(client, "validity-test", false);
    assert.deepEqual(
      { applied: result.applied, scanned: result.scanned, planned: result.planned, validFromChanges: result.validFromChanges, validToChanges: result.validToChanges, updated: result.updated },
      { applied: false, scanned: 3, planned: 3, validFromChanges: 1, validToChanges: 2, updated: 0 }
    );
    assert.deepEqual(result.sample[0], { id: "m-1", before: { validFrom: null, validTo: "2026-09-11T00:00:00Z" }, after: { validFrom: null, validTo: "2026-09-11T21:59:59.999Z" } });
    assert.equal(client.writes.length, 0);
  });

  it("writes the planned values under the run id with --apply, paging by id", async () => {
    const client = fakeClient(stored);
    const result = await normalizeValidityDates(client, "validity-test", true);
    assert.equal(result.updated, 3);
    assert.equal(client.writes[0]?.runId, "validity-test");
    assert.deepEqual(client.writes.flatMap((write) => write.rows), [
      { id: "m-1", validFrom: null, validTo: "2026-09-11T21:59:59.999Z" },
      { id: "m-2", validFrom: "2026-01-09T23:00:00.000Z", validTo: null },
      { id: "m-3", validFrom: "2026-09-01T10:00:00Z", validTo: "2026-12-31T22:59:59.999Z" }
    ]);
  });
});
