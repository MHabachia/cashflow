import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const testDbPath = path.resolve("./data/test-bank-transactions.db");
process.env.DATABASE_PATH = testDbPath;

const userId = "bank-tx-user";
let categoryId = "";
let accountId = "";

async function insertTx(values: { bankTransactionId?: string; amountCents?: number; isSplit?: boolean }): Promise<string> {
  const { db } = await import("../../src/lib/db/index");
  const { transactions } = await import("../../src/lib/db/schema");
  const id = crypto.randomUUID();
  const now = new Date();
  db.insert(transactions)
    .values({
      id,
      userId,
      categoryId,
      type: "expense",
      costType: "variable",
      amountCents: values.amountCents ?? 1_000,
      date: "2026-11-20",
      description: "Testbuchung",
      paymentMethod: "card",
      bankAccountId: accountId,
      bankTransactionId: values.bankTransactionId ?? null,
      isSplit: values.isSplit ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

async function balance(): Promise<number | null> {
  const { db } = await import("../../src/lib/db/index");
  const { bankAccounts } = await import("../../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId)).get()?.balanceCents ?? null;
}

describe("Bankbuchungen", () => {
  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user, categories } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const { ensureDefaultCategoriesForUser } = await import("../../src/lib/db/defaults");
    ensureDatabaseTables();
    const now = new Date();
    db.insert(user).values({ id: userId, name: "Bank", email: "bank-tx@kosten.local", createdAt: now, updatedAt: now }).run();
    ensureDefaultCategoriesForUser(userId);
    categoryId = db.select().from(categories).where(eq(categories.userId, userId)).get()!.id;
    process.env.TEST_USER_ID = userId;

    const { createManualBankAccountAction } = await import("../../src/actions/bank-actions");
    const account = await createManualBankAccountAction({ accountName: "Giro", accountType: "checking", balanceCents: 50_000 });
    assert.ok(account.success);
    accountId = account.accountId!;
  });

  it("von der Bank übernommene Buchungen lassen sich nicht löschen", async () => {
    const { deleteTransactionAction } = await import("../../src/actions/transaction-actions");
    const { BANK_TRANSACTION_DELETE_ERROR } = await import("../../src/lib/transaction-messages");
    const id = await insertTx({ bankTransactionId: "bank-1" });

    const res = await deleteTransactionAction(id);
    assert.equal(res.success, false);
    if (!res.success) assert.equal(res.error, BANK_TRANSACTION_DELETE_ERROR);
    assert.equal(await balance(), 50_000);
  });

  it("manuelle Buchungen werden weiter gelöscht und der Saldo zurückgerechnet", async () => {
    const { deleteTransactionAction } = await import("../../src/actions/transaction-actions");
    const id = await insertTx({});
    assert.equal((await deleteTransactionAction(id)).success, true);
    assert.equal(await balance(), 51_000);
  });

  it("Massenlöschen überspringt Bankbuchungen und zählt richtig", async () => {
    const { batchDeleteTransactionsAction } = await import("../../src/actions/transaction-actions");
    const manual = await insertTx({});
    const synced = await insertTx({ bankTransactionId: "bank-2" });
    const res = await batchDeleteTransactionsAction([manual, synced]);
    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.count, 1);
      assert.equal(res.skippedBankCount, 1);
    }
  });

  it("der Betrag einer aufgeteilten Buchung lässt sich nicht ändern", async () => {
    const { updateTransactionAction } = await import("../../src/actions/transaction-actions");
    const id = await insertTx({ isSplit: true, amountCents: 2_000 });
    const base = { id, categoryId, type: "expense" as const, date: "2026-11-20", description: "Testbuchung", paymentMethod: "card" as const };

    assert.equal((await updateTransactionAction({ ...base, amountCents: 2_500 })).success, false);
    // Andere Felder bleiben änderbar
    assert.equal((await updateTransactionAction({ ...base, amountCents: 2_000, description: "Neuer Text" })).success, true);
  });
});

describe("Kategorie-Vorschlag beim Bank-Sync", () => {
  const cats = [
    { id: "wohnen", name: "Wohnen", type: "expense" as const },
    { id: "essen", name: "Restaurant & Ausgehen", type: "expense" as const },
    { id: "mobil", name: "Mobilität", type: "expense" as const },
    { id: "sonstiges", name: "Sonstiges", type: "expense" as const },
  ];

  it("kurze Suchwörter treffen nur ganze Wörter", async () => {
    const { findMatchingCategory } = await import("../../src/lib/bank-sync/sync-engine");
    assert.equal(findMatchingCategory("Stadtwerke Gas Abschlag", "expense", cats), "wohnen");
    assert.equal(findMatchingCategory("Gastro Müller GmbH", "expense", cats), "sonstiges");
    assert.equal(findMatchingCategory("Barmer Krankenkasse", "expense", cats), "sonstiges");
    assert.equal(findMatchingCategory("Cocktail Bar Mitte", "expense", cats), "essen");
    assert.equal(findMatchingCategory("DB Fernverkehr", "expense", cats), "mobil");
  });

  it("nutzt ohne passende Kategorie eine vorhandene statt einer erfundenen ID", async () => {
    const { findMatchingCategory } = await import("../../src/lib/bank-sync/sync-engine");
    assert.equal(findMatchingCategory("Gehalt", "income", cats), "wohnen");
  });
});
