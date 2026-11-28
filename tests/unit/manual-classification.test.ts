import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-manual-classification.db");
process.env.DATABASE_PATH = testDbPath;

describe("Manuelle Zuordnung wird von Erkennung und Regeln respektiert", async () => {
  const userId = "manual-class-user";
  let db: typeof import("../../src/lib/db/index").db;
  let s: typeof import("../../src/lib/db/schema");
  let eq: typeof import("drizzle-orm").eq;
  let txActions: typeof import("../../src/actions/transaction-actions");
  let detectOwnAccountTransfers: typeof import("../../src/lib/transfer-detection").detectOwnAccountTransfers;

  function insertTx(id: string, values: { type: "expense" | "income"; amountCents: number; date: string; bankAccountId: string; categoryId?: string; description?: string; recurringId?: string }) {
    const now = new Date();
    db.insert(s.transactions)
      .values({
        id,
        userId,
        categoryId: values.categoryId ?? (values.type === "expense" ? "mc-misc" : "mc-inc"),
        type: values.type,
        costType: "variable",
        amountCents: values.amountCents,
        date: values.date,
        description: values.description ?? id,
        bankAccountId: values.bankAccountId,
        recurringId: values.recurringId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const row = (id: string) => db.select().from(s.transactions).where(eq(s.transactions.id, id)).get()!;

  function editPayload(id: string, overrides: Partial<{ categoryId: string; costType: "variable" | "fixed" | "transfer"; description: string }> = {}) {
    const r = row(id);
    return {
      id,
      categoryId: overrides.categoryId ?? r.categoryId,
      type: r.type,
      costType: overrides.costType ?? r.costType,
      amountCents: r.amountCents,
      date: r.date,
      description: overrides.description ?? r.description,
      paymentMethod: r.paymentMethod,
      bankAccountId: r.bankAccountId,
    };
  }

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    db = m.db;
    s = await import("../../src/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    txActions = await import("../../src/actions/transaction-actions");
    ({ detectOwnAccountTransfers } = await import("../../src/lib/transfer-detection"));

    process.env.TEST_USER_ID = userId;
    const now = new Date();
    db.insert(s.user).values({ id: userId, name: "M", email: "manual@kosten.local", createdAt: now, updatedAt: now }).run();
    db.insert(s.categories)
      .values([
        { id: "mc-misc", userId, name: "Sonstiges", type: "expense", createdAt: now },
        { id: "mc-food", userId, name: "Lebensmittel", type: "expense", createdAt: now },
        { id: "mc-rent", userId, name: "Wohnen", type: "expense", createdAt: now },
        { id: "mc-inc", userId, name: "Einnahmen", type: "income", createdAt: now },
        { id: "mc-refund", userId, name: "Erstattungen", type: "income", createdAt: now },
      ])
      .run();
    for (const [id, type] of [["mc-giro", "checking"], ["mc-save", "savings"]] as const) {
      db.insert(s.bankAccounts)
        .values({ id, userId, accountExternalId: id, accountName: id, accountType: type, currency: "EUR", balanceCents: null, autoSync: false, createdAt: now, updatedAt: now })
        .run();
    }
  });

  it("korrigierte Buchungen bleiben nach erneuter Erkennung unverändert", async () => {
    insertTx("fp-out", { type: "expense", amountCents: 4200, date: "2026-10-05", bankAccountId: "mc-giro" });
    insertTx("fp-in", { type: "income", amountCents: 4200, date: "2026-10-06", bankAccountId: "mc-save" });
    assert.equal(detectOwnAccountTransfers(userId, "2026-10-01"), 1);
    assert.equal(row("fp-out").costType, "transfer");

    // Nutzer stellt fest: zufällig gleicher Betrag, keine Umbuchung
    assert.equal((await txActions.updateTransactionAction(editPayload("fp-out", { categoryId: "mc-food", costType: "variable" }))).success, true);
    assert.equal((await txActions.updateTransactionAction(editPayload("fp-in", { categoryId: "mc-refund", costType: "variable" }))).success, true);
    assert.equal(row("fp-out").manuallyClassified, true);
    assert.equal(row("fp-in").manuallyClassified, true);

    assert.equal(detectOwnAccountTransfers(userId, "2026-10-01"), 0);
    assert.equal(row("fp-out").categoryId, "mc-food");
    assert.equal(row("fp-out").costType, "variable");
    assert.equal(row("fp-in").categoryId, "mc-refund");
    assert.equal(row("fp-in").costType, "variable");
  });

  it("Buchung mit Fixkosten-Verknüpfung wird nicht gepaart", async () => {
    const now = new Date();
    db.insert(s.recurringExpenses)
      .values({ id: "mc-rec", userId, categoryId: "mc-rent", type: "expense", name: "Miete", amountCents: 90000, paymentMethod: "transfer", interval: "monthly", dayOfMonth: 1, startDate: "2026-01-01", nextDueDate: "2026-12-01", createdAt: now })
      .run();
    insertTx("rec-out", { type: "expense", amountCents: 90000, date: "2026-11-01", bankAccountId: "mc-giro", categoryId: "mc-rent", recurringId: "mc-rec" });
    insertTx("rec-in", { type: "income", amountCents: 90000, date: "2026-11-02", bankAccountId: "mc-save" });

    assert.equal(detectOwnAccountTransfers(userId, "2026-11-01"), 0);
    assert.equal(row("rec-out").recurringId, "mc-rec");
    assert.equal(row("rec-out").costType, "variable");
    assert.equal(row("rec-in").costType, "variable");
  });

  it("unmarkierte Paare werden weiter erkannt", () => {
    insertTx("ok-out", { type: "expense", amountCents: 1234, date: "2026-11-10", bankAccountId: "mc-giro" });
    insertTx("ok-in", { type: "income", amountCents: 1234, date: "2026-11-11", bankAccountId: "mc-save" });
    assert.equal(detectOwnAccountTransfers(userId, "2026-11-01"), 1);
    assert.equal(row("ok-out").costType, "transfer");
    assert.equal(row("ok-in").costType, "transfer");
    assert.equal(row("ok-out").manuallyClassified, false, "automatische Erkennung setzt kein Kennzeichen");
  });

  it("Bearbeiten ohne Änderung von Kategorie oder Kostenart setzt kein Kennzeichen", async () => {
    insertTx("plain", { type: "expense", amountCents: 500, date: "2026-11-15", bankAccountId: "mc-giro", categoryId: "mc-food" });
    const res = await txActions.updateTransactionAction(editPayload("plain", { description: "Neuer Text" }));
    assert.equal(res.success, true);
    assert.equal(row("plain").description, "Neuer Text");
    assert.equal(row("plain").manuallyClassified, false);
  });

  it("neue Buchungen und Massen-Update setzen das Kennzeichen", async () => {
    const created = await txActions.createTransactionAction({ categoryId: "mc-food", type: "expense", amountCents: 700, date: "2026-11-16", description: "Bäcker", paymentMethod: "card" });
    assert.equal(created.success, true);
    assert.equal(row(created.id!).manuallyClassified, true);

    insertTx("batch", { type: "expense", amountCents: 800, date: "2026-11-16", bankAccountId: "mc-giro" });
    assert.equal((await txActions.batchUpdateTransactionsAction({ ids: ["batch"], categoryId: "mc-food" })).success, true);
    assert.equal(row("batch").manuallyClassified, true);
  });

  it("Prüfung: nur eine abweichende Kategorie setzt das Kennzeichen", async () => {
    const { confirmInboxTransactionAction } = await import("../../src/actions/inbox-actions");
    insertTx("inbox-same", { type: "expense", amountCents: 900, date: "2026-11-17", bankAccountId: "mc-giro" });
    insertTx("inbox-other", { type: "expense", amountCents: 901, date: "2026-11-17", bankAccountId: "mc-giro" });

    assert.equal((await confirmInboxTransactionAction({ id: "inbox-same" })).success, true);
    assert.equal((await confirmInboxTransactionAction({ id: "inbox-other", categoryId: "mc-food" })).success, true);
    assert.equal(row("inbox-same").manuallyClassified, false);
    assert.equal(row("inbox-other").manuallyClassified, true);
  });

  it("Regeln mit Überschreiben lassen gekennzeichnete Buchungen unverändert", async () => {
    const { createCategoryRuleAction, applyCategoryRulesAction } = await import("../../src/actions/category-rule-actions");
    insertTx("rule-manual", { type: "expense", amountCents: 1500, date: "2026-11-18", bankAccountId: "mc-giro", categoryId: "mc-food", description: "MARKTHALLE Einkauf" });
    insertTx("rule-auto", { type: "expense", amountCents: 1600, date: "2026-11-18", bankAccountId: "mc-giro", categoryId: "mc-food", description: "MARKTHALLE Miete Stand" });
    db.update(s.transactions).set({ manuallyClassified: true }).where(eq(s.transactions.id, "rule-manual")).run();
    const manualBefore = db.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.manuallyClassified, true)).all().length;

    assert.equal((await createCategoryRuleAction({ pattern: "MARKTHALLE", matchField: "all", categoryId: "mc-rent", costType: "fixed", priority: 10 })).success, true);
    const res = await applyCategoryRulesAction({ overwriteExisting: true });
    assert.equal(res.success, true);

    assert.equal(row("rule-manual").categoryId, "mc-food");
    assert.equal(row("rule-manual").costType, "variable");
    assert.equal(row("rule-auto").categoryId, "mc-rent");
    assert.equal(row("rule-auto").costType, "fixed");
    assert.equal(res.manualSkippedCount, manualBefore);
    assert.match(res.message ?? "", new RegExp(`${manualBefore} von Hand zugeordnete Buchungen übersprungen`));
  });

  it("Migration 11 ergänzt die Spalte idempotent", async () => {
    const Database = (await import("better-sqlite3")).default;
    const { MIGRATIONS, runMigrations } = await import("../../src/lib/db/migrations");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-m11-"));
    const conn = new Database(path.join(dir, "m11.db"));
    try {
      runMigrations(conn, MIGRATIONS.filter((m) => m.id < 11));
      conn.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('a', 'A', 'a@x', 1, 1);
        INSERT INTO categories (id, user_id, name, type, created_at) VALUES ('c', 'a', 'X', 'expense', 1);
        INSERT INTO transactions (id, user_id, category_id, type, cost_type, amount_cents, date, description, payment_method, created_at, updated_at)
          VALUES ('t', 'a', 'c', 'expense', 'variable', 1, '2026-01-01', 'x', 'card', 1, 1);`);
      assert.deepEqual(runMigrations(conn, MIGRATIONS), [11]);
      const r = conn.prepare("SELECT manually_classified FROM transactions WHERE id = 't'").get() as { manually_classified: number };
      assert.equal(r.manually_classified, 0, "bestehende Buchungen sind nicht gekennzeichnet");
      // Erneuter Lauf der Migration (z. B. nach Wiederherstellung) scheitert nicht
      assert.doesNotThrow(() => MIGRATIONS.find((m) => m.id === 11)!.up(conn));
    } finally {
      conn.close();
    }
  });
});
