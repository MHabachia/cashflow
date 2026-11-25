import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import {
  user as userTable,
  invitations,
  transactions,
  recurringExpenses,
} from "@/lib/db/schema";
import { getGlobalAppSettings } from "@/lib/settings";
import { desc, count, eq } from "drizzle-orm";
import { AdminDashboardView } from "@/components/admin/admin-dashboard-view";
import { AuditLogSection } from "@/components/admin/audit-log-section";
import { getRecentAuditEntries } from "@/lib/audit";
import { SystemHealthSection } from "@/components/admin/system-health-section";
import { getBankHealth, getHealthChecks } from "@/lib/system-health";
import { getUpdateInfo } from "@/lib/update-check";
import { AutoBackupSection } from "@/components/admin/auto-backup-section";
import { getBackupDir, listAutoBackups } from "@/lib/backup-scheduler";

export default async function AdminPage() {
  const currentAdmin = await requireAdmin();
  const updateInfo = await getUpdateInfo();
  const appSettings = getGlobalAppSettings();

  const allUsers = db
    .select()
    .from(userTable)
    .orderBy(desc(userTable.createdAt))
    .all();

  const allInvites = db
    .select()
    .from(invitations)
    .orderBy(desc(invitations.createdAt))
    .all();

  const usersWithStats = allUsers.map((u) => {
    const txRes = db
      .select({ value: count() })
      .from(transactions)
      .where(eq(transactions.userId, u.id))
      .get();

    const fixedRes = db
      .select({ value: count() })
      .from(recurringExpenses)
      .where(eq(recurringExpenses.userId, u.id))
      .get();

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role as "admin" | "user",
      banned: Boolean(u.banned),
      createdAt: u.createdAt.toISOString().slice(0, 10),
      txCount: txRes?.value ?? 0,
      fixedCount: fixedRes?.value ?? 0,
    };
  });

  const userLabels = new Map(allUsers.map((u) => [u.id, u.email]));
  const auditEntries = getRecentAuditEntries(200).map((e) => ({
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    action: e.action,
    userLabel: e.userId ? userLabels.get(e.userId) ?? "gelöschter Benutzer" : null,
    actorLabel:
      e.actorId && e.actorId !== e.userId
        ? userLabels.get(e.actorId) ?? "gelöschter Benutzer"
        : null,
    target: e.target,
    ipAddress: e.ipAddress,
  }));

  return (
    <div className="space-y-10">
    <AdminDashboardView
      currentAdminId={currentAdmin.id}
      initialSettings={appSettings}
      users={usersWithStats}
      invitations={allInvites.map((inv) => ({
        id: inv.id,
        token: inv.token,
        email: inv.email,
        usedAt: inv.usedAt ? inv.usedAt.toISOString() : null,
        expiresAt: inv.expiresAt.toISOString(),
      }))}
    />
    <div className="max-w-4xl mx-auto pb-16 space-y-10">
      <SystemHealthSection checks={getHealthChecks()} banks={getBankHealth()} update={updateInfo} />
      <AutoBackupSection
        backups={listAutoBackups().map((b) => ({
          ...b,
          createdAt: b.createdAt.toISOString(),
        }))}
        backupDir={getBackupDir()}
        enabled={process.env.AUTO_BACKUP_ENABLED !== "false"}
      />
      <AuditLogSection entries={auditEntries} />
    </div>
    </div>
  );
}
