import { formatCents, formatDateDE } from "@/lib/format";
import type { MonthCalendar } from "@/lib/fixed-cost-calendar";
import { Section } from "@/components/ui/finance";

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Monatsübersicht der anstehenden Fixkosten mit Engpass-Hinweis. */
export function FixedCostCalendar({ calendar, today }: { calendar: MonthCalendar; today: string }) {
  const [year, month] = calendar.month.split("-").map(Number);
  const title = `Fällig im ${MONTHS[month - 1]} ${year}`;
  const upcoming = calendar.entries.filter((e) => e.date >= today);

  if (calendar.entries.length === 0) return null;

  return (
    <Section
      title={title}
      description={`${formatCents(calendar.expenseCents)} Ausgaben${
        calendar.incomeCents > 0 ? ` · ${formatCents(calendar.incomeCents)} Einnahmen` : ""
      }`}
    >
      {calendar.shortfallDate && (
        <p role="status" className="text-sm text-red-600 dark:text-red-400">
          Zum {formatDateDE(calendar.shortfallDate)} reicht der aktuelle Kontostand rechnerisch nicht für alle Fixkosten.
        </p>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {calendar.entries.map((e, i) => {
          const past = e.date < today;
          return (
            <li
              key={`${e.date}-${e.name}-${i}`}
              className={`flex items-baseline justify-between gap-3 py-2 text-sm ${past ? "text-zinc-400" : ""}`}
            >
              <span className="flex items-baseline gap-3 min-w-0">
                <span className="tabular-nums text-xs text-zinc-500 w-12 shrink-0">{formatDateDE(e.date).slice(0, 6)}</span>
                <span className="truncate">{e.name}</span>
              </span>
              <span className="tabular-nums shrink-0">
                {e.type === "income" ? "+" : "−"}
                {formatCents(e.amountCents)}
              </span>
            </li>
          );
        })}
      </ul>
      {upcoming.length === 0 && (
        <p className="text-xs text-zinc-500">In diesem Monat steht nichts mehr an.</p>
      )}
    </Section>
  );
}
