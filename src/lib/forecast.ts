import { db } from "@/lib/db";
import {
  bankAccounts,
  balanceSnapshots,
  recurringExpenses,
  transactions,
  user as userTable,
  type RecurringInterval,
} from "@/lib/db/schema";
import { addIntervalToDate } from "@/lib/recurring-processor";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

/**
 * Liquiditätsprognose bis Monatsende und Nettovermögen über die Zeit.
 */

const LIQUID_TYPES = new Set(["checking", "cash", "paypal", "credit_card"]);
const VARIABLE_LOOKBACK_DAYS = 90;

export interface UpcomingItem {
  name: string;
  date: string;
  amountCents: number;
  type: "expense" | "income";
}

export interface LiquidityForecast {
  hasAccounts: boolean;
  startBalanceCents: number;
  upcomingExpenseCents: number;
  upcomingIncomeCents: number;
  expectedVariableCents: number;
  averageDailyVariableCents: number;
  remainingDays: number;
  projectedEndBalanceCents: number;
  monthEnd: string;
  upcoming: UpcomingItem[];
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

/** Alle Fälligkeiten eines Postens zwischen `from` und `to` (inklusive). */
export function occurrencesBetween(
  nextDueDate: string,
  interval: RecurringInterval,
  dayOfMonth: number,
  from: string,
  to: string,
  endDate?: string | null
): string[] {
  const dates: string[] = [];
  let due = nextDueDate;
  for (let i = 0; i < 60 && due <= to; i++) {
    if (endDate && due > endDate) break;
    if (due >= from) dates.push(due);
    due = addIntervalToDate(due, interval, dayOfMonth);
  }
  return dates;
}

export function computeLiquidityForecast(userId: string, now: Date = new Date()): LiquidityForecast {
  const today = isoDate(now);
  const monthEnd = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const remainingDays = Number(monthEnd.slice(8, 10)) - Number(today.slice(8, 10)) + 1;

  const accounts = db
    .select({ type: bankAccounts.accountType, balance: bankAccounts.balanceCents })
    .from(bankAccounts)
    .where(eq(bankAccounts.userId, userId))
    .all()
    .filter((a) => LIQUID_TYPES.has(a.type) && a.balance !== null);
  const startBalanceCents = accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);

  const recurring = db
    .select()
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.userId, userId), eq(recurringExpenses.active, true)))
    .all();

  const upcoming: UpcomingItem[] = [];
  for (const r of recurring) {
    for (const date of occurrencesBetween(r.nextDueDate, r.interval, r.dayOfMonth, today, monthEnd, r.endDate)) {
      upcoming.push({ name: r.name, date, amountCents: r.amountCents, type: r.type });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const upcomingExpenseCents = upcoming
    .filter((u) => u.type === "expense")
    .reduce((s, u) => s + u.amountCents, 0);
  const upcomingIncomeCents = upcoming
    .filter((u) => u.type === "income")
    .reduce((s, u) => s + u.amountCents, 0);

  const lookbackStart = shiftDays(today, -VARIABLE_LOOKBACK_DAYS);
  const variable = db
    .select({ total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "expense"),
        eq(transactions.costType, "variable"),
        gte(transactions.date, lookbackStart),
        lt(transactions.date, today)
      )
    )
    .get();
  const averageDailyVariableCents = Math.round((variable?.total ?? 0) / VARIABLE_LOOKBACK_DAYS);
  const expectedVariableCents = averageDailyVariableCents * remainingDays;

  return {
    hasAccounts: accounts.length > 0,
    startBalanceCents,
    upcomingExpenseCents,
    upcomingIncomeCents,
    expectedVariableCents,
    averageDailyVariableCents,
    remainingDays,
    projectedEndBalanceCents:
      startBalanceCents - upcomingExpenseCents + upcomingIncomeCents - expectedVariableCents,
    monthEnd,
    upcoming,
  };
}

// ---------------- Nettovermögen ----------------

export interface BalanceBreakdown {
  liquidCents: number;
  savingsCents: number;
  debtCents: number;
  netWorthCents: number;
}

export function computeBalanceBreakdown(userId: string): BalanceBreakdown {
  const accounts = db
    .select({ type: bankAccounts.accountType, balance: bankAccounts.balanceCents })
    .from(bankAccounts)
    .where(eq(bankAccounts.userId, userId))
    .all();

  let liquidCents = 0;
  let savingsCents = 0;
  let debtCents = 0;
  for (const a of accounts) {
    const bal = a.balance ?? 0;
    if (bal < 0) debtCents += -bal;
    else if (a.type === "savings") savingsCents += bal;
    else liquidCents += bal;
  }
  return { liquidCents, savingsCents, debtCents, netWorthCents: liquidCents + savingsCents - debtCents };
}

/** Speichert den heutigen Vermögensstand (einmal pro Tag, letzter Stand gewinnt). */
export function snapshotBalances(userId: string, date: string = isoDate(new Date())): BalanceBreakdown {
  const b = computeBalanceBreakdown(userId);
  db.insert(balanceSnapshots)
    .values({ userId, date, ...b })
    .onConflictDoUpdate({
      target: [balanceSnapshots.userId, balanceSnapshots.date],
      set: { ...b },
    })
    .run();
  return b;
}

export function snapshotAllUsers(): number {
  const users = db.select({ id: userTable.id }).from(userTable).all();
  for (const u of users) {
    const hasAccounts = db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, u.id))
      .get();
    if (hasAccounts) snapshotBalances(u.id);
  }
  return users.length;
}

export function getNetWorthHistory(userId: string, days = 365) {
  const since = isoDate(new Date(Date.now() - days * 86400000));
  return db
    .select()
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.userId, userId), gte(balanceSnapshots.date, since)))
    .orderBy(asc(balanceSnapshots.date))
    .all();
}
