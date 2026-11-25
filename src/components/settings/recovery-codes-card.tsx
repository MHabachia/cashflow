"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Download, LifeBuoy, Loader2 } from "lucide-react";
import {
  generateRecoveryCodesAction,
  getRecoveryCodeStatusAction,
} from "@/actions/password-recovery-actions";

export function RecoveryCodesCard() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [hasPassword, setHasPassword] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRecoveryCodeStatusAction().then((s) => {
      setRemaining(s.remaining);
      setHasPassword(s.hasPassword);
    });
  }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await generateRecoveryCodesAction({ currentPassword });
    setBusy(false);
    if (!res.success || !res.codes) {
      toast.error(res.error || "Erzeugen fehlgeschlagen.");
      return;
    }
    setCodes(res.codes);
    setRemaining(res.codes.length);
    setCurrentPassword("");
  }

  const asText = codes
    ? `Cashflow – Wiederherstellungscodes\nErstellt: ${new Date().toLocaleString("de-DE")}\nJeder Code ist einmal gültig.\n\n${codes.join("\n")}\n`
    : "";

  function download() {
    const blob = new Blob([asText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cashflow-wiederherstellungscodes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="recovery-heading" className="space-y-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <LifeBuoy className="w-5 h-5 text-blue-600" aria-hidden="true" />
        <h2 id="recovery-heading" className="font-bold text-base">
          Wiederherstellungscodes
        </h2>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Mit einem dieser Codes kannst du unter „Passwort vergessen?“ selbst ein neues Passwort setzen.
        Bewahre sie sicher auf, z. B. ausgedruckt oder im Passwortmanager.{" "}
        {remaining !== null && (
          <strong className="text-zinc-700 dark:text-zinc-300">
            {remaining > 0 ? `${remaining} Code(s) verfügbar.` : "Noch keine Codes erzeugt."}
          </strong>
        )}
      </p>

      {codes ? (
        <div className="space-y-3">
          <p role="status" className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            Diese Codes werden nur jetzt angezeigt. Ältere Codes sind ab sofort ungültig.
          </p>
          <ul className="grid grid-cols-2 gap-2 tabular-nums text-sm" aria-label="Wiederherstellungscodes">
            {codes.map((c) => (
              <li key={c} className="px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-center">
                {c}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(asText).then(() => toast.success("Kopiert."))}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Kopieren
            </button>
            <button
              type="button"
              onClick={download}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" /> Als Datei speichern
            </button>
            <button
              type="button"
              onClick={() => setCodes(null)}
              className="px-3 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold"
            >
              Gespeichert – ausblenden
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={generate} className="flex flex-col sm:flex-row gap-2 sm:items-end">
          {hasPassword && (
            <div className="flex-1">
              <label htmlFor="recovery-current-password" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Aktuelles Passwort zur Bestätigung
              </label>
              <input
                id="recovery-current-password"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {remaining ? "Neue Codes erzeugen" : "Codes erzeugen"}
          </button>
        </form>
      )}
    </section>
  );
}
