import { occurrencesBetween } from "@/lib/forecast";
import type { RecurringInterval } from "@/lib/db/schema";

export interface CalendarSource {
  name: string;
  type: "expense" | "income";
  amountCents: number;
  interval: RecurringInterval;
  dayOfMonth: number;
  nextDueDate: string;
  active: boolean;
}

export interface CalendarEntry {
  date: string;
  name: string;
  type: "expense" | "income";
  amountCents: number;
  /** Voraussichtlicher Kontostand nach dieser Buchung (nur Fixkosten/Einnahmen) */
  balanceAfterCents: number | null;
}

export interface MonthCalendar {
  month: string; // YYYY-MM
  entries: CalendarEntry[];
  expenseCents: number;
  incomeCents: number;
  /** Erstes Datum, an dem der Kontostand rechnerisch unter 0 fällt */
  shortfallDate: string | null;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${month}-${String(d).padStart(2, "0")}`;
}

/**
 * Alle Fälligkeiten eines Monats in zeitlicher Reihenfolge. Mit einem
 * Startsaldo wird zusätzlich der laufende Kontostand berechnet und ein
 * möglicher Engpass erkannt.
 */
export function buildMonthCalendar(
  sources: CalendarSource[],
  month: string,
  startBalanceCents: number | null = null,
  balanceFromDate: string = `${month}-01`
): MonthCalendar {
  const from = `${month}-01`;
  const to = lastDayOfMonth(month);
  const raw: Omit<CalendarEntry, "balanceAfterCents">[] = [];
  for (const s of sources) {
    if (!s.active) continue;
    for (const date of occurrencesBetween(s.nextDueDate, s.interval, s.dayOfMonth, from, to)) {
      raw.push({ date, name: s.name, type: s.type, amountCents: s.amountCents });
    }
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  let balance = startBalanceCents;
  let expenseCents = 0;
  let incomeCents = 0;
  let shortfallDate: string | null = null;
  const entries: CalendarEntry[] = raw.map((e) => {
    if (e.type === "expense") expenseCents += e.amountCents;
    else incomeCents += e.amountCents;
    if (balance !== null && e.date >= balanceFromDate) {
      balance += e.type === "income" ? e.amountCents : -e.amountCents;
      if (balance < 0 && !shortfallDate) shortfallDate = e.date;
    }
    return { ...e, balanceAfterCents: e.date >= balanceFromDate ? balance : null };
  });

  return { month, entries, expenseCents, incomeCents, shortfallDate };
}
