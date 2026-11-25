"use server";

import { db } from "@/lib/db";
import { savingsGoals, type SavingsGoal } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { and, eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside Next.js context
  }
}

const createSavingsGoalSchema = z.object({
  name: z.string().min(1, "Name für das Sparziel erforderlich.").max(100),
  targetAmountCents: z
    .number()
    .int()
    .positive("Zielbetrag muss größer als 0 € sein."),
  currentAmountCents: z.number().int().min(0).default(0),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datumsformat (YYYY-MM-DD)")
    .optional()
    .nullable(),
  icon: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

export async function createSavingsGoalAction(
  input: z.infer<typeof createSavingsGoalSchema>
) {
  try {
    const user = await requireUser();
    const parsed = createSavingsGoalSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
      };
    }

    const id = crypto.randomUUID();
    const now = new Date();

    db.insert(savingsGoals)
      .values({
        id,
        userId: user.id,
        name: parsed.data.name.trim(),
        targetAmountCents: parsed.data.targetAmountCents,
        currentAmountCents: parsed.data.currentAmountCents,
        targetDate: parsed.data.targetDate || null,
        icon: parsed.data.icon || "piggy-bank",
        color: parsed.data.color || "#10b981",
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    safeRevalidatePath("/");
    safeRevalidatePath("/categories");
    return { success: true, id };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Sparziel konnte nicht erstellt werden.",
    };
  }
}

export async function adjustSavingsGoalAmountAction(params: {
  goalId: string;
  deltaCents: number;
}) {
  try {
    const user = await requireUser();
    const existing = db
      .select()
      .from(savingsGoals)
      .where(
        and(
          eq(savingsGoals.id, params.goalId),
          eq(savingsGoals.userId, user.id)
        )
      )
      .get();

    if (!existing) {
      return { success: false, error: "Sparziel nicht gefunden." };
    }

    const nextAmount = Math.max(0, existing.currentAmountCents + params.deltaCents);

    db.update(savingsGoals)
      .set({
        currentAmountCents: nextAmount,
        updatedAt: new Date(),
      })
      .where(eq(savingsGoals.id, existing.id))
      .run();

    safeRevalidatePath("/");
    safeRevalidatePath("/categories");
    return { success: true, newAmountCents: nextAmount };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Betrag konnte nicht angepasst werden.",
    };
  }
}

export async function updateSavingsGoalAction(params: {
  id: string;
  name?: string;
  targetAmountCents?: number;
  currentAmountCents?: number;
  targetDate?: string | null;
  icon?: string | null;
  color?: string | null;
  isArchived?: boolean;
}) {
  try {
    const user = await requireUser();
    const existing = db
      .select()
      .from(savingsGoals)
      .where(
        and(eq(savingsGoals.id, params.id), eq(savingsGoals.userId, user.id))
      )
      .get();

    if (!existing) {
      return { success: false, error: "Sparziel nicht gefunden." };
    }

    db.update(savingsGoals)
      .set({
        name: params.name !== undefined ? params.name.trim() : existing.name,
        targetAmountCents:
          params.targetAmountCents !== undefined
            ? params.targetAmountCents
            : existing.targetAmountCents,
        currentAmountCents:
          params.currentAmountCents !== undefined
            ? params.currentAmountCents
            : existing.currentAmountCents,
        targetDate:
          params.targetDate !== undefined
            ? params.targetDate
            : existing.targetDate,
        icon: params.icon !== undefined ? params.icon : existing.icon,
        color: params.color !== undefined ? params.color : existing.color,
        isArchived:
          params.isArchived !== undefined
            ? params.isArchived
            : existing.isArchived,
        updatedAt: new Date(),
      })
      .where(eq(savingsGoals.id, existing.id))
      .run();

    safeRevalidatePath("/");
    safeRevalidatePath("/categories");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Sparziel konnte nicht aktualisiert werden.",
    };
  }
}

export async function deleteSavingsGoalAction(id: string) {
  try {
    const user = await requireUser();
    db.delete(savingsGoals)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, user.id)))
      .run();

    safeRevalidatePath("/");
    safeRevalidatePath("/categories");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Sparziel konnte nicht gelöscht werden.",
    };
  }
}
