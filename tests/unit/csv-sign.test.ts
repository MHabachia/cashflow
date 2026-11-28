import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-csv-sign.db");
process.env.DATABASE_PATH = testDbPath;

const userId = "csv-sign-user";

async function importedOf(description: string) {
  const { db } = await import("../../src/lib/db/index");
  const { transactions } = await import("../../src/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.description, description)))
    .get();
}

describe("CSV-Import ohne Typ-Spalte", () => {
  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user } = await import("../../src/lib/db/schema");
    const { ensureDefaultCategoriesForUser } = await import("../../src/lib/db/defaults");
    ensureDatabaseTables();
    const now = new Date();
    db.insert(user).values({ id: userId, name: "CSV", email: "csv-sign@kosten.local", createdAt: now, updatedAt: now }).run();
    ensureDefaultCategoriesForUser(userId);
    process.env.TEST_USER_ID = userId;
  });

  it("wertet das Vorzeichen aus, wenn die Datei Vorzeichen nutzt", async () => {
    const { importCsvTransactionsAction } = await import("../../src/actions/csv-actions");
    const { createManualBankAccountAction } = await import("../../src/actions/bank-actions");
    const { db } = await import("../../src/lib/db/index");
    const { bankAccounts } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const account = await createManualBankAccountAction({ accountName: "Giro", accountType: "checking", balanceCents: 0 });
    assert.ok(account.success);

    const csv = `Buchungsdatum;Verwendungszweck;Betrag
01.11.2026;Gehalt November;+2.500,00
02.11.2026;REWE Markt;-49,99
03.11.2026;Erstattung Versicherung;1.500`;
    const res = await importCsvTransactionsAction(csv, account.accountId, true);
    assert.equal(res.success, true);

    const salary = await importedOf("Gehalt November");
    assert.equal(salary?.type, "income");
    assert.equal(salary?.amountCents, 250_000);
    const rewe = await importedOf("REWE Markt");
    assert.equal(rewe?.type, "expense");
    assert.equal(rewe?.amountCents, 4_999);
    const refund = await importedOf("Erstattung Versicherung");
    assert.equal(refund?.type, "income");
    assert.equal(refund?.amountCents, 150_000);

    const balance = db.select().from(bankAccounts).where(eq(bankAccounts.id, account.accountId!)).get()?.balanceCents;
    assert.equal(balance, 250_000 - 4_999 + 150_000);
  });

  it("bucht Listen ohne Vorzeichen weiterhin als Ausgaben", async () => {
    const { importCsvTransactionsAction } = await import("../../src/actions/csv-actions");
    const csv = `Datum;Beschreibung;Betrag
05.11.2026;Bäckerei Sonne;3,50
06.11.2026;Drogerie;12,80`;
    const res = await importCsvTransactionsAction(csv, null, false);
    assert.equal(res.success, true);
    assert.equal((await importedOf("Bäckerei Sonne"))?.type, "expense");
    assert.equal((await importedOf("Drogerie"))?.type, "expense");
  });
});
