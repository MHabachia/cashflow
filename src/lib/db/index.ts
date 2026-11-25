import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";
import { applyPendingRestore } from "./restore";
import { runMigrations } from "./migrations";

const dbPath = process.env.DATABASE_PATH || "./data/app.db";

// Sicherstellen, dass das Verzeichnis (/data oder ./data) existiert
const dbDir = path.dirname(path.resolve(dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const globalForDb = globalThis as unknown as {
  sqlite: Database.Database | undefined;
  tablesInitialized?: boolean;
};

// Vorgemerkte Wiederherstellung einspielen, bevor die Verbindung geöffnet wird
if (!globalForDb.sqlite && process.env.NEXT_PHASE !== "phase-production-build") {
  applyPendingRestore(path.resolve(dbPath));
}

export const sqlite =
  globalForDb.sqlite ??
  new Database(dbPath, {
    timeout: 30000,
  });

// SQLite Performance & Integritäts-Pragmas
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("busy_timeout = 30000");

globalForDb.sqlite = sqlite;

export const db = drizzle(sqlite, { schema });

// Bringt das Schema über versionierte Migrationen auf den aktuellen Stand (siehe migrations.ts)
export function ensureDatabaseTables() {
  if (globalForDb.tablesInitialized) return;
  // Während des Next.js Docker/Production-Builds (Page Data Collection) keine DDL ausführen
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  try {
    runMigrations(sqlite);
    globalForDb.tablesInitialized = true;
  } catch (err: unknown) {
    const sqliteErr = err as { code?: string; message?: string };
    if (sqliteErr?.code === "SQLITE_BUSY" || sqliteErr?.code === "SQLITE_LOCKED") {
      console.warn("SQLite busy during ensureDatabaseTables, skipping initial execution:", sqliteErr.message);
      return;
    }
    throw err;
  }
}

if (process.env.NEXT_PHASE !== "phase-production-build") {
  ensureDatabaseTables();
}
