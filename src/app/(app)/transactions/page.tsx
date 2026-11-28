import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import {
  categories,
  variablePresets,
  bankAccounts,
  connectedBanks,
} from "@/lib/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { todayISO } from "@/lib/format";
import {
  listAvailableMonths,
  loadRecentTransactions,
  parseListFilter,
  queryTransactions,
  summarizeTransactions,
} from "@/lib/transactions-list";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const currentMonth = todayISO().slice(0, 7);
  // Filter stehen in der URL; der Server lädt nur die erste Seite der Treffer
  const filter = parseListFilter((await searchParams) ?? {}, currentMonth);
  const firstPage = queryTransactions(user.id, filter);

  const userCategories = db
    .select()
    .from(categories)
    .where(eq(categories.userId, user.id))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();

  const userPresets = db
    .select()
    .from(variablePresets)
    .where(eq(variablePresets.userId, user.id))
    .orderBy(desc(variablePresets.usageCount), asc(variablePresets.sortOrder))
    .all();

  const userBankAccounts = db
    .select({
      id: bankAccounts.id,
      accountName: bankAccounts.accountName,
      ibanMasked: bankAccounts.ibanMasked,
      institutionName: connectedBanks.institutionName,
    })
    .from(bankAccounts)
    .leftJoin(
      connectedBanks,
      eq(bankAccounts.connectedBankId, connectedBanks.id)
    )
    .where(eq(bankAccounts.userId, user.id))
    .all();

  return (
    <TransactionsView
      filter={filter}
      summary={summarizeTransactions(user.id, filter)}
      nextCursor={firstPage.nextCursor}
      availableMonths={listAvailableMonths(user.id, currentMonth)}
      recentTransactions={loadRecentTransactions(user.id)}
      transactions={firstPage.rows}
      categories={userCategories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        type: c.type,
        parentId: c.parentId,
        isArchived: c.isArchived,
      }))}
      presets={userPresets.map((p) => ({
        id: p.id,
        name: p.name,
        categoryId: p.categoryId,
        type: p.type,
        defaultAmountCents: p.defaultAmountCents,
        paymentMethod: p.paymentMethod,
        usageCount: p.usageCount,
      }))}
      bankAccounts={userBankAccounts}
    />
  );
}
