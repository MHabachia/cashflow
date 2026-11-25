import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-bank-sync-limits.db");
process.env.DATABASE_PATH = testDbPath;
process.env.AUTH_SECRET = "test_secret_for_bank_sync_limits_unit_tests_32_chars";

type RawTx = {
  bankTransactionId: string;
  bookingDate: string;
  amountCents: number;
  currency: string;
  creditorName?: string;
  remittanceInformation?: string;
  status: "booked" | "pending";
};

describe("Bank-Sync: PSD2-Limit, Backoff, Pending & stabile IDs", async () => {
  const userId = "sync-limits-user";
  const bankId = "bank-limits-1";
  const accountId = "acc-limits-1";

  let db: typeof import("../../src/lib/db/index").db;
  let schema: typeof import("../../src/lib/db/schema");
  let engine: typeof import("../../src/lib/bank-sync/sync-engine");
  let providerModule: typeof import("../../src/lib/bank-sync/provider");
  let eq: typeof import("drizzle-orm").eq;

  let nextResult: () => Promise<{ transactions: RawTx[]; balanceCents?: number | null }>;
  let fetchCalls = 0;

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const dbModule = await import("../../src/lib/db/index");
    dbModule.ensureDatabaseTables();
    db = dbModule.db;
    schema = await import("../../src/lib/db/schema");
    engine = await import("../../src/lib/bank-sync/sync-engine");
    providerModule = await import("../../src/lib/bank-sync/provider");
    ({ eq } = await import("drizzle-orm"));
    const { encryptBankToken } = await import("../../src/lib/crypto/vault");

    const now = new Date();
    db.insert(schema.user)
      .values({
        id: userId,
        name: "Limit Tester",
        email: "limits@kosten.local",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(schema.categories)
      .values({ id: "cat-limits", userId, name: "Sonstiges", type: "expense", createdAt: now })
      .run();
    db.insert(schema.connectedBanks)
      .values({
        id: bankId,
        userId,
        provider: "enable_banking",
        institutionId: "ING_DE",
        institutionName: "ING",
        encryptedAccessToken: encryptBankToken("token", userId),
        consentId: "consent",
        consentExpiresAt: "2099-01-01",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(schema.bankAccounts)
      .values({
        id: accountId,
        connectedBankId: bankId,
        userId,
        accountExternalId: "acc_giro_limits",
        accountName: "Giro",
        accountType: "checking",
        currency: "EUR",
        balanceCents: 0,
        autoSync: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Provider-Antworten im Test steuern
    const provider = providerModule.getBankSyncProvider();
    provider.fetchTransactions = async () => {
      fetchCalls++;
      return nextResult();
    };
  });

  beforeEach(() => {
    fetchCalls = 0;
    nextResult = async () => ({ transactions: [], balanceCents: null });
    db.update(schema.bankAccounts)
      .set({
        unattendedSyncDay: null,
        unattendedSyncCount: 0,
        syncFailureCount: 0,
        syncBackoffUntil: null,
        lastSyncError: null,
      })
      .where(eq(schema.bankAccounts.id, accountId))
      .run();
  });

  function account() {
    return db
      .select()
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.id, accountId))
      .get()!;
  }

  it("begrenzt automatische Abrufe auf 4 pro Tag, manuelle Abrufe bleiben möglich", async () => {
    for (let i = 0; i < 4; i++) {
      const res = await engine.syncBankAccountTransactions(accountId, userId, { unattended: true });
      assert.equal(res.success, true);
    }
    const fifth = await engine.syncBankAccountTransactions(accountId, userId, { unattended: true });
    assert.equal(fifth.success, false);
    assert.equal(fifth.deferred, true);
    assert.equal(fetchCalls, 4);

    const manual = await engine.syncBankAccountTransactions(accountId, userId);
    assert.equal(manual.success, true);
    assert.equal(fetchCalls, 5);
  });

  it("setzt nach HTTP 429 einen Backoff bis zum nächsten Tag", async () => {
    nextResult = async () => {
      throw new providerModule.BankApiError("Rate limit", 429);
    };
    const res = await engine.syncBankAccountTransactions(accountId, userId, { unattended: true });
    assert.equal(res.success, false);
    const acc = account();
    assert.equal(acc.syncFailureCount, 1);
    assert.ok(acc.syncBackoffUntil && acc.syncBackoffUntil.getTime() > Date.now() + 60_000);

    const again = await engine.syncBankAccountTransactions(accountId, userId, { unattended: true });
    assert.equal(again.deferred, true);
    assert.equal(fetchCalls, 1);
  });

  it("markiert die Verbindung bei 401 als abgelaufen", async () => {
    nextResult = async () => {
      throw new providerModule.BankApiError("Unauthorized", 401);
    };
    await engine.syncBankAccountTransactions(accountId, userId);
    const bank = db
      .select()
      .from(schema.connectedBanks)
      .where(eq(schema.connectedBanks.id, bankId))
      .get()!;
    assert.equal(bank.status, "expired");
    db.update(schema.connectedBanks)
      .set({ status: "active" })
      .where(eq(schema.connectedBanks.id, bankId))
      .run();
  });

  it("übernimmt vorgemerkte Umsätze nicht und importiert Buchungen idempotent", async () => {
    nextResult = async () => ({
      transactions: [
        { bankTransactionId: "pend-1", bookingDate: "2026-11-20", amountCents: -500, currency: "EUR", status: "pending" },
        { bankTransactionId: "book-1", bookingDate: "2026-11-20", amountCents: -700, currency: "EUR", status: "booked" },
      ],
    });
    const first = await engine.syncBankAccountTransactions(accountId, userId);
    assert.equal(first.importedCount, 1);
    const second = await engine.syncBankAccountTransactions(accountId, userId);
    assert.equal(second.importedCount, 0);

    const rows = db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.bankAccountId, accountId))
      .all();
    assert.equal(rows.some((r) => r.bankTransactionId === "pend-1"), false);
  });

  it("erzeugt stabile Ersatz-IDs unabhängig von der Reihenfolge", () => {
    const a = providerModule.buildFallbackTransactionId(
      "uid",
      { bookingDate: "2026-11-01", amountCents: -1234, counterparty: "REWE", remittance: "Einkauf" },
      0
    );
    const b = providerModule.buildFallbackTransactionId(
      "uid",
      { bookingDate: "2026-11-01", amountCents: -1234, counterparty: "rewe ", remittance: "Einkauf" },
      0
    );
    const c = providerModule.buildFallbackTransactionId(
      "uid",
      { bookingDate: "2026-11-01", amountCents: -1234, counterparty: "REWE", remittance: "Einkauf" },
      1
    );
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^gen_[0-9a-f]{24}_0$/);
  });

  it("schlüsselt alte positionsabhängige IDs auf die neue stabile ID um (keine Dublette)", async () => {
    const now = new Date();
    db.insert(schema.transactions)
      .values({
        id: "legacy-tx",
        userId,
        categoryId: "cat-limits",
        type: "expense",
        costType: "variable",
        amountCents: 999,
        date: "2026-11-15",
        description: "Alt",
        paymentMethod: "transfer",
        bankAccountId: accountId,
        bankTransactionId: "tx_gen_2026-11-15_3",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const newId = providerModule.buildFallbackTransactionId(
      "acc_giro_limits",
      { bookingDate: "2026-11-15", amountCents: -999, counterparty: "Bäcker" },
      0
    );
    nextResult = async () => ({
      transactions: [
        { bankTransactionId: newId, bookingDate: "2026-11-15", amountCents: -999, currency: "EUR", creditorName: "Bäcker", status: "booked" },
      ],
    });
    const res = await engine.syncBankAccountTransactions(accountId, userId);
    assert.equal(res.importedCount, 0);
    const legacy = db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, "legacy-tx"))
      .get()!;
    assert.equal(legacy.bankTransactionId, newId);
  });
});
