import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import {
  connectedBanks as connectedBanksTable,
  bankAccounts as bankAccountsTable,
  transactions as transactionsTable,
  categories as categoriesTable,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { BankingHubView } from "@/components/banking/banking-hub-view";
import {
  isLiveBankingMode,
  isMockBankingAllowed,
} from "@/lib/bank-sync/provider";

export const metadata = {
  title: "Bankverbindungen & Konten",
  description:
    "Verwalte deine Bankkonten, Kreditkarten und Salden per PSD2 Open Banking.",
};

export default async function BankingPage() {
  const user = await requireUser();

  const userBanks = db
    .select()
    .from(connectedBanksTable)
    .where(eq(connectedBanksTable.userId, user.id))
    .orderBy(desc(connectedBanksTable.createdAt))
    .all();

  const userAccounts = db
    .select()
    .from(bankAccountsTable)
    .where(eq(bankAccountsTable.userId, user.id))
    .all();

  const userTransactions = db
    .select({
      id: transactionsTable.id,
      bankAccountId: transactionsTable.bankAccountId,
      categoryId: transactionsTable.categoryId,
      amountCents: transactionsTable.amountCents,
      type: transactionsTable.type,
      date: transactionsTable.date,
      description: transactionsTable.description,
      merchant: transactionsTable.merchant,
      categoryName: categoriesTable.name,
    })
    .from(transactionsTable)
    .leftJoin(
      categoriesTable,
      eq(transactionsTable.categoryId, categoriesTable.id)
    )
    .where(eq(transactionsTable.userId, user.id))
    .orderBy(desc(transactionsTable.date), desc(transactionsTable.createdAt))
    .limit(200)
    .all();

  const userCategories = db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      type: categoriesTable.type,
      color: categoriesTable.color,
      icon: categoriesTable.icon,
    })
    .from(categoriesTable)
    .where(eq(categoriesTable.userId, user.id))
    .orderBy(desc(categoriesTable.sortOrder))
    .all();

  const connectedBanksWithAccounts = userBanks.map((b) => ({
    id: b.id,
    institutionId: b.institutionId,
    institutionName: b.institutionName,
    institutionLogo: b.institutionLogo,
    consentExpiresAt: b.consentExpiresAt,
    status: b.status,
    lastSyncedAt: b.lastSyncedAt,
    isManual: false,
    accounts: userAccounts
      .filter((a) => a.connectedBankId === b.id)
      .map((a) => ({
        id: a.id,
        accountName: a.accountName,
        accountType: a.accountType,
        ibanMasked: a.ibanMasked,
        currency: a.currency,
        balanceCents: a.balanceCents,
        creditLimitCents: a.creditLimitCents,
        billingDayOfMonth: a.billingDayOfMonth,
        notes: a.notes,
        settlementAccountId: a.settlementAccountId,
        settlementMatchPattern: a.settlementMatchPattern,
        autoSync: a.autoSync,
        lastSyncError: a.lastSyncError,
        syncBackoffUntil: a.syncBackoffUntil
          ? a.syncBackoffUntil.toISOString()
          : null,
        recentTransactions: userTransactions
          .filter((t) => t.bankAccountId === a.id)
          .slice(0, 10),
      })),
  }));

  // Manuelle Geldquellen & Kreditkarten (ohne PSD2-Anbindung wie Advanzia, TF Bank, Bargeld)
  const manualAccounts = userAccounts.filter((a) => !a.connectedBankId);
  if (manualAccounts.length > 0) {
    connectedBanksWithAccounts.push({
      id: "manual_banks_group",
      institutionId: "MANUAL",
      institutionName: "Manuelle Geldquellen & Kreditkarten",
      institutionLogo: null,
      consentExpiresAt: "2099-12-31",
      status: "active",
      lastSyncedAt: null,
      isManual: true,
      accounts: manualAccounts.map((a) => ({
        id: a.id,
        accountName: a.accountName,
        accountType: a.accountType,
        ibanMasked: a.ibanMasked,
        currency: a.currency,
        balanceCents: a.balanceCents,
        creditLimitCents: a.creditLimitCents,
        billingDayOfMonth: a.billingDayOfMonth,
        notes: a.notes,
        settlementAccountId: a.settlementAccountId,
        settlementMatchPattern: a.settlementMatchPattern,
        autoSync: false,
        lastSyncError: null,
        syncBackoffUntil: null,
        recentTransactions: userTransactions
          .filter((t) => t.bankAccountId === a.id)
          .slice(0, 10),
      })),
    });
  }

  const isLiveMode = isLiveBankingMode();
  const isDemoAvailable = !isLiveMode && isMockBankingAllowed();

  return (
    <BankingHubView
      connectedBanks={connectedBanksWithAccounts}
      categories={userCategories}
      isLiveMode={isLiveMode}
      isDemoAvailable={isDemoAvailable}
      isAdmin={(user as { role?: string }).role === "admin"}
    />
  );
}
