import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { categories, recurringExpenses } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { FixedCostsView } from "@/components/recurring/fixed-costs-view";
import { SubscriptionSuggestions } from "@/components/recurring/subscription-suggestions";
import { getSubscriptionSuggestions } from "@/lib/subscription-detection";
import { FixedCostCalendar } from "@/components/recurring/fixed-cost-calendar";
import { buildMonthCalendar } from "@/lib/fixed-cost-calendar";
import { computeLiquidityForecast } from "@/lib/forecast";

export default async function RecurringPage() {
  const user = await requireUser();

  const userCategories = db
    .select()
    .from(categories)
    .where(
      and(eq(categories.userId, user.id), eq(categories.isArchived, false))
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();

  const items = db
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.userId, user.id))
    .orderBy(asc(recurringExpenses.dayOfMonth), asc(recurringExpenses.name))
    .all();

  const suggestions = getSubscriptionSuggestions(user.id);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const forecast = computeLiquidityForecast(user.id, now);
  // Engpass-Prüfung nur ab heute: Fälligkeiten vor heute sind im Saldo schon enthalten
  const calendar = buildMonthCalendar(
    items.map((i) => ({
      name: i.name,
      type: i.type,
      amountCents: i.amountCents,
      interval: i.interval,
      dayOfMonth: i.dayOfMonth,
      nextDueDate: i.nextDueDate,
      active: i.active,
      endDate: i.endDate,
    })),
    today.slice(0, 7),
    forecast.hasAccounts ? forecast.startBalanceCents : null,
    today
  );

  return (
    <>
    <SubscriptionSuggestions suggestions={suggestions} />
    <FixedCostCalendar calendar={calendar} today={today} />
    <FixedCostsView
      items={items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        categoryId: i.categoryId,
        type: i.type,
        amountCents: i.amountCents,
        paymentMethod: i.paymentMethod,
        interval: i.interval,
        dayOfMonth: i.dayOfMonth,
        startDate: i.startDate,
        nextDueDate: i.nextDueDate,
        lastProcessedDate: i.lastProcessedDate,
        autoBook: i.autoBook,
        active: i.active,
      }))}
      categories={userCategories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        type: c.type,
      }))}
    />
    </>
  );
}
