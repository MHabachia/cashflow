import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { and, eq, gte, lt } from "drizzle-orm";
import {
  loadSplits,
  sumIncome,
  summarizeExpenses,
  toExpenseItems,
  type AggregatableTx,
} from "@/lib/aggregation";
import { getInboxCount } from "@/lib/inbox";
import { monthRange } from "@/lib/date-range";

export interface CategoryMove {
  categoryId: string;
  name: string;
  amountCents: number;
  previousCents: number;
  deltaCents: number;
}

export interface MonthSummaryData {
  month: string; // YYYY-MM
  incomeCents: number;
  expenseCents: number;
  savedCents: number;
  savingsRatePercent: number;
  topCategories: { categoryId: string; name: string; amountCents: number }[];
  /** Größte Mehrausgaben gegenüber dem Vormonat */
  biggestIncreases: CategoryMove[];
  openInboxCount: number;
  hasData: boolean;
}

export function previousMonthKey(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyBefore(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function loadMonth(userId: string, month: string) {
  const range = monthRange(month);
  const txs = db
    .select({
      id: transactions.id,
      type: transactions.type,
      costType: transactions.costType,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      isSplit: transactions.isSplit,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.date, range.from),
        lt(transactions.date, range.to)
      )
    )
    .all() as AggregatableTx[];
  return txs;
}

/** Zusammenfassung eines abgeschlossenen Monats für den Monatsabschluss. */
export function getMonthSummary(userId: string, month: string): MonthSummaryData {
  const cats = db.select().from(categories).where(eq(categories.userId, userId)).all();
  const catTypes = new Map(cats.map((c) => [c.id, c.type as "expense" | "income"]));
  const catNames = new Map(cats.map((c) => [c.id, c.name]));

  const txs = loadMonth(userId, month);
  const prevTxs = loadMonth(userId, monthKeyBefore(month));

  const totals = summarizeExpenses(toExpenseItems(txs, catTypes, loadSplits(txs)));
  const prevTotals = summarizeExpenses(toExpenseItems(prevTxs, catTypes, loadSplits(prevTxs)));
  const incomeCents = sumIncome(txs, catTypes);
  const expenseCents = totals.fixedCents + totals.variableCents;
  const savedCents = incomeCents - expenseCents;

  const topCategories = Object.entries(totals.byCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([categoryId, amountCents]) => ({
      categoryId,
      name: catNames.get(categoryId) ?? "Sonstiges",
      amountCents,
    }));

  const biggestIncreases: CategoryMove[] = Object.entries(totals.byCategory)
    .map(([categoryId, amountCents]) => {
      const previousCents = prevTotals.byCategory[categoryId] ?? 0;
      return {
        categoryId,
        name: catNames.get(categoryId) ?? "Sonstiges",
        amountCents,
        previousCents,
        deltaCents: amountCents - previousCents,
      };
    })
    // Nur spürbare Abweichungen (ab 20 € und 20 %) und nur bei vorhandenem Vergleichswert
    .filter((m) => m.previousCents > 0 && m.deltaCents >= 2000 && m.deltaCents >= m.previousCents * 0.2)
    .sort((a, b) => b.deltaCents - a.deltaCents)
    .slice(0, 3);

  return {
    month,
    incomeCents,
    expenseCents,
    savedCents,
    savingsRatePercent: incomeCents > 0 ? Math.round((savedCents / incomeCents) * 100) : 0,
    topCategories,
    biggestIncreases,
    openInboxCount: getInboxCount(userId),
    hasData: txs.length > 0,
  };
}
