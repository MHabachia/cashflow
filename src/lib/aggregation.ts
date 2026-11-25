import { db } from "@/lib/db";
import { transactionSplits } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

/**
 * Gemeinsame Rechenregeln für alle Auswertungen (Dashboard, Jahresbericht,
 * Budgets, Benachrichtigungen):
 *
 * - Umbuchungen (costType "transfer") sind vermögensneutral und zählen nie.
 * - Split-Buchungen werden in ihre Teilbeträge je Kategorie aufgelöst.
 * - Erstattungen: Eine Einnahme mit einer Ausgaben-Kategorie (z. B. Retoure
 *   bei „Kleidung“) verringert die Ausgaben dieser Kategorie, statt das
 *   Einkommen zu erhöhen.
 */

export interface AggregatableTx {
  id: string;
  type: "expense" | "income";
  costType: "variable" | "fixed" | "transfer";
  amountCents: number;
  categoryId: string;
  isSplit?: boolean | null;
}

export interface ExpenseItem {
  categoryId: string;
  /** Positiv = Ausgabe, negativ = Erstattung */
  amountCents: number;
  costType: "fixed" | "variable";
}

export type SplitMap = Map<string, Array<{ categoryId: string; amountCents: number }>>;

/** Lädt die Split-Teile für die übergebenen Buchungen (nur die mit isSplit). */
export function loadSplits(txs: AggregatableTx[]): SplitMap {
  const ids = txs.filter((t) => t.isSplit).map((t) => t.id);
  const map: SplitMap = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db
      .select({
        transactionId: transactionSplits.transactionId,
        categoryId: transactionSplits.categoryId,
        amountCents: transactionSplits.amountCents,
      })
      .from(transactionSplits)
      .where(inArray(transactionSplits.transactionId, chunk))
      .all();
    for (const r of rows) {
      const list = map.get(r.transactionId) ?? [];
      list.push({ categoryId: r.categoryId, amountCents: r.amountCents });
      map.set(r.transactionId, list);
    }
  }
  return map;
}

export function isRefund(
  tx: Pick<AggregatableTx, "type" | "costType" | "categoryId">,
  categoryTypes: Map<string, "expense" | "income">
): boolean {
  return (
    tx.type === "income" &&
    tx.costType !== "transfer" &&
    categoryTypes.get(tx.categoryId) === "expense"
  );
}

/** Zerlegt Buchungen in Ausgabenposten je Kategorie (Splits und Erstattungen berücksichtigt). */
export function toExpenseItems(
  txs: AggregatableTx[],
  categoryTypes: Map<string, "expense" | "income">,
  splits: SplitMap
): ExpenseItem[] {
  const items: ExpenseItem[] = [];
  for (const tx of txs) {
    if (tx.costType === "transfer") continue;
    const refund = isRefund(tx, categoryTypes);
    if (tx.type !== "expense" && !refund) continue;

    const sign = refund ? -1 : 1;
    const costType = tx.costType === "fixed" ? "fixed" : "variable";
    const parts = tx.isSplit ? splits.get(tx.id) : undefined;
    if (parts && parts.length > 0) {
      for (const p of parts) {
        items.push({ categoryId: p.categoryId, amountCents: sign * p.amountCents, costType });
      }
    } else {
      items.push({ categoryId: tx.categoryId, amountCents: sign * tx.amountCents, costType });
    }
  }
  return items;
}

/** Summe echter Einnahmen (ohne Umbuchungen und Erstattungen). */
export function sumIncome(
  txs: AggregatableTx[],
  categoryTypes: Map<string, "expense" | "income">
): number {
  return txs
    .filter((t) => t.type === "income" && t.costType !== "transfer" && !isRefund(t, categoryTypes))
    .reduce((s, t) => s + t.amountCents, 0);
}

export interface ExpenseTotals {
  fixedCents: number;
  variableCents: number;
  byCategory: Record<string, number>;
}

export function summarizeExpenses(items: ExpenseItem[]): ExpenseTotals {
  const totals: ExpenseTotals = { fixedCents: 0, variableCents: 0, byCategory: {} };
  for (const item of items) {
    if (item.costType === "fixed") totals.fixedCents += item.amountCents;
    else totals.variableCents += item.amountCents;
    totals.byCategory[item.categoryId] = (totals.byCategory[item.categoryId] ?? 0) + item.amountCents;
  }
  return totals;
}
