import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-rules.db");
process.env.DATABASE_PATH = testDbPath;

describe("Auto-Kategorisierungs-Regeln & Kreditkarten-Differenzberechnung", async () => {
  before(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("erstellt Regeln, erkennt Händler/Beschreibungen und wendet sie rückwirkend an", async () => {
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user, transactions, categories, categoryRules } = await import(
      "../../src/lib/db/schema"
    );
    const { ensureDefaultCategoriesForUser } = await import(
      "../../src/lib/db/defaults"
    );
    const {
      createCategoryRuleAction,
      applyCategoryRulesAction,
      getUserCategoryRulesAction,
    } = await import("../../src/actions/category-rule-actions");
    const { findMatchingRule } = await import("../../src/lib/category-rules");
    const { eq } = await import("drizzle-orm");

    ensureDatabaseTables();

    const userId = "test-rules-user";
    process.env.TEST_USER_ID = userId;
    const now = new Date();

    db.insert(user)
      .values({
        id: userId,
        name: "Rules Tester",
        email: "rules@kosten.local",
        role: "admin",
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    ensureDefaultCategoriesForUser(userId);

    const userCats = db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .all();
    const subCat = userCats.find((c) => /abo|streaming|vertrag/i.test(c.name)) || userCats[0];
    const foodCat = userCats.find((c) => /lebensmittel|essen/i.test(c.name)) || userCats[1];
    const sonstigesCat = userCats.find((c) => /sonstig/i.test(c.name)) || userCats[userCats.length - 1];

    // 1. Unkategorisierte oder in "Sonstiges" liegende Buchungen anlegen
    const tx1Id = "tx-spotify-1";
    db.insert(transactions)
      .values({
        id: tx1Id,
        userId,
        categoryId: sonstigesCat.id,
        type: "expense",
        costType: "variable",
        amountCents: 1299,
        date: "2026-11-15",
        description: "Kartenzahlung SPOTIFY AB STOCKHOLM",
        merchant: "Spotify",
        paymentMethod: "card",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const tx2Id = "tx-rewe-2";
    db.insert(transactions)
      .values({
        id: tx2Id,
        userId,
        categoryId: sonstigesCat.id,
        type: "expense",
        costType: "variable",
        amountCents: 3450,
        date: "2026-11-16",
        description: "REWE SAGT DANKE FILIALE 1234",
        merchant: null,
        paymentMethod: "card",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // 2. Regel für Spotify anlegen (Kostenart: fixed)
    const rule1Res = await createCategoryRuleAction({
      pattern: "Spotify",
      matchField: "all",
      categoryId: subCat.id,
      costType: "fixed",
      priority: 10,
    });
    assert.equal(rule1Res.success, true);

    // 3. Regel für REWE anlegen (Kostenart: variable)
    const rule2Res = await createCategoryRuleAction({
      pattern: "REWE",
      matchField: "description",
      categoryId: foodCat.id,
      costType: "variable",
      priority: 5,
    });
    assert.equal(rule2Res.success, true);

    // 4. Test findMatchingRule im Memory-Check
    const allRules = await getUserCategoryRulesAction();
    assert.equal(allRules.length, 2);

    const matchSpotify = findMatchingRule(
      {
        merchant: "Spotify",
        description: "SPOTIFY AB STOCKHOLM",
      },
      allRules
    );
    assert.notEqual(matchSpotify, null);
    assert.equal(matchSpotify?.categoryId, subCat.id);
    assert.equal(matchSpotify?.costType, "fixed");

    const matchRewe = findMatchingRule(
      {
        merchant: null,
        description: "REWE SAGT DANKE",
      },
      allRules
    );
    assert.notEqual(matchRewe, null);
    assert.equal(matchRewe?.categoryId, foodCat.id);

    // 5. Retroaktiv alle Regeln anwenden
    const applyRes = await applyCategoryRulesAction();
    assert.equal(applyRes.success, true);
    assert.equal((applyRes.matchedCount || 0) >= 2, true);

    // 6. Buchungen aus der DB prüfen
    const updatedTx1 = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, tx1Id))
      .get();
    assert.equal(updatedTx1?.categoryId, subCat.id);
    assert.equal(updatedTx1?.costType, "fixed");

    const updatedTx2 = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, tx2Id))
      .get();
    assert.equal(updatedTx2?.categoryId, foodCat.id);
    assert.equal(updatedTx2?.costType, "variable");

    // 7. Test: Schutz manueller Kategorien (overwriteExisting: false)
    // Wenn tx2Id manuell der Kategorie subCat zugewiesen wird:
    db.update(transactions)
      .set({ categoryId: subCat.id })
      .where(eq(transactions.id, tx2Id))
      .run();

    // Erneutes Anwenden mit Safe-Mode darf tx2Id NICHT überschreiben!
    const safeApply = await applyCategoryRulesAction({ overwriteExisting: false });
    assert.equal(safeApply.success, true);
    assert.equal((safeApply.skippedCount || 0) >= 1, true);

    const tx2AfterSafe = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, tx2Id))
      .get();
    // Bleibt subCat, wurde nicht auf foodCat zurückgeändert!
    assert.equal(tx2AfterSafe?.categoryId, subCat.id);

    // 8. Test: Standard-Regelpaket aktivieren
    const { seedDefaultCategoryRulesAction } = await import(
      "../../src/actions/category-rule-actions"
    );
    const seedRes = await seedDefaultCategoryRulesAction();
    assert.equal(seedRes.success, true);
    assert.equal((seedRes.createdCount || 0) >= 10, true);

    // Erneutes Seeden überspringt Dubletten
    const reseedRes = await seedDefaultCategoryRulesAction();
    assert.equal(reseedRes.success, true);
    assert.equal(reseedRes.createdCount, 0);

    // 9. Test: Massen-Aktionen (Batch-Update & Batch-Delete)
    const {
      batchUpdateTransactionsAction,
      batchDeleteTransactionsAction,
      findDuplicateTransactionsAction,
    } = await import("../../src/actions/transaction-actions");

    const batchUpdateRes = await batchUpdateTransactionsAction({
      ids: [tx1Id, tx2Id],
      costType: "transfer",
    });
    assert.equal(batchUpdateRes.success, true);
    assert.equal(batchUpdateRes.count, 2);

    // 10. Test: Dubletten-Erkennung
    // Erstelle absichtlich eine zweite Buchung mit identischem Betrag & Text
    const txDupId = "tx-spotify-dup";
    db.insert(transactions)
      .values({
        id: txDupId,
        userId,
        categoryId: subCat.id,
        type: "expense",
        costType: "variable",
        amountCents: 1299,
        date: "2026-11-15",
        description: "Kartenzahlung SPOTIFY AB STOCKHOLM",
        merchant: "Spotify",
        paymentMethod: "card",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const dupScan = await findDuplicateTransactionsAction();
    assert.equal(dupScan.success, true);
    assert.equal((dupScan.totalDuplicates || 0) >= 1, true);

    // 11. Test: Kassensturz & Saldenabgleich
    const {
      createManualBankAccountAction,
      reconcileAccountBalanceAction,
    } = await import("../../src/actions/bank-actions");

    const cashRes = await createManualBankAccountAction({
      accountName: "Bargeld Portemonnaie",
      accountType: "cash",
      balanceCents: 12000, // 120,00 €
    });
    assert.equal(cashRes.success, true);
    const cashAccId = cashRes.accountId!;

    // Kassensturz: Reales Geld sind 105,00 € (Differenz: -15,00 €)
    const reconRes = await reconcileAccountBalanceAction({
      accountId: cashAccId,
      actualBalanceCents: 10500,
      mode: "adjustment_transaction",
    });
    assert.equal(reconRes.success, true);
    assert.equal(reconRes.diffCents, -1500);

    const { bankAccounts } = await import("../../src/lib/db/schema");
    const cashAccInDb = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, cashAccId))
      .get();
    assert.equal(cashAccInDb?.balanceCents, 10500);

    // 12. Test: Regeln pausieren / umschalten / löschen
    const {
      toggleCategoryRuleActiveAction,
      toggleAllCategoryRulesAction,
      deleteAllCategoryRulesAction,
    } = await import("../../src/actions/category-rule-actions");

    // Einzelne Regel toggeln
    const toggleOne = await toggleCategoryRuleActiveAction(rule1Res.id!);
    assert.equal(toggleOne.success, true);
    assert.equal(toggleOne.isActive, false);

    // Alle Regeln pausieren
    const pauseAll = await toggleAllCategoryRulesAction(false);
    assert.equal(pauseAll.success, true);

    const rulesAfterPause = await getUserCategoryRulesAction();
    assert.equal(rulesAfterPause.every((r) => !r.isActive), true);

    // Alle Regeln wieder aktivieren
    const resumeAll = await toggleAllCategoryRulesAction(true);
    assert.equal(resumeAll.success, true);

    const rulesAfterResume = await getUserCategoryRulesAction();
    assert.equal(rulesAfterResume.every((r) => r.isActive), true);

    // Alle Regeln löschen
    const delAll = await deleteAllCategoryRulesAction();
    assert.equal(delAll.success, true);

    const rulesAfterDel = await getUserCategoryRulesAction();
    assert.equal(rulesAfterDel.length, 0);

    // Aufräumen
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("prüft Kreditkarten-Differenzberechnung (Limit 6.000 €, Verfügbar 1.654,68 € => Saldo -4.345,32 €)", () => {
    const limitCents = 600000; // 6.000,00 €
    const availableCents = 165468; // 1.654,68 €

    // Berechneter Saldo / Schulden
    const calculatedSaldoCents = availableCents - limitCents;
    assert.equal(calculatedSaldoCents, -434532); // -4.345,32 €

    // Umgekehrte Prüfung: Limit + Saldo ergibt wieder verfügbaren Betrag
    const checkAvailable = limitCents + calculatedSaldoCents;
    assert.equal(checkAvailable, availableCents);

    // Schuldenbetrag ist Betrag des negativen Saldos
    const debtCents = Math.abs(calculatedSaldoCents);
    assert.equal(debtCents, 434532);
  });

  it("erkennt Pipe- und Komma-getrennte Suchmuster (z. B. rewe|edeka|aldi)", async () => {
    const { matchesRule } = await import("../../src/lib/category-rules");

    // Standard-Muster mit Pipes
    const defaultRule = {
      pattern: "rewe|edeka|aldi|lidl|kaufland|penny|netto|tegut|norma",
      matchField: "all",
    };
    assert.equal(matchesRule("EDEKA 5496 grocery €", defaultRule), true);
    assert.equal(matchesRule("REWE Markt Carmen grocery €", defaultRule), true);
    assert.equal(matchesRule("ALDI SUED sagt Danke", defaultRule), true);
    assert.equal(matchesRule("Tankstelle Shell", defaultRule), false);

    // Benutzer-Muster mit Leerzeichen um Pipes
    const userRule = {
      pattern: "REWE | edeka | kaufland | lidel | aldi",
      matchField: "all",
    };
    assert.equal(matchesRule("EDEKA 5496 grocery €", userRule), true);
    assert.equal(matchesRule("REWE Markt Carmen grocery €", userRule), true);

    // Komma-Muster
    const commaRule = {
      pattern: "spotify, netflix, disney",
      matchField: "description",
    };
    assert.equal(
      matchesRule("Abo Netflix", commaRule, { description: "Abo Netflix" }),
      true
    );
  });
});
