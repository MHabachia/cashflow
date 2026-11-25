"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCheck, Inbox, Loader2 } from "lucide-react";
import {
  confirmAllInboxAction,
  confirmInboxTransactionAction,
} from "@/actions/inbox-actions";
import { formatCents, formatDateDE } from "@/lib/format";
import { cn } from "@/lib/utils";

interface InboxItem {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amountCents: number;
  type: "expense" | "income";
  categoryId: string;
  accountName: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  type: "expense" | "income";
}

export function InboxView({
  items,
  categories,
}: {
  items: InboxItem[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  // Wischgesten (Touch): nach rechts = bestätigen, nach links = Kategorie ändern
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function handleSwipeEnd(e: React.TouchEvent, item: InboxItem) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || busyId) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2) return;
    if (dx > 0) {
      void confirmOne(item);
    } else {
      const select = document.getElementById(`inbox-cat-${item.id}`) as HTMLSelectElement | null;
      select?.focus();
      try {
        select?.showPicker?.();
      } catch {
        /* showPicker nicht überall verfügbar */
      }
    }
  }

  async function confirmOne(item: InboxItem) {
    setBusyId(item.id);
    const categoryId = chosen[item.id] ?? item.categoryId;
    const res = await confirmInboxTransactionAction({
      id: item.id,
      categoryId,
      createRule: remember[item.id] ?? false,
    });
    setBusyId(null);
    if (!res.success) {
      toast.error(res.error || "Bestätigen fehlgeschlagen.");
      return;
    }
    if (res.ruleCreated) toast.success("Bestätigt – Regel für künftige Umsätze gespeichert.");
    setRows((r) => r.filter((x) => x.id !== item.id));
    router.refresh();
  }

  async function confirmAll() {
    setConfirmingAll(true);
    const res = await confirmAllInboxAction(rows.map((r) => r.id));
    setConfirmingAll(false);
    if (res.success) {
      toast.success(`${res.confirmed} Umsätze bestätigt.`);
      setRows([]);
      router.refresh();
    }
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-16">
      <div className="flex items-start justify-between gap-3 flex-wrap pb-4 border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Umsätze prüfen
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Neu importierte Umsätze wurden automatisch kategorisiert. Bestätige sie oder
            korrigiere die Kategorie – auf Wunsch merkt sich die App die Zuordnung.
          </p>
          <p className="text-xs text-zinc-400 sm:hidden">Nach rechts wischen: bestätigen. Nach links: Kategorie ändern.</p>
        </div>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={confirmAll}
            disabled={confirmingAll}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
          >
            {confirmingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Alle {rows.length} bestätigen
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center space-y-2">
          <Inbox className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Alles geprüft</p>
          <p className="text-xs text-zinc-500">Neue Umsätze aus Bank-Sync und Import erscheinen hier.</p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((item) => {
            const options = categories.filter((c) => c.type === item.type);
            const selectId = `inbox-cat-${item.id}`;
            const ruleId = `inbox-rule-${item.id}`;
            return (
              <li
                key={item.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center gap-3"
                onTouchStart={(e) => {
                  touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                }}
                onTouchEnd={(e) => handleSwipeEnd(e, item)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {item.merchant || item.description}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums tabular-nums shrink-0",
                        item.type === "income"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-zinc-900 dark:text-zinc-100"
                      )}
                    >
                      {item.type === "income" ? "+" : "−"}
                      {formatCents(item.amountCents)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">
                    {formatDateDE(item.date)}
                    {item.accountName ? ` • ${item.accountName}` : ""}
                    {item.merchant && item.description !== item.merchant ? ` • ${item.description}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <label htmlFor={selectId} className="sr-only">
                    Kategorie für {item.merchant || item.description}
                  </label>
                  <select
                    id={selectId}
                    value={chosen[item.id] ?? item.categoryId}
                    onChange={(e) => setChosen((c) => ({ ...c, [item.id]: e.target.value }))}
                    className="text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 max-w-44"
                  >
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={ruleId} className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                    <input
                      id={ruleId}
                      type="checkbox"
                      checked={remember[item.id] ?? false}
                      onChange={(e) => setRemember((r) => ({ ...r, [item.id]: e.target.checked }))}
                    />
                    Merken
                  </label>
                  <button
                    type="button"
                    onClick={() => confirmOne(item)}
                    disabled={busyId === item.id}
                    aria-label={`${item.merchant || item.description} bestätigen`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
                  >
                    {busyId === item.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    OK
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
