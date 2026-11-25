"use server";

import { db } from "@/lib/db";
import { notificationSettings, pushSubscriptions } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { getVapidKeys, isAllowedPushEndpoint } from "@/lib/push/web-push";
import { getNotificationSettings, notifyUser } from "@/lib/notifications";
import { and, count, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import crypto from "node:crypto";

export async function getPushConfigAction() {
  const user = await requireUser();
  const devices =
    db
      .select({ value: count() })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id))
      .get()?.value ?? 0;
  return {
    publicKey: getVapidKeys().publicKey,
    devices,
    settings: getNotificationSettings(user.id),
  };
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(80).max(200),
    auth: z.string().min(16).max(100),
  }),
});

export async function savePushSubscriptionAction(input: unknown) {
  const user = await requireUser();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Ungültiges Push-Abonnement." };
  const { endpoint, keys } = parsed.data;
  if (!isAllowedPushEndpoint(endpoint)) {
    return { success: false, error: "Dieser Push-Dienst wird nicht unterstützt." };
  }

  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  db.insert(pushSubscriptions)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    })
    .run();
  return { success: true };
}

export async function removePushSubscriptionAction(endpoint: string) {
  const user = await requireUser();
  db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)))
    .run();
  return { success: true };
}

const settingsSchema = z.object({
  budgetAlerts: z.boolean(),
  consentAlerts: z.boolean(),
  largeTxAlerts: z.boolean(),
  largeTxThresholdCents: z.number().int().min(1000).max(100_000_000),
  inboxAlerts: z.boolean(),
});

export async function updateNotificationSettingsAction(input: z.input<typeof settingsSchema>) {
  const user = await requireUser();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Ungültige Einstellungen." };
  const data = { ...parsed.data, updatedAt: new Date() };
  db.insert(notificationSettings)
    .values({ userId: user.id, ...data })
    .onConflictDoUpdate({ target: notificationSettings.userId, set: data })
    .run();
  return { success: true };
}

export async function sendTestNotificationAction() {
  const user = await requireUser();
  const delivered = await notifyUser(user.id, {
    title: "Benachrichtigungen aktiv",
    body: "So sehen Hinweise zu Budgets, Bankzugriff und hohen Abbuchungen aus.",
    url: "/settings",
    tag: "test",
  });
  return delivered > 0
    ? { success: true, delivered }
    : { success: false, error: "Kein Gerät erreichbar. Bitte Benachrichtigungen erneut aktivieren." };
}
