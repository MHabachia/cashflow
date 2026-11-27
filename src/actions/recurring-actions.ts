"use server";

import { db } from "@/lib/db";
import {
  recurringExpenses,
  transactions,
  PAYMENT_METHODS,
  INTERVALS,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { userOwnsCategory } from "@/lib/ownership";
import { firstIssueMessage, idSchema, positiveCentsSchema } from "@/lib/validation";
import { processDueRecurringExpenses } from "@/lib/recurring-processor";
import { todayISO } from "@/lib/format";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside Next.js request context (z. B. in Unit-Tests) No-Op
  }
}

const recurringSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Bitte Bezeichnung eingeben (z. B. Miete).").max(100),
  description: z.string().max(150).optional().nullable(),
  categoryId: z.string().min(1, "Bitte eine Kategorie wählen."),
  type: z.enum(["expense", "income"]).default("expense"),
  amountCents: z.number().int().positive("Betrag muss größer als 0 sein."),
  paymentMethod: z.enum(PAYMENT_METHODS).default("direct_debit"),
  interval: z.enum(INTERVALS).default("monthly"),
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  autoBook: z.boolean().default(true),
  active: z.boolean().default(true),
});

export type RecurringInput = z.infer<typeof recurringSchema>;

export async function saveRecurringExpenseAction(input: RecurringInput) {
  const user = await requireUser();
  const parsed = recurringSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
    };
  }

  const data = parsed.data;
  if (!userOwnsCategory(user.id, data.categoryId)) {
    return { success: false, error: "Ungültige Kategorie." };
  }

  if (data.id) {
    db.update(recurringExpenses)
      .set({
        name: data.name.trim(),
        description: data.description?.trim() || null,
        categoryId: data.categoryId,
        type: data.type,
        amountCents: data.amountCents,
        paymentMethod: data.paymentMethod,
        interval: data.interval,
        dayOfMonth: data.dayOfMonth,
        startDate: data.startDate,
        nextDueDate: data.nextDueDate,
        autoBook: data.autoBook,
        active: data.active,
      })
      .where(
        and(
          eq(recurringExpenses.id, data.id),
          eq(recurringExpenses.userId, user.id)
        )
      )
      .run();
  } else {
    db.insert(recurringExpenses)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        categoryId: data.categoryId,
        type: data.type,
        amountCents: data.amountCents,
        paymentMethod: data.paymentMethod,
        interval: data.interval,
        dayOfMonth: data.dayOfMonth,
        startDate: data.startDate,
        nextDueDate: data.nextDueDate,
        autoBook: data.autoBook,
        active: data.active,
        createdAt: new Date(),
      })
      .run();
  }

  // Falls Fälligkeitsdatum heute oder in der Vergangenheit liegt und autoBook aktiv ist -> sofort buchen
  const booked = processDueRecurringExpenses(user.id);

  safeRevalidatePath("/");
  safeRevalidatePath("/recurring");
  safeRevalidatePath("/transactions");

  return { success: true, booked };
}

export async function toggleRecurringActiveAction(id: string, active: boolean) {
  try {
    const user = await requireUser();

    db.update(recurringExpenses)
      .set({ active })
      .where(
        and(eq(recurringExpenses.id, id), eq(recurringExpenses.userId, user.id))
      )
      .run();

    safeRevalidatePath("/");
    safeRevalidatePath("/recurring");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Status konnte nicht geändert werden.",
    };
  }
}

export async function bookRecurringNowAction(id: string) {
  try {
    const user = await requireUser();

    const item = db
      .select()
      .from(recurringExpenses)
      .where(
        and(eq(recurringExpenses.id, id), eq(recurringExpenses.userId, user.id))
      )
      .get();

    if (!item) {
      return { success: false, error: "Fixkosten-Eintrag nicht gefunden." };
    }

    const today = todayISO();
    const now = new Date();

    db.insert(transactions)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        categoryId: item.categoryId,
        type: item.type,
        costType: "fixed",
        amountCents: item.amountCents,
        date: today,
        description: item.name,
        merchant: item.description || null,
        paymentMethod: item.paymentMethod,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    safeRevalidatePath("/");
    safeRevalidatePath("/recurring");
    safeRevalidatePath("/transactions");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Buchung fehlgeschlagen.",
    };
  }
}

export async function deleteRecurringExpenseAction(id: string) {
  try {
    const user = await requireUser();

    db.delete(recurringExpenses)
      .where(
        and(eq(recurringExpenses.id, id), eq(recurringExpenses.userId, user.id))
      )
      .run();

    safeRevalidatePath("/");
    safeRevalidatePath("/recurring");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Löschen fehlgeschlagen.",
    };
  }
}

const DAY_OF_MONTH_ERROR = "Der Tag im Monat muss zwischen 1 und 31 liegen.";

const recurringFromTransactionSchema = z.object({
  transactionId: idSchema.optional(),
  name: z.string().trim().min(1, "Bitte eine Bezeichnung angeben.").max(100),
  amountCents: positiveCentsSchema,
  type: z.enum(["expense", "income"]),
  categoryId: idSchema,
  interval: z.enum(INTERVALS).optional(),
  dayOfMonth: z
    .number({ error: DAY_OF_MONTH_ERROR })
    .int(DAY_OF_MONTH_ERROR)
    .min(1, DAY_OF_MONTH_ERROR)
    .max(31, DAY_OF_MONTH_ERROR)
    .optional(),
  autoBook: z.boolean().optional(),
});

export async function createRecurringFromTransactionAction(rawParams: {
  transactionId?: string;
  name: string;
  amountCents: number;
  type: "expense" | "income";
  categoryId: string;
  interval?: "monthly" | "yearly" | "quarterly" | "weekly" | "half_yearly";
  dayOfMonth?: number;
  autoBook?: boolean;
}) {
  try {
    const user = await requireUser();
    const parsed = recurringFromTransactionSchema.safeParse(rawParams);
    if (!parsed.success) {
      return { success: false, error: firstIssueMessage(parsed.error) };
    }
    const params = parsed.data;
    if (!userOwnsCategory(user.id, params.categoryId)) {
      return { success: false, error: "Ungültige Kategorie." };
    }

    const recurringId = crypto.randomUUID();
    const now = new Date();
    const today = todayISO();
    const dayOfMonth = params.dayOfMonth || now.getDate();

    db.transaction((tx) => {
      // 1. Fixkosten-Eintrag erstellen
      tx.insert(recurringExpenses)
        .values({
          id: recurringId,
          userId: user.id,
          name: params.name.trim(),
          description: null,
          categoryId: params.categoryId,
          type: params.type || "expense",
          amountCents: params.amountCents,
          paymentMethod: "direct_debit",
          interval: params.interval || "monthly",
          dayOfMonth: Math.min(31, Math.max(1, dayOfMonth)),
          startDate: today,
          nextDueDate: today,
          autoBook: params.autoBook ?? false,
          active: true,
          createdAt: now,
        })
        .run();

      // 2. Falls eine bestehende Transaktion übergeben wurde: als Fixkosten verknüpfen
      if (params.transactionId) {
        tx.update(transactions)
          .set({
            costType: "fixed",
            recurringId: recurringId,
            categoryId: params.categoryId,
            updatedAt: now,
          })
          .where(
            and(
              eq(transactions.id, params.transactionId),
              eq(transactions.userId, user.id)
            )
          )
          .run();
      }
    });

    safeRevalidatePath("/");
    safeRevalidatePath("/recurring");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/banking");

    return { success: true, recurringId };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Fixkosten konnten nicht angelegt werden.",
    };
  }
}
