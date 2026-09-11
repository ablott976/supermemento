import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUSINESS_TIMEZONE, businessDate, normalizeValidFrom, normalizeValidTo, zonedTimeToUtc } from "./business-time.js";

describe("business-time: validity dates are Europe/Madrid business days", () => {
  it("declares the business timezone once", () => {
    assert.equal(BUSINESS_TIMEZONE, "Europe/Madrid");
  });

  it("date-only validTo is the end of the Madrid day, in summer and in winter", () => {
    assert.equal(normalizeValidTo("2026-09-11"), "2026-09-11T21:59:59.999Z"); // CEST, UTC+2
    assert.equal(normalizeValidTo("2026-01-10"), "2026-01-10T22:59:59.999Z"); // CET, UTC+1
  });

  it("date-only validFrom is the start of the Madrid day", () => {
    assert.equal(normalizeValidFrom("2026-09-11"), "2026-09-10T22:00:00.000Z");
    assert.equal(normalizeValidFrom("2026-01-10"), "2026-01-09T23:00:00.000Z");
  });

  it("a memory that expires today is still valid at 00:36 Madrid and expired at 00:00 Madrid the next day", () => {
    const validTo = new Date(normalizeValidTo("2026-09-11"));
    const madridEarlyMorning = new Date("2026-09-10T22:36:00Z"); // 00:36 on 11/09 in Madrid
    const madridNextMidnight = new Date("2026-09-11T22:00:00Z"); // 00:00 on 12/09 in Madrid
    assert.ok(validTo >= madridEarlyMorning, "the old midnight-UTC rule marked it expired here");
    assert.ok(validTo < madridNextMidnight);
    // The old normalisation ("T00:00:00Z") expired the memory before the business day even started in Madrid.
    assert.ok(new Date("2026-09-11T00:00:00Z") < madridEarlyMorning === false && new Date("2026-09-11T00:00:00Z") > madridEarlyMorning);
  });

  it("handles the DST transitions of the business timezone", () => {
    // 2026-03-29: clocks jump 02:00 -> 03:00 CET->CEST. 2026-10-25: 03:00 -> 02:00 CEST->CET.
    assert.equal(normalizeValidFrom("2026-03-29"), "2026-03-28T23:00:00.000Z");
    assert.equal(normalizeValidTo("2026-03-29"), "2026-03-29T21:59:59.999Z");
    assert.equal(normalizeValidFrom("2026-10-25"), "2026-10-24T22:00:00.000Z");
    assert.equal(normalizeValidTo("2026-10-25"), "2026-10-25T22:59:59.999Z");
  });

  it("leaves full datetimes, empty values and non-dates unchanged", () => {
    for (const value of ["2026-09-11T08:00:00Z", "2026-09-11T10:00:00+02:00", "invalid", "", null, undefined]) {
      assert.equal(normalizeValidTo(value), value);
      assert.equal(normalizeValidFrom(value), value);
    }
  });

  it("zonedTimeToUtc accepts other zones and businessDate reports the Madrid calendar day", () => {
    assert.equal(zonedTimeToUtc(2026, 9, 11, 0, 0, 0, 0, "UTC").toISOString(), "2026-09-11T00:00:00.000Z");
    assert.equal(zonedTimeToUtc(2026, 9, 11, 0, 0, 0, 0, "America/New_York").toISOString(), "2026-09-11T04:00:00.000Z");
    assert.equal(businessDate(new Date("2026-09-10T22:36:00Z")), "2026-09-11");
    assert.equal(businessDate(new Date("2026-09-10T21:59:00Z")), "2026-09-10");
    assert.equal(businessDate(new Date("2026-01-10T23:30:00Z")), "2026-01-11");
  });
});

describe("business-time: normalising validity stored before MEM-05", () => {
  it("moves midnight-UTC values to the Madrid business day and keeps everything else", async () => {
    const { planStoredValidityNormalization } = await import("./business-time.js");
    assert.deepEqual(planStoredValidityNormalization({ validFrom: null, validTo: "2026-09-11T00:00:00Z" }), {
      validFrom: null, validTo: "2026-09-11T21:59:59.999Z"
    });
    assert.deepEqual(planStoredValidityNormalization({ validFrom: "2026-01-10T00:00:00.000Z", validTo: "2026-12-31T00:00:00Z" }), {
      validFrom: "2026-01-09T23:00:00.000Z", validTo: "2026-12-31T22:59:59.999Z"
    });
    // A deliberate instant or an already normalised value is not touched, even next to a midnight one.
    assert.deepEqual(planStoredValidityNormalization({ validFrom: "2026-09-01T10:00:00Z", validTo: "2026-09-11T00:00:00Z" }), {
      validFrom: "2026-09-01T10:00:00Z", validTo: "2026-09-11T21:59:59.999Z"
    });
    assert.equal(planStoredValidityNormalization({ validFrom: "2026-09-10T22:00:00.000Z", validTo: "2026-09-11T21:59:59.999Z" }), null);
    assert.equal(planStoredValidityNormalization({ validFrom: null, validTo: null }), null);
    assert.equal(planStoredValidityNormalization({ validFrom: null, validTo: "2026-09-11T00:00:01Z" }), null);
  });
});
