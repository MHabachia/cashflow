import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const testDbPath = path.resolve("./data/test-ownership.db");
process.env.DATABASE_PATH = testDbPath;

const ownerId = "ownership-owner";
const otherId = "ownership-other";
const ownCat = "own-cat";
const ownCat2 = "own-cat-2";
const foreignCat = "foreign-cat";

/** Legt eine Buchung des Eigentümers an und gibt ihre ID zurück. */
async function insertOwnTransaction(): Promise<string> {
  const { db } = await import("../../src/lib/db/index");
  const { transactions } = await import("../../src/lib/db/schema");
  const id = crypto.randomUUID();
  const now = new Date();
  db.insert(transactions)
    .values({
      id,
      userId: ownerId,
      categoryId: ownCat,
      type: "expense",
      costType: "variable",
      amountCents: 1000,
      date: "2026-11-20",
      description: "Testbuchung",
      paymentMethod: "card",
      isSplit: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

describe("Eigentumsprüfung für Kategorien aus dem Client", () => {
  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user, categories } = await import("../../src/lib/db/schema");
    ensureDatabaseTables();
    const now = new Date();
    db.insert(user)
      .values([
        { id: ownerId, name: "Owner", email: "owner@ownership.local", createdAt: now, updatedAt: now },
        { id: otherId, name: "Other", email: "other@ownership.local", createdAt: now, updatedAt: now },
      ])
      .run();
    db.insert(categories)
      .values([
        { id: ownCat, userId: ownerId, name: "Eigen", type: "expense", createdAt: now },
        { id: ownCat2, userId: ownerId, name: "Eigen 2", type: "expense", createdAt: now },
        { id: foreignCat, userId: otherId, name: "Geheim", type: "expense", createdAt: now },
      ])
      .run();
    process.env.TEST_USER_ID = ownerId;
  });

  it("Hilfsfunktionen erkennen fremde Kategorien", async () => {
    const { userOwnsCategory, userOwnsAllCategories } = await import("../../src/lib/ownership");
    assert.equal(userOwnsCategory(ownerId, ownCat), true);
    assert.equal(userOwnsCategory(ownerId, foreignCat), false);
    assert.equal(userOwnsAllCategories(ownerId, [ownCat, ownCat2, ownCat]), true);
    assert.equal(userOwnsAllCategories(ownerId, [ownCat, foreignCat]), false);
    assert.equal(userOwnsAllCategories(ownerId, []), true);
  });

  it("Massen-Update lehnt eine fremde Kategorie ab", async () => {
    const { batchUpdateTransactionsAction } = await import("../../src/actions/transaction-actions");
    const txId = await insertOwnTransaction();
    const res = await batchUpdateTransactionsAction({ ids: [txId], categoryId: foreignCat });
    assert.equal(res.success, false);
  });

  it("Split lehnt fremde Kategorien ab; die Abfrage zeigt keine fremden Namen", async () => {
    const { splitTransactionAction, getTransactionSplitsAction } = await import(
      "../../src/actions/transaction-actions"
    );
    const { db } = await import("../../src/lib/db/index");
    const { transactionSplits } = await import("../../src/lib/db/schema");
    const txId = await insertOwnTransaction();

    const res = await splitTransactionAction({
      transactionId: txId,
      splits: [
        { categoryId: ownCat, amountCents: 500 },
        { categoryId: foreignCat, amountCents: 500 },
      ],
    });
    assert.equal(res.success, false);

    // Altdaten mit fremder Kategorie (vor dieser Prüfung entstanden) dürfen
    // den fremden Kategorienamen nicht preisgeben.
    db.insert(transactionSplits)
      .values({ id: crypto.randomUUID(), transactionId: txId, categoryId: foreignCat, amountCents: 1000, createdAt: new Date() })
      .run();
    const splits = await getTransactionSplitsAction(txId);
    assert.ok(splits.splits.every((s) => s.categoryName !== "Geheim"));
  });

  it("Regeln: Anlegen und Ändern mit fremder Kategorie scheitern, die Liste zeigt keine fremden Namen", async () => {
    const { createCategoryRuleAction, updateCategoryRuleAction, getUserCategoryRulesAction } = await import(
      "../../src/actions/category-rule-actions"
    );
    const { db } = await import("../../src/lib/db/index");
    const { categoryRules } = await import("../../src/lib/db/schema");

    const created = await createCategoryRuleAction({ pattern: "rewe", categoryId: foreignCat });
    assert.equal(created.success, false);

    const ok = await createCategoryRuleAction({ pattern: "edeka", categoryId: ownCat });
    assert.equal(ok.success, true);
    const updated = await updateCategoryRuleAction({ id: ok.id!, pattern: "edeka", categoryId: foreignCat });
    assert.equal(updated.success, false);

    const now = new Date();
    db.insert(categoryRules)
      .values({ id: crypto.randomUUID(), userId: ownerId, pattern: "alt", matchField: "all", categoryId: foreignCat, costType: "variable", priority: 0, isActive: true, createdAt: now, updatedAt: now })
      .run();
    const rules = await getUserCategoryRulesAction();
    assert.ok(rules.every((r) => r.categoryName !== "Geheim"));
  });

  it("Kategorien: fremde Elternkategorie und Kreise werden abgelehnt", async () => {
    const { saveCategoryAction, saveVariablePresetAction } = await import("../../src/actions/category-actions");
    const { db } = await import("../../src/lib/db/index");
    const { categories } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const foreignParent = await saveCategoryAction({ name: "Neu", parentId: foreignCat, color: "#112233", icon: "Tag", type: "expense" });
    assert.equal(foreignParent.success, false);

    // ownCat2 unter ownCat hängen, dann ownCat unter ownCat2: Kreis
    db.update(categories).set({ parentId: ownCat }).where(eq(categories.id, ownCat2)).run();
    const cycle = await saveCategoryAction({ id: ownCat, name: "Eigen", parentId: ownCat2, color: "#112233", icon: "Tag", type: "expense" });
    assert.equal(cycle.success, false);
    assert.equal(db.select().from(categories).where(eq(categories.id, ownCat)).get()?.parentId, null);

    const preset = await saveVariablePresetAction({ name: "Vorlage", categoryId: foreignCat, type: "expense", paymentMethod: "card" });
    assert.equal(preset.success, false);
  });

  it("Fixkosten und Budgets lehnen fremde Kategorien ab", async () => {
    const { saveRecurringExpenseAction, createRecurringFromTransactionAction } = await import(
      "../../src/actions/recurring-actions"
    );
    const { saveBudgetAction } = await import("../../src/actions/budget-actions");

    const recurring = await saveRecurringExpenseAction({
      name: "Miete",
      categoryId: foreignCat,
      type: "expense",
      amountCents: 50000,
      paymentMethod: "direct_debit",
      interval: "monthly",
      dayOfMonth: 1,
      startDate: "2026-12-01",
      nextDueDate: "2026-12-01",
      autoBook: false,
      active: true,
    });
    assert.equal(recurring.success, false);

    const fromTx = await createRecurringFromTransactionAction({
      name: "Abo",
      amountCents: 999,
      type: "expense",
      categoryId: foreignCat,
    });
    assert.equal(fromTx.success, false);

    const budget = await saveBudgetAction({ categoryId: foreignCat, amountCents: 10000 });
    assert.equal(budget.success, false);
  });
});

describe("wouldCreateCategoryCycle", () => {
  it("erkennt direkte und indirekte Kreise", async () => {
    const { wouldCreateCategoryCycle } = await import("../../src/lib/ownership");
    // Stand aus dem vorherigen Test: ownCat2 → ownCat
    assert.equal(wouldCreateCategoryCycle(ownerId, ownCat, ownCat2), true);
    assert.equal(wouldCreateCategoryCycle(ownerId, ownCat, ownCat), true);
    assert.equal(wouldCreateCategoryCycle(ownerId, ownCat2, ownCat), false);
  });
});
