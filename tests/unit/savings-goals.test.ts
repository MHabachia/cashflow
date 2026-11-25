import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-savings-goals.db");
process.env.DATABASE_PATH = testDbPath;
process.env.AUTH_SECRET = "test_secret_for_savings_goals_unit_tests_32_chars";

describe("Sparziele & Sinking Funds (Spartöpfe)", async () => {
  before(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("erstellt Sparziel, bucht Einzahlungen/Entnahmen und aktualisiert Zielbeträge", async () => {
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user, savingsGoals } = await import("../../src/lib/db/schema");
    const {
      createSavingsGoalAction,
      adjustSavingsGoalAmountAction,
      updateSavingsGoalAction,
      deleteSavingsGoalAction,
    } = await import("../../src/actions/savings-actions");
    const { eq } = await import("drizzle-orm");

    ensureDatabaseTables();

    const userId = "test-savings-user-1";
    process.env.TEST_USER_ID = userId;
    const now = new Date();

    db.insert(user)
      .values({
        id: userId,
        name: "Sparer",
        email: "sparer@kosten.local",
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // 1. Sparziel anlegen (Notgroschen: Ziel 3.000 €, Start 500 €)
    const resCreate = await createSavingsGoalAction({
      name: "Notgroschen",
      targetAmountCents: 300000,
      currentAmountCents: 50000,
      targetDate: "2027-12-31",
      icon: "shield",
      color: "#10b981",
    });

    assert.equal(resCreate.success, true);
    assert.ok(resCreate.id);

    const goal = db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.id, resCreate.id!))
      .get();

    assert.ok(goal);
    assert.equal(goal.name, "Notgroschen");
    assert.equal(goal.targetAmountCents, 300000);
    assert.equal(goal.currentAmountCents, 50000);
    assert.equal(goal.icon, "shield");

    // 2. Einzahlung von 250 € (25000 Cents) buchen
    const resDeposit = await adjustSavingsGoalAmountAction({
      goalId: goal.id,
      deltaCents: 25000,
    });
    assert.equal(resDeposit.success, true);
    assert.equal(resDeposit.newAmountCents, 75000);

    const afterDeposit = db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.id, goal.id))
      .get();
    assert.equal(afterDeposit?.currentAmountCents, 75000); // 500 € + 250 € = 750 €

    // 3. Entnahme von 100 € (10000 Cents) buchen
    const resWithdraw = await adjustSavingsGoalAmountAction({
      goalId: goal.id,
      deltaCents: -10000,
    });
    assert.equal(resWithdraw.success, true);
    assert.equal(resWithdraw.newAmountCents, 65000);

    const afterWithdraw = db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.id, goal.id))
      .get();
    assert.equal(afterWithdraw?.currentAmountCents, 65000); // 750 € - 100 € = 650 €

    // 4. Update des Sparziels (Zielbetrag auf 5.000 € erhöhen)
    const resUpdate = await updateSavingsGoalAction({
      id: goal.id,
      targetAmountCents: 500000,
      name: "Notgroschen 6 Monate",
    });
    assert.equal(resUpdate.success, true);

    const afterUpdate = db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.id, goal.id))
      .get();
    assert.equal(afterUpdate?.targetAmountCents, 500000);
    assert.equal(afterUpdate?.name, "Notgroschen 6 Monate");

    // 5. Löschen des Sparziels
    const resDelete = await deleteSavingsGoalAction(goal.id);
    assert.equal(resDelete.success, true);

    const afterDelete = db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.id, goal.id))
      .get();
    assert.equal(afterDelete, undefined);
  });
});
