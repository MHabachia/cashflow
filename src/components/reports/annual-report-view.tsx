"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  formatCents,
  formatDateDE,
} from "@/lib/format";
import { CategoryIcon } from "@/components/ui/category-icon";
import type { AnnualReportData } from "@/lib/reports";
import {
  Calendar,
  Download,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  BarChart3,
  FileSpreadsheet,
  ChevronRight,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AnnualReportView({
  data,
}: {
  data: AnnualReportData;
}) {
  const router = useRouter();
  const [selectedYear, setSelectedYear] = useState(data.year);

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    router.push(`/reports?year=${year}`);
  };

  const isNetPositive = data.netSavingsCents >= 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* Header & Year Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                Jahresbericht
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Jahresbilanz, Sparquote und Ausgaben nach Kategorien für {data.year}
              </p>
            </div>
          </div>
        </div>

        {/* Jahr-Auswahl Pills & CSV-Export */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl">
            {data.availableYears.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => handleYearChange(y)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition",
                  y === data.year
                    ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white "
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                )}
              >
                {y}
              </button>
            ))}
          </div>

          <a
            href={`/api/csv/export?year=${data.year}`}
            download
            className="px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90 font-semibold text-xs flex items-center gap-1.5 transition"
            title="Alle Buchungen des Jahres als CSV (z. B. für Excel)"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Buchungen {data.year}</span>
          </a>
          <a
            href={`/api/csv/export?year=${data.year}&view=categories`}
            download
            className="px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 font-semibold text-xs flex items-center gap-1.5 transition"
            title="Summen je Kategorie, z. B. für die Steuererklärung"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Summen je Kategorie</span>
          </a>
        </div>
      </div>

      {/* KPI Cards: Einnahmen, Fixkosten, Variable Kosten, Netto-Sparquote */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Einnahmen */}
        <div className="p-4 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Gesamteinnahmen</span>
            <div className="w-6 h-6 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCents(data.totalIncomeCents)}
          </div>
          <p className="text-xs text-zinc-400">
            im gesamten Jahr {data.year}
          </p>
        </div>

        {/* Fixkosten */}
        <div className="p-4 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Fixkosten & Abos</span>
            <div className="w-6 h-6 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <ArrowDownRight className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {formatCents(data.totalFixedExpensesCents)}
          </div>
          <p className="text-xs text-zinc-400">
            Miete, Strom, Verträge, GEZ
          </p>
        </div>

        {/* Variable Ausgaben */}
        <div className="p-4 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Variable Ausgaben</span>
            <div className="w-6 h-6 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <Receipt className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {formatCents(data.totalVariableExpensesCents)}
          </div>
          <p className="text-xs text-zinc-400">
            Einkauf, Freizeit, Shopping
          </p>
        </div>

        {/* Netto-Ersparnis & Sparquote */}
        <div className="p-4 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Netto-Sparquote</span>
            <div
              className={cn(
                "w-6 h-6 rounded-lg flex items-center justify-center",
                isNetPositive
                  ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              )}
            >
              <PiggyBank className="w-3.5 h-3.5" />
            </div>
          </div>
          <div
            className={cn(
              "text-lg sm:text-xl font-bold",
              isNetPositive
                ? "text-zinc-900 dark:text-zinc-100"
                : "text-rose-600 dark:text-rose-400"
            )}
          >
            {data.annualSavingsRatePercent}%
          </div>
          <p className="text-xs text-zinc-400">
            Überschuss: {formatCents(data.netSavingsCents)}
          </p>
        </div>
      </div>

      {/* 12-Monats-Verlauf (Übersicht aller Monate) */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>12-Monats-Entwicklung {data.year}</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Einnahmen, Ausgaben und monatlicher Überschuss im Jahresverlauf
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800 text-zinc-400 font-semibold">
                <th className="py-2.5 px-3">Monat</th>
                <th className="py-2.5 px-3 text-right">Einnahmen</th>
                <th className="py-2.5 px-3 text-right">Fixkosten</th>
                <th className="py-2.5 px-3 text-right">Variabel</th>
                <th className="py-2.5 px-3 text-right">Gesamtausgaben</th>
                <th className="py-2.5 px-3 text-right">Überschuss</th>
                <th className="py-2.5 px-3 text-right">Sparquote</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-medium">
              {data.monthlyBreakdown.map((m) => {
                const hasData = m.incomeCents > 0 || m.totalExpensesCents > 0;
                return (
                  <tr
                    key={m.month}
                    className={cn(
                      "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition",
                      !hasData && "opacity-40"
                    )}
                  >
                    <td className="py-2.5 px-3 font-semibold text-zinc-900 dark:text-zinc-100">
                      {m.monthName}
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400">
                      {formatCents(m.incomeCents)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-zinc-600 dark:text-zinc-400">
                      {formatCents(m.fixedExpensesCents)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-zinc-600 dark:text-zinc-400">
                      {formatCents(m.variableExpensesCents)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-zinc-900 dark:text-zinc-100 font-semibold">
                      {formatCents(m.totalExpensesCents)}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 px-3 text-right font-bold",
                        m.savingsCents >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {formatCents(m.savingsCents)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-bold",
                          m.savingsRatePercent >= 20
                            ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                            : m.savingsRatePercent > 0
                              ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                        )}
                      >
                        {m.savingsRatePercent}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top Ausgaben-Kategorien im Jahr */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
            <span>Größte Ausgabenkategorien im Jahr {data.year}</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Aufschlüsselung nach Kategorien
          </p>
        </div>

        {data.topExpenseCategories.length === 0 ? (
          <p className="text-xs text-zinc-400 py-6 text-center">
            Keine Ausgaben für {data.year} erfasst.
          </p>
        ) : (
          <div className="space-y-3">
            {data.topExpenseCategories.slice(0, 10).map((cat) => (
              <div key={cat.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                    >
                      <CategoryIcon name={cat.icon} className="w-3 h-3" />
                    </span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {cat.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">
                      {formatCents(cat.amountCents)}
                    </span>
                    <span className="text-xs text-zinc-400 w-9 text-right font-medium">
                      {cat.percentOfTotal}%
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(cat.percentOfTotal, 100)}%`,
                      backgroundColor: cat.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
