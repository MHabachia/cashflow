"use server";

import { db } from "@/lib/db";
import {
  categories,
  variablePresets,
  transactions,
  PAYMENT_METHODS,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { and, eq, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside Next.js request context (z. B. in Unit-Tests)
  }
}

const categorySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Name darf nicht leer sein.").max(60),
  parentId: z.string().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ungültige Farbe."),
  icon: z.string().min(1),
  type: z.enum(["expense", "income"]).default("expense"),
});

export async function saveCategoryAction(
  input: z.infer<typeof categorySchema>
) {
  const user = await requireUser();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
    };
  }

  const data = parsed.data;
  if (data.id && data.parentId && data.id === data.parentId) {
    return {
      success: false,
      error: "Eine Kategorie kann nicht ihre eigene übergeordnete Kategorie sein.",
    };
  }

  const cleanParentId = data.parentId?.trim() || null;

  if (data.id) {
    db.update(categories)
      .set({
        name: data.name.trim(),
        parentId: cleanParentId,
        color: data.color,
        icon: data.icon,
        type: data.type,
      })
      .where(and(eq(categories.id, data.id), eq(categories.userId, user.id)))
      .run();
  } else {
    db.insert(categories)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        name: data.name.trim(),
        parentId: cleanParentId,
        color: data.color,
        icon: data.icon,
        type: data.type,
        sortOrder: 99,
        isDefault: false,
        isArchived: false,
        createdAt: new Date(),
      })
      .run();
  }

  safeRevalidatePath("/");
  safeRevalidatePath("/transactions");
  safeRevalidatePath("/categories");
  safeRevalidatePath("/recurring");

  return { success: true };
}

export async function deleteOrArchiveCategoryAction(id: string) {
  try {
    const user = await requireUser();

    const txCount = db
      .select({ value: count() })
      .from(transactions)
      .where(
        and(eq(transactions.categoryId, id), eq(transactions.userId, user.id))
      )
      .get();

    if ((txCount?.value ?? 0) > 0) {
      // Kategorie hat bereits Buchungen -> archivieren statt hart löschen
      db.update(categories)
        .set({ isArchived: true })
        .where(and(eq(categories.id, id), eq(categories.userId, user.id)))
        .run();
      // Unterkategorien von dieser Kategorie trennen
      db.update(categories)
        .set({ parentId: null })
        .where(and(eq(categories.parentId, id), eq(categories.userId, user.id)))
        .run();
      safeRevalidatePath("/categories");
      return {
        success: true,
        archived: true,
        message:
          "Kategorie wird bereits in Buchungen verwendet und wurde archiviert.",
      };
    }

    // Unterkategorien von dieser Kategorie trennen
    db.update(categories)
      .set({ parentId: null })
      .where(and(eq(categories.parentId, id), eq(categories.userId, user.id)))
      .run();

    db.delete(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, user.id)))
      .run();

    safeRevalidatePath("/categories");
    safeRevalidatePath("/transactions");
    return { success: true, archived: false };
  } catch (err: unknown) {
    return {
      success: false,
      archived: false,
      error: (err as Error)?.message || "Kategorie konnte nicht gelöscht werden.",
    };
  }
}

// ==========================================
// VORDEFINIERTE VARIABLE KOSTEN (PRESETS)
// ==========================================

const presetSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Bitte einen Namen für die Vorlage eingeben.").max(80),
  categoryId: z.string().min(1, "Bitte eine Kategorie wählen."),
  type: z.enum(["expense", "income"]).default("expense"),
  defaultAmountCents: z.number().int().positive().nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default("apple_pay"),
});

export async function saveVariablePresetAction(
  input: z.infer<typeof presetSchema>
) {
  const user = await requireUser();
  const parsed = presetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
    };
  }

  const data = parsed.data;
  if (data.id) {
    db.update(variablePresets)
      .set({
        name: data.name.trim(),
        categoryId: data.categoryId,
        type: data.type,
        defaultAmountCents: data.defaultAmountCents ?? null,
        paymentMethod: data.paymentMethod,
      })
      .where(
        and(
          eq(variablePresets.id, data.id),
          eq(variablePresets.userId, user.id)
        )
      )
      .run();
  } else {
    db.insert(variablePresets)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        name: data.name.trim(),
        categoryId: data.categoryId,
        type: data.type,
        defaultAmountCents: data.defaultAmountCents ?? null,
        paymentMethod: data.paymentMethod,
        usageCount: 0,
        sortOrder: 0,
        createdAt: new Date(),
      })
      .run();
  }

  safeRevalidatePath("/");
  safeRevalidatePath("/transactions");
  safeRevalidatePath("/categories");

  return { success: true };
}

export async function deleteVariablePresetAction(id: string) {
  try {
    const user = await requireUser();

    db.delete(variablePresets)
      .where(
        and(eq(variablePresets.id, id), eq(variablePresets.userId, user.id))
      )
      .run();

    safeRevalidatePath("/");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/categories");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Vorlage konnte nicht gelöscht werden.",
    };
  }
}
