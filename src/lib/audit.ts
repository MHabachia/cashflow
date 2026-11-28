import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { desc, lt } from "drizzle-orm";
import crypto from "node:crypto";

/**
 * Protokoll sicherheitsrelevanter Aktionen (Anmeldungen, Admin-Aktionen,
 * Bankverbindungen, Backups). Schreibfehler dürfen die eigentliche Aktion
 * nie abbrechen.
 */
export type AuditAction =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.login.locked"
  | "auth.signup.blocked"
  | "auth.register"
  | "auth.password.change"
  | "auth.email.change"
  | "auth.sessions.revoke"
  | "auth.password.reset"
  | "auth.password.reset_failed"
  | "auth.recovery_codes.generate"
  | "admin.user.create"
  | "admin.user.role"
  | "admin.user.ban"
  | "admin.user.unban"
  | "admin.user.password_reset"
  | "admin.user.delete"
  | "admin.settings.update"
  | "admin.invite.create"
  | "admin.invite.delete"
  | "admin.backup.download"
  | "admin.backup.create"
  | "admin.backup.verify"
  | "admin.backup.restore_staged"
  | "bank.connect"
  | "bank.disconnect"
  | "bank.revoke"
  | "bank.consent_expired";

export interface AuditEntryInput {
  action: AuditAction;
  /** Betroffener Benutzer */
  userId?: string | null;
  /** Ausführender Benutzer (z. B. Admin), falls abweichend */
  actorId?: string | null;
  target?: string | null;
  details?: Record<string, unknown> | null;
  headers?: Headers | null;
}

export const AUDIT_RETENTION_DAYS = 365;

function clientIp(headers?: Headers | null): string | null {
  if (!headers) return null;
  const raw =
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0];
  return raw ? raw.trim().slice(0, 64) : null;
}

export function logAudit(entry: AuditEntryInput): void {
  try {
    db.insert(auditLog)
      .values({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        userId: entry.userId ?? null,
        actorId: entry.actorId ?? entry.userId ?? null,
        action: entry.action,
        target: entry.target ? entry.target.slice(0, 200) : null,
        ipAddress: clientIp(entry.headers),
        userAgent: entry.headers?.get("user-agent")?.slice(0, 300) ?? null,
        details: entry.details ? JSON.stringify(entry.details).slice(0, 2000) : null,
      })
      .run();
  } catch (err) {
    console.warn("[Audit] Eintrag konnte nicht geschrieben werden:", err);
  }
}

export function getRecentAuditEntries(limit = 200) {
  return db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 1000))
    .all();
}

/** Entfernt Einträge, die älter als die Aufbewahrungsfrist sind. */
export function pruneAuditLog(retentionDays = AUDIT_RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - retentionDays * 86400000);
  return db.delete(auditLog).where(lt(auditLog.createdAt, cutoff)).run().changes;
}
