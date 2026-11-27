import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-import-ownership.db");
process.env.DATABASE_PATH = testDbPath;

const ownerId = "test-import-owner";
const otherId = "test-import-other";

const csv = `Buchungsdatum;Buchungstext;Umsatz;Art
15.11.2024;REWE MARKT;-10,00;Soll`;

describe("Import: nur eigene Konten als Ziel", () => {
  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user } = await import("../../src/lib/db/schema");
    const { ensureDefaultCategoriesForUser } = await import("../../src/lib/db/defaults");
    ensureDatabaseTables();
    const now = new Date();
    db.insert(user)
      .values([
        { id: ownerId, name: "Owner", email: "owner@kosten.local", createdAt: now, updatedAt: now },
        { id: otherId, name: "Other", email: "other@kosten.local", createdAt: now, updatedAt: now },
      ])
      .run();
    ensureDefaultCategoriesForUser(ownerId);
    ensureDefaultCategoriesForUser(otherId);
    process.env.TEST_USER_ID = ownerId;
  });

  it("lehnt ein fremdes Zielkonto ab und ändert dessen Daten nicht", async () => {
    const { db } = await import("../../src/lib/db/index");
    const { transactions, bankAccounts } = await import("../../src/lib/db/schema");
    const { getOrCreateImportBankAccount } = await import("../../src/lib/import-bank-account");
    const { importCsvTransactionsAction } = await import("../../src/actions/csv-actions");
    const { eq } = await import("drizzle-orm");

    const foreignAccountId = getOrCreateImportBankAccount(otherId, "Fremdbank", "fremd");

    const res = await importCsvTransactionsAction(csv, foreignAccountId, true);
    assert.equal(res.success, false);

    const onForeignAccount = db
      .select()
      .from(transactions)
      .where(eq(transactions.bankAccountId, foreignAccountId))
      .all();
    assert.equal(onForeignAccount.length, 0);

    const foreign = db.select().from(bankAccounts).where(eq(bankAccounts.id, foreignAccountId)).get();
    assert.equal(foreign?.balanceCents, null);
  });

  it("importiert weiterhin auf ein eigenes Konto", async () => {
    const { getOrCreateImportBankAccount } = await import("../../src/lib/import-bank-account");
    const { importCsvTransactionsAction } = await import("../../src/actions/csv-actions");

    const ownAccountId = getOrCreateImportBankAccount(ownerId, "Eigene Bank", "eigen");
    const res = await importCsvTransactionsAction(csv, ownAccountId, false);
    assert.equal(res.success, true);
    if (res.success) assert.equal(res.importedCount, 1);
  });

  it("getOrCreateImportBankAccount findet nur eigene Konten und behandelt % nicht als Platzhalter", async () => {
    const { getOrCreateImportBankAccount } = await import("../../src/lib/import-bank-account");

    const otherAccountId = getOrCreateImportBankAccount(otherId, "Sparkasse", "sparkasse");
    // Gleicher Name beim anderen Benutzer: eigenes, neues Konto statt des fremden
    const ownAccountId = getOrCreateImportBankAccount(ownerId, "Sparkasse", "sparkasse");
    assert.notEqual(ownAccountId, otherAccountId);
    // Erneuter Aufruf findet das bestehende eigene Konto
    assert.equal(getOrCreateImportBankAccount(ownerId, "Sparkasse", "sparkasse"), ownAccountId);

    // "%" passt nicht auf beliebige Konten, sondern legt ein eigenes Konto an
    const percentAccountId = getOrCreateImportBankAccount(ownerId, "%", "x");
    assert.notEqual(percentAccountId, ownAccountId);

    assert.throws(() => getOrCreateImportBankAccount(ownerId, "   ", "leer"));
  });
});
