import { db } from "../db";
import { bankAccounts } from "../db/schema";
import { syncAllActiveBankAccounts } from "./sync-engine";
import { eq } from "drizzle-orm";
import { withJobLock } from "../job-lock";

// Obergrenze für einen Sync-Lauf; danach gilt eine hängengebliebene Sperre als frei
const BANK_SYNC_LOCK_TTL_MS = 30 * 60 * 1000;

let schedulerTimer: NodeJS.Timeout | null = null;
let isSyncRunning = false;

export interface BackgroundSyncResult {
  processedUsers: number;
  totalImported: number;
  totalSkipped: number;
  errors: string[];
}

/**
 * Führt einen Synchronisationslauf für alle Benutzer durch,
 * die mindestens ein aktives Bankkonto mit aktiviertem autoSync besitzen.
 */
export async function runBackgroundBankSync(): Promise<BackgroundSyncResult> {
  const busy: BackgroundSyncResult = {
    processedUsers: 0,
    totalImported: 0,
    totalSkipped: 0,
    errors: ["Ein Bank-Sync-Lauf ist bereits im Gange."],
  };
  if (isSyncRunning) return busy;

  isSyncRunning = true;
  try {
    // Sperre auch prozessübergreifend (Cron-Endpunkt + Scheduler, mehrere Worker)
    const locked = await withJobLock("bank-sync", BANK_SYNC_LOCK_TTL_MS, async () => {
      const accounts = db
        .select({ userId: bankAccounts.userId })
        .from(bankAccounts)
        .where(eq(bankAccounts.autoSync, true))
        .all();

      const userIds = Array.from(new Set(accounts.map((a) => a.userId)));
      let totalImported = 0;
      let totalSkipped = 0;
      const errors: string[] = [];

      for (const uid of userIds) {
        try {
          const res = await syncAllActiveBankAccounts(uid, { unattended: true });
          totalImported += res.totalImported;
          totalSkipped += res.totalSkipped;
          if (res.errors.length > 0) {
            errors.push(...res.errors);
          }
        } catch (err) {
          errors.push((err as Error)?.message || `Fehler bei Benutzer ${uid}`);
        }
      }

      return {
        processedUsers: userIds.length,
        totalImported,
        totalSkipped,
        errors,
      };
    });
    return locked.skipped ? busy : locked.result;
  } finally {
    isSyncRunning = false;
  }
}

/**
 * Startet den periodischen Hintergrund-Scheduler für den automatischen Bank-Sync.
 * Konfigurierbar über:
 * - BANK_SYNC_INTERVAL_MINUTES (Standard: 360 Minuten / 6 Stunden)
 * - BANK_SYNC_AUTO_ENABLED (Standard: true, "false" zum Deaktivieren)
 */
export function startBankSyncScheduler(options?: { force?: boolean }): boolean {
  if (process.env.BANK_SYNC_AUTO_ENABLED === "false") {
    return false;
  }

  // Weder während Tests noch während des Next.js Builds einen aktiven Timer starten
  if (
    !options?.force &&
    (process.env.NODE_ENV === "test" ||
      process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.npm_lifecycle_event === "build")
  ) {
    return false;
  }

  if (schedulerTimer) {
    return true; // Bereits aktiv
  }

  // Standard 6 Stunden = 4 Läufe pro Tag (PSD2-Grenze für Abrufe ohne Nutzer)
  const intervalMinutes = Number(process.env.BANK_SYNC_INTERVAL_MINUTES) || 360;
  const intervalMs = Math.max(intervalMinutes, 15) * 60 * 1000;

  schedulerTimer = setInterval(async () => {
    try {
      await runBackgroundBankSync();
    } catch (err) {
      console.error("[BankSyncScheduler] Fehler im automatischen Sync-Lauf:", err);
    }
  }, intervalMs);

  // Timer unref damit er das Beenden des Prozesses nicht blockiert
  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }

  return true;
}

export function stopBankSyncScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
