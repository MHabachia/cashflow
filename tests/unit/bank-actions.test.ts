import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Eigene Test-DB für die Funktions-Tests setzen
const testDbPath = path.resolve("./data/test-bank-unit.db");
process.env.DATABASE_PATH = testDbPath;
process.env.AUTH_SECRET = "test_secret_for_bank_actions_unit_tests_32_chars";

describe("Bank-Sync Actions & Open Banking Integration", async () => {
  let userId: string;

  before(async () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    const { ensureDatabaseTables, db } = await import("../../src/lib/db/index");
    const { user } = await import("../../src/lib/db/schema");
    ensureDatabaseTables();

    userId = "test-bank-user-1";
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    db.insert(user)
      .values({
        id: userId,
        name: "Bank Tester",
        email: "banktester@kosten.local",
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  it("verknüpft ING Deutschland sicher, verschlüsselt das Token und legt Konten an", async () => {
    const { connectBankInstitutionAction } = await import(
      "../../src/actions/bank-actions"
    );
    const { db } = await import("../../src/lib/db/index");
    const { connectedBanks, bankAccounts } = await import(
      "../../src/lib/db/schema"
    );
    const { decryptBankToken } = await import("../../src/lib/crypto/vault");
    const { eq } = await import("drizzle-orm");

    const res = await connectBankInstitutionAction("ING_DE");
    assert.equal(res.success, true);
    assert.equal(res.bankName, "ING Deutschland");

    // In der Datenbank prüfen
    const savedBanks = db
      .select()
      .from(connectedBanks)
      .where(eq(connectedBanks.userId, userId))
      .all();
    assert.equal(savedBanks.length, 1);
    assert.equal(savedBanks[0].institutionId, "ING_DE");
    assert.equal(savedBanks[0].status, "active");

    // Token muss verschlüsselt sein und per Krypto-Vault entschlüsselbar sein
    assert.ok(savedBanks[0].encryptedAccessToken.includes(":"));
    const decryptedToken = decryptBankToken(
      savedBanks[0].encryptedAccessToken,
      userId
    );
    assert.ok(decryptedToken.startsWith("psd2_access_ing_de_"));

    // Unterkonten prüfen (ING hat Girokonto + VISA Card)
    const savedAccounts = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.connectedBankId, savedBanks[0].id))
      .all();
    assert.equal(savedAccounts.length, 2);
    assert.ok(savedAccounts.some((a) => a.accountType === "checking"));
    assert.ok(savedAccounts.some((a) => a.accountType === "credit_card"));
  });

  it("verhindert doppelte Verknüpfung derselben Bank", async () => {
    const { connectBankInstitutionAction } = await import(
      "../../src/actions/bank-actions"
    );

    const res = await connectBankInstitutionAction("ING_DE");
    assert.equal(res.success, false);
    assert.ok(res.error?.includes("bereits mit deinem Profil verknüpft"));
  });

  it("schaltet Auto-Sync für ein Konto um", async () => {
    const { toggleAccountAutoSyncAction } = await import(
      "../../src/actions/bank-actions"
    );
    const { db } = await import("../../src/lib/db/index");
    const { bankAccounts } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const account = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, userId))
      .limit(1)
      .get();
    assert.ok(account);

    const res = await toggleAccountAutoSyncAction(account.id, false);
    assert.equal(res.success, true);

    const updated = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, account.id))
      .get();
    assert.equal(updated?.autoSync, false);
  });

  it("trennt eine Bankverbindung und kaskadiert das Löschen der Unterkonten", async () => {
    const { disconnectBankAction } = await import(
      "../../src/actions/bank-actions"
    );
    const { db } = await import("../../src/lib/db/index");
    const { connectedBanks, bankAccounts } = await import(
      "../../src/lib/db/schema"
    );
    const { eq } = await import("drizzle-orm");

    const bank = db
      .select()
      .from(connectedBanks)
      .where(eq(connectedBanks.userId, userId))
      .get();
    assert.ok(bank);

    const res = await disconnectBankAction(bank.id);
    assert.equal(res.success, true);

    const remainingBanks = db
      .select()
      .from(connectedBanks)
      .where(eq(connectedBanks.userId, userId))
      .all();
    assert.equal(remainingBanks.length, 0);

    const remainingAccounts = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, userId))
      .all();
    assert.equal(remainingAccounts.length, 0);
  });
});
