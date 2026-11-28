import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-bank-revoke.db");
process.env.DATABASE_PATH = testDbPath;
process.env.AUTH_SECRET = "test_secret_for_bank_revoke_unit_tests_32ch";

describe("Bank trennen beendet die Session beim Anbieter", async () => {
  const userId = "revoke-user";
  const otherUserId = "revoke-other";
  let db: typeof import("../../src/lib/db/index").db;
  let s: typeof import("../../src/lib/db/schema");
  let eq: typeof import("drizzle-orm").eq;
  let actions: typeof import("../../src/actions/bank-actions");
  let provider: typeof import("../../src/lib/bank-sync/provider");

  function insertBank(id: string, owner: string, accessToken: string) {
    return import("../../src/lib/crypto/vault").then(({ encryptBankToken }) => {
      const now = new Date();
      db.insert(s.connectedBanks)
        .values({
          id,
          userId: owner,
          provider: "enable_banking",
          institutionId: "ING_DE",
          institutionName: "ING",
          encryptedAccessToken: encryptBankToken(accessToken, owner),
          consentId: accessToken,
          consentExpiresAt: "2027-02-01",
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      db.insert(s.bankAccounts)
        .values({ id: `${id}-acc`, userId: owner, connectedBankId: id, accountExternalId: `${id}-ext`, accountName: "Giro", accountType: "checking", currency: "EUR", balanceCents: 0, autoSync: false, createdAt: now, updatedAt: now })
        .run();
    });
  }

  const bankExists = (id: string) => Boolean(db.select().from(s.connectedBanks).where(eq(s.connectedBanks.id, id)).get());

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    db = m.db;
    s = await import("../../src/lib/db/schema");
    ({ eq } = await import("drizzle-orm"));
    actions = await import("../../src/actions/bank-actions");
    provider = await import("../../src/lib/bank-sync/provider");
    process.env.TEST_USER_ID = userId;
    const now = new Date();
    for (const id of [userId, otherUserId]) {
      db.insert(s.user).values({ id, name: id, email: `${id}@kosten.local`, createdAt: now, updatedAt: now }).run();
    }
  });

  it("ruft revokeSession mit dem entschlüsselten Token auf und trennt", async (t) => {
    await insertBank("bank-ok", userId, "session-ok");
    const revoke = t.mock.method(provider.getBankSyncProvider(), "revokeSession", async () => {});

    const res = await actions.disconnectBankAction("bank-ok");

    assert.equal(res.success, true);
    assert.equal(res.revocationFailed, false);
    assert.deepEqual(revoke.mock.calls.map((c) => c.arguments), [["session-ok"]]);
    assert.equal(bankExists("bank-ok"), false);
  });

  it("trennt auch, wenn der Anbieter nicht erreichbar ist, und meldet das", async (t) => {
    await insertBank("bank-down", userId, "session-down");
    t.mock.method(console, "warn", () => {});
    t.mock.method(provider.getBankSyncProvider(), "revokeSession", async () => {
      throw new provider.BankApiError("Bank-API nicht erreichbar", 503);
    });

    const res = await actions.disconnectBankAction("bank-down");

    assert.equal(res.success, true);
    assert.equal(res.revocationFailed, true);
    assert.equal(res.consentExpiresAt, "2027-02-01");
    assert.equal(bankExists("bank-down"), false);
    const audit = db.select().from(s.auditLog).where(eq(s.auditLog.target, "bank-down")).all();
    assert.ok(audit.some((a) => a.action === "bank.revoke" && a.details?.includes('"ok":false')));
  });

  it("ruft für manuelle Konten keinen Anbieter auf", async (t) => {
    const revoke = t.mock.method(provider.getBankSyncProvider(), "revokeSession", async () => {});
    const res = await actions.disconnectBankAction("manual_banks_group");
    assert.equal(res.success, true);
    assert.equal(revoke.mock.callCount(), 0);
  });

  it("beendet keine fremde Session und löscht nichts", async (t) => {
    await insertBank("bank-foreign", otherUserId, "session-foreign");
    const revoke = t.mock.method(provider.getBankSyncProvider(), "revokeSession", async () => {});
    await actions.disconnectBankAction("bank-foreign");
    assert.equal(revoke.mock.callCount(), 0);
    assert.equal(bankExists("bank-foreign"), true);
  });
});

describe("Enable Banking: DELETE /sessions/{id}", () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  async function liveProvider() {
    const { EnableBankingLiveProvider } = await import("../../src/lib/bank-sync/provider");
    return new EnableBankingLiveProvider("app-id", pem);
  }

  it("sendet DELETE an die Session mit signiertem JWT", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
    await (await liveProvider()).revokeSession("abc/123");
    const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, "https://api.enablebanking.com/sessions/abc%2F123");
    assert.equal(init.method, "DELETE");
    assert.match(String((init.headers as Record<string, string>).Authorization), /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(init.signal, "mit Timeout");
  });

  it("wertet eine unbekannte Session (404) als bereits beendet", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("not found", { status: 404 }));
    await (await liveProvider()).revokeSession("weg");
  });

  it("meldet andere Fehler mit Status", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("kaputt", { status: 500 }));
    const { BankApiError } = await import("../../src/lib/bank-sync/provider");
    await assert.rejects((await liveProvider()).revokeSession("x"), (err: unknown) => err instanceof BankApiError && err.status === 500);
  });
});

