import { sqlite } from "@/lib/db";
import { UserFacingError } from "@/lib/errors";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Automatische Datenbank-Sicherungen.
 *
 * - Konsistenter Snapshot über die SQLite-Backup-API, gzip-komprimiert.
 * - Optional verschlüsselt (AES-256-GCM) mit BACKUP_ENCRYPTION_KEY.
 * - Aufbewahrung der letzten BACKUP_RETENTION_COUNT Dateien (Standard 14).
 * - Intervall BACKUP_INTERVAL_HOURS (Standard 24), abschaltbar mit
 *   AUTO_BACKUP_ENABLED=false.
 *
 * Belegfotos (uploads/) sind nicht enthalten – siehe README.
 */

const FILE_PATTERN = /^cashflow-(\d{8}-\d{6})\.sqlite\.gz(\.enc)?$/;
const ENC_MAGIC = Buffer.from("CFBK1");

export interface AutoBackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: Date;
  encrypted: boolean;
}

export function getBackupDir(): string {
  if (process.env.BACKUP_DIR) return path.resolve(process.env.BACKUP_DIR);
  const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/app.db");
  return path.join(path.dirname(dbPath), "backups");
}

function isEnabled(): boolean {
  return process.env.AUTO_BACKUP_ENABLED !== "false";
}

function intervalMs(): number {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600 * 1000;
}

function retentionCount(): number {
  const n = Number(process.env.BACKUP_RETENTION_COUNT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 14;
}

function encryptionKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (raw.length < 32) {
    throw new UserFacingError("BACKUP_ENCRYPTION_KEY muss mindestens 32 Zeichen lang sein.");
  }
  return Buffer.from(crypto.hkdfSync("sha256", raw, "cashflow-backup", "backup-v1", 32));
}

export function encryptBackup(data: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([ENC_MAGIC, iv, cipher.getAuthTag(), ct]);
}

export function decryptBackup(data: Buffer, key: Buffer): Buffer {
  if (!data.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
    throw new UserFacingError("Unbekanntes Format der verschlüsselten Sicherung.");
  }
  const offset = ENC_MAGIC.length;
  const iv = data.subarray(offset, offset + 12);
  const tag = data.subarray(offset + 12, offset + 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(offset + 28)), decipher.final()]);
}

function timestamp(date: Date): string {
  const iso = date.toISOString(); // 2026-11-24T21:23:21.000Z
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

export function listAutoBackups(dir: string = getBackupDir()): AutoBackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => FILE_PATTERN.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return {
        name,
        sizeBytes: stat.size,
        createdAt: stat.mtime,
        encrypted: name.endsWith(".enc"),
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function pruneBackups(dir: string) {
  const keep = retentionCount();
  for (const old of listAutoBackups(dir).slice(keep)) {
    fs.unlinkSync(path.join(dir, old.name));
  }
}

/**
 * Erstellt eine Sicherung, wenn die letzte älter als das Intervall ist
 * (oder sofort mit `force`). Gibt den Dateinamen zurück oder null.
 */
export async function runAutoBackup(options: { force?: boolean; now?: Date } = {}): Promise<string | null> {
  if (!isEnabled() && !options.force) return null;
  const now = options.now ?? new Date();
  const dir = getBackupDir();

  const latest = listAutoBackups(dir)[0];
  if (!options.force && latest && now.getTime() - latest.createdAt.getTime() < intervalMs()) {
    return null;
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpSnapshot = path.join(os.tmpdir(), `cashflow-auto-${crypto.randomUUID()}.sqlite`);
  try {
    await sqlite.backup(tmpSnapshot);
    let payload: Buffer = zlib.gzipSync(fs.readFileSync(tmpSnapshot), { level: 9 });
    const key = encryptionKey();
    if (key) payload = encryptBackup(payload, key);

    const name = `cashflow-${timestamp(now)}.sqlite.gz${key ? ".enc" : ""}`;
    const target = path.join(dir, name);
    const partial = `${target}.partial`;
    fs.writeFileSync(partial, payload, { mode: 0o600 });
    fs.renameSync(partial, target);
    pruneBackups(dir);
    return name;
  } finally {
    if (fs.existsSync(tmpSnapshot)) fs.unlinkSync(tmpSnapshot);
  }
}

/**
 * Liefert eine automatische Sicherung als rohe SQLite-Datei (entschlüsselt,
 * entpackt) – geeignet für den Download und die Wiederherstellung.
 */
export function readAutoBackupAsSqlite(name: string, dir: string = getBackupDir()): Buffer {
  if (!FILE_PATTERN.test(name) || path.basename(name) !== name) {
    throw new UserFacingError("Ungültiger Dateiname.");
  }
  let data: Buffer = fs.readFileSync(path.join(dir, name));
  if (name.endsWith(".enc")) {
    const key = encryptionKey();
    if (!key) throw new UserFacingError("BACKUP_ENCRYPTION_KEY fehlt zum Entschlüsseln.");
    data = decryptBackup(data, key);
  }
  return zlib.gunzipSync(data);
}
