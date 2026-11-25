import { db } from "@/lib/db";
import {
  recurringExpenses,
  transactions,
  type RecurringInterval,
} from "@/lib/db/schema";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { RECURRING_MATCH_WINDOW_DAYS, shiftIsoDate } from "@/lib/recurring-matching";
import { todayISO } from "@/lib/format";
import crypto from "node:crypto";

export function addIntervalToDate(
  isoDate: string,
  interval: RecurringInterval,
  preferredDayOfMonth: number
): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);

  switch (interval) {
    case "weekly":
      date.setDate(date.getDate() + 7);
      break;
    case "monthly":
      date.setMonth(date.getMonth() + 1);
      break;
    case "quarterly":
      date.setMonth(date.getMonth() + 3);
      break;
    case "half_yearly":
      date.setMonth(date.getMonth() + 6);
      break;
    case "yearly":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }

  // Bei monatlichen/quartalsweisen/jährlichen Intervallen den gewünschten Tag im Monat einhalten (z.B. 1. oder 15.)
  if (interval !== "weekly" && preferredDayOfMonth >= 1) {
    const targetYear = date.getFullYear();
    const targetMonth = date.getMonth();
    const maxDaysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    date.setDate(Math.min(preferredDayOfMonth, maxDaysInMonth));
  }

  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, "0");
  const nd = String(date.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

/**
 * Prüft alle aktiven Fixkosten des Benutzers mit autoBook = true,
 * deren nextDueDate <= heute ist, und bucht sie automatisch als Transaktion (costType = 'fixed').
 */
export function processDueRecurringExpenses(userId: string): number {
  const today = todayISO();

  const dueItems = db
    .select()
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.userId, userId),
        eq(recurringExpenses.active, true),
        eq(recurringExpenses.autoBook, true),
        lte(recurringExpenses.nextDueDate, today)
      )
    )
    .all();

  let bookedCount = 0;
  const now = new Date();

  db.transaction((tx) => {
    for (const item of dueItems) {
      let currentDue = item.nextDueDate;
      let safetyCounter = 0;

      while (currentDue <= today && safetyCounter < 24) {
        safetyCounter++;

        if (item.endDate && currentDue > item.endDate) {
          tx.update(recurringExpenses)
            .set({ active: false })
            .where(eq(recurringExpenses.id, item.id))
            .run();
          break;
        }

        const existingTx = tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.recurringId, item.id),
              eq(transactions.date, currentDue)
            )
          )
          .get();

        // Wurde die Zahlung bereits als echter Bankumsatz zugeordnet (z. B. ein
        // paar Tage vor Fälligkeit abgebucht), keine zusätzliche Buchung anlegen
        const alreadyPaidByBank = existingTx
          ? null
          : tx
              .select({ id: transactions.id })
              .from(transactions)
              .where(
                and(
                  eq(transactions.recurringId, item.id),
                  isNotNull(transactions.bankTransactionId),
                  gte(transactions.date, shiftIsoDate(currentDue, -RECURRING_MATCH_WINDOW_DAYS)),
                  lte(transactions.date, shiftIsoDate(currentDue, RECURRING_MATCH_WINDOW_DAYS))
                )
              )
              .get();

        if (!existingTx && !alreadyPaidByBank) {
          tx.insert(transactions)
            .values({
              id: crypto.randomUUID(),
              userId,
              categoryId: item.categoryId,
              type: item.type,
              costType: "fixed",
              amountCents: item.amountCents,
              date: currentDue,
              description: item.name,
              merchant: item.description || null,
              paymentMethod: item.paymentMethod,
              recurringId: item.id,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          bookedCount++;
        }

        const nextDue = addIntervalToDate(
          currentDue,
          item.interval,
          item.dayOfMonth
        );

        tx.update(recurringExpenses)
          .set({
            lastProcessedDate: currentDue,
            nextDueDate: nextDue,
          })
          .where(eq(recurringExpenses.id, item.id))
          .run();

        currentDue = nextDue;
      }
    }
  });

  return bookedCount;
}

/**
 * Prüft und bucht fällige Fixkosten für ALLE Benutzer im System
 * (wird vom Hintergrund-Scheduler beim Serverstart & periodisch aufgerufen).
 */
export function processAllUsersDueRecurringExpenses(): number {
  const allActiveUsers = db
    .select({ userId: recurringExpenses.userId })
    .from(recurringExpenses)
    .where(eq(recurringExpenses.active, true))
    .all();

  const uniqueUserIds = Array.from(
    new Set(allActiveUsers.map((u) => u.userId))
  );

  let totalBooked = 0;
  for (const uid of uniqueUserIds) {
    totalBooked += processDueRecurringExpenses(uid);
  }
  return totalBooked;
}

