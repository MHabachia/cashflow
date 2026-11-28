import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { monthRange, yearRange } from "../../src/lib/date-range";

describe("Datumsbereiche für Abfragen", () => {
  it("Monat: erster Tag bis erster Tag des Folgemonats", () => {
    assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-03-01" });
    assert.deepEqual(monthRange("2026-09"), { from: "2026-09-01", to: "2026-10-01" });
  });

  it("Dezember endet am 1. Januar des Folgejahres", () => {
    assert.deepEqual(monthRange("2026-12"), { from: "2026-12-01", to: "2027-01-01" });
  });

  it("deckt genau dieselben Tage ab wie der bisherige Präfixvergleich", () => {
    const { from, to } = monthRange("2026-02");
    const inRange = (d: string) => d >= from && d < to;
    for (const d of ["2026-02-01", "2026-02-28", "2026-02-29"]) assert.equal(inRange(d), d.startsWith("2026-02"), d);
    for (const d of ["2026-01-31", "2026-03-01", "2026-03-31"]) assert.equal(inRange(d), false, d);
  });

  it("Jahr: 1. Januar bis 1. Januar des Folgejahres", () => {
    assert.deepEqual(yearRange(2026), { from: "2026-01-01", to: "2027-01-01" });
  });

  it("lehnt ungültige Werte ab", () => {
    for (const m of ["2026-13", "2026-00", "2026-1", "26-01", ""]) assert.throws(() => monthRange(m), m);
    for (const y of [Number.NaN, 2026.5, 99]) assert.throws(() => yearRange(y), String(y));
  });
});
