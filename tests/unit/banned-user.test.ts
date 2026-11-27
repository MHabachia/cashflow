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

  it("der Session-Hook verweigert Sitzungen nur für gesperrte Benutzer", async () => {
    const { auth } = await import("../../src/lib/auth");
    const before = auth.options.databaseHooks?.session?.create?.before;
    assert.ok(before, "session.create.before-Hook fehlt");

    const sessionData = (userId: string) => ({
      id: "s",
      userId,
      token: "t",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.equal(await before(sessionData(bannedUserId)), false);
    assert.notEqual(await before(sessionData(activeUserId)), false);
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
