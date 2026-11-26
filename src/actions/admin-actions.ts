"use server";

import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  user as userTable,
  session as sessionTable,
  account as accountTable,
  appSettings,
  PAYMENT_METHODS,
} from "@/lib/db/schema";
import { requireAdmin } from "@/lib/session";
import { runWithSignUpAllowed } from "@/lib/signup-guard";
import { logAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

// ==========================================
// 1. BENUTZERVERWALTUNG (DIREKT ANLEGEN, ROLLE, PASSWORT, SPERREN, LÖSCHEN)
// ==========================================

const createUserSchema = z.object({
  name: z.string().min(2, "Name muss mindestens 2 Zeichen lang sein."),
  email: z.string().email("Ungültige E-Mail-Adresse."),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben.`),
  role: z.enum(["user", "admin"]).default("user"),
});

export async function adminCreateUserAction(
  input: z.infer<typeof createUserSchema>
) {
  const admin = await requireAdmin();
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
    };
  }

  const { name, email, password, role } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const existing = db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, normalizedEmail))
    .get();

  if (existing) {
    return {
      success: false,
      error: "Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.",
    };
  }

  try {
    // Über Better Auth anlegen (ohne Cookie-Header, damit die Admin-Session erhalten bleibt!)
    const created = await runWithSignUpAllowed(() =>
      auth.api.signUpEmail({
        body: {
          name: name.trim(),
          email: normalizedEmail,
          password,
        },
      })
    );

    if (created?.user?.id) {
      logAudit({
        action: "admin.user.create",
        userId: created.user.id,
        actorId: admin.id,
        target: normalizedEmail,
        details: { role },
        headers: await headers(),
      });
    }

    if (created?.user?.id && role === "admin") {
      db.update(userTable)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(userTable.id, created.user.id))
        .run();
    }

    revalidatePath("/admin");
    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Benutzer konnte nicht erstellt werden.",
    };
  }
}

export async function adminUpdateUserRoleAction(
  targetUserId: string,
  role: "admin" | "user"
) {
  const admin = await requireAdmin();
  if (admin.id === targetUserId && role !== "admin") {
    return {
      success: false,
      error: "Du kannst dir nicht selbst die Admin-Rechte entziehen.",
    };
  }

  db.update(userTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(userTable.id, targetUserId))
    .run();
  logAudit({
    action: "admin.user.role",
    userId: targetUserId,
    actorId: admin.id,
    details: { role },
    headers: await headers(),
  });

  revalidatePath("/admin");
  revalidatePath("/settings");
  return { success: true };
}

export async function adminToggleUserBanAction(
  targetUserId: string,
  banned: boolean
) {
  const admin = await requireAdmin();
  if (admin.id === targetUserId) {
    return {
      success: false,
      error: "Du kannst dein eigenes Admin-Konto nicht sperren.",
    };
  }

  db.update(userTable)
    .set({ banned, updatedAt: new Date() })
    .where(eq(userTable.id, targetUserId))
    .run();

  if (banned) {
    // Alle aktiven Sessions des gesperrten Benutzers sofort beenden
    db.delete(sessionTable).where(eq(sessionTable.userId, targetUserId)).run();
  }
  logAudit({
    action: banned ? "admin.user.ban" : "admin.user.unban",
    userId: targetUserId,
    actorId: admin.id,
    headers: await headers(),
  });

  revalidatePath("/admin");
  return { success: true };
}

export async function adminDeleteUserAction(targetUserId: string) {
  const admin = await requireAdmin();
  if (admin.id === targetUserId) {
    return {
      success: false,
      error: "Du kannst dein eigenes Admin-Konto nicht löschen.",
    };
  }

  const target = db
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, targetUserId))
    .get();
  if (!target) {
    return { success: false, error: "Benutzer nicht gefunden." };
  }

  // Belegfotos des Benutzers vom Dateisystem löschen (ID stammt aus der DB,
  // zusätzlich auf einen einfachen Verzeichnisnamen beschränkt)
  try {
    const uploadsRoot = path.resolve(
      process.env.UPLOADS_DIR || "./data/uploads"
    );
    const userUploadsDir = path.join(uploadsRoot, path.basename(target.id));
    if (fs.existsSync(userUploadsDir)) {
      fs.rmSync(userUploadsDir, { recursive: true, force: true });
    }
  } catch {
    // Ignorieren, falls Verzeichnis nicht existiert
  }

  db.delete(userTable).where(eq(userTable.id, targetUserId)).run();
  logAudit({
    action: "admin.user.delete",
    userId: targetUserId,
    actorId: admin.id,
    target: target.email,
    headers: await headers(),
  });

  revalidatePath("/admin");
  revalidatePath("/settings");
  return { success: true };
}

// ==========================================
// 2. GLOBALE APP-EINSTELLUNGEN & BRANDING
// ==========================================

const settingsSchema = z.object({
  appName: z.string().min(2, "App-Name muss mind. 2 Zeichen haben.").max(50),
  appSubtitle: z.string().min(2).max(100),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ungültiger Farbcode."),
  allowOpenRegistration: z.boolean(),
  defaultPaymentMethod: z.enum(PAYMENT_METHODS),
  maxUploadSizeMb: z.number().int().min(1).max(50),
  systemAnnouncement: z.string().max(250).nullable().optional(),
});

export async function saveGlobalAppSettingsAction(
  input: z.infer<typeof settingsSchema>
) {
  const admin = await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Einstellungen.",
    };
  }

  const data = parsed.data;
  const now = new Date();

  db.insert(appSettings)
    .values({
      id: "global",
      appName: data.appName.trim(),
      appSubtitle: data.appSubtitle.trim(),
      primaryColor: data.primaryColor,
      allowOpenRegistration: data.allowOpenRegistration,
      defaultPaymentMethod: data.defaultPaymentMethod,
      maxUploadSizeMb: data.maxUploadSizeMb,
      systemAnnouncement: data.systemAnnouncement?.trim() || null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        appName: data.appName.trim(),
        appSubtitle: data.appSubtitle.trim(),
        primaryColor: data.primaryColor,
        allowOpenRegistration: data.allowOpenRegistration,
        defaultPaymentMethod: data.defaultPaymentMethod,
        maxUploadSizeMb: data.maxUploadSizeMb,
        systemAnnouncement: data.systemAnnouncement?.trim() || null,
        updatedAt: now,
      },
    })
    .run();

  logAudit({
    action: "admin.settings.update",
    actorId: admin.id,
    details: {
      allowOpenRegistration: data.allowOpenRegistration,
      maxUploadSizeMb: data.maxUploadSizeMb,
    },
    headers: await headers(),
  });

  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/login");
  revalidatePath("/register");

  return { success: true };
}

export async function resetGlobalAppSettingsAction() {
  await requireAdmin();

  // Falls ein benutzerdefiniertes Logo hochgeladen wurde -> Datei vom Dateisystem entfernen
  try {
    const existing = db
      .select({ customLogoPath: appSettings.customLogoPath })
      .from(appSettings)
      .where(eq(appSettings.id, "global"))
      .get();

    if (existing?.customLogoPath) {
      const uploadsRoot = path.resolve(
        process.env.UPLOADS_DIR || "./data/uploads"
      );
      const logoFile = path.join(
        uploadsRoot,
        "branding",
        path.basename(existing.customLogoPath)
      );
      if (fs.existsSync(logoFile)) {
        fs.unlinkSync(logoFile);
      }
    }
  } catch {
    // Ignorieren, falls Datei bereits entfernt
  }

  const now = new Date();
  db.insert(appSettings)
    .values({
      id: "global",
      appName: "Cashflow",
      appSubtitle: "Fixkosten & Variable Ausgaben",
      primaryColor: "#2563eb",
      allowOpenRegistration: false,
      defaultPaymentMethod: "card",
      maxUploadSizeMb: 15,
      customLogoPath: null,
      systemAnnouncement: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        appName: "Cashflow",
        appSubtitle: "Fixkosten & Variable Ausgaben",
        primaryColor: "#2563eb",
        allowOpenRegistration: false,
        defaultPaymentMethod: "card",
        maxUploadSizeMb: 15,
        customLogoPath: null,
        systemAnnouncement: null,
        updatedAt: now,
      },
    })
    .run();

  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/login");
  revalidatePath("/register");

  return { success: true };
}

// ==========================================
// 3. AUTOMATISCHE SICHERUNGEN
// ==========================================

export async function createBackupNowAction() {
  const admin = await requireAdmin();
  try {
    const { runAutoBackup } = await import("@/lib/backup-scheduler");
    const name = await runAutoBackup({ force: true });
    logAudit({ action: "admin.backup.create", actorId: admin.id, target: name });
    revalidatePath("/admin");
    return { success: true, name };
  } catch (err) {
    return { success: false, error: (err as Error)?.message || "Sicherung fehlgeschlagen." };
  }
}

export async function verifyBackupAction(name: string) {
  const admin = await requireAdmin();
  try {
    const { readAutoBackupAsSqlite } = await import("@/lib/backup-scheduler");
    const { verifySqliteBackup } = await import("@/lib/backup-verify");
    const result = verifySqliteBackup(readAutoBackupAsSqlite(name));
    logAudit({ action: "admin.backup.verify", actorId: admin.id, target: `${name}: ${result.ok ? "ok" : "fehlerhaft"}` });
    return { success: true as const, result };
  } catch (err) {
    return { success: false as const, error: (err as Error)?.message || "Prüfung fehlgeschlagen." };
  }
}
