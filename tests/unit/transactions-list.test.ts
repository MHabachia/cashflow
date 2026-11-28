import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-transactions-list.db");
process.env.DATABASE_PATH = testDbPath;

describe("Umsatzliste: Filter, Seiten und Summen auf dem Server", async () => {
  const userId = "list-user";
  const otherUserId = "list-other";
  let list: typeof import("../../src/lib/transactions-list");
  let actions: typeof import("../../src/actions/transaction-list-actions");

  const all = (overrides: Partial<import("../../src/lib/transactions-list").TransactionListFilter> = {}) => ({
    month: "all",
    search: "",
    categoryId: "all",
    costType: "all" as const,
    bankAccountId: "all",
    ...overrides,
  });

  /** Alle Seiten nacheinander laden, wie „Weitere laden“ es tut */
  function loadAllPages(filter: ReturnType<typeof all>, pageSize: number) {
    const ids: string[] = [];
    let page = list.queryTransactions(userId, filter, null, pageSize);
    ids.push(...page.rows.map((r) => r.id));
    while (page.nextCursor) {
      page = list.queryTransactions(userId, filter, list.decodeCursor(page.nextCursor), pageSize);
      ids.push(...page.rows.map((r) => r.id));
    }
    return ids;
  }

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    const s = await import("../../src/lib/db/schema");
    list = await import("../../src/lib/transactions-list");
    actions = await import("../../src/actions/transaction-list-actions");
    process.env.TEST_USER_ID = userId;
    const now = new Date("2026-11-28T10:00:00Z");
    for (const id of [userId, otherUserId]) {
      m.db.insert(s.user).values({ id, name: id, email: `${id}@kosten.local`, createdAt: now, updatedAt: now }).run();
    }
    m.db.insert(s.categories).values([
      { id: "cat-food", userId, name: "Lebensmittel", type: "expense", createdAt: now },
      { id: "cat-obst", userId, name: "Äpfel & Obst", type: "expense", createdAt: now },
      { id: "cat-rent", userId, name: "Miete", type: "expense", createdAt: now },
      { id: "cat-inc", userId, name: "Gehalt", type: "income", createdAt: now },
      { id: "cat-other", userId: otherUserId, name: "Fremd", type: "expense", createdAt: now },
    ]).run();
    m.db.insert(s.bankAccounts).values({ id: "acc-giro", userId, accountExternalId: "g", accountName: "Girokonto Sparkasse", accountType: "checking", currency: "EUR", balanceCents: 0, autoSync: false, createdAt: now, updatedAt: now }).run();

    const tx = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
      id, userId, categoryId: "cat-food", type: "expense" as const, costType: "variable" as const,
      amountCents: 100, date, description: id, createdAt: now, updatedAt: now, ...extra,
    });
    m.db.insert(s.transactions).values([
      tx("jan-31", "2026-01-31"),
      tx("feb-01", "2026-02-01", { createdAt: new Date("2026-02-01T08:00:00Z") }),
      tx("feb-28-a", "2026-02-28", { createdAt: new Date("2026-02-28T08:00:00Z") }),
      tx("feb-28-b", "2026-02-28", { createdAt: new Date("2026-02-28T09:00:00Z") }),
      tx("mar-01", "2026-03-01"),
      tx("dec-15", "2025-12-15"),
      tx("rent", "2026-03-01", { categoryId: "cat-rent", costType: "fixed", amountCents: 90000, description: "Miete März" }),
      tx("salary", "2026-03-01", { categoryId: "cat-inc", type: "income", amountCents: 300000, description: "Gehalt" }),
      tx("apple", "2026-03-02", { categoryId: "cat-obst", description: "Wochenmarkt" }),
      tx("percent", "2026-03-03", { description: "Rabatt 100% Aktion" }),
      tx("underscore", "2026-03-03", { description: "Ref_123" }),
      tx("giro", "2026-03-04", { bankAccountId: "acc-giro", description: "Kartenzahlung" }),
      tx("transfer", "2026-03-05", { costType: "transfer", amountCents: 500 }),
      { ...tx("fremd", "2026-03-01"), userId: otherUserId, categoryId: "cat-other" },
    ]).run();
    // Viele Buchungen am selben Tag mit identischer Anlagezeit: Reihenfolge nur über die ID
    m.db.insert(s.transactions).values(
      Array.from({ length: 25 }, (_, i) => tx(`same-${String(i).padStart(2, "0")}`, "2026-04-10"))
    ).run();
  });

  it("liest Filter aus der URL und fällt bei Ungültigem auf „alle“ zurück", () => {
    assert.deepEqual(list.parseListFilter({}, "2026-11"), { month: "2026-11", search: "", categoryId: "all", costType: "all", bankAccountId: "all" });
    assert.deepEqual(
      list.parseListFilter({ month: "all", q: "  rewe ", category: "cat-food", costType: "fixed", bankAccountId: "manual" }, "2026-11"),
      { month: "all", search: "rewe", categoryId: "cat-food", costType: "fixed", bankAccountId: "manual" }
    );
    const bad = list.parseListFilter({ month: "2026-13", costType: "transfer", category: "x".repeat(201), q: "a".repeat(150) }, "2026-11");
    assert.equal(bad.month, "2026-11");
    assert.equal(bad.costType, "all");
    assert.equal(bad.categoryId, "all");
    assert.equal(bad.search.length, 100);
  });

  it("lädt nur den gewählten Monat, neueste zuerst", () => {
    const ids = list.queryTransactions(userId, all({ month: "2026-02" })).rows.map((t) => t.id);
    assert.deepEqual(ids, ["feb-28-b", "feb-28-a", "feb-01"]);
  });

  it("liefert nur eigene Buchungen", () => {
    const ids = loadAllPages(all(), 100);
    assert.equal(ids.includes("fremd"), false);
    assert.equal(ids.length, 38);
  });

  it("filtert nach Kategorie, Kostenart und Konto", () => {
    const ids = (f: Parameters<typeof all>[0]) => loadAllPages(all(f), 100).sort();
    assert.deepEqual(ids({ categoryId: "cat-rent" }), ["rent"]);
    assert.deepEqual(ids({ costType: "fixed" }), ["rent"]);
    assert.deepEqual(ids({ bankAccountId: "acc-giro" }), ["giro"]);
    assert.equal(ids({ bankAccountId: "manual" }).includes("giro"), false);
    assert.deepEqual(ids({ categoryId: "cat-other" }), [], "fremde Kategorie liefert nichts");
  });

  it("sucht in Beschreibung, Kategoriename und Kontoname, ohne Groß/Klein auch bei Umlauten", () => {
    const ids = (search: string) => loadAllPages(all({ search }), 100).sort();
    assert.deepEqual(ids("MIETE"), ["rent"]);
    assert.deepEqual(ids("äpfel"), ["apple"], "Kategoriename mit Umlaut");
    assert.deepEqual(ids("sparkasse"), ["giro"], "Kontoname");
  });

  it("wertet % und _ in der Suche wörtlich", () => {
    assert.deepEqual(loadAllPages(all({ search: "100%" }), 100), ["percent"]);
    assert.deepEqual(loadAllPages(all({ search: "f_1" }), 100), ["underscore"]);
    assert.deepEqual(loadAllPages(all({ search: "%" }), 100), ["percent"]);
  });

  it("blättert ohne Lücken und Dopplungen, auch bei gleichem Tag und gleicher Anlagezeit", () => {
    const expected = list.queryTransactions(userId, all(), null, 1000).rows.map((r) => r.id);
    for (const size of [1, 3, 7, 10]) {
      const paged = loadAllPages(all(), size);
      assert.deepEqual(paged, expected, `Seitengröße ${size}`);
      assert.equal(new Set(paged).size, paged.length);
    }
  });

  it("Summen entsprechen der bisherigen Berechnung im Browser", () => {
    for (const filter of [all(), all({ month: "2026-03" }), all({ search: "a" })]) {
      const rows = list.queryTransactions(userId, filter, null, 1000).rows;
      let variableExpenses = 0, fixedExpenses = 0, income = 0;
      for (const tx of rows) {
        if (tx.type === "income") income += tx.amountCents;
        else if (tx.costType === "fixed") fixedExpenses += tx.amountCents;
        else variableExpenses += tx.amountCents;
      }
      assert.deepEqual(list.summarizeTransactions(userId, filter), {
        count: rows.length, variableExpenses, fixedExpenses, totalExpenses: variableExpenses + fixedExpenses, income,
      });
    }
  });

  it("liefert für „Alle auswählen“ die IDs aller Treffer", () => {
    assert.deepEqual(list.listTransactionIds(userId, all({ month: "2026-02" })), ["feb-28-b", "feb-28-a", "feb-01"]);
  });

  it("lehnt manipulierte Cursor ab", () => {
    assert.equal(list.decodeCursor("kein-base64-json"), null);
    assert.equal(list.decodeCursor(Buffer.from(JSON.stringify({ date: "x", createdAt: 1, id: "a" })).toString("base64url")), null);
  });

  it("Actions: prüfen Eingaben und liefern die nächste Seite", async () => {
    const firstPage = list.queryTransactions(userId, all(), null, 100);
    assert.equal(firstPage.nextCursor, null, "alles passt auf eine Seite");
    const small = list.queryTransactions(userId, all(), null, 5);
    const res = await actions.loadMoreTransactionsAction({ filter: all(), cursor: small.nextCursor! });
    assert.equal(res.success, true);
    if (res.success) assert.deepEqual(res.rows.map((r) => r.id), firstPage.rows.slice(5, 105).map((r) => r.id));

    assert.equal((await actions.loadMoreTransactionsAction({ filter: all(), cursor: "kaputt" })).success, false);
    const badFilter = { ...all(), costType: "evil" } as unknown as ReturnType<typeof all>;
    assert.equal((await actions.loadMoreTransactionsAction({ filter: badFilter, cursor: small.nextCursor! })).success, false);
    assert.equal((await actions.listTransactionIdsAction({ filter: { ...all(), month: "2026-13" } })).success, false);

    const ids = await actions.listTransactionIdsAction({ filter: all({ categoryId: "cat-other" }) });
    assert.deepEqual(ids, { success: true, ids: [] }, "fremde Kategorie liefert keine IDs");
  });

  it("listet Monate mit Buchungen und immer den aktuellen Monat", () => {
    assert.deepEqual(list.listAvailableMonths(userId, "2026-11"), ["2026-11", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12"]);
  });

  it("liefert die neuesten Buchungen unabhängig vom Monat", () => {
    const recent = list.loadRecentTransactions(userId, 2);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].date, "2026-04-10");
  });
});
