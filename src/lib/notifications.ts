import { db } from "@/lib/db";
import {
  budgets,
  categories,
  connectedBanks,
  notificationLog,
  notificationSettings,
  pushSubscriptions,
  transactions,
} from "@/lib/db/schema";
import { sendWebPush } from "@/lib/push/web-push";
import { loadSplits, summarizeExpenses, toExpenseItems } from "@/lib/aggregation";
import { formatCents, toLocalISODate, shiftedLocalISODate } from "@/lib/format";
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

/**
 * Push-Benachrichtigungen: Versand an alle Geräte eines Benutzers und
 * periodische Prüfungen (Budgets, Bank-Zustimmungen, hohe Abbuchungen,
 * offene Umsätze zur Prüfung). Jede Meldung wird über einen dedupe-Schlüssel
 * höchstens einmal verschickt.
 */

export interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface UserNotificationSettings {
  budgetAlerts: boolean;
  consentAlerts: boolean;
  largeTxAlerts: boolean;
  largeTxThresholdCents: number;
  inboxAlerts: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: UserNotificationSettings = {
  budgetAlerts: true,
  consentAlerts: true,
  largeTxAlerts: true,
  largeTxThresholdCents: 50000,
  inboxAlerts: true,
};

export function getNotificationSettings(userId: string): UserNotificationSettings {
  const row = db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .get();
  if (!row) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  return {
    budgetAlerts: row.budgetAlerts,
    consentAlerts: row.consentAlerts,
    largeTxAlerts: row.largeTxAlerts,
    largeTxThresholdCents: row.largeTxThresholdCents,
    inboxAlerts: row.inboxAlerts,
  };
}

/** Markiert einen dedupe-Schlüssel; false, wenn er schon vergeben war. */
function claimDedupeKey(userId: string, key: string): boolean {
  const res = db
    .insert(notificationLog)
    .values({ userId, dedupeKey: key.slice(0, 200), createdAt: new Date() })
    .onConflictDoNothing()
    .run();
  return res.changes === 1;
}

export type Sender = typeof sendWebPush;

/**
 * Sendet eine Benachrichtigung an alle Geräte des Benutzers.
 * Mit `dedupeKey` wird dieselbe Meldung nur einmal verschickt.
 * Gibt die Anzahl erfolgreich zugestellter Geräte zurück.
 */
export async function notifyUser(
  userId: string,
  payload: NotificationPayload,
  options: { dedupeKey?: string; sender?: Sender } = {}
): Promise<number> {
  const subs = db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .all();
  if (subs.length === 0) return 0;
  if (options.dedupeKey && !claimDedupeKey(userId, options.dedupeKey)) return 0;

  const send = options.sender ?? sendWebPush;
  let delivered = 0;
  for (const sub of subs) {
    const result = await send(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { ...payload, url: payload.url ?? "/" },
      { topic: payload.tag }
    );
    if (result === "sent") delivered++;
    if (result === "gone") {
      db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
    }
  }
  return delivered;
}

function monthPrefix(now: Date) {
  return toLocalISODate(now).slice(0, 7);
}

/** Budget zu 80 % bzw. 100 % ausgeschöpft (einmal pro Monat und Stufe). */
async function checkBudgets(userId: string, now: Date, sender?: Sender) {
  const month = monthPrefix(now);
  const userBudgets = db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      amountCents: budgets.amountCents,
      categoryName: categories.name,
    })
    .from(budgets)
    .leftJoin(categories, eq(budgets.categoryId, categories.id))
    .where(eq(budgets.userId, userId))
    .all();

  // Ausgaben des Monats nach denselben Regeln wie im Dashboard (Splits, Erstattungen)
  const monthTx = db
    .select({
      id: transactions.id,
      type: transactions.type,
      costType: transactions.costType,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      isSplit: transactions.isSplit,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), sql`substr(${transactions.date}, 1, 7) = ${month}`))
    .all();
  const categoryTypes = new Map(
    db
      .select({ id: categories.id, type: categories.type })
      .from(categories)
      .where(eq(categories.userId, userId))
      .all()
      .map((c) => [c.id, c.type] as const)
  );
  const expenseTotals = summarizeExpenses(
    toExpenseItems(monthTx, categoryTypes, loadSplits(monthTx))
  );

  for (const b of userBudgets) {
    if (b.amountCents <= 0) continue;
    const spent = b.categoryId
      ? Math.max(0, expenseTotals.byCategory[b.categoryId] ?? 0)
      : Math.max(0, expenseTotals.fixedCents + expenseTotals.variableCents);

    const ratio = spent / b.amountCents;
    const label = b.categoryName ?? "Gesamtbudget";
    if (ratio >= 1) {
      await notifyUser(
        userId,
        {
          title: `Budget überschritten: ${label}`,
          body: `${formatCents(spent)} von ${formatCents(b.amountCents)} ausgegeben.`,
          url: "/",
          tag: `budget-${b.id}`,
        },
        { dedupeKey: `budget:${b.id}:${month}:100`, sender }
      );
    } else if (ratio >= 0.8) {
      await notifyUser(
        userId,
        {
          title: `Budget fast aufgebraucht: ${label}`,
          body: `${Math.round(ratio * 100)} % genutzt (${formatCents(spent)} von ${formatCents(b.amountCents)}).`,
          url: "/",
          tag: `budget-${b.id}`,
        },
        { dedupeKey: `budget:${b.id}:${month}:80`, sender }
      );
    }
  }
}

/** Bank-Zustimmung läuft in ≤ 7 Tagen ab oder ist abgelaufen. */
async function checkConsents(userId: string, now: Date, sender?: Sender) {
  const soon = shiftedLocalISODate(7, now);
  const banks = db
    .select()
    .from(connectedBanks)
    .where(and(eq(connectedBanks.userId, userId), lt(connectedBanks.consentExpiresAt, soon)))
    .all();
  for (const bank of banks) {
    const expired = bank.status === "expired" || bank.consentExpiresAt < toLocalISODate(now);
    await notifyUser(
      userId,
      {
        title: expired ? `${bank.institutionName}: Zugriff abgelaufen` : `${bank.institutionName}: Zugriff läuft ab`,
        body: expired
          ? "Bitte verbinde die Bank neu, damit Umsätze wieder abgerufen werden."
          : "Die Freigabe für den Kontoabruf endet in wenigen Tagen. Jetzt erneuern?",
        url: "/banking",
        tag: `consent-${bank.id}`,
      },
      { dedupeKey: `consent:${bank.id}:${bank.consentExpiresAt}:${expired ? "expired" : "soon"}`, sender }
    );
  }
}

/** Hohe Abbuchungen aus Bank-Sync/Import der letzten 3 Tage. */
async function checkLargeTransactions(userId: string, thresholdCents: number, now: Date, sender?: Sender) {
  const since = new Date(now.getTime() - 3 * 86400000);
  const large = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "expense"),
        isNotNull(transactions.bankTransactionId),
        gte(transactions.amountCents, thresholdCents),
        gte(transactions.createdAt, since)
      )
    )
    .all();
  for (const tx of large) {
    await notifyUser(
      userId,
      {
        title: `Hohe Abbuchung: ${formatCents(tx.amountCents)}`,
        body: `${tx.merchant || tx.description} am ${tx.date.split("-").reverse().join(".")}`,
        url: "/transactions",
        tag: `tx-${tx.id}`,
      },
      { dedupeKey: `largetx:${tx.id}`, sender }
    );
  }
}

/** Einmal täglich: Hinweis auf offene Umsätze zur Prüfung. */
async function checkInbox(userId: string, now: Date, sender?: Sender) {
  const pending =
    db
      .select({ value: sql<number>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.reviewStatus, "pending")))
      .get()?.value ?? 0;
  if (pending === 0) return;
  await notifyUser(
    userId,
    {
      title: `${pending} neue Umsätze zu prüfen`,
      body: "Bestätige die automatische Kategorisierung mit einem Tipp.",
      url: "/inbox",
      tag: "inbox",
    },
    { dedupeKey: `inbox:${toLocalISODate(now)}`, sender }
  );
}

/** Führt alle Prüfungen für alle Benutzer mit Push-Abonnement aus. */
export async function runNotificationChecks(options: { now?: Date; sender?: Sender } = {}) {
  const now = options.now ?? new Date();
  const userIds = Array.from(
    new Set(
      db
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .all()
        .map((r) => r.userId)
    )
  );

  for (const userId of userIds) {
    const settings = getNotificationSettings(userId);
    try {
      if (settings.budgetAlerts) await checkBudgets(userId, now, options.sender);
      if (settings.consentAlerts) await checkConsents(userId, now, options.sender);
      if (settings.largeTxAlerts)
        await checkLargeTransactions(userId, settings.largeTxThresholdCents, now, options.sender);
      if (settings.inboxAlerts) await checkInbox(userId, now, options.sender);
    } catch (err) {
      console.warn(`[Benachrichtigungen] Prüfung für Benutzer fehlgeschlagen:`, err);
    }
  }

  // Alte dedupe-Einträge (> 400 Tage) entfernen
  const cutoff = new Date(now.getTime() - 400 * 86400000);
  db.delete(notificationLog).where(lt(notificationLog.createdAt, cutoff)).run();
  return userIds.length;
}

