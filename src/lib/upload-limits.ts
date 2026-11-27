import fs from "node:fs";
import path from "node:path";

/** Spielraum für Multipart-Grenzen und Feldnamen über der eigentlichen Datei. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Prüft die angekündigte Größe einer Upload-Anfrage, bevor `formData()` den
 * ganzen Body in den Speicher liest. Browser senden bei FormData immer eine
 * Content-Length; fehlt sie (z. B. chunked), wird die Anfrage abgelehnt.
 * Gibt eine Fehlermeldung zurück oder `null`, wenn die Größe passt.
 */
export function checkDeclaredUploadSize(
  headers: Headers,
  maxFileBytes: number
): { status: 411 | 413; error: string } | null {
  const raw = headers.get("content-length");
  if (raw === null || raw.trim() === "") {
    return { status: 411, error: "Die Größe des Uploads fehlt." };
  }
  const declared = Number(raw);
  if (!Number.isFinite(declared) || declared < 0) {
    return { status: 411, error: "Die Größe des Uploads fehlt." };
  }
  if (declared > maxFileBytes + MULTIPART_OVERHEAD_BYTES) {
    return { status: 413, error: "Die Datei ist zu groß." };
  }
  return null;
}

const DEFAULT_RECEIPTS_QUOTA_MB = 500;

/** Speicherkontingent für Belegfotos je Benutzer aus RECEIPTS_QUOTA_MB (0 = unbegrenzt). */
export function receiptsQuotaBytes(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.RECEIPTS_QUOTA_MB?.trim();
  const mb = raw ? Number(raw) : DEFAULT_RECEIPTS_QUOTA_MB;
  if (!Number.isFinite(mb) || mb < 0) return DEFAULT_RECEIPTS_QUOTA_MB * 1024 * 1024;
  return mb * 1024 * 1024;
}

/** Summe der Dateigrößen in einem Verzeichnis (nicht rekursiv); 0, wenn es fehlt. */
export function directorySizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) total += fs.statSync(path.join(dir, entry.name)).size;
  }
  return total;
}
