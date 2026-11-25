import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-transaction-balance.db");
process.env.DATABASE_PATH = testDbPath;

describe("Kontostand bleibt beim Bearbeiten von Buchungen konsistent", async () => {
  const userId = "balance-user";
  const otherUserId = "balance-other-user";

  let db: typeof import("../../src/lib/db/index").db;
  let schema: typeof import("../../src/lib/db/schema");
  let actions: typeof import("../../src/actions/transaction-actions");
  let eq: typeof import("drizzle-orm").eq;
  let categoryId: string;
  let foreignCategoryId: string;

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const dbModule = await import("../../src/lib/db/index");
    dbModule.ensureDatabaseTables();
    db = dbModule.db;
    schema = await import("../../src/lib/db/schema");
    actions = await import("../../src/actions/transaction-actions");
    ({ eq } = await import("drizzle-orm"));

    process.env.TEST_USER_ID = userId;
    const now = new Date();
    for (const id of [userId, otherUserId]) {
      db.insert(schema.user)
        .values({ id, name: id, email: `${id}@kosten.local`, createdAt: now, updatedAt: now })
        .run();
    }
    categoryId = "cat-balance";
    foreignCategoryId = "cat-foreign";
    db.insert(schema.categories)
      .values([
        { id: categoryId, userId, name: "Lebensmittel", type: "expense", createdAt: now },
        { id: foreignCategoryId, userId: otherUserId, name: "Fremd", type: "expense", createdAt: now },
      ])
      .run();
    db.insert(schema.bankAccounts)
      .values({
        id: "acc-balance",
        userId,
        accountExternalId: "manual-balance",
        accountName: "Giro",
        accountType: "checking",
        currency: "EUR",
        balanceCents: 100000,
        autoSync: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  function balance() {
    return db
      .select()
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.id, "acc-balance"))
      .get()!.balanceCents;
  }

  it("verbucht beim Ändern von Betrag und Typ nur die Differenz", async () => {
    const created = await actions.createTransactionAction({
      categoryId,
      type: "expense",
      amountCents: 2000,
      date: "2026-11-20",
      description: "Einkauf",
      paymentMethod: "card",
      bankAccountId: "acc-balance",
    });
    assert.equal(created.success, true);
    assert.equal(balance(), 98000);

    const base = {
      id: created.id,
      categoryId,
      date: "2026-11-20",
      description: "Einkauf",
      paymentMethod: "card" as const,
    };

    await actions.updateTransactionAction({ ...base, type: "expense", amountCents: 3500 });
    assert.equal(balance(), 96500);

    await actions.updateTransactionAction({ ...base, type: "income", amountCents: 3500 });
    assert.equal(balance(), 103500);

    await actions.deleteTransactionAction(created.id!);
    assert.equal(balance(), 100000);
  });

  it("lehnt Kategorien und Konten anderer Benutzer ab", async () => {
    const foreignCat = await actions.createTransactionAction({
      categoryId: foreignCategoryId,
      type: "expense",
      amountCents: 100,
      date: "2026-11-20",
      description: "Test",
      paymentMethod: "card",
    });
    assert.equal(foreignCat.success, false);

    const foreignAcc = await actions.createTransactionAction({
      categoryId,
      type: "expense",
      amountCents: 100,
      date: "2026-11-20",
      description: "Test",
      paymentMethod: "card",
      bankAccountId: "does-not-belong",
    });
    assert.equal(foreignAcc.success, false);
  });
});
