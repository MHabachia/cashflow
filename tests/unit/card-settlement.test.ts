import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const testDbPath = path.resolve("./data/test-card-settlement.db");
process.env.DATABASE_PATH = testDbPath;

const userId = "card-settlement-user";
let categoryId = "";
let giroId = "";
let cardId = "";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const today = iso(new Date());
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));

async function insertTx(values: {
  bankAccountId: string;
  type: "expense" | "income";
  amountCents: number;
  date: string;
  description: string;
  bankTransactionId?: string;
}): Promise<string> {
  const { db } = await import("../../src/lib/db/index");
  const { transactions } = await import("../../src/lib/db/schema");
  const id = crypto.randomUUID();
  const now = new Date();
  db.insert(transactions)
    .values({
      id,
      userId,
      categoryId,
      costType: "variable",
      paymentMethod: "transfer",
      createdAt: now,
      updatedAt: now,
      ...values,
    })
    .run();
  return id;
}

async function account(id: string) {
  const { db } = await import("../../src/lib/db/index");
  const { bankAccounts } = await import("../../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).get()!;
}

async function cardIncomes() {
  const { db } = await import("../../src/lib/db/index");
  const { transactions } = await import("../../src/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.bankAccountId, cardId), eq(transactions.type, "income")))
    .all();
}

describe("Kartenausgleich vom Girokonto", () => {
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
    db.insert(user).values({ id: userId, name: "Karte", email: "card@kosten.local", createdAt: now, updatedAt: now }).run();
    ensureDefaultCategoriesForUser(userId);
    categoryId = db.select().from(categories).where(eq(categories.userId, userId)).get()!.id;
    process.env.TEST_USER_ID = userId;

    const { createManualBankAccountAction } = await import("../../src/actions/bank-actions");
    const giro = await createManualBankAccountAction({ accountName: "Girokonto", accountType: "checking", balanceCents: 100_000 });
    assert.ok(giro.success);
    giroId = giro.accountId!;
  });

  it("lehnt ungültige Verknüpfungen ab", async () => {
    const { createManualBankAccountAction } = await import("../../src/actions/bank-actions");
    const otherCard = await createManualBankAccountAction({ accountName: "TF Bank", accountType: "credit_card", balanceCents: 0 });
    assert.ok(otherCard.success);

    // Kreditkarte als Ausgleichskonto
    const cardAsSource = await createManualBankAccountAction({
      accountName: "Advanzia",
      accountType: "credit_card",
      settlementAccountId: otherCard.accountId,
      settlementMatchPattern: "advanzia",
    });
    assert.equal(cardAsSource.success, false);

    // Zu kurzer Begriff
    const shortPattern = await createManualBankAccountAction({
      accountName: "Advanzia",
      accountType: "credit_card",
      settlementAccountId: giroId,
      settlementMatchPattern: "adv",
    });
    assert.equal(shortPattern.success, false);

    // Nur Kreditkarten
    const notACard = await createManualBankAccountAction({
      accountName: "Tagesgeld",
      accountType: "savings",
      settlementAccountId: giroId,
      settlementMatchPattern: "advanzia",
    });
    assert.equal(notACard.success, false);
  });

  it("verknüpft eine Karte; ältere Abbuchungen bleiben unberührt", async () => {
    // Vor der Verknüpfung: Ausgleich der Vormonate ist schon erfasst
    await insertTx({ bankAccountId: giroId, type: "expense", amountCents: 30_000, date: daysAgo(40), description: "ADVANZIA BANK S.A. Kartenabrechnung", bankTransactionId: "old-1" });

    const { createManualBankAccountAction } = await import("../../src/actions/bank-actions");
    const card = await createManualBankAccountAction({
      accountName: "Advanzia Mastercard",
      accountType: "credit_card",
      balanceCents: -45_000,
      settlementAccountId: giroId,
      settlementMatchPattern: "  Advanzia ",
    });
    assert.ok(card.success);
    cardId = card.accountId!;

    const saved = await account(cardId);
    assert.equal(saved.settlementMatchPattern, "advanzia");
    assert.equal(saved.settlementSince, today);
    assert.equal(saved.balanceCents, -45_000);
    assert.equal((await cardIncomes()).length, 0);
  });

  it("gleicht eine neue Abbuchung aus und bucht sie nur einmal", async () => {
    const { applyCardSettlements } = await import("../../src/lib/card-settlement");
    const debitId = await insertTx({ bankAccountId: giroId, type: "expense", amountCents: 45_000, date: today, description: "ADVANZIA BANK S.A. Ausgleich", bankTransactionId: "new-1" });
    // Fremde Abbuchung mit anderem Text
    await insertTx({ bankAccountId: giroId, type: "expense", amountCents: 12_000, date: today, description: "Stadtwerke Strom", bankTransactionId: "new-2" });

    assert.equal(applyCardSettlements(userId), 1);
    assert.equal(applyCardSettlements(userId), 0);

    assert.equal((await account(cardId)).balanceCents, 0);
    const incomes = await cardIncomes();
    assert.equal(incomes.length, 1);
    assert.equal(incomes[0].amountCents, 45_000);
    assert.equal(incomes[0].costType, "transfer");

    const { db } = await import("../../src/lib/db/index");
    const { transactions } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const debit = db.select().from(transactions).where(eq(transactions.id, debitId)).get()!;
    assert.equal(debit.costType, "transfer");
  });

  it("überspringt die Zahlung beim späteren Import des Kartenauszugs", async () => {
    const { importCsvTransactionsAction } = await import("../../src/actions/csv-actions");
    const [y, m, d] = today.split("-");
    const csv = `Datum;Beschreibung;Betrag;Typ
${d}.${m}.${y};Zahlung erhalten - Danke;450,00;Einnahme
${d}.${m}.${y};Online-Shop;25,00;Ausgabe`;
    const res = await importCsvTransactionsAction(csv, cardId, true);
    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.importedCount, 1);
      assert.equal(res.skippedDuplicates, 1);
    }
    assert.equal((await cardIncomes()).length, 1);
    assert.equal((await account(cardId)).balanceCents, -2_500);
  });

  it("verknüpft eine bereits importierte Gutschrift statt eine zweite anzulegen", async () => {
    const { applyCardSettlements } = await import("../../src/lib/card-settlement");
    // Gutschrift kam per Kartenauszug zuerst, die Abbuchung erst danach
    await insertTx({ bankAccountId: cardId, type: "income", amountCents: 20_000, date: today, description: "Zahlung erhalten" });
    const balanceBefore = (await account(cardId)).balanceCents;
    await insertTx({ bankAccountId: giroId, type: "expense", amountCents: 20_000, date: today, description: "Advanzia Bank Lastschrift", bankTransactionId: "new-3" });

    assert.equal(applyCardSettlements(userId), 1);
    assert.equal((await account(cardId)).balanceCents, balanceBefore);
    const linked = (await cardIncomes()).filter((t) => t.amountCents === 20_000);
    assert.equal(linked.length, 1);
    assert.equal(linked[0].clientTempId?.startsWith("card-settlement:"), true);
  });

  it("Vorschau zählt Treffer der letzten 90 Tage", async () => {
    const { previewCardSettlementAction } = await import("../../src/actions/bank-actions");
    const res = await previewCardSettlementAction({ settlementAccountId: giroId, pattern: "advanzia" });
    assert.equal(res.success, true);
    if (res.success) assert.equal(res.matchCount, 3);
    const short = await previewCardSettlementAction({ settlementAccountId: giroId, pattern: "ad" });
    if (short.success) assert.equal(short.matchCount, 0);
  });
});
