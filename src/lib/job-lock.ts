import { sqlite } from "@/lib/db";
import crypto from "node:crypto";

/**
 * Einfache Sperre in der Datenbank für Hintergrundjobs.
 * Verhindert, dass derselbe Job parallel läuft – auch über Prozessgrenzen
 * hinweg (z. B. mehrere Next.js-Worker, Cron-Aufruf während des Schedulers).
 * Die Sperre läuft nach `ttlMs` automatisch ab, falls ein Prozess abstürzt.
 */
export function tryAcquireJobLock(name: string, ttlMs: number): string | null {
  const owner = `${process.pid}-${crypto.randomUUID()}`;
  const now = Date.now();
  const result = sqlite
    .prepare(
      `INSERT INTO job_locks (name, owner, locked_until) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, locked_until = excluded.locked_until
       WHERE job_locks.locked_until < ?`
    )
    .run(name, owner, now + ttlMs, now);
  return result.changes === 1 ? owner : null;
}

export function releaseJobLock(name: string, owner: string): void {
  sqlite.prepare("DELETE FROM job_locks WHERE name = ? AND owner = ?").run(name, owner);
}

/**
 * Führt `fn` nur aus, wenn die Sperre frei ist. Gibt `{ skipped: true }` zurück,
 * wenn bereits ein anderer Lauf aktiv ist.
 */
export async function withJobLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T> | T
): Promise<{ skipped: true } | { skipped: false; result: T }> {
  const owner = tryAcquireJobLock(name, ttlMs);
  if (!owner) return { skipped: true };
  try {
    return { skipped: false, result: await fn() };
  } finally {
    releaseJobLock(name, owner);
  }
}
