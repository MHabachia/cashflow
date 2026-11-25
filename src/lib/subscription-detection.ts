import { db } from "@/lib/db";
import {
  recurringExpenses,
  subscriptionDismissals,
  transactions,
  type RecurringInterval,
} from "@/lib/db/schema";
import { and, eq, gte, isNull, ne } from "drizzle-orm";

/**
 * Erkennt wiederkehrende Abbuchungen (Abos, Verträge, Versicherungen) in den
 * Umsätzen, die noch nicht als Fixkosten angelegt sind, und meldet
 * Preiserhöhungen.
 */

export interface SubscriptionSuggestion {
  merchantKey: string;
  displayName: string;
  interval: RecurringInterval;
  typicalAmountCents: number;
  lastAmountCents: number;
  previousAmountCents: number;
  priceIncrease: boolean;
  occurrences: number;
  lastDate: string;
  nextExpectedDate: string;
  categoryId: string;
  dayOfMonth: number;
  /** Gesetzt, wenn es bereits Fixkosten gibt, deren Betrag vom Bankumsatz abweicht */
  existingRecurringId?: string;
  existingAmountCents?: number;
}

export interface DetectionTransaction {
  date: string;
  amountCents: number;
  description: string;
  merchant: string | null;
  categoryId: string;
}

const INTERVAL_RULES: Array<{ interval: RecurringInterval; days: number; tolerance: number }> = [
  { interval: "weekly", days: 7, tolerance: 2 },
  { interval: "monthly", days: 30.4, tolerance: 4 },
  { interval: "quarterly", days: 91.3, tolerance: 8 },
  { interval: "half_yearly", days: 182.6, tolerance: 12 },
  { interval: "yearly", days: 365.25, tolerance: 15 },
];

const MIN_OCCURRENCES: Record<RecurringInterval, number> = {
  weekly: 4,
  monthly: 3,
  quarterly: 3,
  half_yearly: 2,
  yearly: 2,
};

/** Normalisiert Händlernamen: Kleinschreibung, ohne Ziffern/Referenzen/Rechtsformen. */
export function normalizeMerchant(merchant: string | null, description: string): string {
  return (merchant || description || "")
    .toLowerCase()
    .replace(/\b(gmbh|ag|se|kg|ltd|inc|b\.v\.|bv|sarl|s\.a\.|co)\b\.?/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-zäöüß ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function addInterval(date: string, interval: RecurringInterval): string {
  const d = new Date(`${date}T00:00:00Z`);
  switch (interval) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "half_yearly":
      d.setUTCMonth(d.getUTCMonth() + 6);
      break;
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Reine Erkennungslogik (ohne Datenbank), damit sie testbar ist.
 */
export function detectSubscriptions(
  txs: DetectionTransaction[],
  options: {
    today?: string;
    existing?: Array<{ id?: string; name: string; amountCents: number }>;
    dismissedKeys?: Set<string>;
  } = {}
): SubscriptionSuggestion[] {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const groups = new Map<string, DetectionTransaction[]>();
  for (const tx of txs) {
    const key = normalizeMerchant(tx.merchant, tx.description);
    if (key.length < 3) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const existingByKey = (options.existing ?? [])
    .map((e) => ({ ...e, key: normalizeMerchant(e.name, e.name) }))
    .filter((e) => e.key.length >= 3);

  const suggestions: SubscriptionSuggestion[] = [];
  for (const [key, list] of groups) {
    if (options.dismissedKeys?.has(key)) continue;
    const existingMatch = existingByKey.find((e) => key.includes(e.key) || e.key.includes(key));

    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) continue;

    const gaps = sorted.slice(1).map((tx, i) => daysBetween(sorted[i].date, tx.date));
    if (gaps.some((g) => g <= 0)) continue; // mehrere Buchungen am selben Tag → kein Abo-Muster
    const typicalGap = median(gaps);
    const rule = INTERVAL_RULES.find((r) => Math.abs(typicalGap - r.days) <= r.tolerance);
    if (!rule) continue;
    if (sorted.length < MIN_OCCURRENCES[rule.interval]) continue;
    // Abstände müssen überwiegend zum Intervall passen
    const regular = gaps.filter((g) => Math.abs(g - rule.days) <= rule.tolerance * 1.5).length;
    if (regular / gaps.length < 0.75) continue;

    const amounts = sorted.map((t) => t.amountCents);
    const typical = median(amounts);
    // Beträge müssen stabil sein (max. 15 % oder 3 € Abweichung vom Median)
    const stable = amounts.filter(
      (a) => Math.abs(a - typical) <= Math.max(typical * 0.15, 300)
    ).length;
    if (stable / amounts.length < 0.75) continue;

    const last = sorted[sorted.length - 1];
    // Abo gilt als beendet, wenn die letzte Buchung deutlich überfällig ist
    if (daysBetween(last.date, today) > rule.days * 1.6 + rule.tolerance) continue;

    const previous = sorted[sorted.length - 2];
    const priceIncrease =
      last.amountCents > previous.amountCents &&
      last.amountCents - previous.amountCents >= Math.max(previous.amountCents * 0.02, 50);

    const name = (last.merchant || last.description).trim().slice(0, 60);

    if (existingMatch) {
      // Bereits als Fixkosten erfasst: nur melden, wenn die Bank inzwischen mehr abbucht
      const diff = last.amountCents - existingMatch.amountCents;
      if (!existingMatch.id || diff < Math.max(existingMatch.amountCents * 0.02, 50)) continue;
    }

    suggestions.push({
      merchantKey: key,
      displayName: name,
      interval: rule.interval,
      typicalAmountCents: Math.round(typical),
      lastAmountCents: last.amountCents,
      previousAmountCents: previous.amountCents,
      priceIncrease,
      occurrences: sorted.length,
      lastDate: last.date,
      nextExpectedDate: addInterval(last.date, rule.interval),
      categoryId: last.categoryId,
      dayOfMonth: Number(last.date.slice(8, 10)),
      ...(existingMatch
        ? {
            existingRecurringId: existingMatch.id,
            existingAmountCents: existingMatch.amountCents,
            priceIncrease: true,
          }
        : {}),
    });
  }

  return suggestions.sort((a, b) => b.typicalAmountCents - a.typicalAmountCents);
}

/** Erkennt Abo-Vorschläge für einen Benutzer aus den letzten 15 Monaten. */
export function getSubscriptionSuggestions(userId: string): SubscriptionSuggestion[] {
  const since = new Date(Date.now() - 456 * 86400000).toISOString().slice(0, 10);
  const txs = db
    .select({
      date: transactions.date,
      amountCents: transactions.amountCents,
      description: transactions.description,
      merchant: transactions.merchant,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "expense"),
        ne(transactions.costType, "transfer"),
        isNull(transactions.recurringId),
        gte(transactions.date, since)
      )
    )
    .all();

  const existing = db
    .select({
      id: recurringExpenses.id,
      name: recurringExpenses.name,
      amountCents: recurringExpenses.amountCents,
    })
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.userId, userId), eq(recurringExpenses.active, true)))
    .all();

  const dismissed = new Set(
    db
      .select({ key: subscriptionDismissals.merchantKey })
      .from(subscriptionDismissals)
      .where(eq(subscriptionDismissals.userId, userId))
      .all()
      .map((d) => d.key)
  );

  return detectSubscriptions(txs, { existing, dismissedKeys: dismissed });
}
