import { requireUser, getCurrentSession } from "@/lib/session";
import { db } from "@/lib/db";
import {
  session as sessionTable,
  passkey as passkeyTable,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { formatDateDE } from "@/lib/format";
import { UserProfileEditor } from "@/components/settings/user-profile-editor";
import { PasswordChangeCard } from "@/components/settings/password-change-card";
import { RecoveryCodesCard } from "@/components/settings/recovery-codes-card";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { PasskeyCard } from "@/components/settings/passkey-card";
import { NotificationCard } from "@/components/settings/notification-card";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function SettingsPage() {
  const currentUser = await requireUser();
  const currentSession = await getCurrentSession();
  const isAdmin = (currentUser as { role?: string }).role === "admin";

  const userSessions = db
    .select()
    .from(sessionTable)
    .where(eq(sessionTable.userId, currentUser.id))
    .orderBy(desc(sessionTable.createdAt))
    .all();

  const userPasskeys = db
    .select()
    .from(passkeyTable)
    .where(eq(passkeyTable.userId, currentUser.id))
    .orderBy(desc(passkeyTable.createdAt))
    .all();

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      {isAdmin && (
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Benutzer, Branding und Systemeinstellungen verwaltest du im Admin-Bereich.
          </p>
          <Link
            href="/admin"
            className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline flex items-center gap-1 shrink-0"
          >
            Admin
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      <UserProfileEditor
        initialName={currentUser.name}
        initialEmail={currentUser.email}
        initialImage={currentUser.image || null}
        role={isAdmin ? "admin" : "user"}
        sessions={userSessions.map((s) => ({
          id: s.id,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
          createdAt: formatDateDE(s.createdAt.toISOString().slice(0, 10)),
          isCurrent: s.id === currentSession?.session?.id,
        }))}
      />

      <NotificationCard />

      <PasskeyCard
        initialPasskeys={userPasskeys.map((pk) => ({
          id: pk.id,
          name: pk.name,
          deviceType: pk.deviceType,
          createdAt: pk.createdAt
            ? formatDateDE(pk.createdAt.toISOString().slice(0, 10))
            : null,
        }))}
      />

      <TwoFactorCard
        initialEnabled={Boolean(
          (currentUser as { twoFactorEnabled?: boolean }).twoFactorEnabled
        )}
      />

      <PasswordChangeCard />

      <RecoveryCodesCard />
    </div>
  );
}
