import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-password-recovery.db");
process.env.DATABASE_PATH = testDbPath;

describe("Passwort-Wiederherstellung ohne E-Mail", async () => {
  let db: typeof import("../../src/lib/db/index").db;
  let s: typeof import("../../src/lib/db/schema");
  let pr: typeof import("../../src/lib/password-recovery");
  let eq: typeof import("drizzle-orm").eq;
  let userId: string;

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const m = await import("../../src/lib/db/index");
    m.ensureDatabaseTables();
    db = m.db;
    s = await import("../../src/lib/db/schema");
    pr = await import("../../src/lib/password-recovery");
    ({ eq } = await import("drizzle-orm"));
    const { auth } = await import("../../src/lib/auth");
    const res = await auth.api.signUpEmail({
      body: { name: "Reset", email: "reset@kosten.local", password: "AltesPasswort1!" },
    });
    userId = res.user.id;
  });

  it("Reset-Link: nur als Hash gespeichert, einmalig, neuer Link entwertet alten", async () => {
    const first = pr.createPasswordResetToken(userId, { purpose: "admin_link", createdBy: null });
    const rows = db.select().from(s.passwordResetTokens).all();
    assert.equal(rows.some((r) => r.tokenHash === first), false, "Klartext nicht gespeichert");
    assert.ok(pr.inspectResetToken(first));

    const second = pr.createPasswordResetToken(userId, { purpose: "admin_link", createdBy: null });
    assert.equal(pr.inspectResetToken(first), null, "alter Link entwertet");

    db.insert(s.session)
      .values({ id: "sess-1", userId, token: "t1", expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(), updatedAt: new Date() })
      .run();

    assert.equal(pr.consumeResetToken(second), userId);
    assert.equal(pr.consumeResetToken(second), null, "nur einmal verwendbar");

    await pr.setUserPassword(userId, "NeuesPasswort2!");
    assert.equal(await pr.verifyUserPassword(userId, "NeuesPasswort2!"), true);
    assert.equal(await pr.verifyUserPassword(userId, "AltesPasswort1!"), false);
    assert.equal(db.select().from(s.session).where(eq(s.session.userId, userId)).all().length, 0, "Sitzungen beendet");
  });

  it("Reset-Link läuft ab", () => {
    const token = pr.createPasswordResetToken(userId, { purpose: "admin_link", createdBy: null, ttlHours: -1 });
    assert.equal(pr.inspectResetToken(token), null);
    assert.equal(pr.consumeResetToken(token), null);
  });

  it("Wiederherstellungscodes: 8 Stück, gehasht, einmalig, tolerant bei Schreibweise", () => {
    const codes = pr.generateRecoveryCodes(userId);
    assert.equal(codes.length, 8);
    for (const c of codes) assert.match(c, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    const stored = db.select().from(s.recoveryCodes).where(eq(s.recoveryCodes.userId, userId)).all();
    assert.equal(stored.some((r) => r.codeHash.includes(pr.normalizeRecoveryCode(codes[0]))), false);

    assert.equal(pr.consumeRecoveryCode(userId, "AAAAA-AAAAA"), false);
    assert.equal(pr.consumeRecoveryCode(userId, ` ${codes[0].toLowerCase().replace("-", " ")} `), true);
    assert.equal(pr.consumeRecoveryCode(userId, codes[0]), false, "nur einmal gültig");
    assert.equal(pr.countRemainingRecoveryCodes(userId), 7);

    const fresh = pr.generateRecoveryCodes(userId);
    assert.equal(pr.consumeRecoveryCode(userId, codes[1]), false, "alte Codes nach Neuerzeugung ungültig");
    assert.equal(pr.consumeRecoveryCode(userId, fresh[0]), true);
  });

  it("Passwort-Regeln", () => {
    assert.ok(pr.validateNewPassword("kurz"));
    assert.ok(pr.validateNewPassword("x".repeat(129)));
    assert.equal(pr.validateNewPassword("lang genug!"), null);
  });

  it("Benutzer nur mit Passkey bekommt ein Passwort-Konto", async () => {
    const now = new Date();
    db.insert(s.user).values({ id: "passkey-only", name: "P", email: "passkey@kosten.local", createdAt: now, updatedAt: now }).run();
    assert.equal(pr.userHasPassword("passkey-only"), false);
    await pr.setUserPassword("passkey-only", "ErstesPasswort3!");
    assert.equal(pr.userHasPassword("passkey-only"), true);
    assert.equal(await pr.verifyUserPassword("passkey-only", "ErstesPasswort3!"), true);
  });

  it("Server-Befehl erzeugt einen funktionierenden Einmal-Link", () => {
    const output = execFileSync(
      process.execPath,
      [path.resolve("scripts/reset-password.mjs"), "RESET@kosten.local", "--allow-root"],
      { env: { ...process.env, DATABASE_PATH: testDbPath, APP_URL: "https://cashflow.example" }, encoding: "utf8" }
    );
    const match = output.match(/https:\/\/cashflow\.example\/reset-password\?token=([A-Za-z0-9_%-]+)/);
    assert.ok(match, output);
    const token = decodeURIComponent(match![1]);
    assert.equal(pr.consumeResetToken(token), userId);

    assert.throws(() =>
      execFileSync(process.execPath, [path.resolve("scripts/reset-password.mjs"), "unbekannt@kosten.local", "--allow-root"], {
        env: { ...process.env, DATABASE_PATH: testDbPath },
        stdio: "pipe",
      })
    );
  });
});
