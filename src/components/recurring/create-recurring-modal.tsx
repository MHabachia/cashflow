"use client";

import { useState, useEffect, useMemo } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { createRecurringFromTransactionAction } from "@/actions/recurring-actions";
import { parseEuroToCents, centsToInput } from "@/lib/format";
import { CategoryIcon } from "@/components/ui/category-icon";
import { X, CalendarClock, Loader2, Check, Repeat } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface CreateRecurringCategoryOption {
  id: string;
  name: string;
  type: "expense" | "income";
  color?: string | null;
  icon?: string | null;
}

export interface PrefillRecurringData {
  transactionId?: string;
  name?: string;
  amountCents?: number;
  type?: "expense" | "income";
  categoryId?: string;
  date?: string;
}

export function CreateRecurringModal({
  open,
  onClose,
  categories,
  prefill,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  categories: CreateRecurringCategoryOption[];
  prefill?: PrefillRecurringData | null;
  onSuccess?: (recurringId: string) => void;
}) {
  const [name, setName] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState("");
  const [interval, setInterval] = useState<
    "monthly" | "yearly" | "quarterly" | "weekly" | "half_yearly"
  >("monthly");
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [autoBook, setAutoBook] = useState(false);
  const [linkExisting, setLinkExisting] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && prefill) {
      setName(prefill.name || "");
      if (prefill.amountCents) {
        setAmountStr(centsToInput(Math.abs(prefill.amountCents)));
      } else {
        setAmountStr("");
      }
      setType(prefill.type || "expense");

      if (prefill.categoryId) {
        setCategoryId(prefill.categoryId);
      } else {
        const defaultCat = categories.find((c) => c.type === (prefill.type || "expense"));
        setCategoryId(defaultCat?.id || categories[0]?.id || "");
      }

      if (prefill.date) {
        const parts = prefill.date.split("-");
        if (parts.length === 3) {
          const day = parseInt(parts[2], 10);
          if (!isNaN(day) && day >= 1 && day <= 31) {
            setDayOfMonth(day);
          }
        }
      } else {
        setDayOfMonth(new Date().getDate());
      }

      setInterval("monthly");
      setAutoBook(false);
      setLinkExisting(true);
    }
  }, [open, prefill, categories]);

  const matchingCategories = useMemo(
    () => categories.filter((c) => c.type === type),
    [categories, type]
  );

  useEffect(() => {
    if (matchingCategories.length > 0) {
      const exists = matchingCategories.some((c) => c.id === categoryId);
      if (!exists) {
        setCategoryId(matchingCategories[0].id);
      }
    }
  }, [type, matchingCategories, categoryId]);

  const { dialogProps, titleId } = useDialogA11y({ open, onClose: onClose });
  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseEuroToCents(amountStr);
    if (!name.trim()) {
      toast.error("Bitte eine Bezeichnung eingeben.");
      return;
    }
    if (!cents || cents <= 0) {
      toast.error("Bitte einen gültigen Betrag größer als 0 eingeben.");
      return;
    }
    if (!categoryId) {
      toast.error("Bitte eine Kategorie auswählen.");
      return;
    }

    setSaving(true);
    try {
      const res = await createRecurringFromTransactionAction({
        transactionId: linkExisting ? prefill?.transactionId : undefined,
        name: name.trim(),
        amountCents: cents,
        type,
        categoryId,
        interval,
        dayOfMonth,
        autoBook,
      });

      if (res.success && res.recurringId) {
        toast.success(`„${name.trim()}“ erfolgreich als Fixkosten angelegt!`);
        if (onSuccess) {
          onSuccess(res.recurringId);
        }
        onClose();
      } else {
        toast.error(res.error || "Fehler beim Anlegen der Fixkosten.");
      }
    } catch {
      toast.error("Fehler beim Anlegen der Fixkosten.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto duration-150">
      <div {...dialogProps} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg w-full max-w-md shadow-lg overflow-hidden my-auto">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-zinc-900 dark:text-zinc-100 flex items-center justify-center shrink-0">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h3 id={titleId} className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                Als Fixkosten anlegen
              </h3>
              <p className="text-xs text-zinc-500">
                Wiederkehrenden Dauerauftrag / Posten erfassen
              </p>
            </div>
          </div>
          <button
            aria-label="Schließen"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {/* Typ: Ausgabe vs Einnahme */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => setType("expense")}
              className={cn(
                "py-1.5 text-xs font-bold rounded-lg transition cursor-pointer",
                type === "expense"
                  ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 "
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
              )}
            >
              Feste Ausgabe
            </button>
            <button
              type="button"
              onClick={() => setType("income")}
              className={cn(
                "py-1.5 text-xs font-bold rounded-lg transition cursor-pointer",
                type === "income"
                  ? "bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 "
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
              )}
            >
              Feste Einnahme (z.B. Gehalt)
            </button>
          </div>

          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Bezeichnung / Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Miete, Netflix, Rundfunkbeitrag, Gehalt"
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-indigo-500 outline-hidden"
              required
            />
          </div>

          {/* Betrag */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Betrag (€)
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0,00"
                className="w-full pl-3 pr-8 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-hidden"
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-bold">
                €
              </span>
            </div>
          </div>

          {/* Intervall & Tag im Monat */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Wiederholung
              </label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-indigo-500 outline-hidden"
              >
                <option value="monthly">Monatlich</option>
                <option value="quarterly">Vierteljährlich</option>
                <option value="half_yearly">Halbjährlich</option>
                <option value="yearly">Jährlich</option>
                <option value="weekly">Wöchentlich</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Tag im Monat (1–31)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10) || 1)}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs focus:ring-2 focus:ring-indigo-500 outline-hidden"
              />
            </div>
          </div>

          {/* Kategorie Auswahl */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Kategorie
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              {matchingCategories.map((cat) => {
                const isSelected = cat.id === categoryId;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    className={cn(
                      "p-1.5 rounded-lg text-left flex items-center gap-1.5 text-xs transition cursor-pointer truncate",
                      isSelected
                        ? "bg-brand text-white font-semibold "
                        : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                    )}
                  >
                    <span
                      className="w-4 h-4 rounded-md flex items-center justify-center shrink-0 text-white text-xs"
                      style={{ backgroundColor: isSelected ? "rgba(255,255,255,0.25)" : cat.color || "#64748b" }}
                    >
                      <CategoryIcon name={cat.icon || "Tag"} className="w-2.5 h-2.5" />
                    </span>
                    <span className="truncate text-xs">{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Checkbox: Mit der aktuellen Transaktion verknüpfen */}
          {prefill?.transactionId && (
            <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={linkExisting}
                onChange={(e) => setLinkExisting(e.target.checked)}
                className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-zinc-600 dark:text-zinc-300">
                Diese importierte Bankbuchung direkt als <strong>Fixkosten</strong> markieren.
              </span>
            </label>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>Fixkosten speichern</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
