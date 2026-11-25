"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/format";
import type { MonthSummaryData } from "@/lib/month-summary";

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Kurzer Rückblick auf den Vormonat, in den ersten Tagen des Monats. */
export function MonthCloseCard({ summary }: { summary: MonthSummaryData }) {
  const key = `cashflow_month_close_${summary.month}`;
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(key) === "1");
    } catch {
      setHidden(false);
    }
  }, [key]);

  if (hidden) return null;
  const [, m] = summary.month.split("-").map(Number);

  return (
    <section aria-label={`Monatsabschluss ${MONTHS[m - 1]}`} className="border-b border-zinc-200 dark:border-zinc-800 pb-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Rückblick auf {MONTHS[m - 1]}</h2>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(key, "1");
            } catch {
              /* ignorieren */
            }
            setHidden(true);
          }}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Ausblenden
        </button>
      </div>

      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {summary.savedCents >= 0 ? (
          <>
            Du hast <strong className="font-medium tabular-nums">{formatCents(summary.savedCents)}</strong> übrig
            behalten ({summary.savingsRatePercent} % der Einnahmen).
          </>
        ) : (
          <>
            Du hast <strong className="font-medium tabular-nums">{formatCents(-summary.savedCents)}</strong> mehr
            ausgegeben als eingenommen.
          </>
        )}
      </p>

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">Einnahmen</dt>
          <dd className="tabular-nums">{formatCents(summary.incomeCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Ausgaben</dt>
          <dd className="tabular-nums">{formatCents(summary.expenseCents)}</dd>
        </div>
      </dl>

      {summary.biggestIncreases.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1">Mehr als im Vormonat</p>
          <ul className="text-sm space-y-0.5">
            {summary.biggestIncreases.map((c) => (
              <li key={c.categoryId} className="flex justify-between gap-3">
                <span>{c.name}</span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-400">+{formatCents(c.deltaCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.openInboxCount > 0 && (
        <Link href="/inbox" className="inline-block text-sm text-brand hover:underline">
          {summary.openInboxCount} Umsätze noch zu prüfen
        </Link>
      )}
    </section>
  );
}
