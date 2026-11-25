import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export interface BackupVerifyResult {
  ok: boolean;
  integrity: string;
  tables: Record<string, number>;
  error?: string;
}

const COUNTED_TABLES = ["user", "transactions", "categories", "recurring_expenses", "bank_accounts"];

/**
 * Prüft eine rohe SQLite-Sicherung, ohne die Live-Datenbank anzufassen:
 * Die Datei wird in ein temporäres Verzeichnis geschrieben, schreibgeschützt
 * geöffnet, mit `PRAGMA integrity_check` geprüft und danach gelöscht.
 */
export function verifySqliteBackup(sqlite: Buffer): BackupVerifyResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-backup-check-"));
  const file = path.join(dir, "check.db");
  try {
    fs.writeFileSync(file, sqlite, { mode: 0o600 });
    const check = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const row = check.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
      const integrity = row?.integrity_check ?? "unbekannt";
      const tables: Record<string, number> = {};
      for (const t of COUNTED_TABLES) {
        try {
          const r = check.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number };
          tables[t] = r.n;
        } catch {
          // Tabelle fehlt (z. B. sehr alte Sicherung) – wird als fehlend gemeldet
        }
      }
      const hasCore = "user" in tables && "transactions" in tables;
      return {
        ok: integrity === "ok" && hasCore,
        integrity,
        tables,
        error: hasCore ? undefined : "Kerntabellen fehlen in der Sicherung.",
      };
    } finally {
      check.close();
    }
  } catch (err) {
    return { ok: false, integrity: "fehler", tables: {}, error: (err as Error).message };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
