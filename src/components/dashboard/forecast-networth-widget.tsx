import { formatCents, formatDateDE, shiftedLocalISODate } from "@/lib/format";
import type { LiquidityForecast } from "@/lib/forecast";
import { Amount, EmptyHint, Section } from "@/components/ui/finance";

interface NetWorthPoint {
  date: string;
  netWorthCents: number;
}

function Sparkline({ points }: { points: NetWorthPoint[] }) {
  const w = 240;
  const h = 40;
  const values = points.map((p) => p.netWorthCents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.netWorthCents - min) / range) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" role="img" aria-label="Verlauf des Nettovermögens">
      <path d={d} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="stroke-zinc-500" />
    </svg>
  );
}

function Row({ label, cents, sign }: { label: string; cents: number; sign: "+" | "−" | "" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm py-1.5">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="tabular-nums text-zinc-900 dark:text-zinc-100">
        {sign}
        {formatCents(cents)}
      </dd>
    </div>
  );
}

export function ForecastNetWorthWidget({
  forecast,
  history,
  currentNetWorthCents,
}: {
  forecast: LiquidityForecast;
  history: NetWorthPoint[];
  currentNetWorthCents: number;
}) {
  const projected = forecast.projectedEndBalanceCents;
  const cutoff = shiftedLocalISODate(-30);
  const reference = history.find((p) => p.date >= cutoff);
  const change30 = reference ? currentNetWorthCents - reference.netWorthCents : null;

  return (
    <div className="grid gap-10 sm:grid-cols-2">
      <Section
        title="Kontostand am Monatsende"
        description={forecast.hasAccounts ? `Prognose für den ${formatDateDE(forecast.monthEnd)}` : undefined}
      >
        {!forecast.hasAccounts ? (
          <EmptyHint>Lege ein Konto mit Kontostand an, um eine Prognose zu sehen.</EmptyHint>
        ) : (
          <>
            <Amount cents={projected} size="lg" tone={projected < 0 ? "negative" : "neutral"} />
            <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <Row label="Heute auf Giro, Karten und bar" cents={forecast.startBalanceCents} sign="" />
              {forecast.upcomingExpenseCents > 0 && (
                <Row label="Anstehende Fixkosten" cents={forecast.upcomingExpenseCents} sign="−" />
              )}
              {forecast.upcomingIncomeCents > 0 && (
                <Row label="Erwartete Einnahmen" cents={forecast.upcomingIncomeCents} sign="+" />
              )}
              <Row
                label={`Übliche Ausgaben, ${forecast.remainingDays} ${forecast.remainingDays === 1 ? "Tag" : "Tage"}`}
                cents={forecast.expectedVariableCents}
                sign="−"
              />
            </dl>
            {projected < 0 && (
              <p role="status" className="text-sm text-red-600 dark:text-red-400">
                Das Konto könnte bis Monatsende ins Minus geraten.
              </p>
            )}
          </>
        )}
      </Section>

      <Section title="Nettovermögen" description="Konten und Sparkonten abzüglich Schulden">
        <Amount cents={currentNetWorthCents} size="lg" tone={currentNetWorthCents < 0 ? "negative" : "neutral"} />
        {change30 !== null && change30 !== 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 tabular-nums">
            {change30 > 0 ? "+" : "−"}
            {formatCents(Math.abs(change30))} in 30 Tagen
          </p>
        )}
        {history.length >= 2 ? (
          <Sparkline points={history} />
        ) : (
          <EmptyHint>Der Verlauf wird ab heute täglich gespeichert.</EmptyHint>
        )}
      </Section>
    </div>
  );
}
