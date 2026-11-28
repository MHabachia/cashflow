import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import {
  categories,
  variablePresets,
  bankAccounts,
  connectedBanks,
} from "@/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { todayISO } from "@/lib/format";
import {
  listAvailableMonths,
  loadRecentTransactions,
  loadTransactionsForList,
  parseListMonth,
} from "@/lib/transactions-list";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string | string[] }>;
}) {
  const user = await requireUser();
  const currentMonth = todayISO().slice(0, 7);
  const selectedMonth = parseListMonth((await searchParams)?.month, currentMonth);

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

  const accountMap = Object.fromEntries(
    userBankAccounts.map((a) => [a.id, a])
  );

  const userTransactions = loadTransactionsForList(user.id, selectedMonth);

  return (
    <TransactionsView
      selectedMonth={selectedMonth}
      availableMonths={listAvailableMonths(user.id, currentMonth)}
      recentTransactions={loadRecentTransactions(user.id)}
      transactions={userTransactions.map((t) => ({
        id: t.id,
        categoryId: t.categoryId,
        type: t.type,
        costType: t.costType,
        amountCents: t.amountCents,
        date: t.date,
        description: t.description,
        merchant: t.merchant,
        paymentMethod: t.paymentMethod,
        receiptPath: t.receiptPath,
        isSplit: t.isSplit,
        bankAccountId: t.bankAccountId,
        isBankSynced: Boolean(t.bankTransactionId),
        bankAccountName: t.bankAccountId
          ? accountMap[t.bankAccountId]?.accountName || "Bankkonto"
          : null,
      }))}
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
