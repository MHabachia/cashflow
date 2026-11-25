import fs from "node:fs";
import { db } from "@/lib/db";
import { connectedBanks, user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { listAutoBackups } from "@/lib/backup-scheduler";

export type HealthLevel = "ok" | "warn";

export interface HealthCheck {
  id: string;
  label: string;
  detail: string;
  level: HealthLevel;
}

export interface BankHealthRow {
  userLabel: string;
  institution: string;
  status: string;
  lastSyncedAt: string | null;
  consentExpiresAt: string;
  daysLeft: number;
}

const DAY = 86400000;

export function getBankHealth(now: Date = new Date()): BankHealthRow[] {
  const rows = db
    .select({
      email: user.email,
      institution: connectedBanks.institutionName,
      status: connectedBanks.status,
      lastSyncedAt: connectedBanks.lastSyncedAt,
      consentExpiresAt: connectedBanks.consentExpiresAt,
    })
    .from(connectedBanks)
    .innerJoin(user, eq(user.id, connectedBanks.userId))
    .all();
  return rows
    .map((r) => ({
      userLabel: r.email,
      institution: r.institution,
      status: r.status,
      lastSyncedAt: r.lastSyncedAt,
      consentExpiresAt: r.consentExpiresAt,
      daysLeft: Math.ceil((new Date(r.consentExpiresAt).getTime() - now.getTime()) / DAY),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function getHealthChecks(now: Date = new Date()): HealthCheck[] {
  const checks: HealthCheck[] = [];

  // Sicherungen
  const backups = listAutoBackups();
  if (backups.length === 0) {
    checks.push({ id: "backup", label: "Sicherung", detail: "Noch keine automatische Sicherung vorhanden.", level: "warn" });
  } else {
    const ageDays = Math.floor((now.getTime() - backups[0].createdAt.getTime()) / DAY);
    checks.push({
      id: "backup",
      label: "Sicherung",
      detail: ageDays === 0 ? "Letzte Sicherung von heute." : `Letzte Sicherung vor ${ageDays} ${ageDays === 1 ? "Tag" : "Tagen"}.`,
      level: ageDays > 3 ? "warn" : "ok",
    });
  }

  // Speicherplatz
  try {
    const dbPath = process.env.DATABASE_PATH || "./data/cashflow.db";
    const stat = fs.statfsSync(fs.existsSync(dbPath) ? dbPath : ".");
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const freeGb = freeBytes / 1024 ** 3;
    checks.push({
      id: "disk",
      label: "Freier Speicher",
      detail: `${freeGb.toFixed(1).replace(".", ",")} GB frei.`,
      level: freeGb < 1 ? "warn" : "ok",
    });
  } catch {
    // statfs nicht verfügbar – Prüfung entfällt
  }

  // Bankverbindungen
  const banks = getBankHealth(now);
  const expiring = banks.filter((b) => b.status === "active" && b.daysLeft <= 7);
  const broken = banks.filter((b) => b.status === "error" || b.status === "expired");
  if (banks.length > 0) {
    checks.push({
      id: "banks",
      label: "Bankverbindungen",
      detail:
        expiring.length + broken.length === 0
          ? `${banks.length} aktiv, keine läuft in den nächsten 7 Tagen ab.`
          : [
              expiring.length > 0 ? `${expiring.length} Zustimmung(en) laufen bald ab` : null,
              broken.length > 0 ? `${broken.length} mit Fehler oder abgelaufen` : null,
            ]
              .filter(Boolean)
              .join(", ") + ".",
      level: expiring.length + broken.length === 0 ? "ok" : "warn",
    });
  }

  return checks;
}
