import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-transactions-list.db");
process.env.DATABASE_PATH = testDbPath;

describe("Umsatzliste: Laden nach Monat", async () => {
  const userId = "list-user";
  const otherUserId = "list-other";
  let list: typeof import("../../src/lib/transactions-list");

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    const s = await import("../../src/lib/db/schema");
    list = await import("../../src/lib/transactions-list");
    const now = new Date();
    for (const id of [userId, otherUserId]) {
      m.db.insert(s.user).values({ id, name: id, email: `${id}@kosten.local`, createdAt: now, updatedAt: now }).run();
      m.db.insert(s.categories).values({ id: `cat-${id}`, userId: id, name: "X", type: "expense", createdAt: now }).run();
    }
    const tx = (id: string, date: string, owner = userId, createdAt = now) => ({
      id, userId: owner, categoryId: `cat-${owner}`, type: "expense" as const, costType: "variable" as const,
      amountCents: 100, date, description: id, createdAt, updatedAt: createdAt,
    });
    m.db.insert(s.transactions).values([
      tx("jan-31", "2026-01-31"),
      tx("feb-01", "2026-02-01"),
      tx("feb-28-a", "2026-02-28", userId, new Date("2026-02-28T08:00:00Z")),
      tx("feb-28-b", "2026-02-28", userId, new Date("2026-02-28T09:00:00Z")),
      tx("mar-01", "2026-03-01"),
      tx("dec-15", "2025-12-15"),
      tx("fremd-feb", "2026-02-10", otherUserId),
    ]).run();
  });

  it("liest den Monat aus der URL und fällt sonst auf den aktuellen zurück", () => {
    assert.equal(list.parseListMonth("2026-02", "2026-11"), "2026-02");
    assert.equal(list.parseListMonth("all", "2026-11"), "all");
    assert.equal(list.parseListMonth(["2026-03", "2026-04"], "2026-11"), "2026-03");
    for (const bad of [undefined, "", "2026-13", "2026-2", "alle", "2026-02'--"]) {
      assert.equal(list.parseListMonth(bad, "2026-11"), "2026-11", String(bad));
    }
  });

  it("lädt nur die Buchungen des gewählten Monats, neueste zuerst", () => {
    const ids = list.loadTransactionsForList(userId, "2026-02").map((t) => t.id);
    assert.deepEqual(ids, ["feb-28-b", "feb-28-a", "feb-01"]);
  });

  it("lädt bei „alle“ die ganze Historie, aber nur eigene Buchungen", () => {
    const ids = list.loadTransactionsForList(userId, "all").map((t) => t.id);
    assert.equal(ids.length, 6);
    assert.equal(ids.includes("fremd-feb"), false);
    assert.equal(ids[0], "mar-01");
  });

  it("listet Monate mit Buchungen und immer den aktuellen Monat", () => {
    assert.deepEqual(list.listAvailableMonths(userId, "2026-11"), ["2026-11", "2026-03", "2026-02", "2026-01", "2025-12"]);
    assert.deepEqual(list.listAvailableMonths(otherUserId, "2026-11"), ["2026-11", "2026-02"]);
  });

  it("liefert die neuesten Buchungen unabhängig vom Monat", () => {
    const recent = list.loadRecentTransactions(userId, 2);
    assert.deepEqual(recent.map((t) => t.id), ["mar-01", "feb-28-b"]);
    assert.deepEqual(Object.keys(recent[0]).sort(), ["amountCents", "costType", "date", "description", "id", "type"]);
  });
});
