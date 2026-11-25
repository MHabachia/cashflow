"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatabaseBackup, Download, Loader2, Lock } from "lucide-react";
import { createBackupNowAction, verifyBackupAction } from "@/actions/admin-actions";

export interface AutoBackupRow {
  name: string;
  sizeBytes: number;
  createdAt: string;
  encrypted: boolean;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AutoBackupSection({
  backups,
  backupDir,
  enabled,
}: {
  backups: AutoBackupRow[];
  backupDir: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function handleVerify(name: string) {
    setVerifying(name);
    const res = await verifyBackupAction(name);
    setVerifying(null);
    if (!res.success) {
      setResults((r) => ({ ...r, [name]: { ok: false, text: res.error } }));
      return;
    }
    const { result } = res;
    const counts = Object.entries(result.tables)
      .map(([t, n]) => `${n} ${t}`)
      .join(", ");
    setResults((r) => ({
      ...r,
      [name]: {
        ok: result.ok,
        text: result.ok ? `Intakt (${counts})` : result.error || `Integrität: ${result.integrity}`,
      },
    }));
  }

  async function handleBackupNow() {
    setBusy(true);
    const res = await createBackupNowAction();
    setBusy(false);
    if (res.success) {
      toast.success("Sicherung erstellt.");
      router.refresh();
    } else {
      toast.error(res.error || "Sicherung fehlgeschlagen.");
    }
  }

  return (
    <section aria-labelledby="auto-backup-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <DatabaseBackup className="w-4 h-4 text-zinc-500" aria-hidden="true" />
          <h2 id="auto-backup-heading" className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Automatische Sicherungen
          </h2>
          <span className="text-xs text-zinc-500">
            {enabled ? "aktiv" : "deaktiviert (AUTO_BACKUP_ENABLED=false)"}
          </span>
        </div>
        <button
          type="button"
          onClick={handleBackupNow}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
          Jetzt sichern
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Speicherort: <code className="tabular-nums">{backupDir}</code>. Belegfotos sind nicht enthalten.
        Heruntergeladene Dateien lassen sich unter „Werkzeuge → Backup wiederherstellen“ einspielen.
      </p>

      {backups.length === 0 ? (
        <p className="text-xs text-zinc-500">Noch keine automatische Sicherung vorhanden.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
          {backups.map((b) => (
            <li key={b.name} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                {b.encrypted && <Lock className="w-3 h-3 text-emerald-600" aria-label="verschlüsselt" />}
                {new Date(b.createdAt).toLocaleString("de-DE")}
                <span className="text-zinc-400">({formatSize(b.sizeBytes)})</span>
              </span>
              <span className="flex items-center gap-3">
              {results[b.name] && (
                <span className={results[b.name].ok ? "text-zinc-600 dark:text-zinc-400" : "text-red-600 dark:text-red-400"} role="status">
                  {results[b.name].text}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleVerify(b.name)}
                disabled={verifying === b.name}
                className="font-semibold text-zinc-700 dark:text-zinc-300 hover:underline disabled:opacity-50"
              >
                {verifying === b.name ? "Prüft …" : "Prüfen"}
              </button>
              <a
                href={`/api/backup/auto/${encodeURIComponent(b.name)}`}
                className="inline-flex items-center gap-1 text-brand font-semibold hover:underline"
                aria-label={`Sicherung vom ${new Date(b.createdAt).toLocaleString("de-DE")} herunterladen`}
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Herunterladen
              </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
