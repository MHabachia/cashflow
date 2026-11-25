import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Eigene Test-DB für die Funktions-Tests setzen
const testDbPath = path.resolve("./data/test-unit.db");
process.env.DATABASE_PATH = testDbPath;

describe("Datenbank, Standardkategorien, Fixkosten-Prozessor & Settings", async () => {
  before(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("initialisiert Tabellen, legt Standardkategorien + variable Vorlagen an und bucht fällige Fixkosten atomar", async () => {
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const {
      user,
      categories,
      variablePresets,
      recurringExpenses,
      transactions,
    } = await import("../../src/lib/db/schema");
    const { ensureDefaultCategoriesForUser } = await import(
      "../../src/lib/db/defaults"
    );
    const { processDueRecurringExpenses } = await import(
      "../../src/lib/recurring-processor"
    );
    const { getGlobalAppSettings } = await import("../../src/lib/settings");
    const { todayISO } = await import("../../src/lib/format");
    const { eq } = await import("drizzle-orm");

    ensureDatabaseTables();

    // 1. Globale App-Einstellungen prüfen
    const settings = getGlobalAppSettings();
    assert.equal(settings.appName, "Cashflow");
    assert.equal(settings.defaultPaymentMethod, "card");

    // 2. Test-Benutzer erstellen
    const userId = "test-user-1";
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    db.insert(user)
      .values({
        id: userId,
        name: "Test User",
        email: "test@kosten.local",
        role: "admin",
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // 3. Standardkategorien & variable Vorlagen anlegen
    ensureDefaultCategoriesForUser(userId);

    const userCats = db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .all();
    assert.equal(userCats.length, 11);

    const userPresets = db
      .select()
      .from(variablePresets)
      .where(eq(variablePresets.userId, userId))
      .all();
    assert.equal(userPresets.length, 5);

    // 4. Fällige monatliche Fixkosten anlegen und automatisch abbuchen lassen
    const today = todayISO();
    const recId = "rec-test-1";
    db.insert(recurringExpenses)
      .values({
        id: recId,
        userId,
        categoryId: userCats[0].id,
        type: "expense",
        name: "Test Warmmiete",
        amountCents: 85000,
        paymentMethod: "transfer",
        interval: "monthly",
        dayOfMonth: 1,
        startDate: today,
        nextDueDate: today,
        autoBook: true,
        active: true,
        createdAt: now,
      })
      .run();

    const bookedCount = processDueRecurringExpenses(userId);
    assert.equal(bookedCount, 1);

    // Erneuter Aufruf am selben Tag darf NICHT doppelt buchen!
    const secondBookedCount = processDueRecurringExpenses(userId);
    assert.equal(secondBookedCount, 0);

    const bookedTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .all();
    assert.equal(bookedTx.length, 1);
    assert.equal(bookedTx[0].costType, "fixed");
    assert.equal(bookedTx[0].type, "expense");
    assert.equal(bookedTx[0].amountCents, 85000);

    // 5. Fällige feste Einnahme (Gehalt) anlegen und automatisch verbuchen lassen
    const incomeCat = userCats.find((c) => c.type === "income") || userCats[0];
    const recIncomeId = "rec-income-test-1";
    db.insert(recurringExpenses)
      .values({
        id: recIncomeId,
        userId,
        categoryId: incomeCat.id,
        type: "income",
        name: "Test Gehalt",
        amountCents: 320000,
        paymentMethod: "transfer",
        interval: "monthly",
        dayOfMonth: 1,
        startDate: today,
        nextDueDate: today,
        autoBook: true,
        active: true,
        createdAt: now,
      })
      .run();

    const incomeBookedCount = processDueRecurringExpenses(userId);
    assert.equal(incomeBookedCount, 1);

    const allTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .all();
    assert.equal(allTx.length, 2);

    const bookedIncomeTx = allTx.find((t) => t.type === "income");
    assert.ok(bookedIncomeTx);
    assert.equal(bookedIncomeTx.costType, "fixed");
    assert.equal(bookedIncomeTx.amountCents, 320000);
    assert.equal(bookedIncomeTx.description, "Test Gehalt");

    // 6. Test createRecurringFromTransactionAction: Bankbuchung direkt in Fixkosten umwandeln
    const { createRecurringFromTransactionAction } = await import(
      "../../src/actions/recurring-actions"
    );

    // Variable Test-Transaktion (z. B. importierte Netflix-Bankbuchung) anlegen
    const sampleTxId = "tx-sample-bank-netflix";
    db.insert(transactions)
      .values({
        id: sampleTxId,
        userId,
        categoryId: incomeCat.id,
        type: "expense",
        costType: "variable",
        amountCents: 1799,
        date: today,
        description: "Netflix International B.V.",
        merchant: "Netflix",
        paymentMethod: "direct_debit",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const recurringRes = await createRecurringFromTransactionAction({
      transactionId: sampleTxId,
      name: "Netflix Abo",
      amountCents: 1799,
      type: "expense",
      categoryId: incomeCat.id,
      interval: "monthly",
      dayOfMonth: 15,
    });

    assert.ok(recurringRes.success);
    assert.ok(recurringRes.recurringId);

    // Prüfen, ob Eintrag in recurringExpenses existiert
    const createdRec = db
      .select()
      .from(recurringExpenses)
      .where(eq(recurringExpenses.id, recurringRes.recurringId))
      .get();
    assert.ok(createdRec);
    assert.equal(createdRec.name, "Netflix Abo");
    assert.equal(createdRec.amountCents, 1799);
    assert.equal(createdRec.dayOfMonth, 15);
    assert.equal(createdRec.interval, "monthly");

    // Prüfen, ob die bisherige Transaktion jetzt als 'fixed' verknüpft ist
    const updatedTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, sampleTxId))
      .get();
    assert.ok(updatedTx);
    assert.equal(updatedTx.costType, "fixed");
    assert.equal(updatedTx.recurringId, recurringRes.recurringId);
  });
});
