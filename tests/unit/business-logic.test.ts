import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const testDbPath = path.resolve("./data/test-business-logic.db");
process.env.DATABASE_PATH = testDbPath;

describe("Geschäftslogik: Import, Splits, Erstattungen, Regeln, Fixkosten, Umbuchungen", async () => {
  const userId = "logic-user";
  let db: typeof import("../../src/lib/db/index").db;
  let s: typeof import("../../src/lib/db/schema");
  let eq: typeof import("drizzle-orm").eq;

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    db = m.db;
    s = await import("../../src/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    db.insert(s.user).values({ id: userId, name: "L", email: "logic@kosten.local", createdAt: now, updatedAt: now }).run();
    db.insert(s.categories)
      .values([
        { id: "l-food", userId, name: "Lebensmittel", type: "expense", createdAt: now },
        { id: "l-drug", userId, name: "Drogerie", type: "expense", createdAt: now },
        { id: "l-clothes", userId, name: "Kleidung", type: "expense", createdAt: now },
        { id: "l-salary", userId, name: "Gehalt", type: "income", createdAt: now },
      ])
      .run();
  });

  it("CSV-Import behält gleiche Käufe am selben Tag und bleibt beim Re-Import idempotent", async () => {
    const { importCsvTransactionsAction } = await import("../../src/actions/csv-actions");
    const header = "Datum;Betrag_EUR;Typ;Kostenart;Kategorie;Beschreibung;Zahlungsmethode\n";
    const row = "2026-11-20;3,50;Ausgabe;Variabel;Lebensmittel;Bäckerei Sonne;card\n";
    const first = (await importCsvTransactionsAction(header + row + row, null, false)) as { importedCount: number; skippedDuplicates: number };
    assert.deepEqual([first.importedCount, first.skippedDuplicates], [2, 0]);
    const again = (await importCsvTransactionsAction(header + row + row, null, false)) as { importedCount: number; skippedDuplicates: number };
    assert.deepEqual([again.importedCount, again.skippedDuplicates], [0, 2]);
    const more = (await importCsvTransactionsAction(header + row + row + row, null, false)) as { importedCount: number; skippedDuplicates: number };
    assert.deepEqual([more.importedCount, more.skippedDuplicates], [1, 2]);
  });

  it("Auswertungen lösen Splits auf und verrechnen Erstattungen mit der Ausgabe", async () => {
    const { createTransactionAction, splitTransactionAction } = await import("../../src/actions/transaction-actions");
    const { getAnnualReportData } = await import("../../src/lib/reports");
    const t = await createTransactionAction({ categoryId: "l-food", type: "expense", amountCents: 10000, date: "2025-03-05", description: "Großeinkauf", paymentMethod: "card" });
    await splitTransactionAction({ transactionId: t.id!, splits: [{ categoryId: "l-food", amountCents: 7000 }, { categoryId: "l-drug", amountCents: 3000 }] });
    const now = new Date();
    db.insert(s.transactions)
      .values([
        { id: "l-shoes", userId, categoryId: "l-clothes", type: "expense", costType: "variable", amountCents: 8000, date: "2025-03-10", description: "Zalando", createdAt: now, updatedAt: now },
        { id: "l-refund", userId, categoryId: "l-clothes", type: "income", costType: "variable", amountCents: 8000, date: "2025-03-20", description: "Zalando Erstattung", createdAt: now, updatedAt: now },
        { id: "l-pay", userId, categoryId: "l-salary", type: "income", costType: "fixed", amountCents: 300000, date: "2025-03-28", description: "Gehalt", createdAt: now, updatedAt: now },
      ])
      .run();

    const rep = getAnnualReportData(userId, 2025);
    const byName = Object.fromEntries(rep.topExpenseCategories.map((c) => [c.name, c.amountCents]));
    assert.deepEqual(byName, { Lebensmittel: 7000, Drogerie: 3000 });
    assert.equal(rep.totalIncomeCents, 300000, "Erstattung zählt nicht als Einkommen");
    assert.equal(rep.monthlyBreakdown[2].variableExpensesCents, 10000);
  });

  it("Standardregeln: keine Regex-Muster, keine Fehltreffer, PayPal-Regel standardmäßig aus", async () => {
    const { DEFAULT_RULE_PRESETS } = await import("../../src/lib/default-rules");
    const { matchesRule } = await import("../../src/lib/category-rules");
    for (const r of DEFAULT_RULE_PRESETS) {
      assert.equal(r.matchField, "all");
      assert.doesNotMatch(r.pattern, /\.\*|\\\\/, `Regex-Syntax in ${r.name}`);
    }
    const find = (name: string) => DEFAULT_RULE_PRESETS.find((r) => r.name.startsWith(name))!;
    assert.equal(find("PayPal").inactiveByDefault, true);
    const shopping = DEFAULT_RULE_PRESETS.find((r) => r.pattern.includes("zalando"))!;
    assert.equal(matchesRule("SEPA Transaction 123", shopping), false);
    assert.equal(matchesRule("Lotto Hessen", shopping), false);
    const streaming = DEFAULT_RULE_PRESETS.find((r) => r.pattern.includes("netflix"))!;
    assert.equal(matchesRule("Disney+ Abo", streaming), true);
    assert.equal(matchesRule("Skyline Parkhaus", streaming), false);
    const transfer = find("Kreditkarten");
    assert.equal(matchesRule("Gutschrift Umbuchung Mietkaution", transfer), false);
  });

  it("Fixkosten erkennen Preisänderungen und buchen nicht doppelt, wenn die Bank schon abgebucht hat", async () => {
    const { findMatchingRecurring } = await import("../../src/lib/recurring-matching");
    const candidates = [{ id: "r1", name: "Netflix", amountCents: 1799, categoryId: "l-food", type: "expense" as const }];
    assert.equal(findMatchingRecurring(candidates, { type: "expense", amountCents: 1999, text: "NETFLIX INTERNATIONAL B.V. Ref 42" })?.id, "r1");
    assert.equal(findMatchingRecurring(candidates, { type: "expense", amountCents: 9999, text: "Netflix" }), undefined);
    assert.equal(findMatchingRecurring(candidates, { type: "expense", amountCents: 1799, text: "Spotify" }), undefined);

    const { processDueRecurringExpenses } = await import("../../src/lib/recurring-processor");
    const { todayISO } = await import("../../src/lib/format");
    const today = todayISO();
    const threeDaysAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10);
    const now = new Date();
    db.insert(s.recurringExpenses)
      .values({ id: "l-rec", userId, categoryId: "l-food", name: "Fitnessstudio", amountCents: 2990, interval: "monthly", dayOfMonth: Number(today.slice(8, 10)), startDate: today, nextDueDate: today, type: "expense", autoBook: true, active: true, createdAt: now })
      .run();
    db.insert(s.transactions)
      .values({ id: "l-bank-paid", userId, categoryId: "l-food", type: "expense", costType: "fixed", amountCents: 2990, date: threeDaysAgo, description: "FitX", recurringId: "l-rec", bankTransactionId: "bank-1", createdAt: now, updatedAt: now })
      .run();
    assert.equal(processDueRecurringExpenses(userId), 0, "keine zusätzliche Buchung");
    const rec = db.select().from(s.recurringExpenses).where(eq(s.recurringExpenses.id, "l-rec")).get()!;
    assert.ok(rec.nextDueDate > today, "Fälligkeit wurde trotzdem weitergeschoben");
  });

  it("erkennt Erstattungstexte", async () => {
    const { isRefundText } = await import("../../src/lib/bank-sync/sync-engine");
    assert.equal(isRefundText("Zalando SE Rückerstattung Bestellung 123"), true);
    assert.equal(isRefundText("AMAZON Retoure"), true);
    assert.equal(isRefundText("Gehalt November"), false);
  });

  it("Umbuchung: synchronisierte Konten bekommen keine eigene Buchung, Kategorie wird angelegt", async () => {
    const now = new Date();
    db.insert(s.connectedBanks)
      .values({ id: "l-bank", userId, provider: "enable_banking", institutionId: "ING_DE", institutionName: "ING", encryptedAccessToken: "x", consentId: "c", consentExpiresAt: "2099-01-01", createdAt: now, updatedAt: now })
      .run();
    db.insert(s.bankAccounts)
      .values([
        { id: "l-giro-sync", connectedBankId: "l-bank", userId, accountExternalId: "g", accountName: "Giro (Sync)", accountType: "checking", currency: "EUR", balanceCents: 100000, autoSync: true, createdAt: now, updatedAt: now },
        { id: "l-card", userId, accountExternalId: "c", accountName: "Karte", accountType: "credit_card", currency: "EUR", balanceCents: -50000, autoSync: false, createdAt: now, updatedAt: now },
      ])
      .run();
    const { transferBetweenAccountsAction } = await import("../../src/actions/bank-actions");
    const res = await transferBetweenAccountsAction({ sourceAccountId: "l-giro-sync", targetAccountId: "l-card", amountCents: 50000, date: "2026-11-20" });
    assert.equal(res.success, true);
    const txs = db.select().from(s.transactions).where(eq(s.transactions.date, "2026-11-20")).all().filter((t) => t.costType === "transfer");
    assert.deepEqual(txs.map((t) => t.bankAccountId), ["l-card"]);
    const giro = db.select().from(s.bankAccounts).where(eq(s.bankAccounts.id, "l-giro-sync")).get()!;
    const card = db.select().from(s.bankAccounts).where(eq(s.bankAccounts.id, "l-card")).get()!;
    assert.equal(giro.balanceCents, 100000, "synchronisiertes Konto unverändert");
    assert.equal(card.balanceCents, 0);
    const cat = db.select().from(s.categories).where(eq(s.categories.id, txs[0].categoryId)).get()!;
    assert.equal(cat.name, "Umbuchung & Ausgleich");
  });

  it("Migration 6 korrigiert Altdaten (Regeln, vertauschte Kreditkarten)", async () => {
    const { MIGRATIONS, runMigrations } = await import("../../src/lib/db/migrations");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-m6-"));
    const conn = new Database(path.join(dir, "m6.db"));
    try {
      runMigrations(conn, MIGRATIONS.filter((m) => m.id <= 5));
      const old = new Date("2026-11-20T10:00:00Z").getTime() / 1000;
      const fresh = new Date("2026-11-23T10:00:00Z").getTime() / 1000;
      conn.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'U', 'u@x', 1, 1);
        INSERT INTO categories (id, user_id, name, type, created_at) VALUES ('c', 'u', 'Umbuchung & Ausgleich', 'expense', 1);
        INSERT INTO category_rules (id, user_id, pattern, match_field, category_id, cost_type, priority, is_active, created_at, updated_at)
          VALUES ('r1', 'u', 'paypal.*lastschrift|paypal europe|paypal abbuchung', 'any', 'c', 'transfer', 85, 1, 1, 1);
        INSERT INTO bank_accounts (id, user_id, account_external_id, account_name, account_type, currency, balance_cents, credit_limit_cents, auto_sync, created_at, updated_at)
          VALUES ('legacy', 'u', 'l', 'Alt', 'credit_card', 'EUR', 4000, 2000, 0, ${old}, ${old}),
                 ('credit', 'u', 'n', 'Neu mit Guthaben', 'credit_card', 'EUR', 5000, 200000, 0, ${fresh}, ${fresh});`);
      assert.deepEqual(runMigrations(conn, MIGRATIONS.filter((m) => m.id <= 6)), [6]);
      const rule = conn.prepare("SELECT pattern, match_field, is_active FROM category_rules WHERE id = 'r1'").get() as { pattern: string; match_field: string; is_active: number };
      assert.deepEqual(rule, { pattern: "paypal europe|paypal (europe)|paypal lastschrift|paypal abbuchung", match_field: "all", is_active: 0 });
      const legacy = conn.prepare("SELECT balance_cents b, credit_limit_cents l FROM bank_accounts WHERE id = 'legacy'").get();
      assert.deepEqual(legacy, { b: -2000, l: 6000 });
      const credit = conn.prepare("SELECT balance_cents b, credit_limit_cents l FROM bank_accounts WHERE id = 'credit'").get();
      assert.deepEqual(credit, { b: 5000, l: 200000 }, "neue Karte mit Guthaben unverändert");
    } finally {
      conn.close();
    }
  });
});
