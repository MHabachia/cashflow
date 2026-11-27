import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const testDbPath = path.resolve("./data/test-banned-user.db");
process.env.DATABASE_PATH = testDbPath;

const bannedUserId = "test-banned-user";
const activeUserId = "test-active-user";

describe("Gesperrte Benutzer erhalten keine Sitzung", () => {
  const savedTestUser = process.env.TEST_USER_ID;

  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user } = await import("../../src/lib/db/schema");
    ensureDatabaseTables();
    const now = new Date();
    db.insert(user)
      .values([
        { id: bannedUserId, name: "Gesperrt", email: "banned@kosten.local", banned: true, createdAt: now, updatedAt: now },
        { id: activeUserId, name: "Aktiv", email: "active@kosten.local", banned: false, createdAt: now, updatedAt: now },
      ])
      .run();
  });

  after(() => {
    if (savedTestUser === undefined) delete process.env.TEST_USER_ID;
    else process.env.TEST_USER_ID = savedTestUser;
  });

  it("isUserBanned liest den Sperrstatus aus der Datenbank", async () => {
    const { isUserBanned } = await import("../../src/lib/user-status");
    assert.equal(isUserBanned(bannedUserId), true);
    assert.equal(isUserBanned(activeUserId), false);
    assert.equal(isUserBanned("unbekannt"), false);
  });

  it("Better Auth verweigert gesperrten Benutzern die Anmeldung mit 403", async () => {
    const { auth } = await import("../../src/lib/auth");
    const { runWithSignUpAllowed } = await import("../../src/lib/signup-guard");
    const { db } = await import("../../src/lib/db/index");
    const { user } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const email = "signin-ban@kosten.local";
    const password = "ein-langes-test-passwort";
    await runWithSignUpAllowed(() =>
      auth.api.signUpEmail({ body: { email, password, name: "Sign-in Test" } })
    );

    // Direkt über die Better-Auth-API, also ohne die Vorprüfung der Route:
    // Nur der Session-Hook kann die Anmeldung hier verhindern.
    db.update(user).set({ banned: true }).where(eq(user.email, email)).run();
    await assert.rejects(
      auth.api.signInEmail({ body: { email, password } }),
      (err: { statusCode?: number; message?: string }) =>
        err.statusCode === 403 && /gesperrt/.test(err.message ?? "")
    );

    db.update(user).set({ banned: false }).where(eq(user.email, email)).run();
    const ok = await auth.api.signInEmail({ body: { email, password } });
    assert.ok(ok.token);
  });

  it("entfernt eine Sitzung, die trotz Sperre entstanden ist", async () => {
    const { auth } = await import("../../src/lib/auth");
    const { db } = await import("../../src/lib/db/index");
    const { session } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const after = auth.options.databaseHooks?.session?.create?.after;
    assert.ok(after, "session.create.after-Hook fehlt");

    const now = new Date();
    const row = {
      id: "race-session",
      userId: bannedUserId,
      token: "race-token",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    };
    db.insert(session).values(row).run();
    await after(row);
    assert.equal(db.select().from(session).where(eq(session.id, row.id)).get(), undefined);
  });

  it("getCurrentSession liefert für gesperrte Benutzer null", async () => {
    const { getCurrentSession } = await import("../../src/lib/session");

    process.env.TEST_USER_ID = bannedUserId;
    assert.equal(await getCurrentSession(), null);

    process.env.TEST_USER_ID = activeUserId;
    const session = await getCurrentSession();
    assert.equal(session?.user.id, activeUserId);
  });
});
