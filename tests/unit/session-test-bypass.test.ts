import { it } from "node:test";
import assert from "node:assert/strict";

it("TEST_USER_ID wirkt nur bei NODE_ENV=test", async () => {
  const { getCurrentSession } = await import("../../src/lib/session");
  const savedEnv = process.env.NODE_ENV;
  const savedUser = process.env.TEST_USER_ID;
  process.env.TEST_USER_ID = "should-not-authenticate";
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    // Ohne Request-Kontext wirft headers(); entscheidend ist, dass KEINE Test-Session entsteht
    const session = await getCurrentSession().catch(() => null);
    assert.notEqual(session?.user?.id, "should-not-authenticate");
  } finally {
    (process.env as Record<string, string>).NODE_ENV = savedEnv as string;
    if (savedUser === undefined) delete process.env.TEST_USER_ID;
    else process.env.TEST_USER_ID = savedUser;
  }
});
