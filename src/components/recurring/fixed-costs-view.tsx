"use client";

import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import {
  saveRecurringExpenseAction,
  toggleRecurringActiveAction,
  bookRecurringNowAction,
  deleteRecurringExpenseAction,
} from "@/actions/recurring-actions";
import {
  centsToInput,
  formatCents,
  formatDateDE,
  INTERVAL_LABELS,
  parseEuroToCents,
  PAYMENT_METHOD_LABELS,
  todayISO,
} from "@/lib/format";
import {
  INTERVALS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type RecurringInterval,
} from "@/lib/db/schema";
import { CategoryIcon } from "@/components/ui/category-icon";
import type { CategoryItem } from "@/components/transactions/quick-add-modal";
import {
  Repeat,
  ListOrdered,
  Plus,
  Pencil,
  Trash2,
  Play,
  Pause,
  Check,
  X,
  CalendarClock,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export interface FixedCostRow {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  type: "expense" | "income";
  amountCents: number;
  paymentMethod: PaymentMethod;
  interval: RecurringInterval;
  dayOfMonth: number;
  startDate: string;
  nextDueDate: string;
  lastProcessedDate: string | null;
  autoBook: boolean;
  active: boolean;
}

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

export function FixedCostsView({
  items,
  categories,
}: {
  items: FixedCostRow[];
  categories: CategoryItem[];
}) {
  const [showForm, setShowForm] = useState(false);
  // Schutz gegen Doppelklick: Ref statt State, damit ein zweiter Klick im
  // selben Render-Durchlauf schon blockiert ist
  const bookingInFlight = useRef(new Set<string>());
  const [bookingIds, setBookingIds] = useState<Set<string>>(new Set());

  async function bookNow(itemId: string, successMessage: string, errorMessage: string) {
    if (bookingInFlight.current.has(itemId)) return;
    bookingInFlight.current.add(itemId);
    setBookingIds(new Set(bookingInFlight.current));
    try {
      const res = await bookRecurringNowAction(itemId);
      if (res.success) toast.success(successMessage);
      else toast.error(res.error || errorMessage);
    } finally {
      bookingInFlight.current.delete(itemId);
      setBookingIds(new Set(bookingInFlight.current));
    }
  }
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState(
    categories.find((c) => c.type === "expense")?.id || categories[0]?.id || ""
  );
  const [amountStr, setAmountStr] = useState("");
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("direct_debit");
  const [interval, setInterval] = useState<RecurringInterval>("monthly");
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [nextDueDate, setNextDueDate] = useState<string>(todayISO());
  const [autoBook, setAutoBook] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
    isIncome: boolean;
  } | null>(null);
  const [isDeletingConfirm, setIsDeletingConfirm] = useState(false);

  const monthlySummary = useMemo(() => {
    let monthlyFixedExpenses = 0;
    let monthlyFixedIncome = 0;

    for (const item of items) {
      if (!item.active) continue;
      const eqCents = getMonthlyEquivalentCents(
        item.amountCents,
        item.interval
      );
      if (item.type === "income") {
        monthlyFixedIncome += eqCents;
      } else {
        monthlyFixedExpenses += eqCents;
      }
    }

    const netAfterFixed = monthlyFixedIncome - monthlyFixedExpenses;

    return { monthlyFixedExpenses, monthlyFixedIncome, netAfterFixed };
  }, [items]);

  const currentMonthPrefix = useMemo(
    () => new Date().toISOString().slice(0, 7),
    []
  );

  const incomeItems = useMemo(
    () => items.filter((i) => i.type === "income"),
    [items]
  );
  const expenseItems = useMemo(
    () => items.filter((i) => i.type !== "income"),
    [items]
  );

  // Monats-Status: wie viele Fixkosten wurden für den aktuellen Monat bereits gebucht?
  const monthlyTracker = useMemo(() => {
    const activeExpenses = expenseItems.filter((i) => i.active);
    const bookedExpenses = activeExpenses.filter(
      (i) =>
        i.lastProcessedDate && i.lastProcessedDate.startsWith(currentMonthPrefix)
    );
    const bookedCents = bookedExpenses.reduce(
      (sum, i) => sum + getMonthlyEquivalentCents(i.amountCents, i.interval),
      0
    );
    const totalExpectedCents = activeExpenses.reduce(
      (sum, i) => sum + getMonthlyEquivalentCents(i.amountCents, i.interval),
      0
    );
    const percent =
      totalExpectedCents > 0
        ? Math.min(100, Math.round((bookedCents / totalExpectedCents) * 100))
        : 100;

    return {
      activeCount: activeExpenses.length,
      bookedCount: bookedExpenses.length,
      bookedCents,
      totalExpectedCents,
      percent,
    };
  }, [expenseItems, currentMonthPrefix]);

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.type === type),
    [categories, type]
  );

  function openNew(targetType: "expense" | "income" = "expense") {
    setEditId(undefined);
    setName("");
    setDescription("");
    setType(targetType);
    const defaultCat =
      categories.find((c) => c.type === targetType)?.id ||
      categories[0]?.id ||
      "";
    setCategoryId(defaultCat);
    setAmountStr("");
    setPaymentMethod(targetType === "income" ? "transfer" : "direct_debit");
    setInterval("monthly");
    setDayOfMonth(1);
    setNextDueDate(todayISO());
    setAutoBook(true);
    setShowForm(true);
  }

  function handleTypeChange(newType: "expense" | "income") {
    setType(newType);
    const matchingCat = categories.find((c) => c.type === newType);
    if (matchingCat) {
      setCategoryId(matchingCat.id);
    }
    if (newType === "income" && paymentMethod === "direct_debit") {
      setPaymentMethod("transfer");
    } else if (newType === "expense" && paymentMethod === "transfer") {
      setPaymentMethod("direct_debit");
    }
  }

  function openEdit(item: FixedCostRow) {
    setEditId(item.id);
    setName(item.name);
    setDescription(item.description || "");
    setType(item.type);
    setCategoryId(item.categoryId);
    setAmountStr(centsToInput(item.amountCents));
    setPaymentMethod(item.paymentMethod);
    setInterval(item.interval);
    setDayOfMonth(item.dayOfMonth);
    setNextDueDate(item.nextDueDate);
    setAutoBook(item.autoBook);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = parseEuroToCents(amountStr);
    if (!amountCents) {
      toast.error("Bitte einen gültigen Betrag eingeben.");
      return;
    }

    const res = await saveRecurringExpenseAction({
      id: editId,
      name,
      description,
      categoryId,
      type,
      amountCents,
      paymentMethod,
      interval,
      dayOfMonth,
      startDate: nextDueDate,
      nextDueDate,
      autoBook,
      active: true,
    });

    if (res.success) {
      const typeLabel = type === "income" ? "Feste Einnahme" : "Fixkosten";
      toast.success(
        editId ? `${typeLabel} aktualisiert!` : `${typeLabel} hinzugefügt!`
      );
      setShowForm(false);
    } else {
      toast.error(res.error || "Fehler beim Speichern.");
    }
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* Sub-Navigation: Umsätze & Buchungen vs. Fixkosten & Daueraufträge */}
      <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-lg w-fit">
        <Link
          href="/transactions"
          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition"
        >
          <ListOrdered className="w-3.5 h-3.5" />
          <span>Umsätze</span>
        </Link>
        <Link
          href="/recurring"
          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
        >
          <Repeat className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-100" />
          <span>Fixkosten</span>
        </Link>
      </div>

      {/* Header & Cashflow-Balance Übersicht */}
      <div className="pb-6 border-b border-zinc-200/80 dark:border-zinc-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-base font-semibold">Fixkosten und feste Einnahmen</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openNew("income")}
              className="px-3 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Einnahme</span>
            </button>
            <button
              type="button"
              onClick={() => openNew("expense")}
              className="px-3 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Fixkosten</span>
            </button>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-4 py-4 border-y border-zinc-200 dark:border-zinc-800">
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">
              Feste Einnahmen · {incomeItems.filter((i) => i.active).length}
            </dt>
            <dd className="mt-1 text-base font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
              +{formatCents(monthlySummary.monthlyFixedIncome)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">
              Fixkosten · {expenseItems.filter((i) => i.active).length}
            </dt>
            <dd className="mt-1 text-base font-medium tabular-nums">
              −{formatCents(monthlySummary.monthlyFixedExpenses)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Danach verfügbar</dt>
            <dd
              className={cn(
                "mt-1 text-base font-medium tabular-nums",
                monthlySummary.netAfterFixed < 0 && "text-red-600 dark:text-red-400"
              )}
            >
              {formatCents(monthlySummary.netAfterFixed)}
            </dd>
          </div>
        </dl>

        {/* Monats-Erledigungs-Tracker */}
        {monthlyTracker.activeCount > 0 && (
          <div className="mt-4 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 space-y-1.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
              <span className="font-semibold flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                Diesen Monat {monthlyTracker.bookedCount} von {monthlyTracker.activeCount} Fixkosten abgebucht
              </span>
              <span className="font-bold text-zinc-500 text-xs">
                {formatCents(monthlyTracker.bookedCents)} von{" "}
                {formatCents(monthlyTracker.totalExpectedCents)} (
                {monthlyTracker.percent}%)
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className="bg-zinc-800 dark:bg-zinc-300 h-full rounded-full"
                style={{ width: `${monthlyTracker.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Formular zum Anlegen / Bearbeiten */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="bg-white dark:bg-zinc-900 border-2 border-blue-600/30 rounded-lg p-4 space-y-3.5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm">
              {editId
                ? type === "income"
                  ? "Feste Einnahme bearbeiten"
                  : "Fixkosten bearbeiten"
                : type === "income"
                  ? "Neue feste Einnahme anlegen"
                  : "Neue monatliche Fixkosten anlegen"}
            </h2>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="p-1 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Typ-Auswahl (Einnahme vs. Fixkosten-Ausgabe) */}
          <div className="grid grid-cols-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl gap-1">
            <button
              type="button"
              onClick={() => handleTypeChange("income")}
              className={cn(
                "py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition",
                type === "income"
                  ? "bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 "
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              )}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Einnahme (+ Gehalt)</span>
            </button>
            <button
              type="button"
              onClick={() => handleTypeChange("expense")}
              className={cn(
                "py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition",
                type === "expense"
                  ? "bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 "
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              )}
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>Fixkosten (- Ausgabe)</span>
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                {type === "income"
                  ? "Bezeichnung (z. B. Gehalt Arbeitgeber, Kindergeld)"
                  : "Bezeichnung (z. B. Miete, Strom, Netflix)"}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  type === "income"
                    ? "z. B. Gehalt Arbeitgeber"
                    : "z. B. Warmmiete"
                }
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Betrag in EUR
              </label>
              <input
                type="text"
                inputMode="decimal"
                required
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0,00"
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-semibold"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Kategorie
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              >
                {filteredCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Intervall
              </label>
              <select
                value={interval}
                onChange={(e) =>
                  setInterval(e.target.value as RecurringInterval)
                }
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              >
                {INTERVALS.map((iv) => (
                  <option key={iv} value={iv}>
                    {INTERVAL_LABELS[iv]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Zahlungsart
              </label>
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as PaymentMethod)
                }
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {PAYMENT_METHOD_LABELS[pm]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                {type === "income" ? "Eingangstag im Monat" : "Abbuchungstag im Monat"} (1–31)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value) || 1)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Nächste Fälligkeit
              </label>
              <input
                type="date"
                required
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={autoBook}
              onChange={(e) => setAutoBook(e.target.checked)}
              className="rounded text-blue-600"
            />
            <span>
              {type === "income"
                ? "Automatisch am Fälligkeitstag als Einnahme verbuchen"
                : "Automatisch am Fälligkeitstag in meinen Ausgaben abbuchen"}
            </span>
          </label>

          <button
            type="submit"
            className={cn(
              "w-full py-2.5 rounded-xl text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition",
              type === "income"
                ? "bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                : "bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            )}
          >
            <Check className="w-4 h-4" />
            <span>
              {type === "income"
                ? "Feste Einnahme speichern"
                : "Fixkosten speichern"}
            </span>
          </button>
        </form>
      )}

      {/* 1. SEKTION: FESTE EINNAHMEN */}
      <div className="space-y-2 pb-6 border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm">Feste Einnahmen (Gehalt & Eingänge)</h2>
              <p className="text-xs text-zinc-500">
                Monatliche Basis für dein verfügbares Budget
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openNew("income")}
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Einnahme hinzufügen</span>
          </button>
        </div>

        {incomeItems.length === 0 ? (
          <div className="p-6 text-center">
            <Wallet className="w-8 h-8 text-emerald-500/40 mx-auto mb-2" />
            <p className="text-sm font-medium">Noch keine festen Einnahmen hinterlegt</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
              Trage hier dein Gehalt, Kindergeld oder regelmäßige Überweisungen ein, um dein frei verfügbares Budget nach Fixkosten zu ermitteln.
            </p>
            <button
              type="button"
              onClick={() => openNew("income")}
              className="mt-3 px-3 py-1.5 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Gehalt / Einnahme anlegen</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {incomeItems.map((item) => {
              const cat = categories.find((c) => c.id === item.categoryId);
              return (
                <div
                  key={item.id}
                  className={cn(
                    "p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5",
                    !item.active && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                    >
                      <CategoryIcon
                        name={cat?.icon || "Wallet"}
                        className="w-5 h-5"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{item.name}</p>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium">
                          {INTERVAL_LABELS[item.interval]} (am {item.dayOfMonth}.)
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        Nächster Eingang: {formatDateDE(item.nextDueDate)} •{" "}
                        {PAYMENT_METHOD_LABELS[item.paymentMethod]}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0 pl-13 sm:pl-0">
                    <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400 mr-1">
                      +{formatCents(item.amountCents)}
                    </span>

                    <button
                      type="button"
                      disabled={bookingIds.has(item.id)}
                      onClick={() =>
                        bookNow(
                          item.id,
                          `„${item.name}“ jetzt als Einnahme verbucht!`,
                          "Fehler beim Einbuchen der Einnahme."
                        )
                      }
                      title="Jetzt sofort einmalig als Einnahme einbuchen"
                      className="px-2 py-1 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-emerald-500/20"
                    >
                      Einbuchen
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        const res = await toggleRecurringActiveAction(item.id, !item.active);
                        if (res.success) {
                          toast.success(
                            item.active ? "Einnahme pausiert" : "Einnahme aktiviert"
                          );
                        } else {
                          toast.error(res.error || "Statusänderung fehlgeschlagen.");
                        }
                      }}
                      title={item.active ? "Pausieren" : "Aktivieren"}
                      className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {item.active ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      title="Bearbeiten"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setDeleteConfirm({
                          id: item.id,
                          name: item.name,
                          isIncome: true,
                        })
                      }
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10 cursor-pointer"
                      title="Löschen"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. SEKTION: MONATLICHE FIXKOSTEN */}
      <div className="space-y-2">
        <div className="py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center">
              <Repeat className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm">Monatliche Fixkosten</h2>
              <p className="text-xs text-zinc-500">
                Wiederkehrende Verträge, Miete & Abonnements
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openNew("expense")}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Fixkosten hinzufügen</span>
          </button>
        </div>

        {expenseItems.length === 0 ? (
          <div className="p-6 text-center">
            <CalendarClock className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
            <p className="text-sm font-medium">Noch keine Fixkosten hinterlegt</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
              Trage Miete, Strom, Versicherungen und Abos ein, damit sie monatlich automatisch als Ausgabe abgezogen werden.
            </p>
            <button
              type="button"
              onClick={() => openNew("expense")}
              className="mt-3 px-3 py-1.5 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Fixkosten anlegen</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {expenseItems.map((item) => {
              const cat = categories.find((c) => c.id === item.categoryId);
              return (
                <div
                  key={item.id}
                  className={cn(
                    "p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5",
                    !item.active && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                    >
                      <CategoryIcon
                        name={cat?.icon || "Repeat"}
                        className="w-5 h-5"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{item.name}</p>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                          {INTERVAL_LABELS[item.interval]} (am {item.dayOfMonth}.)
                        </span>

                        {item.interval !== "monthly" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-medium">
                            Mtl. Rücklage:{" "}
                            {formatCents(
                              getMonthlyEquivalentCents(
                                item.amountCents,
                                item.interval
                              )
                            )}
                          </span>
                        )}

                        {item.lastProcessedDate &&
                          item.lastProcessedDate.startsWith(
                            currentMonthPrefix
                          ) && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-medium flex items-center gap-0.5">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              Diesen Monat gebucht
                            </span>
                          )}
                      </div>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        Nächster Abzug: {formatDateDE(item.nextDueDate)} •{" "}
                        {PAYMENT_METHOD_LABELS[item.paymentMethod]}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0 pl-13 sm:pl-0">
                    <span className="font-bold text-sm mr-1">
                      {formatCents(item.amountCents)}
                    </span>

                    <button
                      type="button"
                      disabled={bookingIds.has(item.id)}
                      onClick={() =>
                        bookNow(
                          item.id,
                          `„${item.name}“ jetzt als Ausgabe gebucht!`,
                          "Fehler beim Abbuchen der Fixkosten."
                        )
                      }
                      title="Jetzt sofort einmalig abbuchen"
                      className="px-2 py-1 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-indigo-500/20"
                    >
                      Buchen
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        const res = await toggleRecurringActiveAction(item.id, !item.active);
                        if (res.success) {
                          toast.success(
                            item.active ? "Fixkosten pausiert" : "Fixkosten aktiviert"
                          );
                        } else {
                          toast.error(res.error || "Statusänderung fehlgeschlagen.");
                        }
                      }}
                      title={item.active ? "Pausieren" : "Aktivieren"}
                      className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {item.active ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      title="Bearbeiten"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setDeleteConfirm({
                          id: item.id,
                          name: item.name,
                          isIncome: false,
                        })
                      }
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10 cursor-pointer"
                      title="Löschen"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* App-eigener Bestätigungsdialog für Fixkosten/Daueraufträge */}
      <ConfirmModal
        open={Boolean(deleteConfirm)}
        title={deleteConfirm?.isIncome ? "Feste Einnahme löschen" : "Fixkosten löschen"}
        message={`Möchtest du „${deleteConfirm?.name}“ wirklich unwiderruflich löschen?`}
        confirmText="Löschen"
        cancelText="Abbrechen"
        variant="danger"
        loading={isDeletingConfirm}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={async () => {
          if (!deleteConfirm) return;
          setIsDeletingConfirm(true);
          try {
            const res = await deleteRecurringExpenseAction(deleteConfirm.id);
            if (res.success) {
              toast.success(
                deleteConfirm.isIncome
                  ? "Einnahme gelöscht."
                  : "Fixkosten-Eintrag gelöscht."
              );
              setDeleteConfirm(null);
            } else {
              toast.error(res.error || "Löschen fehlgeschlagen.");
            }
          } catch {
            toast.error("Fehler beim Löschen.");
          } finally {
            setIsDeletingConfirm(false);
          }
        }}
      />
    </div>
  );
}
