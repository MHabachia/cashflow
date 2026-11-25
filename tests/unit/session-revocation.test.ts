import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { db } from "../../src/lib/db";
import { user as userTable, session as sessionTable } from "../../src/lib/db/schema";
import { revokeOtherUserSessions } from "../../src/lib/session";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

describe("Session Revocation on Password Change", () => {
  const testUserId = `test-user-${crypto.randomUUID()}`;
  const otherUserId = `other-user-${crypto.randomUUID()}`;

  beforeEach(() => {
    // Testbenutzer vorbereiten
    db.insert(userTable)
      .values({
        id: testUserId,
        name: "Revoke Tester",
        email: `${testUserId}@example.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();

    db.insert(userTable)
      .values({
        id: otherUserId,
        name: "Other Tester",
        email: `${otherUserId}@example.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();

    // Vorherige Sessions aufräumen
    db.delete(sessionTable).where(eq(sessionTable.userId, testUserId)).run();
    db.delete(sessionTable).where(eq(sessionTable.userId, otherUserId)).run();
  });

  it("löscht alle anderen Sessions des Benutzers und behält nur die aktive Session", () => {
    const session1Id = `sess-1-${crypto.randomUUID()}`;
    const session2Id = `sess-2-${crypto.randomUUID()}`;
    const activeSessionId = `sess-active-${crypto.randomUUID()}`;
    const foreignSessionId = `sess-foreign-${crypto.randomUUID()}`;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86400000);

    // 3 Sessions für Testbenutzer anlegen
    db.insert(sessionTable)
      .values([
        {
          id: session1Id,
          userId: testUserId,
          token: `token-${session1Id}`,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: session2Id,
          userId: testUserId,
          token: `token-${session2Id}`,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: activeSessionId,
          userId: testUserId,
          token: `token-${activeSessionId}`,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
        // Fremde Session eines anderen Benutzers
        {
          id: foreignSessionId,
          userId: otherUserId,
          token: `token-${foreignSessionId}`,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    // Revoke aufrufen: Nur activeSessionId behalten
    const removedCount = revokeOtherUserSessions(testUserId, activeSessionId);
    assert.strictEqual(removedCount, 2);

    // Prüfen, welche Sessions noch existieren
    const remainingTestSessions = db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.userId, testUserId))
      .all();

    assert.strictEqual(remainingTestSessions.length, 1);
    assert.strictEqual(remainingTestSessions[0].id, activeSessionId);

    // Prüfen, dass fremde Sessions unberührt geblieben sind
    const foreignSessions = db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.userId, otherUserId))
      .all();

    assert.strictEqual(foreignSessions.length, 1);
    assert.strictEqual(foreignSessions[0].id, foreignSessionId);
  });

  it("löscht alle Sessions des Benutzers, wenn kein keepSessionId angegeben wird", () => {
    const session1Id = `sess-all-1-${crypto.randomUUID()}`;
    const session2Id = `sess-all-2-${crypto.randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86400000);

    db.insert(sessionTable)
      .values([
        {
          id: session1Id,
          userId: testUserId,
          token: `token-${session1Id}`,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: session2Id,
          userId: testUserId,
          token: `token-${session2Id}`,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    const removedCount = revokeOtherUserSessions(testUserId, null);
    assert.strictEqual(removedCount, 2);

    const remaining = db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.userId, testUserId))
      .all();
    assert.strictEqual(remaining.length, 0);
  });
});
