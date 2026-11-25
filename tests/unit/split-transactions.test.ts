import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { db } from "../../src/lib/db";
import {
  user as userTable,
  categories,
  transactions,
  transactionSplits,
} from "../../src/lib/db/schema";
import {
  splitTransactionAction,
  unsplitTransactionAction,
  getTransactionSplitsAction,
} from "../../src/actions/transaction-actions";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

describe("Split Transactions (Split-Buchungen)", () => {
  const testUserId = `split-tester-${crypto.randomUUID()}`;
  let cat1Id: string;
  let cat2Id: string;
  let cat3Id: string;

  beforeEach(() => {
    process.env.TEST_USER_ID = testUserId;

    db.insert(userTable)
      .values({
        id: testUserId,
        name: "Split Tester",
        email: `${testUserId}@kosten.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();

    cat1Id = crypto.randomUUID();
    cat2Id = crypto.randomUUID();
    cat3Id = crypto.randomUUID();

    db.insert(categories)
      .values([
        {
          id: cat1Id,
          userId: testUserId,
          name: "Lebensmittel",
          type: "expense",
          createdAt: new Date(),
        },
        {
          id: cat2Id,
          userId: testUserId,
          name: "Drogerie & Haushalt",
          type: "expense",
          createdAt: new Date(),
        },
        {
          id: cat3Id,
          userId: testUserId,
          name: "Elektronik",
          type: "expense",
          createdAt: new Date(),
        },
      ])
      .run();
  });

  it("erteilt einer 100,00 € Ausgabe einen Split in 70 € und 30 € und validiert Summengleichheit", async () => {
    const txId = crypto.randomUUID();
    db.insert(transactions)
      .values({
        id: txId,
        userId: testUserId,
        categoryId: cat1Id,
        type: "expense",
        costType: "variable",
        amountCents: 10000, // 100,00 €
        date: "2026-11-23",
        description: "Supermarkt Einkauf",
        paymentMethod: "card",
        isSplit: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    // Versuch mit falscher Summe (60 + 30 = 90 statt 100)
    const invalidRes = await splitTransactionAction({
      transactionId: txId,
      splits: [
        { categoryId: cat1Id, amountCents: 6000, description: "Essen" },
        { categoryId: cat2Id, amountCents: 3000, description: "Putzmittel" },
      ],
    });
    assert.strictEqual(invalidRes.success, false);
    assert.match(invalidRes.error || "", /stimmt nicht mit dem Gesamtbetrag überein/);

    // Gültiger Split (70 € + 30 € = 100 €)
    const validRes = await splitTransactionAction({
      transactionId: txId,
      splits: [
        { categoryId: cat1Id, amountCents: 7000, description: "Lebensmittel" },
        { categoryId: cat2Id, amountCents: 3000, description: "Haushaltsartikel" },
      ],
    });
    assert.strictEqual(validRes.success, true);

    // Prüfen, dass isSplit auf true gesetzt wurde
    const updatedTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, txId))
      .get();
    assert.strictEqual(updatedTx?.isSplit, true);

    // Splits abrufen
    const splitsRes = await getTransactionSplitsAction(txId);
    assert.strictEqual(splitsRes.success, true);
    assert.strictEqual(splitsRes.splits.length, 2);
    assert.strictEqual(splitsRes.splits[0].amountCents, 7000);
    assert.strictEqual(splitsRes.splits[1].amountCents, 3000);

    // Split aufheben
    const unsplitRes = await unsplitTransactionAction(txId);
    assert.strictEqual(unsplitRes.success, true);

    const unsplitTx = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, txId))
      .get();
    assert.strictEqual(unsplitTx?.isSplit, false);

    const afterUnsplitSplits = await getTransactionSplitsAction(txId);
    assert.strictEqual(afterUnsplitSplits.splits.length, 0);
  });
});
