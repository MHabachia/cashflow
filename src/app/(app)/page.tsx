import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import {
  categories,
  recurringExpenses,
  transactions,
  budgets,
  bankAccounts,
  savingsGoals,
  type RecurringInterval,
} from "@/lib/db/schema";
import { and, eq, desc, asc, gte, count } from "drizzle-orm";
import { loadSplits, sumIncome, summarizeExpenses, toExpenseItems } from "@/lib/aggregation";
import { formatCents, formatDateDE } from "@/lib/format";
import { CategoryIcon } from "@/components/ui/category-icon";
import { SavingsGoalsSection } from "@/components/savings/savings-goals-section";
import {
  CustomizeDashboardButton,
  DashboardWidgetSystem,
  DashboardWidget,
} from "@/components/dashboard/dashboard-widget-system";
import { Amount, EmptyHint, Meter, Section } from "@/components/ui/finance";
import dynamic from "next/dynamic";
import type {
  CategoryBreakdownItem,
  MonthlyTrendItem,
} from "@/components/dashboard/dashboard-charts";

const MonthlyBarChart = dynamic(() =>
  import("@/components/dashboard/dashboard-charts").then(
    (m) => m.MonthlyBarChart
  )
);

import Link from "next/link";
import { MonthCloseCard } from "@/components/dashboard/month-close-card";
import { getMonthSummary, previousMonthKey } from "@/lib/month-summary";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { ForecastNetWorthWidget } from "@/components/dashboard/forecast-networth-widget";
import {
  computeBalanceBreakdown,
  computeLiquidityForecast,
  getNetWorthHistory,
  recurringPaymentDates,
  unpaidOccurrences,
} from "@/lib/forecast";
import { RECURRING_MATCH_WINDOW_DAYS, shiftIsoDate } from "@/lib/recurring-matching";
import { getInboxCount } from "@/lib/inbox";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

const MONTH_NAMES_FULL = [
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

function getMonthlyEquivalentCents(
  amountCents: number,
  interval: RecurringInterval
): number {
  switch (interval) {
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "monthly":
      return amountCents;
    case "quarterly":
      return Math.round(amountCents / 3);
    case "half_yearly":
      return Math.round(amountCents / 6);
    case "yearly":
      return Math.round(amountCents / 12);
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const user = await requireUser();

  const userCategories = db
    .select()
    .from(categories)
    .where(eq(categories.userId, user.id))
    .all();

  const catMap = Object.fromEntries(userCategories.map((c) => [c.id, c]));

  // Monatsauswahl früh auswerten, um nur den benötigten Zeitraum zu laden
  const nowForWindow = new Date();
  const resolvedParams: { month?: string } = searchParams ? await searchParams : {};
  const requestedMonth = resolvedParams.month;
  const windowAnchor =
    requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
      ? new Date(Number(requestedMonth.slice(0, 4)), Number(requestedMonth.slice(5, 7)) - 1, 1)
      : nowForWindow;
  const earliest = windowAnchor < nowForWindow ? windowAnchor : nowForWindow;
  const windowStartDate = new Date(earliest.getFullYear(), earliest.getMonth() - 11, 1);
  const windowStart = `${windowStartDate.getFullYear()}-${String(windowStartDate.getMonth() + 1).padStart(2, "0")}-01`;

  // Nur die letzten 12 Monate (bzw. ab ausgewähltem Monat) laden statt aller Jahre
  const allTransactions = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, user.id), gte(transactions.date, windowStart)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all();
  const totalTransactionCount =
    db
      .select({ value: count() })
      .from(transactions)
      .where(eq(transactions.userId, user.id))
      .get()?.value ?? 0;

  const userBudgets = db
    .select()
    .from(budgets)
    .where(eq(budgets.userId, user.id))
    .all();

  const userFixed = db
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.userId, user.id))
    .orderBy(asc(recurringExpenses.dayOfMonth))
    .all();

  const userBankAccounts = db
    .select({
      id: bankAccounts.id,
      balanceCents: bankAccounts.balanceCents,
      accountName: bankAccounts.accountName,
      accountType: bankAccounts.accountType,
      ibanMasked: bankAccounts.ibanMasked,
      autoSync: bankAccounts.autoSync,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.userId, user.id))
    .all();

  const userSavingsGoals = db
    .select()
    .from(savingsGoals)
    .where(
      and(eq(savingsGoals.userId, user.id), eq(savingsGoals.isArchived, false))
    )
    .orderBy(desc(savingsGoals.createdAt))
    .all();

  const bankAccountMap = Object.fromEntries(
    userBankAccounts.map((a) => [a.id, a])
  );

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentMonthPrefix = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;

  // Optionaler Monats-Filter (z. B. ?month=2026-10)
  let selectedYear = currentYear;
  let selectedMonth = currentMonth;

  if (
    resolvedParams.month &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(resolvedParams.month)
  ) {
    const [y, m] = resolvedParams.month.split("-").map(Number);
    selectedYear = y;
    selectedMonth = m;
  }

  const selectedMonthPrefix = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
  const isCurrentMonth = selectedMonthPrefix === currentMonthPrefix;
  const inboxCount = getInboxCount(user.id);
  const isFutureMonth = selectedMonthPrefix > currentMonthPrefix;

  // Vorheriger und nächster Monat für die Navigation
  const prevDate = new Date(selectedYear, selectedMonth - 2, 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const nextDate = new Date(selectedYear, selectedMonth, 1);
  const nextMonthKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;

  // 1. Ausgaben & Einnahmen des ausgewählten Monats
  const currentMonthTx = allTransactions.filter((t) =>
    t.date.startsWith(selectedMonthPrefix)
  );

  // Gemeinsame Rechenregeln: Umbuchungen neutral, Splits aufgelöst,
  // Erstattungen mindern die Ausgaben ihrer Kategorie (siehe lib/aggregation.ts)
  const categoryTypes = new Map(userCategories.map((c) => [c.id, c.type]));
  const splitMap = loadSplits(allTransactions);
  const monthTotals = summarizeExpenses(toExpenseItems(currentMonthTx, categoryTypes, splitMap));
  const monthFixedExpenses = monthTotals.fixedCents;
  const monthVariableExpenses = monthTotals.variableCents;
  const monthIncome = sumIncome(currentMonthTx, categoryTypes);
  const spentByCategory: Record<string, number> = monthTotals.byCategory;

  // Geplante monatliche Fixeinnahmen & Fixkosten
  let plannedMonthlyIncome = 0;
  let plannedMonthlyFixedExpenses = 0;
  for (const f of userFixed) {
    if (!f.active) continue;
    const eq = getMonthlyEquivalentCents(f.amountCents, f.interval);
    if (f.type === "income") {
      plannedMonthlyIncome += eq;
    } else {
      plannedMonthlyFixedExpenses += eq;
    }
  }

  // In Zukunftsmonaten ohne erfasste Buchungen die bekannten geplanten Fixkosten als Prognose verwenden
  const isFutureForecast = isFutureMonth && currentMonthTx.length === 0;
  const displayFixedExpenses = isFutureForecast
    ? plannedMonthlyFixedExpenses
    : monthFixedExpenses;
  const displayIncome = isFutureForecast
    ? plannedMonthlyIncome
    : monthIncome;
  const displayVariableExpenses = monthVariableExpenses;
  const monthTotalExpenses = displayFixedExpenses + displayVariableExpenses;
  const netCashflow = displayIncome - monthTotalExpenses;

  // Tägliches Restbudget & verbleibende Tage
  const totalDaysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const currentDay = now.getDate();
  const daysRemaining = isCurrentMonth
    ? Math.max(1, totalDaysInMonth - currentDay + 1)
    : totalDaysInMonth;

  // Globales Monatsbudget (falls definiert)
  const globalBudget = userBudgets.find((b) => !b.categoryId);

  // Bis Monatsende noch anstehende Fixkosten/-einnahmen (ab heute), damit das
  // Tagesbudget z. B. die Miete am 28. bereits berücksichtigt
  let upcomingFixedExpenseCents = 0;
  let upcomingFixedIncomeCents = 0;
  if (isCurrentMonth) {
    const todayKey = `${currentMonthPrefix}-${String(now.getDate()).padStart(2, "0")}`;
    const monthEndKey = `${currentMonthPrefix}-${String(totalDaysInMonth).padStart(2, "0")}`;
    // Bereits gebuchte oder von der Bank (auch vor dem Fälligkeitstag)
    // abgebuchte Fälligkeiten nicht zusätzlich als anstehend abziehen
    const paymentDates = recurringPaymentDates(
      user.id,
      shiftIsoDate(todayKey, -RECURRING_MATCH_WINDOW_DAYS),
      shiftIsoDate(monthEndKey, RECURRING_MATCH_WINDOW_DAYS)
    );
    for (const f of userFixed) {
      if (!f.active) continue;
      const pending = unpaidOccurrences(f, todayKey, monthEndKey, paymentDates);
      if (f.type === "income") upcomingFixedIncomeCents += pending.length * f.amountCents;
      else upcomingFixedExpenseCents += pending.length * f.amountCents;
    }
  }
  const availableAfterFixedCents = netCashflow - upcomingFixedExpenseCents + upcomingFixedIncomeCents;

  // Tagesbudget: Mit Gesamtbudget dessen Rest, sonst der freie Betrag nach anstehenden Fixkosten
  let dailyBudgetCents: number | null = null;
  if (globalBudget) {
    const rest = globalBudget.amountCents - monthTotalExpenses - upcomingFixedExpenseCents;
    if (rest > 0) dailyBudgetCents = Math.round(rest / daysRemaining);
  } else if (availableAfterFixedCents > 0 && displayIncome > 0) {
    dailyBudgetCents = Math.round(availableAfterFixedCents / daysRemaining);
  }

  const totalBankBalanceCents = userBankAccounts.reduce(
    (sum, acc) => sum + (acc.balanceCents !== null ? acc.balanceCents : 0),
    0
  );
  const hasBankAccounts = userBankAccounts.length > 0;

  // 2. Verteilung nach Kategorie
  const categoryBreakdown: CategoryBreakdownItem[] = Object.entries(
    spentByCategory
  )
    .filter(([, amountCents]) => amountCents > 0)
    .map(([categoryId, amountCents]) => {
      const cat = catMap[categoryId];
      return {
        categoryId,
        name: cat?.name || "Sonstiges",
        color: cat?.color || "#64748b",
        amountCents,
        percentage:
          monthTotalExpenses > 0
            ? Math.round((amountCents / monthTotalExpenses) * 100)
            : 0,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents);

  // 3. Verlauf der letzten 12 Monate
  const last12Months: MonthlyTrendItem[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const label = MONTH_NAMES_SHORT[m - 1];

    const monthTx = allTransactions.filter((tx) => tx.date.startsWith(key));
    const totals = summarizeExpenses(toExpenseItems(monthTx, categoryTypes, splitMap));
    const fixedCents = totals.fixedCents;
    const variableCents = totals.variableCents;

    last12Months.push({
      monthKey: key,
      label,
      fixedCents,
      variableCents,
      totalCents: fixedCents + variableCents,
    });
  }

  // 4. Monatsbudgets
  const budgetStatuses = userBudgets
    .map((b) => {
      const isGlobal = !b.categoryId;
      const cat = b.categoryId ? catMap[b.categoryId] : null;
      const spentCents = isGlobal
        ? monthTotalExpenses
        : spentByCategory[b.categoryId!] || 0;
      const percent =
        b.amountCents > 0 ? Math.round((spentCents / b.amountCents) * 100) : 0;

      return {
        id: b.id,
        categoryId: b.categoryId,
        name: isGlobal ? "Gesamtbudget" : cat?.name || "Kategorie",
        color: isGlobal ? "#2563eb" : cat?.color || "#3b82f6",
        icon: isGlobal ? "Wallet" : cat?.icon || "ShoppingCart",
        limitCents: b.amountCents,
        spentCents,
        percent,
        status:
          percent >= 100 ? "exceeded" : percent >= 80 ? "warning" : "normal",
      };
    })
    .sort((a, b) => b.percent - a.percent);

  const budgetsExceeded = budgetStatuses.filter((b) => b.status === "exceeded").length;
  const budgetsWarning = budgetStatuses.filter((b) => b.status === "warning").length;

  const recentTransactions = allTransactions.slice(0, 6);

  // Cashflow-Verhältnis für den Fortschrittsbalken
  const baseIncome = displayIncome > 0 ? displayIncome : plannedMonthlyIncome;
  const fixedPercent =
    baseIncome > 0
      ? Math.min(100, Math.round((displayFixedExpenses / baseIncome) * 100))
      : 0;
  const variablePercent =
    baseIncome > 0
      ? Math.min(
          100 - fixedPercent,
          Math.round((displayVariableExpenses / baseIncome) * 100)
        )
      : 0;
  const remainingPercent = Math.max(0, 100 - fixedPercent - variablePercent);

  const monthLabel = `${MONTH_NAMES_FULL[selectedMonth - 1]} ${selectedYear}`;
  const activeFixed = userFixed.filter((f) => f.active && f.type === "expense");

  // Hauptzahl: im laufenden Monat der freie Betrag nach anstehenden Fixkosten,
  // sonst die Monatsbilanz
  const hero = (() => {
    if (isCurrentMonth && displayIncome > 0) {
      return { label: "Verfügbar bis Monatsende", cents: availableAfterFixedCents, signed: false };
    }
    if (isCurrentMonth) {
      return { label: "Ausgaben diesen Monat", cents: -monthTotalExpenses, signed: false };
    }
    if (isFutureForecast) {
      return { label: `Geplante Bilanz ${monthLabel}`, cents: netCashflow, signed: true };
    }
    return { label: `Bilanz ${monthLabel}`, cents: netCashflow, signed: true };
  })();

  return (
    <div className="max-w-7xl mx-auto pb-16 space-y-8">
      <DashboardWidgetSystem>
        {/* Kopfzeile: Monat wechseln, Aktionen */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Link
              href={`/?month=${prevMonthKey}`}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Vorheriger Monat"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </Link>
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 min-w-36 text-center">
              {monthLabel}
            </h1>
            <Link
              href={`/?month=${nextMonthKey}`}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Nächster Monat"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            {!isCurrentMonth && (
              <Link
                href="/"
                className="ml-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Zum aktuellen Monat
              </Link>
            )}
          </div>

          <div className="flex items-center gap-1">
            <CustomizeDashboardButton />
            <Link
              href="/transactions"
              className="hidden sm:inline-flex items-center px-2.5 py-1.5 rounded-md text-sm text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Importieren
            </Link>
            {/* Auf dem Handy übernimmt der runde „+“-Knopf das Erfassen */}
            <Link
              href="/transactions?quickAdd=1"
              className="hidden sm:inline-flex items-center gap-1.5 ml-1 px-3 py-1.5 rounded-md bg-brand text-white text-sm font-medium hover:opacity-90"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Buchung erfassen
            </Link>
          </div>
        </div>

        {isCurrentMonth && new Date().getDate() <= 10 && (() => {
          const summary = getMonthSummary(user.id, previousMonthKey(new Date()));
          return summary.hasData ? <MonthCloseCard summary={summary} /> : null;
        })()}

        <GettingStarted
          hasAccount={userBankAccounts.length > 0}
          hasTransaction={totalTransactionCount > 0}
          hasBudget={userBudgets.length > 0}
        />

        {inboxCount > 0 && (
          <Link
            href="/inbox"
            className="flex items-center justify-between gap-3 py-2.5 px-3 -mx-3 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand" aria-hidden="true" />
              {inboxCount === 1 ? "1 neuer Umsatz" : `${inboxCount} neue Umsätze`} zu prüfen
            </span>
            <span className="text-zinc-400" aria-hidden="true">
              <ChevronRight className="w-4 h-4" />
            </span>
          </Link>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-12 gap-y-10 items-start">
          {/* Linke Spalte */}
          <div className="lg:col-span-8 space-y-10">
            <DashboardWidget id="hero_balance">
              <section className="space-y-6">
                <div className="space-y-1">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{hero.label}</p>
                  <Amount
                    cents={hero.cents}
                    size="xl"
                    signed={hero.signed}
                    tone={hero.cents < 0 ? "negative" : "neutral"}
                  />
                  {isCurrentMonth && dailyBudgetCents !== null && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      etwa <Amount cents={dailyBudgetCents} /> pro Tag · noch {daysRemaining}{" "}
                      {daysRemaining === 1 ? "Tag" : "Tage"}
                      {upcomingFixedExpenseCents > 0 && (
                        <>
                          {" "}· <Amount cents={upcomingFixedExpenseCents} className="text-zinc-500 dark:text-zinc-400" /> Fixkosten stehen noch an
                        </>
                      )}
                    </p>
                  )}
                  {isCurrentMonth && displayIncome > 0 && netCashflow < 0 && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Bisher <Amount cents={Math.abs(netCashflow)} className="text-red-600 dark:text-red-400" /> mehr ausgegeben als eingenommen.
                    </p>
                  )}
                </div>

                <dl className="grid grid-cols-3 gap-4 border-y border-zinc-200 dark:border-zinc-800 py-4">
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">
                      Einnahmen{isFutureForecast ? " (geplant)" : ""}
                    </dt>
                    <dd className="mt-1">
                      <Amount cents={displayIncome} size="md" />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">
                      Fixkosten{isFutureForecast ? " (geplant)" : ""}
                    </dt>
                    <dd className="mt-1">
                      <Amount cents={displayFixedExpenses} size="md" />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">Variable Ausgaben</dt>
                    <dd className="mt-1">
                      <Amount cents={displayVariableExpenses} size="md" />
                    </dd>
                  </div>
                </dl>

                {baseIncome > 0 && (
                  <div className="space-y-2">
                    <div
                      className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden flex"
                      role="img"
                      aria-label={`${fixedPercent} % Fixkosten, ${variablePercent} % variable Ausgaben, ${remainingPercent} % frei`}
                    >
                      <div className="bg-brand" style={{ width: `${fixedPercent}%` }} />
                      <div className="bg-zinc-300 dark:bg-zinc-600" style={{ width: `${variablePercent}%` }} />
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap gap-x-4 gap-y-1">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-brand" aria-hidden="true" />
                        {fixedPercent} % Fixkosten
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600" aria-hidden="true" />
                        {variablePercent} % variabel
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700" aria-hidden="true" />
                        {remainingPercent} % frei
                      </span>
                    </p>
                  </div>
                )}
              </section>
            </DashboardWidget>

            <DashboardWidget id="recent_transactions">
              <Section
                title="Letzte Buchungen"
                description={`${totalTransactionCount} Buchungen insgesamt`}
                action={{ href: "/transactions", label: "Alle anzeigen" }}
              >
                {recentTransactions.length === 0 ? (
                  <EmptyHint action={{ href: "/transactions?quickAdd=1", label: "Erste Buchung erfassen" }}>
                    Noch keine Buchungen. Erfasse eine Ausgabe oder importiere einen Kontoauszug.
                  </EmptyHint>
                ) : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {recentTransactions.map((tx) => {
                      const cat = catMap[tx.categoryId];
                      const bankAcc = tx.bankAccountId ? bankAccountMap[tx.bankAccountId] : null;
                      const isIncome = tx.type === "income";
                      return (
                        <li key={tx.id} className="py-3 flex items-center gap-3">
                          <span className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 shrink-0">
                            <CategoryIcon name={cat?.icon || "ShoppingCart"} className="w-4 h-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{tx.description}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                              {formatDateDE(tx.date)} · {cat?.name || "Ohne Kategorie"}
                              {bankAcc ? ` · ${bankAcc.accountName}` : ""}
                            </p>
                          </div>
                          <Amount
                            cents={isIncome ? tx.amountCents : -tx.amountCents}
                            signed={isIncome}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            </DashboardWidget>

            {isCurrentMonth && (
              <DashboardWidget id="forecast">
                <ForecastNetWorthWidget
                  forecast={computeLiquidityForecast(user.id)}
                  history={getNetWorthHistory(user.id).map((h) => ({
                    date: h.date,
                    netWorthCents: h.netWorthCents,
                  }))}
                  currentNetWorthCents={computeBalanceBreakdown(user.id).netWorthCents}
                />
              </DashboardWidget>
            )}

            <DashboardWidget id="fixed_costs">
              <Section
                title="Fixkosten"
                description={
                  <>
                    <Amount cents={plannedMonthlyFixedExpenses} className="text-zinc-500 dark:text-zinc-400 text-xs" /> pro Monat
                  </>
                }
                action={{ href: "/recurring", label: "Verwalten" }}
              >
                {activeFixed.length === 0 ? (
                  <EmptyHint action={{ href: "/recurring", label: "Fixkosten anlegen" }}>Noch keine Fixkosten angelegt.</EmptyHint>
                ) : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {activeFixed.slice(0, 5).map((f) => (
                      <li key={f.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{f.name}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">am {f.dayOfMonth}. des Monats</p>
                        </div>
                        <Amount cents={f.amountCents} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </DashboardWidget>

            <DashboardWidget id="trend_chart">
              <Section title="Ausgaben der letzten 12 Monate">
                <MonthlyBarChart data={last12Months} />
              </Section>
            </DashboardWidget>
          </div>

          {/* Rechte Spalte */}
          <div className="lg:col-span-4 space-y-10">
            <DashboardWidget id="accounts">
              <Section title="Konten" action={{ href: "/banking", label: "Banking" }}>
                {userBankAccounts.length === 0 ? (
                  <EmptyHint action={{ href: "/banking", label: "Konto hinzufügen" }}>Noch kein Konto.</EmptyHint>
                ) : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {userBankAccounts.slice(0, 6).map((acc) => (
                      <li key={acc.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{acc.accountName}</p>
                          {acc.ibanMasked && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums truncate">
                              {acc.ibanMasked.replace(/\*+/g, "•••").replace(/(\s•••)+/g, " •••")}
                            </p>
                          )}
                        </div>
                        {acc.balanceCents !== null ? (
                          <Amount cents={acc.balanceCents} tone={acc.balanceCents < 0 ? "negative" : "neutral"} />
                        ) : (
                          <span className="text-sm text-zinc-400">–</span>
                        )}
                      </li>
                    ))}
                    <li className="pt-2.5 flex items-center justify-between gap-3">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">Summe</span>
                      <Amount cents={totalBankBalanceCents} tone={totalBankBalanceCents < 0 ? "negative" : "neutral"} className="font-semibold" />
                    </li>
                  </ul>
                )}
              </Section>
            </DashboardWidget>

            <DashboardWidget id="budgets">
              <Section
                title="Budgets"
                description={
                  budgetStatuses.length === 0
                    ? undefined
                    : budgetsExceeded > 0
                      ? `${budgetsExceeded} überschritten`
                      : budgetsWarning > 0
                        ? `${budgetsWarning} fast aufgebraucht`
                        : "Alle im Rahmen"
                }
                action={{ href: "/categories?tab=budgets", label: "Bearbeiten" }}
              >
                {budgetStatuses.length === 0 ? (
                  <EmptyHint action={{ href: "/categories?tab=budgets", label: "Erstes Budget anlegen" }}>Noch keine Budgets.</EmptyHint>
                ) : (
                  <ul className="space-y-4">
                    {budgetStatuses.map((b) => (
                      <li key={b.id} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-zinc-900 dark:text-zinc-100 truncate">{b.name}</span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
                            <Amount
                              cents={b.spentCents}
                              tone={b.status === "exceeded" ? "negative" : "neutral"}
                              className="text-xs"
                            />{" "}
                            von {formatCents(b.limitCents)}
                          </span>
                        </div>
                        <Meter
                          percent={b.percent}
                          status={b.status as "normal" | "warning" | "exceeded"}
                          label={`${b.name}: ${b.percent} % genutzt`}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </DashboardWidget>

            <DashboardWidget id="categories">
              <Section
                title="Ausgaben nach Kategorie"
                action={{ href: "/categories", label: "Alle" }}
              >
                {categoryBreakdown.length === 0 ? (
                  <EmptyHint>Noch keine Ausgaben in diesem Monat.</EmptyHint>
                ) : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {categoryBreakdown.slice(0, 6).map((c) => (
                      <li key={c.categoryId} className="py-2 flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0 opacity-70"
                            style={{ backgroundColor: c.color }}
                            aria-hidden="true"
                          />
                          <span className="text-zinc-900 dark:text-zinc-100 truncate">{c.name}</span>
                        </span>
                        <span className="flex items-baseline gap-2 shrink-0">
                          <span className="text-xs text-zinc-400 tabular-nums">{c.percentage} %</span>
                          <Amount cents={c.amountCents} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </DashboardWidget>

            <DashboardWidget id="savings">
              <SavingsGoalsSection goals={userSavingsGoals} />
            </DashboardWidget>

            <DashboardWidget id="tools">
              <Section title="Werkzeuge">
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
                  {[
                    { href: "/transactions", label: "Kontoauszug importieren" },
                    { href: "/tools", label: "Export und Sicherungen" },
                    { href: "/reports", label: "Jahresbericht" },
                  ].map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="py-2.5 flex items-center justify-between text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        {l.label}
                        <ChevronRight className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
            </DashboardWidget>
          </div>
        </div>
      </DashboardWidgetSystem>
    </div>
  );
}
