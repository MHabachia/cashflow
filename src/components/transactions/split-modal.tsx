"use client";

import { useState, useEffect } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import {
  splitTransactionAction,
  unsplitTransactionAction,
  getTransactionSplitsAction,
} from "@/actions/transaction-actions";
import { formatCents, parseEuroToCents, centsToInput } from "@/lib/format";
import { CategoryIcon } from "@/components/ui/category-icon";
import type { CategoryItem } from "@/components/transactions/quick-add-modal";
import {
  X,
  Plus,
  Trash2,
  GitFork,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SplitRow {
  id: string;
  categoryId: string;
  amountStr: string;
  description: string;
}

export function SplitTransactionModal({
  open,
  onClose,
  transaction,
  categories,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  transaction: {
    id: string;
    description: string;
    amountCents: number;
    categoryId: string;
    date: string;
    isSplit?: boolean;
  } | null;
  categories: CategoryItem[];
  onSuccess?: () => void;
}) {
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !transaction) return;

    if (transaction.isSplit) {
      setLoading(true);
      getTransactionSplitsAction(transaction.id)
        .then((res) => {
          if (res.success && res.splits.length > 0) {
            setSplits(
              res.splits.map((s) => ({
                id: s.id,
                categoryId: s.categoryId,
                amountStr: centsToInput(s.amountCents),
                description: s.description || "",
              }))
            );
          } else {
            initDefaultSplits();
          }
        })
        .finally(() => setLoading(false));
    } else {
      initDefaultSplits();
    }

    function initDefaultSplits() {
      if (!transaction) return;
      const half = Math.floor(transaction.amountCents / 2);
      const rest = transaction.amountCents - half;
      const defaultCat = transaction.categoryId || categories[0]?.id || "";
      const otherCat =
        categories.find((c) => c.id !== defaultCat)?.id || defaultCat;

      setSplits([
        {
          id: "1",
          categoryId: defaultCat,
          amountStr: centsToInput(half),
          description: "",
        },
        {
          id: "2",
          categoryId: otherCat,
          amountStr: centsToInput(rest),
          description: "",
        },
      ]);
    }
  }, [open, transaction, categories]);

  const { dialogProps, titleId } = useDialogA11y({ open, onClose: onClose });
  if (!open || !transaction) return null;

  const currentSplitCents = splits.map((s) => parseEuroToCents(s.amountStr) || 0);
  const totalAllocated = currentSplitCents.reduce((sum, v) => sum + v, 0);
  const remainingCents = transaction.amountCents - totalAllocated;
  const isBalanced = remainingCents === 0;

  const handleAddSplit = () => {
    const defaultCat = categories[0]?.id || "";
    setSplits((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        categoryId: defaultCat,
        amountStr: remainingCents > 0 ? centsToInput(remainingCents) : "0,00",
        description: "",
      },
    ]);
  };

  const handleRemoveSplit = (index: number) => {
    if (splits.length <= 2) {
      toast.error("Mindestens 2 Split-Zeilen erforderlich.");
      return;
    }
    setSplits((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateSplit = (
    index: number,
    field: keyof SplitRow,
    value: string
  ) => {
    setSplits((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleFillRemainder = (index: number) => {
    const otherSum = splits.reduce((acc, s, idx) => {
      if (idx === index) return acc;
      return acc + (parseEuroToCents(s.amountStr) || 0);
    }, 0);
    const needed = transaction.amountCents - otherSum;
    if (needed > 0) {
      handleUpdateSplit(index, "amountStr", centsToInput(needed));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isBalanced) {
      toast.error(
        `Bitte alle Beträge aufteilen. Differenz: ${formatCents(Math.abs(remainingCents))}`
      );
      return;
    }

    const payload = splits.map((s) => ({
      categoryId: s.categoryId,
      amountCents: parseEuroToCents(s.amountStr) || 0,
      description: s.description || null,
    }));

    setSubmitting(true);
    try {
      const res = await splitTransactionAction({
        transactionId: transaction.id,
        splits: payload,
      });

      if (res.success) {
        toast.success("Buchung erfolgreich aufgeteilt!");
        onSuccess?.();
        onClose();
      } else {
        toast.error(res.error || "Fehler beim Aufteilen.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnsplit = async () => {
    setSubmitting(true);
    try {
      const res = await unsplitTransactionAction(transaction.id);
      if (res.success) {
        toast.success("Split-Aufteilung erfolgreich aufgehoben.");
        onSuccess?.();
        onClose();
      } else {
        toast.error(res.error || "Fehler beim Aufheben.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div {...dialogProps} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg w-full max-w-lg shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <GitFork className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-bold text-zinc-900 dark:text-white">
                Split-Buchung aufteilen
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {transaction.description} • {formatCents(transaction.amountCents)}
              </p>
            </div>
          </div>
          <button
            aria-label="Schließen"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Balance status bar */}
        <div
          className={cn(
            "px-5 py-2.5 text-xs font-semibold flex items-center justify-between border-b transition-colors",
            isBalanced
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
          )}
        >
          <span className="flex items-center gap-1.5">
            {isBalanced ? (
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            )}
            Gesamt: {formatCents(transaction.amountCents)} • Zugeordnet:{" "}
            {formatCents(totalAllocated)}
          </span>
          <span>
            {remainingCents === 0
              ? "Exakt ausgeglichen"
              : remainingCents > 0
                ? `Noch ${formatCents(remainingCents)} offen`
                : `${formatCents(Math.abs(remainingCents))} zu viel`}
          </span>
        </div>

        {/* Content body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-12 flex justify-center items-center text-zinc-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Lade Split-Einträge...
            </div>
          ) : (
            <div className="space-y-3">
              {splits.map((split, index) => {
                const cat = categories.find((c) => c.id === split.categoryId);
                return (
                  <div
                    key={split.id}
                    className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-400 w-5">
                        #{index + 1}
                      </span>
                      <div className="flex-1">
                        <select
                          value={split.categoryId}
                          onChange={(e) =>
                            handleUpdateSplit(index, "categoryId", e.target.value)
                          }
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-medium"
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-28 relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          required
                          value={split.amountStr}
                          onChange={(e) =>
                            handleUpdateSplit(index, "amountStr", e.target.value)
                          }
                          placeholder="0,00"
                          className="w-full px-2.5 py-1.5 text-xs text-right rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-semibold"
                        />
                        <span className="absolute right-7 top-1.5 text-xs text-zinc-400 pointer-events-none">
                          €
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveSplit(index)}
                        disabled={splits.length <= 2}
                        className="p-1.5 text-zinc-400 hover:text-rose-500 disabled:opacity-30 disabled:hover:text-zinc-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        title="Zeile entfernen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2 pl-7">
                      <input
                        type="text"
                        placeholder="Optionale Notiz (z. B. Drogerie-Artikel)..."
                        value={split.description}
                        onChange={(e) =>
                          handleUpdateSplit(index, "description", e.target.value)
                        }
                        className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 placeholder:text-zinc-400"
                      />
                      {remainingCents > 0 && (
                        <button
                          type="button"
                          onClick={() => handleFillRemainder(index)}
                          className="text-xs px-2 py-0.5 font-medium rounded bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors whitespace-nowrap"
                        >
                          Rest einfüllen
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={handleAddSplit}
                className="w-full py-2 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Weitere Split-Kategorie hinzufügen
              </button>
            </div>
          )}

          {/* Footer actions */}
          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            {transaction.isSplit ? (
              <button
                type="button"
                onClick={handleUnsplit}
                disabled={submitting}
                className="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 font-medium px-2 py-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                Split aufheben
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={!isBalanced || submitting || splits.length < 2}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1.5 transition-colors"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Split speichern
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
