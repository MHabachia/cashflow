import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-action-validation.db");
process.env.DATABASE_PATH = testDbPath;

const userId = "validation-user";

/**
 * Server Actions lassen sich mit beliebigem JSON aufrufen. Die Casts auf
 * `never` simulieren genau das: Werte, die der TypeScript-Typ verbietet.
 */
const forged = <T>(value: unknown) => value as T;

async function balanceOf(accountId: string): Promise<number | null> {
  const { db } = await import("../../src/lib/db/index");
  const { bankAccounts } = await import("../../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId)).get()?.balanceCents ?? null;
}

describe("Eingabeprüfung der Server Actions", () => {
  let giroId = "";
  let cashId = "";

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user } = await import("../../src/lib/db/schema");
    const { ensureDefaultCategoriesForUser } = await import("../../src/lib/db/defaults");
    ensureDatabaseTables();
    const now = new Date();
    db.insert(user).values({ id: userId, name: "Validierung", email: "validation@kosten.local", createdAt: now, updatedAt: now }).run();
    ensureDefaultCategoriesForUser(userId);
    process.env.TEST_USER_ID = userId;

    const { createManualBankAccountAction } = await import("../../src/actions/bank-actions");
    const giro = await createManualBankAccountAction({ accountName: "Giro", accountType: "checking", balanceCents: 10_000 });
    const cash = await createManualBankAccountAction({ accountName: "Bargeld", accountType: "cash", balanceCents: 0 });
    assert.ok(giro.success && cash.success);
    giroId = giro.accountId!;
    cashId = cash.accountId!;
  });

  it("isoDateSchema akzeptiert nur echte Kalenderdaten", async () => {
    const { isoDateSchema } = await import("../../src/lib/validation");
    assert.equal(isoDateSchema.safeParse("2028-02-29").success, true);
    assert.equal(isoDateSchema.safeParse("2027-02-29").success, false);
    assert.equal(isoDateSchema.safeParse("2026-13-01").success, false);
    assert.equal(isoDateSchema.safeParse("1.1.2026").success, false);
  });

  it("Konto anlegen: unbekannte Kontoart, Abrechnungstag und Kommazahlen werden abgelehnt", async () => {
    const { createManualBankAccountAction } = await import("../../src/actions/bank-actions");
    const badType = await createManualBankAccountAction({ accountName: "X", accountType: forged("depot") });
    assert.equal(badType.success, false);
    const badDay = await createManualBankAccountAction({ accountName: "X", accountType: "credit_card", billingDayOfMonth: 40 });
    assert.equal(badDay.success, false);
    const fraction = await createManualBankAccountAction({ accountName: "X", accountType: "cash", balanceCents: 10.5 });
    assert.equal(fraction.success, false);
    const negative = await createManualBankAccountAction({ accountName: "Karte", accountType: "credit_card", balanceCents: -5_000 });
    assert.equal(negative.success, true);
  });

  it("Konto ändern: String im Saldo wird abgelehnt, der Saldo bleibt", async () => {
    const { updateBankAccountAction } = await import("../../src/actions/bank-actions");
    const res = await updateBankAccountAction({ accountId: giroId, balanceCents: forged("5001e9") });
    assert.equal(res.success, false);
    assert.equal(await balanceOf(giroId), 10_000);
  });

  it("Umbuchung: String, Kommazahl und ungültiges Datum werden abgelehnt", async () => {
    const { transferBetweenAccountsAction } = await import("../../src/actions/bank-actions");
    const base = { sourceAccountId: giroId, targetAccountId: cashId };
    assert.equal((await transferBetweenAccountsAction({ ...base, amountCents: forged("1e9") })).success, false);
    assert.equal((await transferBetweenAccountsAction({ ...base, amountCents: 12.5 })).success, false);
    assert.equal((await transferBetweenAccountsAction({ ...base, amountCents: 100, date: "2026-02-30" })).success, false);
    assert.equal(await balanceOf(giroId), 10_000);
    assert.equal(await balanceOf(cashId), 0);

    const ok = await transferBetweenAccountsAction({ ...base, amountCents: 2_500, date: "2026-11-20" });
    assert.equal(ok.success, true);
    assert.equal(await balanceOf(giroId), 7_500);
    assert.equal(await balanceOf(cashId), 2_500);
  });

  it("Saldo-Abgleich: String als Zielsaldo und unbekannter Modus werden abgelehnt", async () => {
    const { reconcileAccountBalanceAction } = await import("../../src/actions/bank-actions");
    const asString = await reconcileAccountBalanceAction({ accountId: cashId, actualBalanceCents: forged("100") });
    assert.equal(asString.success, false);
    const badMode = await reconcileAccountBalanceAction({ accountId: cashId, actualBalanceCents: 100, mode: forged("delete_all") });
    assert.equal(badMode.success, false);
    assert.equal(await balanceOf(cashId), 2_500);
  });

  it("Sparziele: String im Betrag und ungültige Farbe werden abgelehnt", async () => {
    const { createSavingsGoalAction, adjustSavingsGoalAmountAction, updateSavingsGoalAction } = await import(
      "../../src/actions/savings-actions"
    );
    const badColor = await createSavingsGoalAction({ name: "Urlaub", targetAmountCents: 100_000, currentAmountCents: 0, color: "red;background:url(x)" });
    assert.equal(badColor.success, false);

    const goal = await createSavingsGoalAction({ name: "Urlaub", targetAmountCents: 100_000, currentAmountCents: 500, color: "#10b981" });
    assert.ok(goal.success && goal.id);
    assert.equal((await adjustSavingsGoalAmountAction({ goalId: goal.id, deltaCents: forged("1e9") })).success, false);
    assert.equal((await updateSavingsGoalAction({ id: goal.id, targetAmountCents: -1 })).success, false);

    const ok = await adjustSavingsGoalAmountAction({ goalId: goal.id, deltaCents: 1_000 });
    assert.equal(ok.success, true);
    if (ok.success) assert.equal(ok.newAmountCents, 1_500);
  });

  it("Massenaktionen und Fixkosten: unbekannte Enums und leere Listen werden abgelehnt", async () => {
    const { batchUpdateTransactionsAction, batchDeleteTransactionsAction } = await import(
      "../../src/actions/transaction-actions"
    );
    const { createRecurringFromTransactionAction } = await import("../../src/actions/recurring-actions");
    const { db } = await import("../../src/lib/db/index");
    const { categories } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const categoryId = db.select().from(categories).where(eq(categories.userId, userId)).get()!.id;

    assert.equal((await batchUpdateTransactionsAction({ ids: ["x"], costType: forged("evil") })).success, false);
    assert.equal((await batchUpdateTransactionsAction({ ids: [] })).success, false);
    assert.equal((await batchDeleteTransactionsAction(forged("alle"))).success, false);

    const badInterval = await createRecurringFromTransactionAction({
      name: "Abo",
      amountCents: 999,
      type: "expense",
      categoryId,
      interval: forged("daily"),
    });
    assert.equal(badInterval.success, false);
  });
});
