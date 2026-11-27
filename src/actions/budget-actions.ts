"use server";

import { db } from "@/lib/db";
import { budgets } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { userOwnsCategory } from "@/lib/ownership";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";

const budgetSchema = z.object({
  categoryId: z.string().nullable(), // null = Gesamt-Monatsbudget
  amountCents: z
    .number()
    .int()
    .nonnegative("Budget darf nicht negativ sein."),
});

export async function saveBudgetAction(input: z.infer<typeof budgetSchema>) {
  const user = await requireUser();
  const parsed = budgetSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Eingabe.",
    };
  }

  const { categoryId, amountCents } = parsed.data;
  if (categoryId && !userOwnsCategory(user.id, categoryId)) {
    return { success: false, error: "Ungültige Kategorie." };
  }
  const now = new Date();

  const existing = db
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, user.id),
        categoryId ? eq(budgets.categoryId, categoryId) : isNull(budgets.categoryId)
      )
    )
    .get();

  // Wenn amountCents === 0 -> Budget entfernen
  if (amountCents === 0) {
    if (existing) {
      db.delete(budgets).where(eq(budgets.id, existing.id)).run();
    }
  } else if (existing) {
    db.update(budgets)
      .set({
        amountCents,
        updatedAt: now,
      })
      .where(eq(budgets.id, existing.id))
      .run();
  } else {
    db.insert(budgets)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        categoryId,
        amountCents,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  revalidatePath("/");
  revalidatePath("/categories");

  return { success: true };
}
