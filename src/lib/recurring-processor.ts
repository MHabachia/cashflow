import { db } from "@/lib/db";
import {
  recurringExpenses,
  transactions,
  type RecurringInterval,
} from "@/lib/db/schema";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { matchWindowDays, shiftIsoDate } from "@/lib/recurring-matching";
import { todayISO } from "@/lib/format";
import crypto from "node:crypto";

const MONTHS_PER_INTERVAL: Record<Exclude<RecurringInterval, "weekly">, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

/**
 * Nächste Fälligkeit nach `isoDate`. Bei monatlichen und längeren Intervallen
 * wird zuerst der Zielmonat bestimmt und dann der Wunschtag auf dessen Länge
 * begrenzt (31.01. → 28./29.02. → 31.03.). Früher lief `setMonth` über das
 * Monatsende hinaus und übersprang kurze Monate (31.01. → 03.03. → 31.03.).
 */
export function addIntervalToDate(
  isoDate: string,
  interval: RecurringInterval,
  preferredDayOfMonth: number
): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  let date: Date;

  if (interval === "weekly") {
    date = new Date(y, m - 1, d + 7);
  } else {
    date = new Date(y, m - 1 + MONTHS_PER_INTERVAL[interval], 1);
    const wantedDay = preferredDayOfMonth >= 1 ? preferredDayOfMonth : d;
    const daysInTargetMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(wantedDay, daysInTargetMonth));
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
                  gte(transactions.date, shiftIsoDate(currentDue, -matchWindowDays(item.interval))),
                  lte(transactions.date, shiftIsoDate(currentDue, matchWindowDays(item.interval)))
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

