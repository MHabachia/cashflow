import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const testDbPath = path.resolve("./data/test-recurring-logic.db");
process.env.DATABASE_PATH = testDbPath;

const userId = "recurring-logic-user";
let categoryId = "";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
}

async function insertRecurring(values: {
  name: string;
  interval: "weekly" | "monthly";
  dayOfMonth: number;
  nextDueDate: string;
  autoBook: boolean;
}): Promise<string> {
  const { db } = await import("../../src/lib/db/index");
  const { recurringExpenses } = await import("../../src/lib/db/schema");
  const id = crypto.randomUUID();
  db.insert(recurringExpenses)
    .values({
      id,
      userId,
      categoryId,
      type: "expense",
      amountCents: 1_000,
      paymentMethod: "direct_debit",
      startDate: "2020-01-01",
      active: true,
      createdAt: new Date(),
      ...values,
    })
    .run();
  return id;
}

async function insertTransaction(values: { recurringId: string; date: string; bankTransactionId?: string }) {
  const { db } = await import("../../src/lib/db/index");
  const { transactions } = await import("../../src/lib/db/schema");
  const now = new Date();
  db.insert(transactions)
    .values({
      id: crypto.randomUUID(),
      userId,
      categoryId,
      type: "expense",
      costType: "fixed",
      amountCents: 1_000,
      description: "Testbuchung",
      paymentMethod: "direct_debit",
      createdAt: now,
      updatedAt: now,
      ...values,
    })
    .run();
}

describe("Fälligkeiten berechnen", () => {
  it("überspringt am Monatsende keine Monate", async () => {
    const { addIntervalToDate } = await import("../../src/lib/recurring-processor");
    assert.equal(addIntervalToDate("2026-01-31", "monthly", 31), "2026-02-28");
    assert.equal(addIntervalToDate("2026-02-28", "monthly", 31), "2026-03-31");
    assert.equal(addIntervalToDate("2026-05-31", "monthly", 31), "2026-06-30");
    assert.equal(addIntervalToDate("2028-01-30", "monthly", 30), "2028-02-29");
    assert.equal(addIntervalToDate("2026-11-30", "quarterly", 30), "2027-02-28");
    assert.equal(addIntervalToDate("2026-08-31", "half_yearly", 31), "2027-02-28");
    assert.equal(addIntervalToDate("2028-02-29", "yearly", 29), "2029-02-28");
    assert.equal(addIntervalToDate("2026-12-28", "weekly", 28), "2027-01-04");
  });

  it("liefert Termine auch bei sehr altem nextDueDate", async () => {
    const { occurrencesBetween } = await import("../../src/lib/forecast");
    // Wöchentlich seit 2020: früher nach 60 Schritten abgeschnitten
    const dates = occurrencesBetween("2020-01-06", "weekly", 6, "2026-12-01", "2026-12-31");
    // Montage im Dezember 2026: 7., 14., 21., 28.
    assert.deepEqual(dates, ["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"]);
  });

  it("Kalender beachtet das Enddatum", async () => {
    const { buildMonthCalendar } = await import("../../src/lib/fixed-cost-calendar");
    const base = { name: "Kurs", type: "expense" as const, amountCents: 500, interval: "weekly" as const, dayOfMonth: 1, nextDueDate: "2026-12-01", active: true };
    assert.equal(buildMonthCalendar([base], "2026-12").entries.length, 5);
    assert.equal(buildMonthCalendar([{ ...base, endDate: "2026-12-10" }], "2026-12").entries.length, 2);
  });

  it("Abgleichfenster ist bei wöchentlichen Posten kleiner als eine halbe Woche", async () => {
    const { matchWindowDays } = await import("../../src/lib/recurring-matching");
    assert.ok(matchWindowDays("weekly") < 3.5);
    assert.equal(matchWindowDays("monthly"), 10);
  });
});

describe("Fixkosten mit Buchungen abgleichen", () => {
  before(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
    const { db, ensureDatabaseTables } = await import("../../src/lib/db/index");
    const { user, categories } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const { ensureDefaultCategoriesForUser } = await import("../../src/lib/db/defaults");
    ensureDatabaseTables();
    const now = new Date();
    db.insert(user).values({ id: userId, name: "Fix", email: "fix@kosten.local", createdAt: now, updatedAt: now }).run();
    ensureDefaultCategoriesForUser(userId);
    categoryId = db.select().from(categories).where(eq(categories.userId, userId)).get()!.id;
    process.env.TEST_USER_ID = userId;
  });

  it("eine vor Fälligkeit abgebuchte Zahlung gilt nicht mehr als anstehend", async () => {
    const { recurringPaymentDates, unpaidOccurrences } = await import("../../src/lib/forecast");
    const due = "2026-12-03";
    const id = await insertRecurring({ name: "Miete", interval: "monthly", dayOfMonth: 3, nextDueDate: due, autoBook: false });
    await insertTransaction({ recurringId: id, date: "2026-12-01", bankTransactionId: "bank-1" });

    const paid = recurringPaymentDates(userId, "2026-11-20", "2027-01-10");
    const item = { id, nextDueDate: due, interval: "monthly" as const, dayOfMonth: 3 };
    assert.deepEqual(unpaidOccurrences(item, "2026-12-01", "2026-12-31", paid), []);
  });

  it("die Zahlung der Vorwoche deckt die aktuelle Woche nicht ab", async () => {
    const { recurringPaymentDates, unpaidOccurrences } = await import("../../src/lib/forecast");
    const id = await insertRecurring({ name: "Putzhilfe", interval: "weekly", dayOfMonth: 7, nextDueDate: "2026-12-07", autoBook: false });
    await insertTransaction({ recurringId: id, date: "2026-11-30", bankTransactionId: "bank-2" });

    const paid = recurringPaymentDates(userId, "2026-11-20", "2026-12-20");
    const item = { id, nextDueDate: "2026-12-07", interval: "weekly" as const, dayOfMonth: 7 };
    assert.deepEqual(unpaidOccurrences(item, "2026-12-07", "2026-12-07", paid), ["2026-12-07"]);
  });

  it("autoBook bucht wöchentlich trotz Bankzahlung der Vorwoche", async () => {
    const { processDueRecurringExpenses } = await import("../../src/lib/recurring-processor");
    const { db } = await import("../../src/lib/db/index");
    const { transactions } = await import("../../src/lib/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const due = daysFromToday(0);
    const id = await insertRecurring({ name: "Wochenabo", interval: "weekly", dayOfMonth: 1, nextDueDate: due, autoBook: true });
    await insertTransaction({ recurringId: id, date: daysFromToday(-7), bankTransactionId: "bank-3" });

    processDueRecurringExpenses(userId);
    const booked = db.select().from(transactions).where(and(eq(transactions.recurringId, id), eq(transactions.date, due))).get();
    assert.ok(booked, "Fälligkeit dieser Woche wurde nicht gebucht");
  });

  it("„Jetzt buchen“ verknüpft die Buchung, schiebt die Fälligkeit weiter und verhindert Dubletten", async () => {
    const { bookRecurringNowAction } = await import("../../src/actions/recurring-actions");
    const { processDueRecurringExpenses } = await import("../../src/lib/recurring-processor");
    const { db } = await import("../../src/lib/db/index");
    const { transactions, recurringExpenses } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const today = daysFromToday(0);
    const id = await insertRecurring({ name: "Strom", interval: "monthly", dayOfMonth: Number(today.slice(8, 10)), nextDueDate: today, autoBook: true });

    assert.equal((await bookRecurringNowAction(id)).success, true);
    assert.equal((await bookRecurringNowAction(id)).success, false);

    const item = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).get()!;
    assert.ok(item.nextDueDate > today);
    processDueRecurringExpenses(userId);
    const bookings = db.select().from(transactions).where(eq(transactions.recurringId, id)).all();
    assert.equal(bookings.length, 1);
  });

  it("Fixkosten aus einer Buchung starten beim nächsten Termin danach", async () => {
    const { createRecurringFromTransactionAction } = await import("../../src/actions/recurring-actions");
    const { db } = await import("../../src/lib/db/index");
    const { recurringExpenses, transactions } = await import("../../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const today = daysFromToday(0);
    const txId = crypto.randomUUID();
    const now = new Date();
    db.insert(transactions)
      .values({ id: txId, userId, categoryId, type: "expense", costType: "variable", amountCents: 999, date: today, description: "Streaming", paymentMethod: "direct_debit", createdAt: now, updatedAt: now })
      .run();

    const res = await createRecurringFromTransactionAction({
      transactionId: txId,
      name: "Streaming",
      amountCents: 999,
      type: "expense",
      categoryId,
      interval: "monthly",
      autoBook: true,
    });
    assert.ok(res.success && res.recurringId);
    const item = db.select().from(recurringExpenses).where(eq(recurringExpenses.id, res.recurringId)).get()!;
    assert.ok(item.nextDueDate > today, `nextDueDate ${item.nextDueDate} sollte nach ${today} liegen`);
    assert.equal(item.startDate, today);
  });
});
