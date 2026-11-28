import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

describe("Lokale Kalenderdaten", () => {
  const savedTz = process.env.TZ;

  before(() => {
    // Node übernimmt eine zur Laufzeit gesetzte Zeitzone für Date
    process.env.TZ = "Europe/Berlin";
  });

  after(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("liefert kurz nach Mitternacht das lokale Datum statt des UTC-Datums", async () => {
    const { toLocalISODate } = await import("../../src/lib/format");
    // 00:30 Uhr in Berlin am 1. Dezember = 23:30 UTC am 30. November
    const justAfterMidnight = new Date("2026-11-30T23:30:00Z");
    assert.equal(justAfterMidnight.toISOString().slice(0, 10), "2026-11-30");
    assert.equal(toLocalISODate(justAfterMidnight), "2026-12-01");

    // Sommerzeit: 01:30 Uhr MESZ am 1. Juli = 23:30 UTC am 30. Juni
    assert.equal(toLocalISODate(new Date("2026-06-30T23:30:00Z")), "2026-07-01");
  });

  it("verschiebt Daten über Monats- und Jahresgrenzen", async () => {
    const { shiftedLocalISODate } = await import("../../src/lib/format");
    const newYear = new Date("2026-12-31T23:30:00Z"); // 00:30 am 01.01.2027 in Berlin
    assert.equal(shiftedLocalISODate(0, newYear), "2027-01-01");
    assert.equal(shiftedLocalISODate(-1, newYear), "2026-12-31");
    assert.equal(shiftedLocalISODate(7, newYear), "2027-01-08");
    // Wechsel auf Sommerzeit (29.03.2026) verschiebt keinen Tag
    assert.equal(shiftedLocalISODate(1, new Date("2026-03-28T12:00:00Z")), "2026-03-29");
    assert.equal(shiftedLocalISODate(2, new Date("2026-03-28T12:00:00Z")), "2026-03-30");
  });
});
