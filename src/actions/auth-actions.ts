"use server";

import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { auth, getUserCount } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  invitations,
  user as userTable,
  session as sessionTable,
  account as accountTable,
} from "@/lib/db/schema";
import { logAudit } from "@/lib/audit";
import { verifyUserPassword } from "@/lib/password-recovery";
import { getGlobalAppSettings } from "@/lib/settings";
import {
  requireAdmin,
  requireUser,
  getCurrentSession,
  revokeOtherUserSessions,
} from "@/lib/session";
import { eq, and, isNull, gt, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";
import { runWithSignUpAllowed } from "@/lib/signup-guard";

const registerSchema = z.object({
  name: z.string().min(2, "Name muss mindestens 2 Zeichen lang sein."),
  email: z.string().email("Bitte eine gültige E-Mail-Adresse eingeben."),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`),
  inviteToken: z.string().optional(),
});

export async function getBrandingAction() {
  const settings = getGlobalAppSettings();
  return {
    appName: settings.appName,
    appSubtitle: settings.appSubtitle,
    primaryColor: settings.primaryColor,
    customLogoPath: settings.customLogoPath,
  };
}

export async function getRegistrationStatusAction(inviteToken?: string) {
  const userCount = getUserCount();
  const settings = getGlobalAppSettings();
  const branding = {
    appName: settings.appName,
    appSubtitle: settings.appSubtitle,
    primaryColor: settings.primaryColor,
    customLogoPath: settings.customLogoPath,
  };

  if (userCount === 0) {
    return {
      isFirstUser: true,
      registrationAllowed: true,
      inviteEmail: null,
      appName: settings.appName,
      branding,
    };
  }

  if (!inviteToken && settings.allowOpenRegistration) {
    return {
      isFirstUser: false,
      registrationAllowed: true,
      inviteEmail: null,
      appName: settings.appName,
      branding,
    };
  }

  if (!inviteToken) {
    return {
      isFirstUser: false,
      registrationAllowed: false,
      inviteEmail: null,
      appName: settings.appName,
      branding,
    };
  }

  const now = new Date();
  const invite = db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token, inviteToken),
        isNull(invitations.usedAt),
        gt(invitations.expiresAt, now)
      )
    )
    .get();

  if (!invite) {
    return {
      isFirstUser: false,
      registrationAllowed: false,
      inviteEmail: null,
      invalidToken: true,
      appName: settings.appName,
      branding,
    };
  }

  return {
    isFirstUser: false,
    registrationAllowed: true,
    inviteEmail: invite.email,
    appName: settings.appName,
    branding,
  };
}

export async function registerUserAction(formData: {
  name: string;
  email: string;
  password: string;
  inviteToken?: string;
}) {
  const parsed = registerSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
    };
  }

  const { name, email, password, inviteToken } = parsed.data;
  const userCount = getUserCount();
  const settings = getGlobalAppSettings();

  let validInviteId: string | null = null;

  if (userCount > 0 && !settings.allowOpenRegistration) {
    if (!inviteToken) {
      return {
        success: false,
        error:
          "Die offene Registrierung ist deaktiviert. Bitte nutze einen Einladungslink des Administrators.",
      };
    }

    const now = new Date();
    const invite = db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.token, inviteToken),
          isNull(invitations.usedAt),
          gt(invitations.expiresAt, now)
        )
      )
      .get();

    if (!invite) {
      return {
        success: false,
        error: "Dieser Einladungslink ist ungültig oder abgelaufen.",
      };
    }

    if (
      invite.email &&
      invite.email.toLowerCase() !== email.trim().toLowerCase()
    ) {
      return {
        success: false,
        error: `Diese Einladung ist für ${invite.email} ausgestellt.`,
      };
    }

    // Einladung atomar reservieren, damit ein Token nicht parallel mehrfach
    // eingelöst werden kann.
    const claim = db
      .update(invitations)
      .set({ usedAt: now })
      .where(
        and(
          eq(invitations.id, invite.id),
          isNull(invitations.usedAt),
          gt(invitations.expiresAt, now)
        )
      )
      .run();

    if (claim.changes !== 1) {
      return {
        success: false,
        error: "Dieser Einladungslink ist ungültig oder abgelaufen.",
      };
    }

    validInviteId = invite.id;
  }

  try {
    const requestHeaders = await headers();
    const res = await runWithSignUpAllowed(() =>
      auth.api.signUpEmail({
        body: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        },
        headers: requestHeaders,
      })
    );

    if (!res?.user?.id) {
      throw new Error("Registrierung fehlgeschlagen.");
    }

    if (validInviteId) {
      db.update(invitations)
        .set({ usedBy: res.user.id })
        .where(eq(invitations.id, validInviteId))
        .run();
    }

    logAudit({
      action: "auth.register",
      userId: res.user.id,
      target: email.trim().toLowerCase(),
      details: { viaInvite: !!validInviteId },
      headers: requestHeaders,
    });

    return { success: true };
  } catch (err) {
    // Reservierte Einladung wieder freigeben, wenn die Anlage scheitert
    if (validInviteId) {
      db.update(invitations)
        .set({ usedAt: null })
        .where(
          and(eq(invitations.id, validInviteId), isNull(invitations.usedBy))
        )
        .run();
    }
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Registrierung fehlgeschlagen. Möglicherweise existiert die E-Mail bereits.",
    };
  }
}

export async function createInvitationAction(email?: string, validDays: number = 7) {
  const admin = await requireAdmin();
  const days = Math.min(30, Math.max(1, Math.round(Number(validDays)) || 7));

  const token = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  logAudit({
    action: "admin.invite.create",
    actorId: admin.id,
    target: email?.trim() ? email.trim().toLowerCase() : null,
    headers: await headers(),
  });

  db.insert(invitations)
    .values({
      id: crypto.randomUUID(),
      token,
      email: email?.trim() ? email.trim().toLowerCase() : null,
      createdBy: admin.id,
      expiresAt,
      createdAt: now,
    })
    .run();

  revalidatePath("/settings");

  return {
    success: true,
    token,
  };
}

export async function deleteInvitationAction(id: string) {
  const admin = await requireAdmin();
  db.delete(invitations).where(eq(invitations.id, id)).run();
  logAudit({ action: "admin.invite.delete", actorId: admin.id, target: id, headers: await headers() });
  revalidatePath("/settings");
  revalidatePath("/admin");
  return { success: true };
}

export async function changeOwnPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}) {
  const user = await requireUser();

  if (!input.newPassword || input.newPassword.length < PASSWORD_MIN_LENGTH) {
    return {
      success: false,
      error: `Das neue Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`,
    };
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });

    // Strikter Schutz: Alle anderen Sessions des Benutzers explizit aus der DB entfernen
    const currentSession = await getCurrentSession();
    revokeOtherUserSessions(user.id, currentSession?.session?.id ?? null);
    logAudit({ action: "auth.password.change", userId: user.id, headers: await headers() });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Passwort konnte nicht geändert werden. Bitte aktuelles Passwort prüfen.",
    };
  }
}

const updateProfileSchema = z.object({
  name: z.string().min(2, "Name muss mindestens 2 Zeichen lang sein.").max(80),
  email: z.string().email("Bitte eine gültige E-Mail-Adresse eingeben."),
});

export async function updateOwnProfileAction(input: {
  name: string;
  email: string;
  currentPassword?: string;
}) {
  const currentUser = await requireUser();
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
    };
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  // Prüfen, ob E-Mail bereits von einem anderen Benutzer verwendet wird
  const emailConflict = db
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.email, normalizedEmail),
        ne(userTable.id, currentUser.id)
      )
    )
    .get();

  if (emailConflict) {
    return {
      success: false,
      error: "Diese E-Mail-Adresse wird bereits von einem anderen Konto genutzt.",
    };
  }

  const emailChanged = normalizedEmail !== currentUser.email.trim().toLowerCase();

  // Änderung der Anmelde-E-Mail nur mit aktuellem Passwort (Schutz bei
  // gestohlener Session vor Kontoübernahme)
  if (emailChanged) {
    const ok = await verifyUserPassword(currentUser.id, input.currentPassword || "");
    if (!ok) {
      return {
        success: false,
        error: "Zum Ändern der E-Mail-Adresse bitte das aktuelle Passwort eingeben.",
        requiresPassword: true,
      };
    }
  }

  db.update(userTable)
    .set({
      name: parsed.data.name.trim(),
      email: normalizedEmail,
      ...(emailChanged ? { emailVerified: false } : {}),
      updatedAt: new Date(),
    })
    .where(eq(userTable.id, currentUser.id))
    .run();

  if (emailChanged) {
    // Andere Geräte abmelden, damit eine evtl. kompromittierte Session nicht weiterlebt
    const currentSession = await getCurrentSession();
    revokeOtherUserSessions(currentUser.id, currentSession?.session?.id ?? null);
    logAudit({
      action: "auth.email.change",
      userId: currentUser.id,
      details: { from: currentUser.email, to: normalizedEmail },
      headers: await headers(),
    });
  }

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/admin");

  return { success: true };
}

export async function revokeOtherSessionsAction() {
  const session = await getCurrentSession();
  if (!session?.user || !session?.session) {
    return { success: false, error: "Nicht angemeldet." };
  }

  db.delete(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, session.user.id),
        ne(sessionTable.id, session.session.id)
      )
    )
    .run();
  logAudit({ action: "auth.sessions.revoke", userId: session.user.id, headers: await headers() });

  revalidatePath("/settings");
  return { success: true };
}


