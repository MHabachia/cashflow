"use server";

import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { requireAdmin, requireUser } from "@/lib/session";
import { checkAccountLoginLock, recordLoginFailure } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getAppBaseUrl } from "@/lib/url";
import {
  consumeRecoveryCode,
  consumeResetToken,
  countRemainingRecoveryCodes,
  createPasswordResetToken,
  generateRecoveryCodes,
  inspectResetToken,
  RESET_TOKEN_TTL_HOURS,
  setUserPassword,
  userHasPassword,
  validateNewPassword,
  verifyUserPassword,
} from "@/lib/password-recovery";
import { clientKeyFromHeaders, hitRateLimit } from "@/lib/simple-rate-limit";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

const GENERIC_RECOVERY_ERROR =
  "E-Mail-Adresse oder Wiederherstellungscode ist nicht korrekt.";

// ---------------- 1. Reset-Link durch Admin ----------------

export async function createPasswordResetLinkAction(targetUserId: string) {
  const admin = await requireAdmin();
  const target = db
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, targetUserId))
    .get();
  if (!target) return { success: false, error: "Benutzer nicht gefunden." };

  const token = createPasswordResetToken(target.id, { purpose: "admin_link", createdBy: admin.id });
  const requestHeaders = await headers();
  logAudit({
    action: "admin.user.password_reset",
    userId: target.id,
    actorId: admin.id,
    target: target.email,
    details: { method: "link" },
    headers: requestHeaders,
  });
  // Basis-URL aus APP_URL (Host-Header werden bewusst nicht verwendet)
  const base = getAppBaseUrl();
  return {
    success: true,
    url: `${base}/reset-password?token=${encodeURIComponent(token)}`,
    validHours: RESET_TOKEN_TTL_HOURS,
  };
}

export async function inspectResetTokenAction(token: string) {
  const info = inspectResetToken(token);
  if (!info) return { valid: false as const };
  // E-Mail nur teilweise anzeigen
  const [name, domain] = info.email.split("@");
  return { valid: true as const, maskedEmail: `${name.slice(0, 2)}…@${domain}` };
}

export async function resetPasswordWithTokenAction(input: { token: string; newPassword: string }) {
  const requestHeaders = await headers();
  const limit = hitRateLimit(`reset:${clientKeyFromHeaders(requestHeaders)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return { success: false, error: "Zu viele Versuche. Bitte später erneut versuchen." };
  }
  const invalid = validateNewPassword(input.newPassword);
  if (invalid) return { success: false, error: invalid };

  const userId = consumeResetToken(input.token);
  if (!userId) {
    return { success: false, error: "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet." };
  }
  await setUserPassword(userId, input.newPassword);
  logAudit({ action: "auth.password.reset", userId, details: { method: "link" }, headers: requestHeaders });
  return { success: true };
}

// ---------------- 2. Wiederherstellungscodes ----------------

export async function getRecoveryCodeStatusAction() {
  const user = await requireUser();
  return {
    remaining: countRemainingRecoveryCodes(user.id),
    hasPassword: userHasPassword(user.id),
  };
}

export async function generateRecoveryCodesAction(input: { currentPassword: string }) {
  const user = await requireUser();
  // Erneute Passwortabfrage: Wer nur eine gestohlene Sitzung hat, soll sich
  // keine dauerhaften Hintertüren erzeugen können
  if (userHasPassword(user.id) && !(await verifyUserPassword(user.id, input.currentPassword))) {
    return { success: false, error: "Das aktuelle Passwort ist nicht korrekt." };
  }
  const codes = generateRecoveryCodes(user.id);
  logAudit({ action: "auth.recovery_codes.generate", userId: user.id, headers: await headers() });
  return { success: true, codes };
}

export async function recoverWithCodeAction(input: { email: string; code: string; newPassword: string }) {
  const requestHeaders = await headers();
  const email = (input.email || "").trim().toLowerCase();

  const ipLimit = hitRateLimit(`recover:${clientKeyFromHeaders(requestHeaders)}`, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return { success: false, error: "Zu viele Versuche. Bitte später erneut versuchen." };
  }
  if (email && checkAccountLoginLock(email).locked) {
    return { success: false, error: "Zu viele Fehlversuche für dieses Konto. Bitte später erneut versuchen." };
  }
  const invalid = validateNewPassword(input.newPassword);
  if (invalid) return { success: false, error: invalid };

  const user = email
    ? db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).get()
    : undefined;

  // Gleiche Antwort für unbekannte E-Mail und falschen Code (keine Konto-Erkennung)
  if (!user || !consumeRecoveryCode(user.id, input.code)) {
    if (email) recordLoginFailure(email);
    logAudit({
      action: "auth.password.reset_failed",
      userId: user?.id ?? null,
      target: email || null,
      details: { method: "recovery_code" },
      headers: requestHeaders,
    });
    return { success: false, error: GENERIC_RECOVERY_ERROR };
  }

  await setUserPassword(user.id, input.newPassword);
  logAudit({
    action: "auth.password.reset",
    userId: user.id,
    details: { method: "recovery_code", remainingCodes: countRemainingRecoveryCodes(user.id) },
    headers: requestHeaders,
  });
  return { success: true, remaining: countRemainingRecoveryCodes(user.id) };
}
