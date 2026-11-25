import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "../../src/lib/db";
import { user as userTable } from "../../src/lib/db/schema";
import { auth } from "../../src/lib/auth";
import { runWithSignUpAllowed } from "../../src/lib/signup-guard";
import { POST } from "../../src/app/api/auth/[...all]/route";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

describe("Registrierung nur über freigegebene Serverpfade", () => {
  before(() => {
    // Sicherstellen, dass bereits ein Benutzer existiert (kein "erster Benutzer")
    const id = `existing-${crypto.randomUUID()}`;
    db.insert(userTable)
      .values({
        id,
        name: "Existing",
        email: `${id}@example.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  it("sperrt den öffentlichen Endpunkt POST /api/auth/sign-up/email", async () => {
    const email = `bypass-${crypto.randomUUID()}@example.local`;
    const req = new NextRequest("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Bypass", email, password: "Passwort123!" }),
    });
    const res = await POST(req);
    assert.equal(res.status, 403);
    const created = db.select().from(userTable).where(eq(userTable.email, email)).get();
    assert.equal(created, undefined);
  });

  it("verhindert auth.api.signUpEmail ohne Freigabe", async () => {
    const email = `direct-${crypto.randomUUID()}@example.local`;
    await assert.rejects(
      auth.api.signUpEmail({ body: { name: "Direct", email, password: "Passwort123!" } })
    );
    const created = db.select().from(userTable).where(eq(userTable.email, email)).get();
    assert.equal(created, undefined);
  });

  it("erlaubt die Anlage innerhalb von runWithSignUpAllowed", async () => {
    const email = `allowed-${crypto.randomUUID()}@example.local`;
    const res = await runWithSignUpAllowed(() =>
      auth.api.signUpEmail({ body: { name: "Allowed", email, password: "Passwort123!" } })
    );
    assert.ok(res?.user?.id);
    const created = db.select().from(userTable).where(eq(userTable.email, email)).get();
    assert.equal(created?.role, "user");
  });
});
