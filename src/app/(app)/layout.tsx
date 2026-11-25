import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { categories, variablePresets, bankAccounts } from "@/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { getGlobalAppSettings } from "@/lib/settings";
import { getInboxCount } from "@/lib/inbox";
import { BottomNav } from "@/components/layout/bottom-nav";
import { TopHeader } from "@/components/layout/top-header";
import { CommandBar } from "@/components/layout/command-bar";
import { AppLayoutShell } from "@/components/layout/app-layout-shell";
import { PwaStatusBar } from "@/components/pwa/pwa-status-bar";
import { Megaphone } from "lucide-react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const appSettings = getGlobalAppSettings();

  const userCategories = db
    .select()
    .from(categories)
    .where(
      and(eq(categories.userId, user.id), eq(categories.isArchived, false))
    )
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
      accountType: bankAccounts.accountType,
      balanceCents: bankAccounts.balanceCents,
      ibanMasked: bankAccounts.ibanMasked,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.userId, user.id))
    .all();

  return (
    <AppLayoutShell
      header={
        <TopHeader
          userName={user.name}
          userEmail={user.email}
          userImage={user.image || null}
          userRole={(user as { role?: string }).role || "user"}
          appName={appSettings.appName}
          appSubtitle={appSettings.appSubtitle}
          primaryColor={appSettings.primaryColor}
          customLogoPath={appSettings.customLogoPath}
          inboxCount={getInboxCount(user.id)}
        />
      }
      commandBar={
        <CommandBar
          categories={userCategories.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
          }))}
          bankAccounts={userBankAccounts.map((b) => ({
            id: b.id,
            accountName: b.accountName,
            accountType: b.accountType,
          }))}
          userRole={(user as { role?: string }).role || "user"}
        />
      }
      announcement={
        appSettings.systemAnnouncement ? (
          <div className="bg-blue-500/10 border border-blue-500/25 text-blue-800 dark:text-blue-300 px-4 py-2.5 rounded-2xl text-xs font-medium flex items-center gap-2">
            <Megaphone className="w-4 h-4 shrink-0" />
            <span>{appSettings.systemAnnouncement}</span>
          </div>
        ) : null
      }
      pwaStatusBar={<PwaStatusBar />}
      bottomNav={
        <BottomNav
          categories={userCategories.map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            icon: c.icon,
            type: c.type,
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
          defaultPaymentMethod={appSettings.defaultPaymentMethod}
        />
      }
    >
      {children}
    </AppLayoutShell>
  );
}
