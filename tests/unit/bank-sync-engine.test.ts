import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-bank-sync-engine.db");
process.env.DATABASE_PATH = testDbPath;
process.env.AUTH_SECRET = "test_secret_for_bank_sync_engine_unit_tests_32_chars";

describe("Bank-Umsatz-Synchronisations-Engine (Idempotenz & Auto-Matching)", async () => {
  let userId: string;
  let categoryLebensmittelId: string;
  let categorySonstigesId: string;
  let recurringNetflixId: string;
  let connectedBankId: string;
  let bankAccountGiroId: string;
  let bankAccountCardId: string;

  before(async () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    const { ensureDatabaseTables, db } = await import("../../src/lib/db/index");
    const {
      user,
      categories,
      recurringExpenses,
      connectedBanks,
      bankAccounts,
    } = await import("../../src/lib/db/schema");
    const { encryptBankToken } = await import("../../src/lib/crypto/vault");

    ensureDatabaseTables();

    userId = "sync-engine-user-1";
    process.env.TEST_USER_ID = userId;
    const now = new Date();

    // 1. Benutzer anlegen
    db.insert(user)
      .values({
        id: userId,
        name: "Sync Tester",
        email: "synctester@kosten.local",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // 2. Kategorien anlegen
    categoryLebensmittelId = "cat-lebensmittel-1";
    categorySonstigesId = "cat-sonstiges-1";

    db.insert(categories)
      .values([
        {
          id: categoryLebensmittelId,
          userId,
          name: "Lebensmittel & Haushalt",
          type: "expense",
          createdAt: now,
        },
        {
          id: categorySonstigesId,
          userId,
          name: "Sonstiges",
          type: "expense",
          createdAt: now,
        },
      ])
      .run();

    // 3. Fixkosten anlegen (Netflix Abo: 17,99 €)
    recurringNetflixId = "rec-netflix-1";
    db.insert(recurringExpenses)
      .values({
        id: recurringNetflixId,
        userId,
        categoryId: categorySonstigesId,
        name: "Netflix",
        amountCents: 1799,
        interval: "monthly",
        paymentMethod: "card",
        dayOfMonth: 1,
        startDate: "2026-01-01",
        nextDueDate: "2026-12-01",
        type: "expense",
        active: true,
        createdAt: now,
      })
      .run();

    // 4. Verknüpfte Bank & Konten anlegen mit verschlüsseltem Token
    connectedBankId = "bank-ing-sync-1";
    const encryptedToken = encryptBankToken("psd2_access_token_mock", userId);

    db.insert(connectedBanks)
      .values({
        id: connectedBankId,
        userId,
        provider: "enable_banking",
        institutionId: "ING_DE",
        institutionName: "ING Deutschland",
        encryptedAccessToken: encryptedToken,
        consentId: "consent_123",
        consentExpiresAt: "2027-01-01",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    bankAccountGiroId = "acc-giro-1";
    bankAccountCardId = "acc-card-1";

    db.insert(bankAccounts)
      .values([
        {
          id: bankAccountGiroId,
          connectedBankId,
          userId,
          accountExternalId: "acc_giro_ing_de_01",
          ibanMasked: "DE** **** **** 1234",
          accountName: "ING Girokonto",
          accountType: "checking",
          currency: "EUR",
          autoSync: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: bankAccountCardId,
          connectedBankId,
          userId,
          accountExternalId: "acc_card_ing_de_02",
          ibanMasked: "**** **** **** 5678",
          accountName: "ING VISA Card Debit",
          accountType: "credit_card",
          currency: "EUR",
          autoSync: true,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
  });

  it("importiert Umsätze erfolgreich, ordnet Kategorien zu und aktualisiert den Saldo", async () => {
    const { syncBankAccountTransactions } = await import(
      "../../src/lib/bank-sync/sync-engine"
    );
    const { db } = await import("../../src/lib/db/index");
    const { transactions, bankAccounts } = await import(
      "../../src/lib/db/schema"
    );
    const { eq } = await import("drizzle-orm");

    // Girokonto synchronisieren
    const result = await syncBankAccountTransactions(bankAccountGiroId, userId);
    assert.equal(result.success, true);
    assert.equal(result.importedCount, 3);
    assert.equal(result.skippedCount, 0);
    assert.equal(typeof result.balanceCents, "number");

    // Überprüfen in der Datenbank
    const importedTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.bankAccountId, bankAccountGiroId))
      .all();
    assert.equal(importedTx.length, 3);

    // EDEKA Ausgabe (-62,50 €) sollte der Lebensmittel-Kategorie zugeordnet sein
    const edekaTx = importedTx.find((t) => t.description.includes("EDEKA"));
    assert.ok(edekaTx);
    assert.equal(edekaTx.amountCents, 6250);
    assert.equal(edekaTx.type, "expense");
    assert.equal(edekaTx.categoryId, categoryLebensmittelId);

    // Kontostand muss aktualisiert sein
    const updatedAccount = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountGiroId))
      .get();
    assert.equal(updatedAccount?.balanceCents, result.balanceCents);
  });

  it("gewährleistet strenge Idempotenz: überspringt bereits vorhandene Umsätze ohne Duplikate", async () => {
    const { syncBankAccountTransactions } = await import(
      "../../src/lib/bank-sync/sync-engine"
    );
    const { db } = await import("../../src/lib/db/index");
    const { transactions } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    // Zweiter Sync desselben Kontos
    const result2 = await syncBankAccountTransactions(bankAccountGiroId, userId);
    assert.equal(result2.success, true);
    assert.equal(result2.importedCount, 0);
    assert.equal(result2.skippedCount, 3); // Alle 3 Umsätze wurden als Duplikat erkannt

    // Datenbank enthält weiterhin genau 3 Transaktionen
    const importedTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.bankAccountId, bankAccountGiroId))
      .all();
    assert.equal(importedTx.length, 3);
  });

  it("führt automatisches Matching mit Fixkosten (z.B. Netflix Abo) durch", async () => {
    const { syncBankAccountTransactions } = await import(
      "../../src/lib/bank-sync/sync-engine"
    );
    const { db } = await import("../../src/lib/db/index");
    const { transactions } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    // Kreditkarte synchronisieren (enthält Netflix 17,99 €)
    const result = await syncBankAccountTransactions(bankAccountCardId, userId);
    assert.equal(result.success, true);
    assert.equal(result.importedCount, 3);

    const netflixTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.bankAccountId, bankAccountCardId))
      .all()
      .find((t) => t.description.toLowerCase().includes("netflix"));

    assert.ok(netflixTx);
    assert.equal(netflixTx.amountCents, 1799);
    assert.equal(netflixTx.costType, "fixed");
    assert.equal(netflixTx.recurringId, recurringNetflixId);
  });

  it("reconciliert bestehende synthetische Fixkosten-Buchung ohne Dublette", async () => {
    const { syncBankAccountTransactions } = await import(
      "../../src/lib/bank-sync/sync-engine"
    );
    const { db } = await import("../../src/lib/db/index");
    const { transactions, recurringExpenses } = await import(
      "../../src/lib/db/schema"
    );
    const { eq } = await import("drizzle-orm");

    // Neues Fixkosten-Abo: Spotify (9,99 €)
    const spotifyRecId = "rec-spotify-reconcile";
    const now = new Date();
    db.insert(recurringExpenses)
      .values({
        id: spotifyRecId,
        userId,
        categoryId: categorySonstigesId,
        name: "Spotify",
        amountCents: 999,
        interval: "monthly",
        paymentMethod: "card",
        dayOfMonth: 5,
        startDate: "2026-01-01",
        nextDueDate: "2026-12-01",
        type: "expense",
        active: true,
        createdAt: now,
      })
      .run();

    // Bereits synthetisch im Voraus generierte Transaktion für den aktuellen Monat
    const currentMonth = new Date().toISOString().slice(0, 7);
    const syntheticTxId = "synth-tx-spotify-1";
    db.insert(transactions)
      .values({
        id: syntheticTxId,
        userId,
        categoryId: categorySonstigesId,
        type: "expense",
        costType: "fixed",
        amountCents: 999,
        date: `${currentMonth}-05`,
        description: "Spotify (Fixkosten)",
        paymentMethod: "card",
        recurringId: spotifyRecId,
        bankAccountId: null,
        bankTransactionId: null, // Noch kein Bankbeleg vorhanden
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Simuliere Eingang der echten Bank-Buchung für Spotify über einen Mock-Lauf
    // Wir rufen die Transaktions-Engine direkt mit den Daten ab
    const provider = (await import("../../src/lib/bank-sync/provider")).getBankSyncProvider();
    // Temporär fetchTransactions überschreiben für diesen Testfall
    const originalFetch = provider.fetchTransactions.bind(provider);
    provider.fetchTransactions = async () => ({
      transactions: [
        {
          bankTransactionId: "bank-spotify-unique-tx-999",
          bookingDate: `${currentMonth}-06`,
          amountCents: -999,
          currency: "EUR",
          creditorName: "Spotify AB Stockholm",
          remittanceInformation: "Monatsbeitrag Spotify Premium",
          status: "booked",
        },
      ],
      balanceCents: 50000,
    });

    try {
      const res = await syncBankAccountTransactions(bankAccountCardId, userId);
      assert.equal(res.success, true);
      assert.equal(res.importedCount, 1);

      // Prüfen, dass KEINE Dublette angelegt wurde, sondern die synthetische Zeile aktualisiert wurde
      const allSpotify = db
        .select()
        .from(transactions)
        .where(eq(transactions.recurringId, spotifyRecId))
        .all();

      assert.equal(allSpotify.length, 1);
      assert.equal(allSpotify[0].id, syntheticTxId); // Exakt dieselbe ID aktualisiert!
      assert.equal(allSpotify[0].bankTransactionId, "bank-spotify-unique-tx-999");
      assert.equal(allSpotify[0].bankAccountId, bankAccountCardId);
      assert.equal(allSpotify[0].date, `${currentMonth}-06`);
    } finally {
      provider.fetchTransactions = originalFetch;
    }
  });

  it("wehrt Zugriffe fremder Mandanten strikt ab (Mandantentrennung)", async () => {
    const { syncBankAccountTransactions } = await import(
      "../../src/lib/bank-sync/sync-engine"
    );

    const maliciousResult = await syncBankAccountTransactions(
      bankAccountGiroId,
      "unauthorized-attacker-id"
    );
    assert.equal(maliciousResult.success, false);
    assert.ok(maliciousResult.error?.includes("nicht gefunden"));
  });
});
