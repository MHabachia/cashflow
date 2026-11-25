import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-manual-bank.db");
process.env.DATABASE_PATH = testDbPath;

describe("Manuelle Konten, Kreditkarten (Advanzia/TF Bank) & Kartenausgleich", async () => {
  before(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("erstellt manuelle Kreditkarte mit Limit & Abrechnungstag und führt Kartenausgleich durch", async () => {
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user, bankAccounts, transactions, categories } = await import("../../src/lib/db/schema");
    const { ensureDefaultCategoriesForUser } = await import("../../src/lib/db/defaults");
    const {
      createManualBankAccountAction,
      transferBetweenAccountsAction,
      updateBankAccountAction,
    } = await import("../../src/actions/bank-actions");
    const { eq } = await import("drizzle-orm");

    ensureDatabaseTables();

    const userId = "test-manual-bank-user";
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    db.insert(user)
      .values({
        id: userId,
        name: "FinTech Tester",
        email: "fintech@kosten.local",
        role: "admin",
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    ensureDefaultCategoriesForUser(userId);

    // 1. Manuelles Girokonto anlegen (Startsaldo 2.000 €)
    const resGiro = await createManualBankAccountAction({
      accountName: "ING Girokonto",
      accountType: "checking",
      balanceCents: 200000,
      ibanMasked: "DE89 **** **** 1234",
    });
    assert.equal(resGiro.success, true, resGiro.error || "Giro failed");
    if (!resGiro.success) throw new Error("Giro creation failed");
    const giroId = resGiro.accountId!;

    // 2. Manuelle Kreditkarte anlegen (Advanzia mit Limit 2.500 € und Saldo -450 €)
    const resCard = await createManualBankAccountAction({
      accountName: "Advanzia Mastercard Gold",
      accountType: "credit_card",
      balanceCents: -45000,
      creditLimitCents: 250000,
      billingDayOfMonth: 20,
      ibanMasked: "**** 5678",
      notes: "Gebührenfreie Kreditkarte für Reisen",
    });
    assert.equal(resCard.success, true);
    if (!resCard.success) throw new Error("Card creation failed");
    const cardId = resCard.accountId!;

    // Prüfung in der Datenbank
    const cardInDb = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, cardId))
      .get();
    assert.ok(cardInDb);
    assert.equal(cardInDb.accountName, "Advanzia Mastercard Gold");
    assert.equal(cardInDb.creditLimitCents, 250000);
    assert.equal(cardInDb.billingDayOfMonth, 20);
    assert.equal(cardInDb.balanceCents, -45000);
    assert.equal(cardInDb.connectedBankId, null);

    // 3. Kartenausgleich / Umbuchung durchführen (450 € von Girokonto auf Advanzia Karte)
    const resTransfer = await transferBetweenAccountsAction({
      sourceAccountId: giroId,
      targetAccountId: cardId,
      amountCents: 45000,
      date: "2026-11-22",
      description: "Monatsausgleich Advanzia",
    });
    assert.equal(resTransfer.success, true);

    // Salden nach Ausgleich prüfen
    const giroAfter = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, giroId))
      .get();
    assert.equal(giroAfter?.balanceCents, 155000); // 2000 € - 450 € = 1550 €

    const cardAfter = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, cardId))
      .get();
    assert.equal(cardAfter?.balanceCents, 0); // -450 € + 450 € = 0 € ausgeglichen!

    // Transaktionen prüfen: Müssen costType 'transfer' besitzen (neutral für Cashflow)
    const transferTxs = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .all();
    assert.equal(transferTxs.length, 2);

    const outTx = transferTxs.find((t) => t.type === "expense");
    assert.ok(outTx);
    assert.equal(outTx.amountCents, 45000);
    assert.equal(outTx.costType, "transfer");
    assert.equal(outTx.bankAccountId, giroId);

    const inTx = transferTxs.find((t) => t.type === "income");
    assert.ok(inTx);
    assert.equal(inTx.amountCents, 45000);
    assert.equal(inTx.costType, "transfer");
    assert.equal(inTx.bankAccountId, cardId);

    // 4. Update des Kreditlimits & Abrechnungstags
    const resUpdate = await updateBankAccountAction({
      accountId: cardId,
      creditLimitCents: 300000, // Limit-Erhöhung auf 3.000 €
      billingDayOfMonth: 15,
    });
    assert.equal(resUpdate.success, true);

    const cardUpdated = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, cardId))
      .get();
    assert.equal(cardUpdated?.creditLimitCents, 300000);
    assert.equal(cardUpdated?.billingDayOfMonth, 15);

    // 5. Test mit 6.000 € Limit und verbleibendem Rahmen (Advanzia Differenzberechnung)
    // Wenn Limit = 6.000 € und noch verfügbar = 1.654,68 € -> Saldo (Schulden) = -4.345,32 €
    const limit6000Cents = 600000;
    const availableCents = 165468;
    const calculatedDebtCents = availableCents - limit6000Cents; // -434532 Cent (-4.345,32 €)

    const resAdvanzia6000 = await createManualBankAccountAction({
      accountName: "Advanzia 6000er",
      accountType: "credit_card",
      balanceCents: calculatedDebtCents,
      creditLimitCents: limit6000Cents,
      billingDayOfMonth: 8,
      ibanMasked: "5401 **** 9999",
    });
    assert.equal(resAdvanzia6000.success, true);
    const adv6000 = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, resAdvanzia6000.accountId!))
      .get();
    assert.ok(adv6000);
    assert.equal(adv6000.creditLimitCents, 600000);
    assert.equal(adv6000.balanceCents, -434532);
    // Noch verfügbar: Limit + Saldo = 600.000 + (-434.532) = 165.468 (1.654,68 €)
    assert.equal(adv6000.creditLimitCents + adv6000.balanceCents, 165468);

    // 6. Test PayPal Konto als eigene Geldquelle anlegen
    const resPayPal = await createManualBankAccountAction({
      accountName: "Mein PayPal Konto",
      accountType: "paypal",
      balanceCents: 12550, // 125,50 € PayPal Guthaben
      ibanMasked: "user@paypal.de",
    });
    assert.equal(resPayPal.success, true);
    const ppAcc = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, resPayPal.accountId!))
      .get();
    assert.ok(ppAcc);
    assert.equal(ppAcc.accountType, "paypal");
    assert.equal(ppAcc.balanceCents, 12550);

    // 7. Test Manuelle Buchung mit Geldquelle (bankAccountId) und automatischer Saldenfortschreibung
    const { createTransactionAction, deleteTransactionAction } = await import(
      "../../src/actions/transaction-actions"
    );
    const firstCat = db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .get();
    assert.ok(firstCat);

    // Ausgabe von 25,50 € von PayPal buchen
    const resTx = await createTransactionAction({
      categoryId: firstCat.id,
      type: "expense",
      costType: "variable",
      amountCents: 2550,
      date: "2026-11-22",
      description: "Ebay Kauf mit PayPal",
      paymentMethod: "paypal",
      bankAccountId: ppAcc.id,
    });
    assert.equal(resTx.success, true);

    const ppAfterTx = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, ppAcc.id))
      .get();
    assert.equal(ppAfterTx?.balanceCents, 10000); // 125,50 € - 25,50 € = 100,00 €!

    // Transaktion löschen -> Saldo muss wiederhergestellt werden
    const resDel = await deleteTransactionAction(resTx.id!);
    assert.equal(resDel.success, true);

    const ppAfterDel = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, ppAcc.id))
      .get();
    assert.equal(ppAfterDel?.balanceCents, 12550); // Wieder 125,50 €!

    // 8. Test: Bankkonto / Kreditkarte löschen und Transaktionen entkoppeln
    const { deleteBankAccountAction, disconnectBankAction } = await import(
      "../../src/actions/bank-actions"
    );

    // Buchung verknüpft mit Kreditkarte anlegen
    const resTxCard = await createTransactionAction({
      categoryId: firstCat.id,
      type: "expense",
      costType: "variable",
      amountCents: 4999,
      date: "2026-11-22",
      description: "Reisebuchung Advanzia",
      paymentMethod: "card",
      bankAccountId: cardId,
    });
    assert.equal(resTxCard.success, true, resTxCard.error || "tx failed");

    // Jetzt Kreditkarte löschen
    const resDelCard = await deleteBankAccountAction(cardId);
    assert.equal(resDelCard.success, true, resDelCard.error || "delete failed");

    // Karte existiert nicht mehr
    const deletedCardInDb = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, cardId))
      .get();
    assert.equal(deletedCardInDb, undefined);

    // Transaktion existiert weiterhin, aber bankAccountId ist entkoppelt (null)
    const txAfterCardDeleted = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, resTxCard.id!))
      .get();
    assert.ok(txAfterCardDeleted);
    assert.equal(txAfterCardDeleted.bankAccountId, null);

    // Test: disconnectBankAction für manuelle Kontogruppe
    const resDiscManual = await disconnectBankAction("manual_banks_group");
    assert.equal(resDiscManual.success, true, resDiscManual.error || "disconnect manual failed");

    // Aufräumen
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });
});
