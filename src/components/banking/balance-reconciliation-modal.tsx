"use client";

import { useState } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { X, Scale, Loader2, ArrowRight } from "lucide-react";
import { parseSignedCents, formatCents } from "@/lib/format";
import { reconcileAccountBalanceAction } from "@/actions/bank-actions";
import { toast } from "sonner";
import type { ConnectedAccountItem } from "./banking-hub-view";

export function BalanceReconciliationModal({
  open,
  onClose,
  account,
}: {
  open: boolean;
  onClose: () => void;
  account: ConnectedAccountItem | null;
}) {
  const [actualInput, setActualInput] = useState("");
  const [mode, setMode] = useState<"adjustment_transaction" | "set_balance">(
    "adjustment_transaction"
  );
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { dialogProps, titleId } = useDialogA11y({ open, onClose: onClose });
  if (!open || !account) return null;

  const currentBal = account.balanceCents ?? 0;
  const parsedTarget = actualInput.trim() ? parseSignedCents(actualInput) : null;
  const diffCents = parsedTarget !== null ? parsedTarget - currentBal : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedTarget === null) {
      toast.error("Bitte gib den tatsächlichen Kontostand in Euro ein.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await reconcileAccountBalanceAction({
        accountId: account!.id,
        actualBalanceCents: parsedTarget,
        mode,
        description: note.trim() || undefined,
      });

      if (res.success) {
        toast.success(res.message || "Saldo erfolgreich abgeglichen!");
        onClose();
      } else {
        toast.error(res.error || "Abgleich fehlgeschlagen.");
      }
    } catch {
      toast.error("Fehler beim Abgleichen des Kontostands.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 duration-150">
      <div {...dialogProps} className="relative w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h2 id={titleId} className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Kassensturz & Saldenabgleich
              </h2>
              <p className="text-xs text-zinc-400">
                {account.accountName} • Stand in der App: {formatCents(currentBal)}
              </p>
            </div>
          </div>
          <button
            aria-label="Schließen"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Tatsächlicher Stand lt. Bank-App / Geldbeutel (€) *
            </label>
            <input
              type="text"
              required
              value={actualInput}
              onChange={(e) => setActualInput(e.target.value)}
              placeholder="z. B. 125,50 oder -450,00"
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 tabular-nums font-bold text-sm focus:ring-2 focus:ring-blue-500 outline-hidden transition"
              autoFocus
            />
          </div>

          {diffCents !== null && (
            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-zinc-500 font-medium">Berechnete Differenz:</span>
              <span
                className={`tabular-nums font-bold text-sm ${
                  diffCents > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : diffCents < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-zinc-500"
                }`}
              >
                {diffCents > 0 ? "+" : ""}
                {formatCents(diffCents)}
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Wie soll die Differenz verbucht werden?
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition">
                <input
                  type="radio"
                  name="reconcileMode"
                  checked={mode === "adjustment_transaction"}
                  onChange={() => setMode("adjustment_transaction")}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 block">
                    Automatische Ausgleichsbuchung anlegen (Empfohlen)
                  </span>
                  <span className="text-xs text-zinc-400">
                    Erstellt eine neutrale Korrekturbuchung in deiner Historie, sodass dein Verlauf lückenlos bleibt.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition">
                <input
                  type="radio"
                  name="reconcileMode"
                  checked={mode === "set_balance"}
                  onChange={() => setMode("set_balance")}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 block">
                    Nur Saldo direkt anpassen (ohne Buchung)
                  </span>
                  <span className="text-xs text-zinc-400">
                    Setzt den Kontostand stillschweigend auf den Zielwert ohne zusätzliche Buchungszeile.
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Notiz / Bemerkung (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. Bargeld-Kassensturz Monatsende"
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden transition"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Saldo abgleichen</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
