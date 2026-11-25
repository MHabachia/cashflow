import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMonthCalendar, type CalendarSource } from "../../src/lib/fixed-cost-calendar";

const rent: CalendarSource = {
  name: "Miete",
  type: "expense",
  amountCents: 80000,
  interval: "monthly",
  dayOfMonth: 3,
  nextDueDate: "2026-12-03",
  active: true,
};
const salary: CalendarSource = {
  name: "Gehalt",
  type: "income",
  amountCents: 250000,
  interval: "monthly",
  dayOfMonth: 28,
  nextDueDate: "2026-12-28",
  active: true,
};

describe("Fixkosten-Kalender", () => {
  it("listet Fälligkeiten eines Monats sortiert und summiert sie", () => {
    const cal = buildMonthCalendar([salary, rent], "2026-12");
    assert.deepEqual(cal.entries.map((e) => e.name), ["Miete", "Gehalt"]);
    assert.equal(cal.expenseCents, 80000);
    assert.equal(cal.incomeCents, 250000);
    assert.equal(cal.shortfallDate, null);
  });

  it("überspringt inaktive Posten und andere Monate", () => {
    const cal = buildMonthCalendar([{ ...rent, active: false }, salary], "2027-02");
    assert.deepEqual(cal.entries.map((e) => e.name), ["Gehalt"]);
  });

  it("erkennt einen Engpass, wenn der Kontostand vor der Gutschrift nicht reicht", () => {
    const cal = buildMonthCalendar([rent, salary], "2026-12", 50000, "2026-12-01");
    assert.equal(cal.shortfallDate, "2026-12-03");
    assert.equal(cal.entries[0].balanceAfterCents, -30000);
    assert.equal(cal.entries[1].balanceAfterCents, 220000);
  });

  it("rechnet Fälligkeiten vor dem Stichtag nicht in den Saldo ein", () => {
    const cal = buildMonthCalendar([rent, salary], "2026-12", 50000, "2026-12-10");
    assert.equal(cal.shortfallDate, null);
    assert.equal(cal.entries[0].balanceAfterCents, null);
  });
});
