"use client";

import { useState, useEffect } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { X, CreditCard, Landmark, PiggyBank, Coins, Wallet, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createManualBankAccountAction,
  updateBankAccountAction,
  deleteBankAccountAction,
} from "@/actions/bank-actions";
import { parseEuroToCents, centsToInput } from "@/lib/format";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import type { ConnectedAccountItem } from "./banking-hub-view";

interface ManualAccountModalProps {
  open: boolean;
  onClose: () => void;
  accountToEdit?: ConnectedAccountItem | null;
}

export function ManualAccountModal({
  open,
  onClose,
  accountToEdit,
}: ManualAccountModalProps) {
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<
    "checking" | "credit_card" | "savings" | "cash" | "paypal"
  >("credit_card");
  const [balanceInput, setBalanceInput] = useState("");
  const [availableInput, setAvailableInput] = useState("");
  const [creditLimitInput, setCreditLimitInput] = useState("");
  const [billingDayInput, setBillingDayInput] = useState("");
  const [ibanMasked, setIbanMasked] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  async function handleDeleteAccount() {
    if (!accountToEdit) return;
    const isCard = accountToEdit.accountType === "credit_card";

    setIsDeleting(true);
    try {
      const res = await deleteBankAccountAction(accountToEdit.id);
      if (res.success) {
        toast.success(`${isCard ? "Karte" : "Konto"} erfolgreich gelöscht.`);
        setDeleteConfirmOpen(false);
        onClose();
      } else {
        toast.error(res.error || "Löschen fehlgeschlagen.");
      }
    } catch {
      toast.error("Fehler beim Löschen des Kontos.");
    } finally {
      setIsDeleting(false);
    }
  }

  function formatEuroInputSigned(cents: number): string {
    const isNeg = cents < 0;
    return `${isNeg ? "-" : ""}${centsToInput(Math.abs(cents))}`;
  }

  function parseSignedCents(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const isNeg = trimmed.startsWith("-");
    const clean = trimmed.replace("-", "").trim();
    const cents = parseEuroToCents(clean);
    if (cents === null) return null;
    return isNeg ? -cents : cents;
  }

  useEffect(() => {
    if (accountToEdit) {
      setAccountName(accountToEdit.accountName || "");
      setAccountType(accountToEdit.accountType || "credit_card");

      const limitCents = accountToEdit.creditLimitCents || 0;
      const balCents =
        accountToEdit.balanceCents !== null && accountToEdit.balanceCents !== undefined
          ? accountToEdit.balanceCents
          : 0;

      // Negativer Saldo = Schulden; Altdaten mit vertauschten Werten korrigiert Migration 6
      setCreditLimitInput(limitCents > 0 ? centsToInput(limitCents) : "");
      setBalanceInput(formatEuroInputSigned(balCents));
      setAvailableInput(limitCents > 0 ? centsToInput(Math.max(0, limitCents + balCents)) : "");

      setBillingDayInput(
        accountToEdit.billingDayOfMonth ? String(accountToEdit.billingDayOfMonth) : ""
      );
      setIbanMasked(accountToEdit.ibanMasked || "");
      setNotes(accountToEdit.notes || "");
    } else {
      setAccountName("");
      setAccountType("credit_card");
      setCreditLimitInput("6000,00");
      setAvailableInput("6000,00");
      setBalanceInput("0,00");
      setBillingDayInput("8");
      setIbanMasked("");
      setNotes("");
    }
  }, [accountToEdit, open]);

  const { dialogProps, titleId } = useDialogA11y({ open, onClose: onClose });
  if (!open) return null;

  function handleCreditLimitChange(val: string) {
    setCreditLimitInput(val);
    const limitCents = parseEuroToCents(val);
    const availCents = parseEuroToCents(availableInput);
    if (limitCents !== null && availCents !== null) {
      const calculatedSaldoCents = availCents - limitCents;
      setBalanceInput(formatEuroInputSigned(calculatedSaldoCents));
    }
  }

  function handleAvailableChange(val: string) {
    setAvailableInput(val);
    const availCents = parseEuroToCents(val);
    const limitCents = parseEuroToCents(creditLimitInput);
    if (limitCents !== null && availCents !== null) {
      const calculatedSaldoCents = availCents - limitCents;
      setBalanceInput(formatEuroInputSigned(calculatedSaldoCents));
    }
  }

  function handleBalanceChange(val: string) {
    setBalanceInput(val);
    const balCents = parseSignedCents(val);
    const limitCents = parseEuroToCents(creditLimitInput);
    if (limitCents !== null && balCents !== null) {
      const calculatedAvailCents = Math.max(0, limitCents + balCents);
      setAvailableInput(centsToInput(calculatedAvailCents));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountName.trim()) {
      toast.error("Bitte gib einen Namen für das Konto oder die Karte an.");
      return;
    }

    const parsedBalance = balanceInput.trim() ? parseSignedCents(balanceInput) : null;
    const parsedLimit = creditLimitInput.trim() ? parseEuroToCents(creditLimitInput) : null;
    const parsedBillingDay = billingDayInput.trim() ? parseInt(billingDayInput, 10) : null;

    if (
      parsedBillingDay !== null &&
      (parsedBillingDay < 1 || parsedBillingDay > 31 || Number.isNaN(parsedBillingDay))
    ) {
      toast.error("Der Abrechnungstag muss zwischen dem 1. und 31. eines Monats liegen.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (accountToEdit) {
        const res = await updateBankAccountAction({
          accountId: accountToEdit.id,
          accountName: accountName.trim(),
          balanceCents: parsedBalance,
          creditLimitCents: accountType === "credit_card" ? parsedLimit : null,
          billingDayOfMonth: accountType === "credit_card" ? parsedBillingDay : null,
          ibanMasked: ibanMasked.trim() || null,
          notes: notes.trim() || null,
        });

        if (res.success) {
          toast.success("Konto/Karte erfolgreich aktualisiert.");
          onClose();
        } else {
          toast.error(res.error || "Aktualisierung fehlgeschlagen.");
        }
      } else {
        const res = await createManualBankAccountAction({
          accountName: accountName.trim(),
          accountType,
          balanceCents: parsedBalance,
          creditLimitCents: accountType === "credit_card" ? parsedLimit : null,
          billingDayOfMonth: accountType === "credit_card" ? parsedBillingDay : null,
          ibanMasked: ibanMasked.trim() || null,
          notes: notes.trim() || null,
        });

        if (res.success) {
          toast.success("Manuelles Konto / Karte erfolgreich angelegt.");
          onClose();
        } else {
          toast.error(res.error || "Konto konnte nicht angelegt werden.");
        }
      }
    } catch {
      toast.error("Unerwarteter Fehler beim Speichern.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 duration-150">
      <div {...dialogProps} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-lg shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {accountToEdit ? "Konto / Karte bearbeiten" : "Manuelle Geldquelle oder Karte anlegen"}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {accountToEdit
                  ? "Stammdaten, Saldo, Kreditlimit oder Abrechnungstag anpassen."
                  : "Für Karten, PayPal oder Konten ohne PSD2-Direktanbindung (z. B. Advanzia, TF Bank, PayPal)."}
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Typ-Auswahl */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
              Kategorie / Kontotyp
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { type: "credit_card" as const, label: "Kreditkarte", icon: CreditCard },
                { type: "checking" as const, label: "Girokonto", icon: Landmark },
                { type: "paypal" as const, label: "PayPal", icon: Wallet },
                { type: "savings" as const, label: "Tagesgeld", icon: PiggyBank },
                { type: "cash" as const, label: "Bargeld", icon: Coins },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = accountType === item.type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => {
                      setAccountType(item.type);
                      if (item.type !== "credit_card") {
                        if (balanceInput.startsWith("-")) {
                          setBalanceInput(balanceInput.replace("-", ""));
                        }
                      }
                    }}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
                      isSelected
                        ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold "
                        : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    <Icon className="w-4 h-4 mb-1" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Bezeichnung / Name *
            </label>
            <input
              type="text"
              required
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="z. B. Advanzia Mastercard Gold, TF Bank oder PayPal Konto"
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden transition"
            />
          </div>

          {/* Kreditkarten: Intelligenter Live-Differenzrechner */}
          {accountType === "credit_card" ? (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4" />
                  Kreditkarten-Rahmen & Live-Differenzrechner
                </span>
                <span className="text-xs text-amber-700/80 dark:text-amber-400 font-medium">
                  Automatische Salden-Berechnung
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Kartenlimit / Kreditrahmen (€) *
                  </label>
                  <input
                    type="text"
                    required
                    value={creditLimitInput}
                    onChange={(e) => handleCreditLimitChange(e.target.value)}
                    placeholder="z. B. 6.000,00"
                    className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs tabular-nums font-bold focus:ring-2 focus:ring-amber-500 outline-hidden transition"
                  />
                  <span className="text-xs text-zinc-400 mt-0.5 block">
                    Gesamter Verfügungsrahmen der Bank
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Noch verfügbarer Betrag (€)
                  </label>
                  <input
                    type="text"
                    value={availableInput}
                    onChange={(e) => handleAvailableChange(e.target.value)}
                    placeholder="z. B. 1.654,68"
                    className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs tabular-nums font-bold text-emerald-600 dark:text-emerald-400 focus:ring-2 focus:ring-emerald-500 outline-hidden transition"
                  />
                  <span className="text-xs text-zinc-400 mt-0.5 block">
                    Was aktuell noch übrig ist
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Berechneter Saldo / Schulden (€)
                  </label>
                  <input
                    type="text"
                    value={balanceInput}
                    onChange={(e) => handleBalanceChange(e.target.value)}
                    placeholder="z. B. -4.345,32"
                    className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs tabular-nums font-bold text-red-600 dark:text-red-400 focus:ring-2 focus:ring-red-500 outline-hidden transition"
                  />
                  <span className="text-xs text-zinc-400 mt-0.5 block">
                    Minus = ausstehende Kartenschulden
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Monatlicher Abrechnungstag
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={billingDayInput}
                    onChange={(e) => setBillingDayInput(e.target.value)}
                    placeholder="z. B. 8 (für 8. d. M.)"
                    className="w-full px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs tabular-nums focus:ring-2 focus:ring-amber-500 outline-hidden transition"
                  />
                  <span className="text-xs text-zinc-400 mt-0.5 block">
                    Tag des monatlichen Bankeinzugs
                  </span>
                </div>
              </div>

              {/* Live Preview Summary */}
              <div className="p-3 rounded-xl bg-white/80 dark:bg-zinc-900/80 border border-amber-500/20 text-xs flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-xs text-zinc-500">
                    Offener Saldo (Schulden):{" "}
                    <strong className="text-red-600 dark:text-red-400">
                      {balanceInput.trim() ? `${balanceInput} €` : "0,00 €"}
                    </strong>
                  </p>
                  <p className="text-xs text-zinc-500">
                    Verfügbarer Restrahmen:{" "}
                    <strong className="text-emerald-600 dark:text-emerald-400">
                      {availableInput.trim() ? `${availableInput} €` : "0,00 €"}
                    </strong>
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs uppercase font-bold text-zinc-400 block">Kartenlimit</span>
                  <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {creditLimitInput.trim() ? `${creditLimitInput} €` : "—"}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Maskierte Kartennummer (optional)
                </label>
                <input
                  type="text"
                  value={ibanMasked}
                  onChange={(e) => setIbanMasked(e.target.value)}
                  placeholder="z. B. 5401 **** 1234"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden tabular-nums transition"
                />
              </div>
            </div>
          ) : (
            /* Standard Girokonto / PayPal / Tagesgeld / Bargeld */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Aktueller Saldo / Guthaben (€)
                </label>
                <input
                  type="text"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  placeholder="z. B. 250,00"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden tabular-nums transition"
                />
                <span className="text-xs text-zinc-400 mt-0.5 block">
                  {accountType === "paypal" ? "Aktuelles PayPal-Guthaben" : "Verfügbares Kontoguthaben"}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  {accountType === "paypal" ? "PayPal E-Mail / ID (optional)" : "IBAN / Kontonummer (optional)"}
                </label>
                <input
                  type="text"
                  value={ibanMasked}
                  onChange={(e) => setIbanMasked(e.target.value)}
                  placeholder={accountType === "paypal" ? "z. B. account@paypal.de" : "z. B. DE89 **** 1234"}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden tabular-nums transition"
                />
              </div>
            </div>
          )}


          {/* Notizen */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Notizen / Memo (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z. B. Haupt-Kreditkarte für Reisen, Online-Shopping oder PayPal Ausgleich"
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-blue-500 outline-hidden transition"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2.5">
            {accountToEdit ? (
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={isDeleting || isSubmitting}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent hover:border-red-200 dark:hover:border-red-900/50 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{accountType === "credit_card" ? "Karte löschen" : "Konto löschen"}</span>
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting || isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isDeleting}
                className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{accountToEdit ? "Speichern" : "Konto / Karte anlegen"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      <ConfirmModal
        open={deleteConfirmOpen}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteAccount}
        title={accountToEdit?.accountType === "credit_card" ? "Karte löschen" : "Konto löschen"}
        message={`Möchtest du ${accountToEdit?.accountType === "credit_card" ? "die Karte" : "das Konto"} „${accountToEdit?.accountName}“ wirklich unwiderruflich löschen?`}
        confirmText="Unwiderruflich löschen"
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}