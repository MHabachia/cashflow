"use server";

import { db } from "@/lib/db";
import { categories, categoryRules, transactions } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { deriveRulePattern } from "@/lib/inbox";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";

function safeRevalidate() {
  try {
    revalidatePath("/", "layout");
    revalidatePath("/inbox");
    revalidatePath("/transactions");
  } catch {
    // außerhalb des Next.js-Kontexts (Unit-Tests)
  }
}

const confirmSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  createRule: z.boolean().optional(),
});

/**
 * Bestätigt einen geprüften Umsatz, optional mit neuer Kategorie und
 * einer Regel, die künftige Umsätze dieses Händlers automatisch zuordnet.
 */
export async function confirmInboxTransactionAction(input: z.input<typeof confirmSchema>) {
  const user = await requireUser();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Ungültige Eingaben." };
  const { id, categoryId, createRule } = parsed.data;

  const tx = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
    .get();
  if (!tx) return { success: false, error: "Buchung nicht gefunden." };

  const targetCategoryId = categoryId ?? tx.categoryId;
  const category = db
    .select({ id: categories.id, type: categories.type })
    .from(categories)
    .where(and(eq(categories.id, targetCategoryId), eq(categories.userId, user.id)))
    .get();
  if (!category) return { success: false, error: "Ungültige Kategorie." };

  let ruleCreated = false;
  db.transaction((t) => {
    t.update(transactions)
      .set({
        categoryId: targetCategoryId,
        reviewStatus: null,
        // Nur eine abweichende Kategorie ist eine manuelle Korrektur
        ...(targetCategoryId !== tx.categoryId ? { manuallyClassified: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, tx.id))
      .run();

    if (createRule) {
      const pattern = deriveRulePattern(tx.merchant, tx.description);
      if (pattern.length >= 3) {
        const existing = t
          .select({ id: categoryRules.id })
          .from(categoryRules)
          .where(and(eq(categoryRules.userId, user.id), eq(categoryRules.pattern, pattern)))
          .get();
        const now = new Date();
        if (existing) {
          t.update(categoryRules)
            .set({ categoryId: targetCategoryId, isActive: true, updatedAt: now })
            .where(eq(categoryRules.id, existing.id))
            .run();
        } else {
          t.insert(categoryRules)
            .values({
              id: crypto.randomUUID(),
              userId: user.id,
              name: `Aus Prüfung: ${pattern}`,
              pattern,
              matchField: "all",
              categoryId: targetCategoryId,
              costType: tx.costType,
              priority: 10,
              isActive: true,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
        ruleCreated = true;
      }
    }
  });

  safeRevalidate();
  return { success: true, ruleCreated };
}

/** Bestätigt mehrere (oder alle offenen) Umsätze ohne Änderung. */
export async function confirmAllInboxAction(ids?: string[]) {
  const user = await requireUser();
  const conditions = [eq(transactions.userId, user.id), eq(transactions.reviewStatus, "pending")];
  if (ids && ids.length > 0) conditions.push(inArray(transactions.id, ids.slice(0, 1000)));

  const res = db
    .update(transactions)
    .set({ reviewStatus: null, updatedAt: new Date() })
    .where(and(...conditions))
    .run();

  safeRevalidate();
  return { success: true, confirmed: res.changes };
}
