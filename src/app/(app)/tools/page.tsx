import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { bankAccounts, categoryRules } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { ToolsHubView } from "@/components/tools/tools-hub-view";

export default async function ToolsPage() {
  const user = await requireUser();

  const userAccounts = db
    .select({
      id: bankAccounts.id,
      accountName: bankAccounts.accountName,
      ibanMasked: bankAccounts.ibanMasked,
      accountType: bankAccounts.accountType,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.userId, user.id))
    .orderBy(desc(bankAccounts.createdAt))
    .all();

  const userRules = db
    .select({
      id: categoryRules.id,
      isActive: categoryRules.isActive,
    })
    .from(categoryRules)
    .where(eq(categoryRules.userId, user.id))
    .all();

  const activeRulesCount = userRules.filter((r) => r.isActive).length;

  return (
    <ToolsHubView
      hasPaypalAccount={userAccounts.some((a) => a.accountType === "paypal")}
      accounts={userAccounts.map((a) => ({
        id: a.id,
        accountName: a.accountName,
        ibanMasked: a.ibanMasked,
        accountType: a.accountType,
      }))}
      rulesCount={userRules.length}
      activeRulesCount={activeRulesCount}
      isAdmin={(user as { role?: string }).role === "admin"}
    />
  );
}
