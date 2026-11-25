import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-csv-unit.db");
process.env.DATABASE_PATH = testDbPath;

describe("CSV-Import & Advanzia/Bank-Format Kompatibilität", async () => {
  before(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("importiert verschiedene Datums- und Bank-Spaltenformate und überspringt Duplikate", async () => {
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user, categories, transactions } = await import(
      "../../src/lib/db/schema"
    );
    const { ensureDefaultCategoriesForUser } = await import(
      "../../src/lib/db/defaults"
    );
    const { importCsvTransactionsAction } = await import(
      "../../src/actions/csv-actions"
    );
    const { eq } = await import("drizzle-orm");

    ensureDatabaseTables();

    const userId = "test-csv-user";
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    db.insert(user)
      .values({
        id: userId,
        name: "CSV Tester",
        email: "csv@kosten.local",
        role: "admin",
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    ensureDefaultCategoriesForUser(userId);

    // 1. Bank-Format im Advanzia/Kreditkarten-Stil (Semikolon-getrennt, Buchungstext, Umsatz)
    const advanziaCsv = `Buchungsdatum;Buchungstext;Umsatz;Art
15.11.24;AMAZON DE PAYMENTS;-49,99;Soll
18.11.2024;REWE MARKT KOELN;23,50;Haben
20/11/2024;NETFLIX ENTERTAINMENT;-12,99;Soll`;

    const res1 = await importCsvTransactionsAction(advanziaCsv);
    assert.equal(res1.success, true);
    assert.equal(res1.importedCount, 3);
    assert.equal(res1.skippedDuplicates, 0);

    const userTxs = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .all();
    assert.equal(userTxs.length, 3);

    const amazonTx = userTxs.find((t) => t.description.includes("AMAZON"));
    assert.ok(amazonTx);
    assert.equal(amazonTx.date, "2024-11-15");
    assert.equal(amazonTx.amountCents, 4999);
    assert.equal(amazonTx.type, "expense");

    const reweTx = userTxs.find((t) => t.description.includes("REWE"));
    assert.ok(reweTx);
    assert.equal(reweTx.date, "2024-11-18");
    assert.equal(reweTx.amountCents, 2350);
    assert.equal(reweTx.type, "income");

    // 2. Re-Import desselben CSV: Muss Duplikate erkennen und überspringen
    const res2 = await importCsvTransactionsAction(advanziaCsv);
    assert.equal(res2.success, true);
    assert.equal(res2.importedCount, 0);
    assert.equal(res2.skippedDuplicates, 3);

    // Gesamtanzahl in DB bleibt 3
    const countAfter = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .all().length;
    assert.equal(countAfter, 3);

    // Aufräumen
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });
});
