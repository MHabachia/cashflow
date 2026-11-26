import { auth, resetLoginFailures } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  account as accountTable,
  passwordResetTokens,
  recoveryCodes,
  session as sessionTable,
  user as userTable,
} from "@/lib/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import crypto from "node:crypto";

/**
 * Passwort-Wiederherstellung ohne E-Mail-Versand:
 * 1. Einmal-Link, den ein Admin erzeugt und über einen beliebigen Kanal weitergibt
 * 2. Wiederherstellungscodes, die der Nutzer vorab ausdruckt/speichert
 * 3. Einmal-Link per Befehl auf dem Server (scripts/reset-password.mjs) – für
 *    den Fall, dass sich der einzige Admin ausgesperrt hat
 *
 * Tokens und Codes werden nur als Hash gespeichert.
 */

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };
export const RESET_TOKEN_TTL_HOURS = 24;
export const RECOVERY_CODE_COUNT = 8;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // ohne 0/O, 1/I/L

export function validateNewPassword(password: string): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen lang sein.`;
  }
  return null;
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------- Reset-Links ----------------

export function createPasswordResetToken(
  userId: string,
  options: { purpose: "admin_link" | "cli"; createdBy?: string | null; ttlHours?: number } = {
    purpose: "admin_link",
  }
): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  db.transaction((tx) => {
    // Ältere, noch offene Links dieses Nutzers ungültig machen
    tx.update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)))
      .run();
    tx.insert(passwordResetTokens)
      .values({
        id: crypto.randomUUID(),
        userId,
        tokenHash: hashResetToken(token),
        purpose: options.purpose,
        createdBy: options.createdBy ?? null,
        expiresAt: new Date(now.getTime() + (options.ttlHours ?? RESET_TOKEN_TTL_HOURS) * 3600 * 1000),
        createdAt: now,
      })
      .run();
  });
  return token;
}

/** Prüft einen Link, ohne ihn zu verbrauchen (für die Anzeige der Reset-Seite). */
export function inspectResetToken(token: string): { userId: string; email: string } | null {
  if (!token || token.length > 200) return null;
  const row = db
    .select({ userId: passwordResetTokens.userId, email: userTable.email })
    .from(passwordResetTokens)
    .innerJoin(userTable, eq(userTable.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashResetToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date())
      )
    )
    .get();
  return row ?? null;
}

/** Verbraucht einen Link atomar; liefert die Benutzer-ID oder null. */
export function consumeResetToken(token: string): string | null {
  if (!token || token.length > 200) return null;
  const row = db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashResetToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date())
      )
    )
    .returning({ userId: passwordResetTokens.userId })
    .get();
  return row?.userId ?? null;
}

// ---------------- Passwort setzen ----------------

export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  if (!password) return false;
  const credential = db
    .select({ password: accountTable.password })
    .from(accountTable)
    .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, "credential")))
    .get();
  if (!credential?.password) return false;
  const ctx = await auth.$context;
  return ctx.password.verify({ hash: credential.password, password });
}

export function userHasPassword(userId: string): boolean {
  return Boolean(
    db
      .select({ id: accountTable.id })
      .from(accountTable)
      .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, "credential")))
      .get()
  );
}

/**
 * Setzt ein neues Passwort (legt das Passwort-Konto an, falls der Nutzer bisher
 * nur Passkeys hatte) und beendet alle Sitzungen des Nutzers.
 */
export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(newPassword);
  const now = new Date();
  const user = db.select({ email: userTable.email }).from(userTable).where(eq(userTable.id, userId)).get();

  db.transaction((tx) => {
    const updated = tx
      .update(accountTable)
      .set({ password: hash, updatedAt: now })
      .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, "credential")))
      .run();
    if (updated.changes === 0) {
      tx.insert(accountTable)
        .values({
          id: crypto.randomUUID(),
          accountId: userId,
          providerId: "credential",
          userId,
          password: hash,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    tx.delete(sessionTable).where(eq(sessionTable.userId, userId)).run();
  });

  if (user?.email) resetLoginFailures(user.email);
}

// ---------------- Wiederherstellungscodes ----------------

function randomCode(): string {
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return (input || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function hashCode(normalized: string, salt: Buffer = crypto.randomBytes(16)): string {
  const derived = crypto.scryptSync(normalized, salt, 32, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function codeMatches(normalized: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const derived = crypto.scryptSync(normalized, Buffer.from(saltHex, "hex"), 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

/** Erzeugt neue Codes (alte werden ungültig) und gibt sie einmalig im Klartext zurück. */
export function generateRecoveryCodes(userId: string): string[] {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
  const now = new Date();
  db.transaction((tx) => {
    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
    for (const code of codes) {
      tx.insert(recoveryCodes)
        .values({
          id: crypto.randomUUID(),
          userId,
          codeHash: hashCode(normalizeRecoveryCode(code)),
          createdAt: now,
        })
        .run();
    }
  });
  return codes;
}

export function countRemainingRecoveryCodes(userId: string): number {
  return db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
    .all().length;
}

/** Prüft einen Code und markiert ihn bei Erfolg als verbraucht. */
export function consumeRecoveryCode(userId: string, input: string): boolean {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== 10) return false;
  const open = db
    .select()
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
    .all();
  const match = open.find((c) => codeMatches(normalized, c.codeHash));
  if (!match) return false;
  const res = db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.id, match.id), isNull(recoveryCodes.usedAt)))
    .run();
  return res.changes === 1;
}
