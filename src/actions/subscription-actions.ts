"use server";

import { db } from "@/lib/db";
import { recurringExpenses, subscriptionDismissals } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { getSubscriptionSuggestions } from "@/lib/subscription-detection";
import { saveRecurringExpenseAction } from "@/actions/recurring-actions";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function safeRevalidate() {
  try {
    revalidatePath("/recurring");
    revalidatePath("/");
  } catch {
    // außerhalb des Next.js-Kontexts
  }
}

/**
 * Übernimmt ein erkanntes Abo als Fixkosten. Automatisches Buchen bleibt aus,
 * weil die Abbuchung bereits über die Bank kommt (sonst entstünden Dubletten).
 */
export async function acceptSubscriptionSuggestionAction(merchantKey: string) {
  const user = await requireUser();
  const suggestion = getSubscriptionSuggestions(user.id).find(
    (s) => s.merchantKey === merchantKey && !s.existingRecurringId
  );
  if (!suggestion) return { success: false, error: "Vorschlag nicht mehr verfügbar." };

  return saveRecurringExpenseAction({
    name: suggestion.displayName,
    description: "Automatisch erkanntes Abo",
    categoryId: suggestion.categoryId,
    type: "expense",
    amountCents: suggestion.lastAmountCents,
    paymentMethod: "direct_debit",
    interval: suggestion.interval,
    dayOfMonth: Math.min(Math.max(suggestion.dayOfMonth, 1), 31),
    startDate: suggestion.lastDate,
    nextDueDate: suggestion.nextExpectedDate,
    autoBook: false,
    active: true,
  });
}

/** Passt den Betrag bestehender Fixkosten an eine Preiserhöhung an. */
export async function applyPriceIncreaseAction(recurringId: string, amountCents: number) {
  const user = await requireUser();
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { success: false, error: "Ungültiger Betrag." };
  }
  const res = db
    .update(recurringExpenses)
    .set({ amountCents })
    .where(and(eq(recurringExpenses.id, recurringId), eq(recurringExpenses.userId, user.id)))
    .run();
  safeRevalidate();
  return res.changes === 1
    ? { success: true }
    : { success: false, error: "Fixkosten nicht gefunden." };
}

/** Blendet einen Vorschlag dauerhaft aus. */
export async function dismissSubscriptionSuggestionAction(merchantKey: string) {
  const user = await requireUser();
  db.insert(subscriptionDismissals)
    .values({ userId: user.id, merchantKey: merchantKey.slice(0, 100), createdAt: new Date() })
    .onConflictDoNothing()
    .run();
  safeRevalidate();
  return { success: true };
}
