import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-pdf-unit.db");
process.env.DATABASE_PATH = testDbPath;

describe("PDF-Kontoauszug Parsing & direkter Datei-Import", async () => {
  before(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("parst Advanzia- und Bank-Kontoauszugstexte inklusive Ignorieren von Salden", async () => {
    const {
      parseStatementText,
      convertParsedTransactionsToCsv,
    } = await import("../../src/lib/pdf-statement-parser");

    const sampleAdvanziaStatement = `
Advanzia Bank S.A.
Rechnung vom 03.11.2024
Transaktionsdetails
Kaufdatum Belegdatum Beschreibung Betrag (EUR)
24.10.2024 25.10.2024 AMAZON DE PAYMENTS LUXEMBOURG 45,99 -
28.10.2024 29.10.2024 REWE SAGT DANKE KOELN 18,20 -
01.11.2024 02.11.2024 NETFLIX.COM AMSTERDAM 13,99 -
02.11.2024 02.11.2024 GUTSCHRIFT UEBERWEISUNG 250,00 +
Neuer Saldo: -120,50 EUR
Mindestbetrag: 30,00 EUR
Seite 1 von 2
`;

    const txs = parseStatementText(sampleAdvanziaStatement);
    assert.equal(txs.length, 4);

    // Amazon
    assert.equal(txs[0].date, "2024-10-24");
    assert.equal(txs[0].description, "AMAZON DE PAYMENTS LUXEMBOURG");
    assert.equal(txs[0].amountCents, 4599);
    assert.equal(txs[0].type, "expense");

    // Rewe
    assert.equal(txs[1].date, "2024-10-28");
    assert.equal(txs[1].description, "REWE SAGT DANKE KOELN");
    assert.equal(txs[1].amountCents, 1820);
    assert.equal(txs[1].type, "expense");

    // Netflix
    assert.equal(txs[2].date, "2024-11-01");
    assert.equal(txs[2].description, "NETFLIX.COM AMSTERDAM");
    assert.equal(txs[2].amountCents, 1399);
    assert.equal(txs[2].type, "expense");

    // Gutschrift
    assert.equal(txs[3].date, "2024-11-02");
    assert.equal(txs[3].description, "GUTSCHRIFT UEBERWEISUNG");
    assert.equal(txs[3].amountCents, 25000);
    assert.equal(txs[3].type, "income");

    // CSV-Konvertierung
    const csv = convertParsedTransactionsToCsv(txs);
    assert.ok(csv.includes("Datum;Betrag_EUR;Typ;Kostenart;Kategorie;Beschreibung;Zahlungsmethode"));
    assert.ok(csv.includes("2024-10-24;45,99;Ausgabe"));
    assert.ok(csv.includes("2024-11-02;250,00;Einnahme"));
  });

  it("parst das exakte Advanzia-Layout (Dear Customer, Counterparty, Category, Amount)", async () => {
    const { parseStatementText } = await import(
      "../../src/lib/pdf-statement-parser"
    );

    const advanziaCustomStatement = `
Dear MOHAMAD HABACHIA,
Exported date range: June 1, 2026 - June 30, 2026

Date Counterparty Description Category Amount
June 15, 2026 Amazon EU SARL Prime Membership Subscription -8.99
June 18, 2026 REWE Markt Koeln Lebensmittel Groceries -45.50
June 25, 2026 Bank Transfer Payment Payment CRDT +500.00
`;

    const txs = parseStatementText(advanziaCustomStatement);
    assert.equal(txs.length, 3);

    // 1. Amazon
    assert.equal(txs[0].date, "2026-06-15");
    assert.ok(txs[0].description.includes("Amazon EU SARL"));
    assert.equal(txs[0].amountCents, 899);
    assert.equal(txs[0].type, "expense");

    // 2. REWE
    assert.equal(txs[1].date, "2026-06-18");
    assert.ok(txs[1].description.includes("REWE Markt"));
    assert.equal(txs[1].amountCents, 4550);
    assert.equal(txs[1].type, "expense");

    // 3. Payment / Gutschrift
    assert.equal(txs[2].date, "2026-06-25");
    assert.ok(txs[2].description.includes("Bank Transfer"));
    assert.equal(txs[2].amountCents, 50000);
    assert.equal(txs[2].type, "income");
  });

  it("importiert Datei über importStatementFileAction (CSV- und PDF-Flow)", async () => {
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user, transactions } = await import("../../src/lib/db/schema");
    const { ensureDefaultCategoriesForUser } = await import("../../src/lib/db/defaults");
    const { importStatementFileAction } = await import("../../src/actions/csv-actions");
    const { eq } = await import("drizzle-orm");

    ensureDatabaseTables();

    const userId = "test-pdf-user";
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    db.insert(user)
      .values({
        id: userId,
        name: "Statement Tester",
        email: "statement@kosten.local",
        role: "admin",
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    ensureDefaultCategoriesForUser(userId);

    // 1. Simulierter CSV-Upload via FormData
    const csvContent = `Datum;Betrag_EUR;Typ;Kategorie;Beschreibung
2024-11-10;55,00;Ausgabe;Lebensmittel;Lidl Wocheneinkauf`;
    const csvFile = new File([csvContent], "export.csv", { type: "text/csv" });
    const formDataCsv = new FormData();
    formDataCsv.append("file", csvFile);

    const resCsv = await importStatementFileAction(formDataCsv);
    assert.equal(resCsv.success, true);
    if (!resCsv.success) throw new Error("CSV Import failed");
    assert.equal(resCsv.importedCount, 1);
    assert.equal(resCsv.format, "csv");

    const lidlTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .all();
    assert.equal(lidlTx.length, 1);
    assert.equal(lidlTx[0].amountCents, 5500);

    // 2. Simulierter PDF-Upload mit minimaler PDF-Struktur
    // Enthält echte Text-Streams im PDF-Format
    const streamContent = `BT
/F1 12 Tf
100 700 Td
(24.10.2024 25.10.2024 SPOTIFY ABONNEMENT 10,99 -) Tj
ET`;
    const pdfSource = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj
4 0 obj<</Length ${streamContent.length}>>stream
${streamContent}
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000216 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
${216 + streamContent.length + 30}
%%EOF`;

    const pdfFile = new File([Buffer.from(pdfSource)], "advanzia-rechnung.pdf", {
      type: "application/pdf",
    });
    const formDataPdf = new FormData();
    formDataPdf.append("file", pdfFile);

    const resPdf = await importStatementFileAction(formDataPdf);
    assert.equal(resPdf.success, true);
    if (!resPdf.success) throw new Error("PDF Import failed");
    assert.equal(resPdf.importedCount, 1);
    assert.equal(resPdf.format, "pdf");

    const allTxs = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .all();
    assert.equal(allTxs.length, 2);

    const spotifyTx = allTxs.find((t) => t.description.includes("SPOTIFY"));
    assert.ok(spotifyTx);
    assert.equal(spotifyTx.amountCents, 1099);
    assert.equal(spotifyTx.date, "2024-10-24");
    // Wurde automatisch mit dem erkannten Advanzia Mastercard Konto verknüpft
    assert.ok(spotifyTx.bankAccountId);

    // 3. Re-Import derselben PDF: Muss Duplikat erkennen
    const resPdfDuplicate = await importStatementFileAction(formDataPdf);
    assert.equal(resPdfDuplicate.success, true);
    if (!resPdfDuplicate.success) throw new Error("Duplicate check failed");
    assert.equal(resPdfDuplicate.importedCount, 0);
    assert.equal(resPdfDuplicate.skippedDuplicates, 1);

    // 4. Test mit explizitem Bankkonto und Salden-Fortschreibung (updateBalance: "true")
    const { bankAccounts } = await import("../../src/lib/db/schema");
    const testAccId = "acc-manual-advanzia-test";
    db.insert(bankAccounts)
      .values({
        id: testAccId,
        userId: userId,
        connectedBankId: null,
        accountExternalId: "manual-advanzia-test",
        accountName: "Meine Advanzia Gold",
        accountType: "credit_card",
        ibanMasked: "5401 **** 1234",
        balanceCents: 0,
        creditLimitCents: 200000,
        billingDayOfMonth: 20,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const csvExplicitContent = `Datum;Betrag_EUR;Typ;Kategorie;Beschreibung
2024-11-15;80,00;Ausgabe;Sonstiges;Tankstelle Shell
2024-11-16;30,00;Einnahme;Sonstiges;Cashback Bonus`;
    const csvExplicitFile = new File([csvExplicitContent], "shell.csv", { type: "text/csv" });
    const formDataExplicit = new FormData();
    formDataExplicit.append("file", csvExplicitFile);
    formDataExplicit.append("bankAccountId", testAccId);
    formDataExplicit.append("updateBalance", "true");

    const resExplicit = await importStatementFileAction(formDataExplicit);
    assert.equal(resExplicit.success, true);
    if (!resExplicit.success) throw new Error("Explicit import failed");
    assert.equal(resExplicit.importedCount, 2);

    const updatedAcc = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, testAccId))
      .get();
    assert.ok(updatedAcc);
    // Netto: -80,00 EUR (Ausgabe) + 30,00 EUR (Einnahme) = -50,00 EUR (-5000 Cents)
    assert.equal(updatedAcc.balanceCents, -5000);

    // 5. Test detectStatementBank für Advanzia, TF Bank und ING
    const { detectStatementBank } = await import(
      "../../src/lib/pdf-statement-parser"
    );
    const adv = detectStatementBank("Abrechnung", "advanzia_statement.pdf");
    assert.equal(adv?.bankKey, "advanzia");
    assert.equal(adv?.bankName, "Advanzia Mastercard");

    const tf = detectStatementBank("TF Bank AB Kreditkartenkonto", "statement.pdf");
    assert.equal(tf?.bankKey, "tfbank");
    assert.equal(tf?.bankName, "TF Bank Mastercard");

    const ing = detectStatementBank("ING Girokonto Auszug", "kontoauszug.pdf");
    assert.equal(ing?.bankKey, "ing");
    assert.equal(ing?.bankName, "ING Girokonto");

    // Aufräumen
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });
});
