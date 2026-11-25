#!/usr/bin/env node
/**
 * Notfall-Zugang: erzeugt einen Einmal-Link zum Zurücksetzen des Passworts.
 * Gedacht für den Fall, dass sich der (einzige) Admin ausgesperrt hat.
 *
 * Docker (als App-Benutzer ausführen, damit Dateirechte der DB stimmen):
 *   docker exec -u nextjs cashflow-app node reset-password.mjs admin@example.com
 * Lokal:
 *   node scripts/reset-password.mjs admin@example.com
 *
 * Der Link ist 1 Stunde gültig und nur einmal verwendbar.
 */
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Aufruf: node reset-password.mjs <E-Mail-Adresse>");
  process.exit(1);
}

if (typeof process.getuid === "function" && process.getuid() === 0 && !process.argv.includes("--allow-root")) {
  console.error(
    "Bitte nicht als root ausführen (die Datenbank-Dateien würden root gehören).\n" +
      "Docker: docker exec -u nextjs cashflow-app node reset-password.mjs " + email
  );
  process.exit(1);
}

const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/app.db");
const db = new Database(dbPath, { fileMustExist: true, timeout: 10000 });
db.pragma("busy_timeout = 10000");

try {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'")
    .get();
  if (!hasTable) {
    console.error("Die Datenbank ist noch nicht migriert. Bitte die App einmal starten.");
    process.exit(1);
  }

  const user = db.prepare("SELECT id, email FROM user WHERE lower(email) = ?").get(email);
  if (!user) {
    console.error(`Kein Benutzer mit der E-Mail-Adresse ${email} gefunden.`);
    process.exit(1);
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const nowSec = Math.floor(Date.now() / 1000);

  db.transaction(() => {
    db.prepare(
      "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
    ).run(nowSec, user.id);
    db.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, purpose, created_by, expires_at, created_at)
       VALUES (?, ?, ?, 'cli', NULL, ?, ?)`
    ).run(crypto.randomUUID(), user.id, tokenHash, nowSec + 3600, nowSec);
    db.prepare(
      `INSERT INTO audit_log (id, created_at, user_id, actor_id, action, target, details)
       VALUES (?, ?, ?, NULL, 'admin.user.password_reset', ?, ?)`
    ).run(crypto.randomUUID(), Date.now(), user.id, user.email, JSON.stringify({ method: "cli" }));
  })();

  const base = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Einmal-Link für ${user.email} (1 Stunde gültig):\n`);
  console.log(`${base}/reset-password?token=${encodeURIComponent(token)}\n`);
} finally {
  db.close();
}
