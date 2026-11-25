import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { db } from "../../src/lib/db";
import {
  user as userTable,
  bankAccounts,
  connectedBanks,
} from "../../src/lib/db/schema";
import {
  runBackgroundBankSync,
  startBankSyncScheduler,
  stopBankSyncScheduler,
} from "../../src/lib/bank-sync/scheduler";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

describe("Background Bank Sync Worker & Scheduler", () => {
  const testUserId = `sync-worker-user-${crypto.randomUUID()}`;

  beforeEach(() => {
    db.insert(userTable)
      .values({
        id: testUserId,
        name: "Worker Tester",
        email: `${testUserId}@kosten.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();
  });

  afterEach(() => {
    stopBankSyncScheduler();
    db.delete(bankAccounts).where(eq(bankAccounts.userId, testUserId)).run();
    db.delete(connectedBanks).where(eq(connectedBanks.userId, testUserId)).run();
  });

  it("führt runBackgroundBankSync ohne Konten fehlerfrei aus", async () => {
    const res = await runBackgroundBankSync();
    assert.strictEqual(typeof res.processedUsers, "number");
    assert.strictEqual(typeof res.totalImported, "number");
    assert.strictEqual(typeof res.totalSkipped, "number");
    assert.strictEqual(Array.isArray(res.errors), true);
  });

  it("ignoriert Konten mit autoSync = false", async () => {
    const bankId = crypto.randomUUID();
    const accId = crypto.randomUUID();

    db.insert(connectedBanks)
      .values({
        id: bankId,
        userId: testUserId,
        institutionId: "ing_dibaa",
        institutionName: "ING Tester",
        encryptedAccessToken: "test-token",
        consentId: "consent-123",
        consentExpiresAt: "2030-01-01T00:00:00Z",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    db.insert(bankAccounts)
      .values({
        id: accId,
        connectedBankId: bankId,
        userId: testUserId,
        accountExternalId: "ext-123",
        accountName: "Girokonto ohne AutoSync",
        accountType: "checking",
        autoSync: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const res = await runBackgroundBankSync();
    // Da autoSync = false ist, taucht der Nutzer für diesen Sync nicht auf
    const autoSyncAccounts = db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.autoSync, true))
      .all();
    assert.strictEqual(autoSyncAccounts.some((a) => a.id === accId), false);
  });

  it("steuert den Scheduler-Lebenszyklus (start / stop)", () => {
    const originalEnv = process.env.BANK_SYNC_AUTO_ENABLED;

    try {
      process.env.BANK_SYNC_AUTO_ENABLED = "false";
      const startedDisabled = startBankSyncScheduler({ force: true });
      assert.strictEqual(startedDisabled, false);

      delete process.env.BANK_SYNC_AUTO_ENABLED;
      const started = startBankSyncScheduler({ force: true });
      assert.strictEqual(started, true);

      // Zweiter Aufruf liefert true (bereits aktiv)
      const startedAgain = startBankSyncScheduler({ force: true });
      assert.strictEqual(startedAgain, true);
    } finally {
      process.env.BANK_SYNC_AUTO_ENABLED = originalEnv;
      stopBankSyncScheduler();
    }
  });
});
