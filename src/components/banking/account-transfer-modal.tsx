"use client";

import { useState, useEffect } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { X, ArrowRightLeft, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { transferBetweenAccountsAction } from "@/actions/bank-actions";
import { parseEuroToCents, formatCents } from "@/lib/format";
import type { ConnectedAccountItem } from "./banking-hub-view";

interface AccountTransferModalProps {
  open: boolean;
  onClose: () => void;
  accounts: ConnectedAccountItem[];
  defaultTargetAccountId?: string | null;
}

export function AccountTransferModal({
  open,
  onClose,
  accounts,
  defaultTargetAccountId,
}: AccountTransferModalProps) {
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const today = new Date().toISOString().slice(0, 10);
      setDateInput(today);
      setDescriptionInput("Kartenausgleich / Umbuchung");

      // Auto-Select Giro as Source and Target as specified or Credit Card
      const giro = accounts.find((a) => a.accountType === "checking") || accounts[0];
      const target =
        (defaultTargetAccountId && accounts.find((a) => a.id === defaultTargetAccountId)) ||
        accounts.find((a) => a.accountType === "credit_card" && a.id !== giro?.id) ||
        accounts.find((a) => a.id !== giro?.id);

      if (giro) setSourceAccountId(giro.id);
      if (target) {
        setTargetAccountId(target.id);
        // Wenn das Zielkonto ein negatives Saldo hat (z. B. -450 €), schlagen wir den Betrag direkt vor!
        if (target.balanceCents !== null && target.balanceCents !== undefined && target.balanceCents < 0) {
          const defaultCents = Math.abs(target.balanceCents);
          setAmountInput((defaultCents / 100).toFixed(2).replace(".", ","));
        } else {
          setAmountInput("");
        }
      }
    }
  }, [open, accounts, defaultTargetAccountId]);

  const { dialogProps, titleId } = useDialogA11y({ open, onClose: onClose });
  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceAccountId || !targetAccountId) {
      toast.error("Bitte wähle sowohl Ausgangs- als auch Zielkonto aus.");
      return;
    }
    if (sourceAccountId === targetAccountId) {
      toast.error("Ausgangskonto und Zielkonto dürfen nicht identisch sein.");
      return;
    }

    const cents = parseEuroToCents(amountInput);
    if (!cents || cents <= 0) {
      toast.error("Bitte gib einen gültigen Ausgleichsbetrag größer als 0 € an.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await transferBetweenAccountsAction({
        sourceAccountId,
        targetAccountId,
        amountCents: cents,
        date: dateInput || undefined,
        description: descriptionInput.trim() || undefined,
      });

      if (res.success) {
        toast.success(`Kartenausgleich über ${formatCents(cents)} erfolgreich verbucht!`);
        onClose();
      } else {
        toast.error(res.error || "Umbuchung fehlgeschlagen.");
      }
    } catch {
      toast.error("Unerwarteter Fehler bei der Umbuchung.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
  const targetAccount = accounts.find((a) => a.id === targetAccountId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 duration-150">
      <div {...dialogProps} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-lg shadow-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Kartenausgleich & Umbuchung
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Geld zwischen Girokonto, Kreditkarte (Advanzia / TF Bank) oder Bar übertragen.
              </p>
            </div>
          </div>
          <button
            aria-label="Schließen"
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info-Banner: Cashflow-Neutralität */}
        <div className="mx-5 mt-4 p-3 rounded-lg bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-900/50 flex items-start gap-2.5 text-xs text-blue-900 dark:text-blue-300">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Cashflow-neutral:</strong> Diese Buchung gleicht deine Karte aus und wird
            nicht fälschlicherweise als doppelte Lebenshaltungsausgabe im Monats-Cashflow gezählt.
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Ausgangskonto */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Ausgangskonto (Belastung)
            </label>
            <select
              value={sourceAccountId}
              onChange={(e) => setSourceAccountId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden transition"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id} disabled={acc.id === targetAccountId}>
                  {acc.accountName} {acc.balanceCents !== null ? `(${formatCents(acc.balanceCents)})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Zielkonto */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Zielkonto (Gutschrift / Kartenausgleich)
            </label>
            <select
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden transition"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id} disabled={acc.id === sourceAccountId}>
                  {acc.accountName} {acc.balanceCents !== null ? `(${formatCents(acc.balanceCents)})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Betrag & Datum */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Betrag (€) *
              </label>
              <input
                type="text"
                required
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="z. B. 450,00"
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden tabular-nums transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Wertstellungsdatum
              </label>
              <input
                type="date"
                required
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden transition"
              />
            </div>
          </div>

          {/* Verwendungszweck */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Verwendungszweck / Buchungstext (optional)
            </label>
            <input
              type="text"
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              placeholder="z. B. Ausgleich Kreditkartenabrechnung Advanzia November"
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden transition"
            />
          </div>

          {/* Transfer Summary */}
          {sourceAccount && targetAccount && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">Vorschau:</span>{" "}
              Überweisung von <span className="font-medium text-zinc-900 dark:text-zinc-100">{sourceAccount.accountName}</span> an{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{targetAccount.accountName}</span>.
            </div>
          )}

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
              <span>Kartenausgleich durchführen</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
