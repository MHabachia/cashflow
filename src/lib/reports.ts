import { db } from "./db";
import { isRefund, loadSplits, sumIncome, summarizeExpenses, toExpenseItems } from "@/lib/aggregation";
import { transactions, categories } from "./db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export interface MonthSummary {
  month: number;
  monthName: string;
  monthKey: string; // YYYY-MM
  incomeCents: number;
  fixedExpensesCents: number;
  variableExpensesCents: number;
  totalExpensesCents: number;
  savingsCents: number;
  savingsRatePercent: number;
}

export interface CategorySummary {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: "expense" | "income";
  amountCents: number;
  percentOfTotal: number;
}

export interface AnnualReportData {
  year: number;
  availableYears: number[];
  totalIncomeCents: number;
  totalFixedExpensesCents: number;
  totalVariableExpensesCents: number;
  totalExpensesCents: number;
  netSavingsCents: number;
  annualSavingsRatePercent: number;
  monthlyBreakdown: MonthSummary[];
  topExpenseCategories: CategorySummary[];
  topIncomeCategories: CategorySummary[];
  transactionCount: number;
}

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export function getAnnualReportData(userId: string, targetYear: number): AnnualReportData {
  // 1. Verfügbare Jahre ermitteln
  const yearRows = db
    .select({
      year: sql<string>`DISTINCT substr(${transactions.date}, 1, 4)`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .all();

  const currentYear = new Date().getFullYear();
  const availableYearsSet = new Set<number>([currentYear, targetYear]);
  for (const r of yearRows) {
    const y = parseInt(r.year, 10);
    if (!Number.isNaN(y) && y > 2000 && y < 2100) {
      availableYearsSet.add(y);
    }
  }
  const availableYears = Array.from(availableYearsSet).sort((a, b) => b - a);

  // 2. Transaktionen des Zieljahres laden
  const yearPrefix = `${targetYear}-`;
  const txs = db
    .select({
      id: transactions.id,
      date: transactions.date,
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
        sql`substr(${transactions.date}, 1, 5) = ${yearPrefix}`
      )
    )
    .all();

  // 3. Kategorien des Benutzers für Namen/Farben/Icons laden
  const userCats = db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .all();

  const catMap = new Map(userCats.map((c) => [c.id, c]));

  // 4. Monats-Breakdown initialisieren (12 Monate)
  const months: MonthSummary[] = Array.from({ length: 12 }, (_, i) => {
    const monthNum = i + 1;
    const monthKey = `${targetYear}-${String(monthNum).padStart(2, "0")}`;
    return {
      month: monthNum,
      monthName: MONTH_NAMES[i],
      monthKey,
      incomeCents: 0,
      fixedExpensesCents: 0,
      variableExpensesCents: 0,
      totalExpensesCents: 0,
      savingsCents: 0,
      savingsRatePercent: 0,
    };
  });

  const catExpenseTotals = new Map<string, number>();
  const catIncomeTotals = new Map<string, number>();

  let totalIncomeCents = 0;
  let totalFixedExpensesCents = 0;
  let totalVariableExpensesCents = 0;

  // Gemeinsame Rechenregeln (Umbuchungen neutral, Splits aufgelöst,
  // Erstattungen mindern Ausgaben) – siehe lib/aggregation.ts
  const categoryTypes = new Map(userCats.map((c) => [c.id, c.type]));
  const splitMap = loadSplits(txs);

  for (const m of months) {
    const monthTx = txs.filter((t) => t.date.startsWith(m.monthKey));
    const totals = summarizeExpenses(toExpenseItems(monthTx, categoryTypes, splitMap));
    const income = sumIncome(monthTx, categoryTypes);
    m.incomeCents = income;
    m.fixedExpensesCents = totals.fixedCents;
    m.variableExpensesCents = totals.variableCents;
    totalIncomeCents += income;
    totalFixedExpensesCents += totals.fixedCents;
    totalVariableExpensesCents += totals.variableCents;
    for (const [catId, amount] of Object.entries(totals.byCategory)) {
      catExpenseTotals.set(catId, (catExpenseTotals.get(catId) || 0) + amount);
    }
    for (const tx of monthTx) {
      if (tx.type === "income" && tx.costType !== "transfer" && !isRefund(tx, categoryTypes)) {
        catIncomeTotals.set(tx.categoryId, (catIncomeTotals.get(tx.categoryId) || 0) + tx.amountCents);
      }
    }
  }

  // Sparraten und Monatssummen berechnen
  for (const m of months) {
    m.totalExpensesCents = m.fixedExpensesCents + m.variableExpensesCents;
    m.savingsCents = m.incomeCents - m.totalExpensesCents;
    m.savingsRatePercent =
      m.incomeCents > 0
        ? Math.round((m.savingsCents / m.incomeCents) * 100)
        : 0;
  }

  const totalExpensesCents = totalFixedExpensesCents + totalVariableExpensesCents;
  const netSavingsCents = totalIncomeCents - totalExpensesCents;
  const annualSavingsRatePercent =
    totalIncomeCents > 0
      ? Math.round((netSavingsCents / totalIncomeCents) * 100)
      : 0;

  // Kategorien aggregieren & sortieren
  const topExpenseCategories: CategorySummary[] = Array.from(
    catExpenseTotals.entries()
  )
    .filter(([, amount]) => amount > 0)
    .map(([catId, amount]) => {
      const cat = catMap.get(catId);
      return {
        id: catId,
        name: cat?.name || "Sonstiges",
        color: cat?.color || "#6b7280",
        icon: cat?.icon || "ShoppingCart",
        type: "expense" as const,
        amountCents: amount,
        percentOfTotal:
          totalExpensesCents > 0
            ? Math.round((amount / totalExpensesCents) * 100)
            : 0,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents);

  const topIncomeCategories: CategorySummary[] = Array.from(
    catIncomeTotals.entries()
  )
    .map(([catId, amount]) => {
      const cat = catMap.get(catId);
      return {
        id: catId,
        name: cat?.name || "Einnahme",
        color: cat?.color || "#10b981",
        icon: cat?.icon || "Wallet",
        type: "income" as const,
        amountCents: amount,
        percentOfTotal:
          totalIncomeCents > 0 ? Math.round((amount / totalIncomeCents) * 100) : 0,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents);

  return {
    year: targetYear,
    availableYears,
    totalIncomeCents,
    totalFixedExpensesCents,
    totalVariableExpensesCents,
    totalExpensesCents,
    netSavingsCents,
    annualSavingsRatePercent,
    monthlyBreakdown: months,
    topExpenseCategories,
    topIncomeCategories,
    transactionCount: txs.length,
  };
}
