import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { monthRange } from "@/lib/date-range";

/**
 * Daten für die Umsatzliste. Geladen wird nur der gewählte Monat; „alle“ lädt
 * weiterhin die ganze Historie. Vorher kam immer die ganze Historie in den
 * Browser, obwohl die Liste standardmäßig nur den aktuellen Monat zeigt.
 */

export const ALL_MONTHS = "all";
export type ListMonth = string; // "YYYY-MM" oder ALL_MONTHS

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Liest `?month=` aus der URL; Unbekanntes fällt auf den aktuellen Monat zurück. */
export function parseListMonth(param: string | string[] | undefined, currentMonth: string): ListMonth {
  const value = Array.isArray(param) ? param[0] : param;
  if (value === ALL_MONTHS) return ALL_MONTHS;
  if (value && MONTH_PATTERN.test(value)) return value;
  return currentMonth;
}

export function loadTransactionsForList(userId: string, month: ListMonth) {
  const conditions = [eq(transactions.userId, userId)];
  if (month !== ALL_MONTHS) {
    const range = monthRange(month);
    conditions.push(gte(transactions.date, range.from), lt(transactions.date, range.to));
  }
  return db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all();
}

/** Monate mit Buchungen, neueste zuerst; der aktuelle Monat ist immer dabei. */
export function listAvailableMonths(userId: string, currentMonth: string): string[] {
  const rows = db
    .select({ month: sql<string>`DISTINCT substr(${transactions.date}, 1, 7)` })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .all();
  const months = new Set<string>([currentMonth]);
  for (const row of rows) {
    if (MONTH_PATTERN.test(row.month)) months.add(row.month);
  }
  return Array.from(months).sort().reverse();
}

/** Neueste Buchungen unabhängig vom gewählten Monat (für die Offline-Ansicht). */
export function loadRecentTransactions(userId: string, limit = 15) {
  return db
    .select({
      id: transactions.id,
      description: transactions.description,
      amountCents: transactions.amountCents,
      date: transactions.date,
      type: transactions.type,
      costType: transactions.costType,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit)
    .all();
}
