/**
 * Datumsbereiche für Abfragen auf `transactions.date` (Text `YYYY-MM-DD`).
 *
 * `date >= from AND date < to` kann den Index (user_id, date) nutzen;
 * `substr(date, …) = …` musste jede Buchung des Benutzers lesen. Gerechnet
 * wird nur mit Text, damit keine Zeitzone das Ergebnis verschiebt.
 */

export interface DateRange {
  /** erster Tag, einschließlich */
  from: string;
  /** erster Tag danach, ausschließlich */
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Bereich eines Monats, `month` im Format `YYYY-MM`. */
export function monthRange(month: string): DateRange {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`Ungültiger Monat: ${month}`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  const next = m === 12 ? `${year + 1}-01` : `${year}-${pad(m + 1)}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

/** Bereich eines Kalenderjahres. */
export function yearRange(year: number): DateRange {
  if (!Number.isInteger(year) || year < 1000 || year > 9998) throw new Error(`Ungültiges Jahr: ${year}`);
  return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
}
