import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { bankAccounts, categories, transactions } from "@/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata = { title: "Umsätze prüfen" };

export default async function InboxPage() {
  const user = await requireUser();

  const pending = db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      merchant: transactions.merchant,
      amountCents: transactions.amountCents,
      type: transactions.type,
      categoryId: transactions.categoryId,
      accountName: bankAccounts.accountName,
    })
    .from(transactions)
    .leftJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
    .where(and(eq(transactions.userId, user.id), eq(transactions.reviewStatus, "pending")))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(300)
    .all();

  const userCategories = db
    .select({ id: categories.id, name: categories.name, type: categories.type })
    .from(categories)
    .where(and(eq(categories.userId, user.id), eq(categories.isArchived, false)))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();

  return <InboxView items={pending} categories={userCategories} />;
}
