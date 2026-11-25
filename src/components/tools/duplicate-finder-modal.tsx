"use client";

import { useState } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { X, Copy, Trash2, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { formatCents, formatDateDE } from "@/lib/format";
import { deleteTransactionAction } from "@/actions/transaction-actions";
import { toast } from "sonner";
import type { DuplicateGroup } from "@/actions/transaction-actions";

export function DuplicateFinderModal({
  open,
  onClose,
  groups,
  onResolved,
}: {
  open: boolean;
  onClose: () => void;
  groups: DuplicateGroup[];
  onResolved?: () => void;
}) {
  const [duplicateList, setDuplicateList] = useState<DuplicateGroup[]>(groups);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { dialogProps, titleId } = useDialogA11y({ open, onClose: onClose });
  if (!open) return null;

  async function handleDeleteSingle(groupId: string, txId: string) {
    setDeletingId(txId);
    try {
      const res = await deleteTransactionAction(txId);
      if (res.success) {
        toast.success("Doppelte Buchung erfolgreich entfernt.");
        setDuplicateList((prev) =>
          prev
            .map((g) => {
              if (g.groupId !== groupId) return g;
              return {
                ...g,
                items: g.items.filter((item) => item.id !== txId),
              };
            })
            .filter((g) => g.items.length > 1)
        );
        onResolved?.();
      } else {
        toast.error("Fehler beim Löschen des Duplikats.");
      }
    } catch {
      toast.error("Fehler beim Löschen.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 duration-150">
      <div {...dialogProps} className="relative w-full max-w-2xl rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg p-6 space-y-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <Copy className="w-4 h-4" />
            </div>
            <div>
              <h2 id={titleId} className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Gefundene doppelte Buchungen (Dubletten)
              </h2>
              <p className="text-xs text-zinc-400">
                Buchungen mit identischem Betrag, gleichem Händler und ähnlichem Datum
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

        {/* Content */}
        <div className="overflow-y-auto space-y-4 flex-1 pr-1">
          {duplicateList.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                Keine Duplikate gefunden!
              </p>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                Deine Buchungen sind sauber. Es wurden keine verdächtigen Doppelbuchungen entdeckt.
              </p>
            </div>
          ) : (
            duplicateList.map((group) => (
              <div
                key={group.groupId}
                className="p-3.5 rounded-xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-amber-900 dark:text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Verdacht auf Doppelbuchung:</span>
                  </span>
                  <span className="tabular-nums font-bold">
                    {formatCents(group.amountCents)}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {group.items.map((item, idx) => {
                    const isDeleting = deletingId === item.id;
                    return (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums text-xs text-zinc-400 shrink-0">
                              {formatDateDE(item.date)}
                            </span>
                            <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {item.description}
                            </span>
                          </div>
                          <span className="text-xs text-zinc-400 block mt-0.5">
                            {item.bankAccountName || "Manuell"}
                            {item.bankTransactionId ? " • Bankumsatz" : " • Manueller Eintrag"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {idx === 0 ? (
                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800">
                              Behalten
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDeleteSingle(group.groupId, item.id)}
                              disabled={isDeleting}
                              className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/50 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 text-xs font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                              title="Dieses Duplikat löschen"
                            >
                              {isDeleting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                              <span>Löschen</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
