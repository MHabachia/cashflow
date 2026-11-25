"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TrendingUp, X } from "lucide-react";
import {
  acceptSubscriptionSuggestionAction,
  applyPriceIncreaseAction,
  dismissSubscriptionSuggestionAction,
} from "@/actions/subscription-actions";
import { formatCents, formatDateDE } from "@/lib/format";
import type { SubscriptionSuggestion } from "@/lib/subscription-detection";

const INTERVAL_LABELS: Record<string, string> = {
  weekly: "wöchentlich",
  monthly: "monatlich",
  quarterly: "vierteljährlich",
  half_yearly: "halbjährlich",
  yearly: "jährlich",
};

export function SubscriptionSuggestions({
  suggestions,
}: {
  suggestions: SubscriptionSuggestion[];
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const visible = suggestions.filter((s) => !hidden.has(s.merchantKey));
  if (visible.length === 0) return null;

  async function run(key: string, fn: () => Promise<{ success: boolean; error?: string }>, msg: string) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (res.success) {
      toast.success(msg);
      setHidden((h) => new Set(h).add(key));
      router.refresh();
    } else {
      toast.error(res.error || "Aktion fehlgeschlagen.");
    }
  }

  return (
    <section aria-labelledby="subs-heading" className="space-y-3 pb-6 mb-6 border-b border-zinc-200/80 dark:border-zinc-800 max-w-4xl mx-auto">
      <div>
        <h2 id="subs-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Erkannte Abos und Verträge
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Regelmäßige Abbuchungen, die noch nicht als Fixkosten erfasst sind.
        </p>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {visible.map((s) => (
          <li key={s.merchantKey} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {s.displayName}
              </p>
              <p className="text-xs text-zinc-500">
                {formatCents(s.lastAmountCents)} {INTERVAL_LABELS[s.interval]} · {s.occurrences}× gebucht ·
                nächste etwa{" "}
                {formatDateDE(s.nextExpectedDate)}
              </p>
              {s.priceIncrease && (
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                  <TrendingUp className="w-3 h-3" aria-hidden="true" />
                  Preiserhöhung: {formatCents(s.existingAmountCents ?? s.previousAmountCents)} →{" "}
                  {formatCents(s.lastAmountCents)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {s.existingRecurringId ? (
                <button
                  type="button"
                  disabled={busy === s.merchantKey}
                  onClick={() =>
                    run(
                      s.merchantKey,
                      () => applyPriceIncreaseAction(s.existingRecurringId!, s.lastAmountCents),
                      "Fixkosten an neuen Preis angepasst."
                    )
                  }
                  className="px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
                >
                  Betrag anpassen
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === s.merchantKey}
                  onClick={() =>
                    run(
                      s.merchantKey,
                      () => acceptSubscriptionSuggestionAction(s.merchantKey),
                      "Als Fixkosten übernommen."
                    )
                  }
                  className="px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
                >
                  Als Fixkosten übernehmen
                </button>
              )}
              <button
                type="button"
                disabled={busy === s.merchantKey}
                onClick={() =>
                  run(
                    s.merchantKey,
                    () => dismissSubscriptionSuggestionAction(s.merchantKey),
                    "Vorschlag ausgeblendet."
                  )
                }
                aria-label={`Vorschlag ${s.displayName} ausblenden`}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
