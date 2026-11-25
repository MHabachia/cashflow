import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const testDbPath = path.resolve("./data/test-p2-hardening.db");
process.env.DATABASE_PATH = testDbPath;

describe("P2: Migrationen, Job-Lock, Login-Sperre, Audit-Log", async () => {
  before(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
  });

  it("führt Migrationen genau einmal und in Reihenfolge aus", async () => {
    const { runMigrations, MIGRATIONS } = await import("../../src/lib/db/migrations");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-mig-"));
    const conn = new Database(path.join(dir, "m.db"));
    try {
      const first = runMigrations(conn);
      assert.deepEqual(first, MIGRATIONS.map((m) => m.id).sort((a, b) => a - b));
      const second = runMigrations(conn);
      assert.deepEqual(second, []);

      const tables = (
        conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      ).map((t) => t.name);
      for (const t of ["user", "transactions", "rate_limit", "audit_log", "job_locks", "schema_migrations"]) {
        assert.ok(tables.includes(t), `Tabelle ${t} fehlt`);
      }

      // Neue Migration wird nachträglich angewendet, alte nicht erneut
      const extra = runMigrations(conn, [
        ...MIGRATIONS,
        { id: 999, name: "test", up: (db) => db.exec("CREATE TABLE test_extra (id INTEGER)") },
      ]);
      assert.deepEqual(extra, [999]);
    } finally {
      conn.close();
    }
  });

  it("vergibt Job-Sperren exklusiv und gibt sie nach Ablauf frei", async () => {
    const { ensureDatabaseTables } = await import("../../src/lib/db/index");
    ensureDatabaseTables();
    const { tryAcquireJobLock, releaseJobLock, withJobLock } = await import("../../src/lib/job-lock");

    const owner = tryAcquireJobLock("test-job", 60_000);
    assert.ok(owner);
    assert.equal(tryAcquireJobLock("test-job", 60_000), null);

    const nested = await withJobLock("test-job", 60_000, () => "lief");
    assert.equal(nested.skipped, true);

    releaseJobLock("test-job", owner!);
    const after = await withJobLock("test-job", 60_000, () => "lief");
    assert.deepEqual(after, { skipped: false, result: "lief" });

    // Abgelaufene Sperre darf übernommen werden
    const stale = tryAcquireJobLock("stale-job", -1);
    assert.ok(stale);
    assert.ok(tryAcquireJobLock("stale-job", 60_000));
  });

  it("sperrt ein Konto nach 10 Fehlversuchen unabhängig von der IP", async () => {
    const { checkAccountLoginLock, recordLoginFailure, resetLoginFailures } = await import(
      "../../src/lib/auth"
    );
    const email = "Brute@Example.local";
    for (let i = 0; i < 9; i++) recordLoginFailure(email);
    assert.equal(checkAccountLoginLock(email).locked, false);
    recordLoginFailure("brute@example.local ");
    const lock = checkAccountLoginLock("brute@example.local");
    assert.equal(lock.locked, true);
    assert.ok((lock.retryAfterSeconds ?? 0) > 0);
    resetLoginFailures(email);
    assert.equal(checkAccountLoginLock(email).locked, false);
  });

  it("schreibt Audit-Einträge und räumt alte Einträge auf", async () => {
    const { logAudit, getRecentAuditEntries, pruneAuditLog } = await import("../../src/lib/audit");
    const { db } = await import("../../src/lib/db/index");
    const { auditLog } = await import("../../src/lib/db/schema");

    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Test" });
    logAudit({ action: "auth.login.failure", target: "a@b.de", headers, details: { status: 401 } });
    const [latest] = getRecentAuditEntries(1);
    assert.equal(latest.action, "auth.login.failure");
    assert.equal(latest.ipAddress, "203.0.113.7");
    assert.equal(latest.userAgent, "Test");

    db.insert(auditLog)
      .values({ id: "old-entry", createdAt: new Date(Date.now() - 400 * 86400000), action: "auth.register" })
      .run();
    assert.ok(pruneAuditLog() >= 1);
    assert.equal(getRecentAuditEntries(1000).some((e) => e.id === "old-entry"), false);
  });
});
