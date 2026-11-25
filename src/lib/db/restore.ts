import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Sichere Datenbank-Wiederherstellung.
 *
 * Eine hochgeladene Sicherung wird nie im laufenden Betrieb über die geöffnete
 * SQLite-Datei kopiert (das kann die Datenbank zerstören). Stattdessen:
 *   1. `stageRestore()` prüft die Datei (Integrität, Schema, keine Trigger/Views)
 *      und legt sie als `<db>.restore-pending` ab.
 *   2. Beim nächsten Prozessstart ruft `db/index.ts` vor dem Öffnen der
 *      Verbindung `applyPendingRestore()` auf: aktuelle DB wird gecheckpointet,
 *      als `<db>.bak-<timestamp>` gesichert und die vorgemerkte Datei atomar
 *      per `rename` eingesetzt.
 */

export const MAX_RESTORE_BYTES = 512 * 1024 * 1024; // 512 MB
const KEEP_BACKUP_COUNT = 3;
const REQUIRED_TABLES = ["user", "session", "account", "categories", "transactions"];

export function getDatabasePath(): string {
  return path.resolve(process.env.DATABASE_PATH || "./data/app.db");
}

function pendingPathFor(dbPath: string): string {
  return `${dbPath}.restore-pending`;
}

function removeSidecarFiles(filePath: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${filePath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
}

export function validateBackupDatabase(filePath: string): {
  valid: boolean;
  error?: string;
} {
  let conn: Database.Database | null = null;
  try {
    conn = new Database(filePath, { readonly: true, fileMustExist: true });
    // Keine Funktionen aus dem (nicht vertrauenswürdigen) Schema ausführen
    conn.pragma("trusted_schema = OFF");

    const integrity = conn.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      return { valid: false, error: "Die Sicherung ist beschädigt (integrity_check fehlgeschlagen)." };
    }

    const objects = conn
      .prepare("SELECT type, name FROM sqlite_master")
      .all() as Array<{ type: string; name: string }>;

    const forbidden = objects.find((o) => o.type === "trigger" || o.type === "view");
    if (forbidden) {
      return {
        valid: false,
        error: `Die Sicherung enthält ein unerwartetes Objekt (${forbidden.type} „${forbidden.name}“).`,
      };
    }

    const tableNames = new Set(
      objects.filter((o) => o.type === "table").map((o) => o.name)
    );
    const missing = REQUIRED_TABLES.filter((t) => !tableNames.has(t));
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Keine gültige Cashflow-Sicherung (fehlende Tabellen: ${missing.join(", ")}).`,
      };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `Sicherung konnte nicht gelesen werden: ${(err as Error)?.message || "unbekannter Fehler"}`,
    };
  } finally {
    conn?.close();
  }
}

/**
 * Prüft die hochgeladene Sicherung und merkt sie für den nächsten Start vor.
 */
export function stageRestore(
  buffer: Buffer,
  dbPath: string = getDatabasePath()
): { success: boolean; error?: string } {
  if (buffer.length > MAX_RESTORE_BYTES) {
    return { success: false, error: "Die Sicherung ist zu groß." };
  }
  if (!buffer.subarray(0, 16).toString("utf8").startsWith("SQLite format 3")) {
    return {
      success: false,
      error: "Ungültiges Dateiformat. Es muss eine valide .sqlite Datei sein.",
    };
  }

  const pendingPath = pendingPathFor(dbPath);
  const tempPath = `${pendingPath}.tmp`;

  try {
    fs.writeFileSync(tempPath, buffer, { mode: 0o600 });
    const validation = validateBackupDatabase(tempPath);
    removeSidecarFiles(tempPath);

    if (!validation.valid) {
      fs.unlinkSync(tempPath);
      return { success: false, error: validation.error };
    }

    fs.renameSync(tempPath, pendingPath);
    return { success: true };
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    removeSidecarFiles(tempPath);
    return {
      success: false,
      error: (err as Error)?.message || "Sicherung konnte nicht vorgemerkt werden.",
    };
  }
}

export function hasPendingRestore(dbPath: string = getDatabasePath()): boolean {
  return fs.existsSync(pendingPathFor(dbPath));
}

function pruneOldBackups(dbPath: string) {
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.bak-`;
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .sort()
    .reverse();
  for (const old of backups.slice(KEEP_BACKUP_COUNT)) {
    fs.unlinkSync(path.join(dir, old));
  }
}

/**
 * Spielt eine vorgemerkte Sicherung ein. Muss aufgerufen werden, BEVOR die
 * Anwendung eine Verbindung zu `dbPath` öffnet.
 */
export function applyPendingRestore(dbPath: string = getDatabasePath()): boolean {
  const pendingPath = pendingPathFor(dbPath);
  if (!fs.existsSync(pendingPath)) return false;

  const backupPath = `${dbPath}.bak-${Date.now()}`;
  let movedCurrent = false;

  try {
    if (fs.existsSync(dbPath)) {
      // WAL-Inhalt in die Hauptdatei schreiben, damit die Sicherung vollständig ist
      const current = new Database(dbPath);
      try {
        current.pragma("wal_checkpoint(TRUNCATE)");
      } finally {
        current.close();
      }
      fs.renameSync(dbPath, backupPath);
      movedCurrent = true;
      removeSidecarFiles(dbPath);
    }

    fs.renameSync(pendingPath, dbPath);
    pruneOldBackups(dbPath);
    console.log(
      `[Restore] Sicherung eingespielt.${movedCurrent ? ` Vorheriger Stand: ${path.basename(backupPath)}` : ""}`
    );
    return true;
  } catch (err) {
    console.error("[Restore] Wiederherstellung fehlgeschlagen:", err);
    // Vorherigen Stand zurückholen, falls er bereits verschoben wurde
    if (movedCurrent && !fs.existsSync(dbPath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, dbPath);
    }
    return false;
  }
}
