import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-month-summary.db");
process.env.DATABASE_PATH = testDbPath;

describe("Monatsabschluss", async () => {
  const userId = "month-user";
  let getMonthSummary: typeof import("../../src/lib/month-summary").getMonthSummary;
  let previousMonthKey: typeof import("../../src/lib/month-summary").previousMonthKey;

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    const s = await import("../../src/lib/db/schema");
    ({ getMonthSummary, previousMonthKey } = await import("../../src/lib/month-summary"));
    const now = new Date();
    m.db.insert(s.user).values({ id: userId, name: "M", email: "m@example.com", createdAt: now, updatedAt: now }).run();
    const cat = (id: string, name: string, type: "expense" | "income") =>
      m.db.insert(s.categories).values({ id, userId, name, type, color: "#000", icon: "tag", createdAt: now } as never).run();
    cat("c-food", "Essen", "expense");
    cat("c-sal", "Gehalt", "income");
    const tx = (id: string, date: string, type: "expense" | "income", cents: number, categoryId: string) =>
      m.db
        .insert(s.transactions)
        .values({
          id, userId, date, type, costType: "variable", amountCents: cents, categoryId,
          description: id, paymentMethod: "card", createdAt: now, updatedAt: now,
        } as never)
        .run();
    tx("t1", "2026-10-02", "income", 300000, "c-sal");
    tx("t2", "2026-10-05", "expense", 20000, "c-food");
    tx("t3", "2026-11-05", "expense", 60000, "c-food");
    tx("t4", "2026-11-06", "income", 300000, "c-sal");
  });

  it("berechnet Einnahmen, Ausgaben und Sparquote", () => {
    const r = getMonthSummary(userId, "2026-11");
    assert.equal(r.incomeCents, 300000);
    assert.equal(r.expenseCents, 60000);
    assert.equal(r.savedCents, 240000);
    assert.equal(r.savingsRatePercent, 80);
    assert.equal(r.hasData, true);
  });

  it("nennt Kategorien mit deutlich höheren Ausgaben als im Vormonat", () => {
    const r = getMonthSummary(userId, "2026-11");
    assert.equal(r.biggestIncreases.length, 1);
    assert.equal(r.biggestIncreases[0].name, "Essen");
    assert.equal(r.biggestIncreases[0].deltaCents, 40000);
  });

  it("meldet hasData=false für Monate ohne Buchungen", () => {
    assert.equal(getMonthSummary(userId, "2025-01").hasData, false);
  });

  it("berechnet den Vormonat über den Jahreswechsel", () => {
    assert.equal(previousMonthKey(new Date(2027, 0, 5)), "2026-12");
  });
});
