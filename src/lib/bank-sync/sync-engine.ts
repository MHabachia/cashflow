import { db } from "../db";
import {
  connectedBanks,
  bankAccounts,
  transactions,
  categories,
  recurringExpenses,
  categoryRules,
  type PaymentMethod,
} from "../db/schema";
import { decryptBankToken, encryptBankToken, needsReencryption } from "../crypto/vault";
import { BankApiError, getBankSyncProvider } from "./provider";
import { findMatchingRule } from "@/lib/category-rules";
import { detectOwnAccountTransfers } from "@/lib/transfer-detection";
import { applyCardSettlements } from "@/lib/card-settlement";
import { and, eq, sql, desc, gte, lte } from "drizzle-orm";
import {
  findMatchingRecurring,
  matchWindowDays,
  shiftIsoDate,
} from "@/lib/recurring-matching";
import { logAudit } from "@/lib/audit";
import { ensureDefaultCategoriesForUser } from "../db/defaults";
import crypto from "node:crypto";

export interface SyncResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  balanceCents: number | null;
  error?: string;
  /** true, wenn der Lauf bewusst ausgelassen wurde (Tageslimit, Backoff, Consent abgelaufen) */
  deferred?: boolean;
}

export interface SyncOptions {
  /**
   * Abruf ohne Anwesenheit des Nutzers (Hintergrund-Scheduler, Cron).
   * PSD2 begrenzt solche Abrufe auf 4 pro Konto und Tag.
   */
  unattended?: boolean;
}

const FULL_HISTORY_DAYS = 730;
const INCREMENTAL_OVERLAP_DAYS = 10;
const BASE_BACKOFF_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

export function getMaxUnattendedSyncsPerDay(): number {
  const configured = Number(process.env.BANK_SYNC_MAX_UNATTENDED_PER_DAY);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 4) : 4;
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextUtcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(24, 5, 0, 0);
  return d;
}

/**
 * Ermittelt das Startdatum für den Abruf: inkrementell ab der letzten
 * importierten Bankbuchung (mit Überlappung für spät gebuchte Umsätze),
 * sonst die volle Historie.
 */
function computeDateFrom(bankAccountId: string, now: Date): string {
  const latest = db
    .select({ date: sql<string>`max(${transactions.date})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.bankAccountId, bankAccountId),
        sql`${transactions.bankTransactionId} IS NOT NULL`
      )
    )
    .get();

  if (latest?.date) {
    const from = new Date(`${latest.date}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - INCREMENTAL_OVERLAP_DAYS);
    return utcDay(from);
  }
  return utcDay(new Date(now.getTime() - FULL_HISTORY_DAYS * 86400000));
}

const REFUND_PATTERN =
  /(r(ü|ue)ck)?erstattung|retoure|r(ü|ue)cksendung|storno|stornierung|refund|r(ü|ue)ck(ü|ue)berweisung|gutschrift (zu|f(ü|ue)r) (bestellung|rechnung)/i;

/** Erkennt Gutschriften, die eine frühere Ausgabe ausgleichen. */
export function isRefundText(text: string): boolean {
  return REFUND_PATTERN.test(text);
}

/**
 * Ermittelt anhand von Empfänger, Text und Typ eine passende Kategorie.
 */
export function findMatchingCategory(
  remittanceText: string,
  type: "expense" | "income",
  allCategories: Array<{ id: string; name: string; type: "expense" | "income" }>
): string {
  const text = remittanceText.toLowerCase();

  // Typenfilter; ohne passende Kategorie irgendeine vorhandene (der Aufrufer
  // stellt sicher, dass es mindestens eine gibt – eine erfundene ID wie früher
  // "unknown" scheiterte am Fremdschlüssel und rollte den ganzen Abruf zurück)
  const matchingTypeCats = allCategories.filter((c) => c.type === type);
  if (matchingTypeCats.length === 0) {
    return allCategories[0].id;
  }

  // Kurze Suchwörter nur als ganzes Wort (sonst träfe „gas“ auch „Gastro“,
  // „bar“ auch „Barmer“, „db“ jede Referenz mit diesen Buchstaben)

  // Intelligentes Keyword-Matching
  if (type === "expense") {
    if (/(rewe|edeka|aldi|lidl|kaufland|penny|netto|supermarkt|lebensmittel)/i.test(text)) {
      const cat = matchingTypeCats.find((c) =>
        /(lebensmittel|einkauf|supermarkt|haushalt)/i.test(c.name)
      );
      if (cat) return cat.id;
    }

    if (/(miete|strom|\bgas\b|stadtwerke|energie|wasser|wohnung)/i.test(text)) {
      const cat = matchingTypeCats.find((c) =>
        /(wohnen|miete|fixkosten|haushalt)/i.test(c.name)
      );
      if (cat) return cat.id;
    }

    if (/(netflix|spotify|disney|prime|apple|youtube|\babo\b|rundfunk)/i.test(text)) {
      const cat = matchingTypeCats.find((c) =>
        /(abo|streaming|unterhaltung|medien|digital)/i.test(c.name)
      );
      if (cat) return cat.id;
    }

    if (/(bahn|\bdb\b|tankstelle|shell|aral|\btotal\b|esso|benzin|\buber\b|taxi|oepnv)/i.test(text)) {
      const cat = matchingTypeCats.find((c) =>
        /(mobilit|transport|auto|verkehr|bahn)/i.test(c.name)
      );
      if (cat) return cat.id;
    }

    if (/(restaurant|cafe|bistro|\bbar\b|lieferando|mcdonalds|burger)/i.test(text)) {
      const cat = matchingTypeCats.find((c) =>
        /(restaurant|essen|freizeit|ausgehen)/i.test(c.name)
      );
      if (cat) return cat.id;
    }
  } else {
    // Einnahmen
    if (/(gehalt|lohn|bezug|arbeitgeber|salary)/i.test(text)) {
      const cat = matchingTypeCats.find((c) =>
        /(gehalt|einkommen|lohn)/i.test(c.name)
      );
      if (cat) return cat.id;
    }

    if (/(kindergeld|familienkasse)/i.test(text)) {
      const cat = matchingTypeCats.find((c) =>
        /(kindergeld|staatlich|zulage)/i.test(c.name)
      );
      if (cat) return cat.id;
    }
  }

  // Standard-Kategorie (z. B. Sonstiges)
  const defaultCat =
    matchingTypeCats.find((c) => /sonstig/i.test(c.name)) || matchingTypeCats[0];
  return defaultCat.id;
}

/**
 * Synchronisiert Umsätze für ein bestimmtes Bankkonto.
 * - Entschlüsselt das Token über den Krypto-Vault.
 * - Ruft Umsätze über die PSD2-Schnittstelle ab.
 * - Dedupliziert Transaktionen strikt und idempotent anhand der bankTransactionId.
 * - Führt automatisches Kategorien- und Fixkosten-Matching durch.
 * - Aktualisiert Kontostand und Synchronisations-Zeitstempel.
 */
export async function syncBankAccountTransactions(
  bankAccountId: string,
  userId: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  let syncAccountId: string | null = null;
  let syncBankId: string | null = null;
  let syncFailureCount = 0;
  try {
    // 1. Konto und Bankverbindung abrufen
    const account = db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.userId, userId)))
      .get();

    if (!account) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        balanceCents: null,
        error: "Bankkonto nicht gefunden.",
      };
    }

    if (!account.connectedBankId) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        balanceCents: account.balanceCents,
        error: "Manuell angelegte Konten können nicht über PSD2 synchronisiert werden.",
      };
    }

    const bank = db
      .select()
      .from(connectedBanks)
      .where(and(eq(connectedBanks.id, account.connectedBankId), eq(connectedBanks.userId, userId)))
      .get();

    if (!bank) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        balanceCents: null,
        error: "Verknüpfte Bankverbindung nicht gefunden.",
      };
    }

    syncAccountId = account.id;
    syncBankId = bank.id;
    syncFailureCount = account.syncFailureCount ?? 0;
    const startedAt = new Date();

    // Hintergrundabrufe: Consent, Backoff und PSD2-Tageslimit respektieren
    if (options.unattended) {
      if (bank.status === "expired" || bank.status === "revoked") {
        return deferredResult(account.balanceCents, "Bank-Zustimmung abgelaufen – bitte Bank neu verbinden.");
      }
      if (bank.consentExpiresAt && bank.consentExpiresAt < utcDay(startedAt)) {
        db.update(connectedBanks)
          .set({ status: "expired", updatedAt: startedAt })
          .where(eq(connectedBanks.id, bank.id))
          .run();
        logAudit({ action: "bank.consent_expired", userId, target: bank.institutionId });
        return deferredResult(account.balanceCents, "Bank-Zustimmung abgelaufen – bitte Bank neu verbinden.");
      }
      if (account.syncBackoffUntil && account.syncBackoffUntil > startedAt) {
        return deferredResult(account.balanceCents, "Sync pausiert nach vorherigem Fehler.");
      }
      const today = utcDay(startedAt);
      const countToday =
        account.unattendedSyncDay === today ? account.unattendedSyncCount ?? 0 : 0;
      if (countToday >= getMaxUnattendedSyncsPerDay()) {
        return deferredResult(account.balanceCents, "PSD2-Tageslimit für automatische Abrufe erreicht.");
      }
      db.update(bankAccounts)
        .set({ unattendedSyncDay: today, unattendedSyncCount: countToday + 1 })
        .where(eq(bankAccounts.id, account.id))
        .run();
    }

    // 2. Token über Krypto-Vault entschlüsseln (und ggf. mit aktuellem Schlüssel neu verschlüsseln)
    const accessToken = decryptBankToken(bank.encryptedAccessToken, userId);
    if (needsReencryption(bank.encryptedAccessToken)) {
      const refreshToken = bank.encryptedRefreshToken
        ? decryptBankToken(bank.encryptedRefreshToken, userId)
        : null;
      db.update(connectedBanks)
        .set({
          encryptedAccessToken: encryptBankToken(accessToken, userId),
          encryptedRefreshToken: refreshToken ? encryptBankToken(refreshToken, userId) : null,
        })
        .where(eq(connectedBanks.id, bank.id))
        .run();
    }

    // 3. Umsätze inkrementell über den Provider abrufen (erstmalig volle Historie)
    const provider = getBankSyncProvider();
    const fetched = await provider.fetchTransactions({
      accountExternalId: account.accountExternalId,
      accessToken,
      dateFrom: computeDateFrom(account.id, startedAt),
    });

    // 4. Hilfsdaten für Auto-Matching laden (Kategorien & Fixkosten).
    // Jede Buchung braucht eine Kategorie: Standardkategorien sicherstellen
    ensureDefaultCategoriesForUser(userId);
    const userCategories = db
      .select({ id: categories.id, name: categories.name, type: categories.type })
      .from(categories)
      .where(eq(categories.userId, userId))
      .all();

    const userRecurring = db
      .select({
        id: recurringExpenses.id,
        name: recurringExpenses.name,
        amountCents: recurringExpenses.amountCents,
        categoryId: recurringExpenses.categoryId,
        type: recurringExpenses.type,
        interval: recurringExpenses.interval,
      })
      .from(recurringExpenses)
      .where(
        and(
          eq(recurringExpenses.userId, userId),
          eq(recurringExpenses.active, true)
        )
      )
      .all();

    const userRules = db
      .select()
      .from(categoryRules)
      .where(
        and(eq(categoryRules.userId, userId), eq(categoryRules.isActive, true))
      )
      .orderBy(desc(categoryRules.priority))
      .all();

    let importedCount = 0;
    let skippedCount = 0;
    const now = new Date();

    // 5. Transaktions-Import mit atomarer Deduplizierung
    db.transaction((tx) => {
      for (const rawTx of fetched.transactions) {
        // Vorgemerkte Umsätze erst nach Buchung übernehmen (deren IDs ändern sich oft)
        if (rawTx.status === "pending") {
          skippedCount++;
          continue;
        }

        // Prüfen, ob diese Transaktion für dieses Konto bereits existiert
        const existing = tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.bankAccountId, account.id),
              eq(transactions.bankTransactionId, rawTx.bankTransactionId)
            )
          )
          .get();

        if (existing) {
          skippedCount++;
          continue;
        }

        const isIncome = rawTx.amountCents > 0;
        const txType: "expense" | "income" = isIncome ? "income" : "expense";
        const absAmount = Math.abs(rawTx.amountCents);

        // Migration: Buchungen mit alter, positionsabhängiger Ersatz-ID (tx_gen_<datum>_<index>)
        // auf die neue stabile ID umschlüsseln statt Dubletten anzulegen.
        if (rawTx.bankTransactionId.startsWith("gen_")) {
          const legacy = tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(
                eq(transactions.bankAccountId, account.id),
                eq(transactions.date, rawTx.bookingDate),
                eq(transactions.amountCents, absAmount),
                eq(transactions.type, txType),
                sql`${transactions.bankTransactionId} LIKE 'tx_gen_%'`
              )
            )
            .get();
          if (legacy) {
            tx.update(transactions)
              .set({ bankTransactionId: rawTx.bankTransactionId, updatedAt: now })
              .where(eq(transactions.id, legacy.id))
              .run();
            skippedCount++;
            continue;
          }
        }

        const merchantName =
          rawTx.creditorName ||
          rawTx.debtorName ||
          rawTx.remittanceInformation ||
          "Bankumsatz";

        // Prüfen, ob eine passende Fixkostenvorlage existiert
        const matchingRecurring = findMatchingRecurring(userRecurring, {
          type: txType,
          amountCents: absAmount,
          text: `${merchantName} ${rawTx.remittanceInformation || ""}`,
        });

        // Prüfen, ob eine benutzerdefinierte Auto-Kategorisierungs-Regel zutrifft
        const matchingRule = !matchingRecurring
          ? findMatchingRule(
            {
              merchant: rawTx.creditorName || rawTx.debtorName,
              description: merchantName,
              remittance: rawTx.remittanceInformation,
            },
            userRules
          )
          : null;

        // Gutschriften, die wie Erstattungen aussehen (Retoure, Storno, …), einer
        // Ausgaben-Kategorie zuordnen: Sie mindern dann die Ausgaben, statt als
        // Einkommen zu zählen (siehe lib/aggregation.ts)
        const fullText = `${merchantName} ${rawTx.remittanceInformation || ""}`;
        const looksLikeRefund = isIncome && isRefundText(fullText);

        const categoryId = matchingRecurring
          ? matchingRecurring.categoryId
          : matchingRule
            ? matchingRule.categoryId
            : findMatchingCategory(
              fullText,
              looksLikeRefund ? "expense" : txType,
              userCategories
            );

        const assignedCostType = matchingRecurring
          ? "fixed"
          : (matchingRule?.costType as "variable" | "fixed" | "transfer") ||
          "variable";

        const paymentMethod: PaymentMethod =
          account.accountType === "credit_card" ? "card" : "transfer";

        // Fixkosten-Reconciliation: Falls für diesen Monat bereits eine automatische/synthetische
        // Buchung für diesen Dauerauftrag/Fixkostenposten existiert (ohne bankTransactionId),
        // führen wir sie mit dem echten Bankbeleg zusammen, statt eine Dublette anzulegen.
        let reconciled = false;
        if (matchingRecurring) {
          // Automatische Buchung im Zeitfenster um das Buchungsdatum suchen
          // (Abbuchungen kommen oft einige Tage vor/nach dem Fälligkeitstag)
          const existingSynthetic = tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(
                eq(transactions.userId, userId),
                eq(transactions.recurringId, matchingRecurring.id),
                gte(transactions.date, shiftIsoDate(rawTx.bookingDate, -matchWindowDays(matchingRecurring.interval))),
                lte(transactions.date, shiftIsoDate(rawTx.bookingDate, matchWindowDays(matchingRecurring.interval))),
                sql`${transactions.bankTransactionId} IS NULL`
              )
            )
            .get();

          if (existingSynthetic) {
            tx.update(transactions)
              .set({
                bankAccountId: account.id,
                bankTransactionId: rawTx.bankTransactionId,
                date: rawTx.bookingDate,
                // Tatsächlich abgebuchten Betrag übernehmen (z. B. nach Preisänderung)
                amountCents: absAmount,
                description: merchantName,
                merchant: merchantName.slice(0, 50),
                paymentMethod,
                updatedAt: now,
              })
              .where(eq(transactions.id, existingSynthetic.id))
              .run();
            reconciled = true;
            importedCount++;
          }
        }

        if (!reconciled) {
          const newTxId = crypto.randomUUID();
          // Eindeutiger Index (recurring_id, date): bei zweiter Abbuchung am selben
          // Tag (z. B. Doppelabbuchung) nicht erneut verknüpfen, sonst bricht der Sync ab
          const recurringSlotTaken = matchingRecurring
            ? tx
                .select({ id: transactions.id })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.recurringId, matchingRecurring.id),
                    eq(transactions.date, rawTx.bookingDate)
                  )
                )
                .get()
            : null;
          tx.insert(transactions)
            .values({
              id: newTxId,
              userId,
              categoryId,
              type: txType,
              costType: assignedCostType,
              amountCents: absAmount,
              date: rawTx.bookingDate,
              description: merchantName,
              merchant: merchantName.slice(0, 50),
              paymentMethod,
              recurringId: recurringSlotTaken ? null : matchingRecurring?.id || null,
              presetId: null,
              bankAccountId: account.id,
              bankTransactionId: rawTx.bankTransactionId,
              reviewStatus: "pending",
              createdAt: now,
              updatedAt: now,
            })
            .run();

          importedCount++;

        }
      }

      // Kontostand und ggf. aufgelöste Account-External-ID (UUID) aktualisieren
      const nextBalance =
        fetched.balanceCents !== undefined && fetched.balanceCents !== null
          ? fetched.balanceCents
          : account.balanceCents;

      const nextAccountExternalId =
        fetched.resolvedAccountExternalId && fetched.resolvedAccountExternalId !== account.accountExternalId
          ? fetched.resolvedAccountExternalId
          : account.accountExternalId;

      tx.update(bankAccounts)
        .set({
          balanceCents: nextBalance,
          accountExternalId: nextAccountExternalId,
          syncFailureCount: 0,
          syncBackoffUntil: null,
          lastSyncError: null,
          updatedAt: now,
        })
        .where(eq(bankAccounts.id, account.id))
        .run();

      // Bank lastSyncedAt aktualisieren
      tx.update(connectedBanks)
        .set({
          lastSyncedAt: now.toISOString(),
          status: "active",
          updatedAt: now,
        })
        .where(eq(connectedBanks.id, bank.id))
        .run();
    });

    // Kartenausgleich für verknüpfte manuelle Kreditkarten (vor der
    // Umbuchungs-Erkennung, damit die Abbuchung nicht doppelt gepaart wird)
    if (importedCount > 0) {
      try {
        applyCardSettlements(userId);
      } catch (settleErr) {
        console.warn("Kartenausgleich fehlgeschlagen:", settleErr);
      }
    }

    // Umbuchungen zwischen eigenen Konten (z. B. Giro → Tagesgeld) erkennen
    if (importedCount > 0) {
      try {
        detectOwnAccountTransfers(userId);
      } catch (detectErr) {
        console.warn("Umbuchungs-Erkennung fehlgeschlagen:", detectErr);
      }
    }

    return {
      success: true,
      importedCount,
      skippedCount,
      balanceCents: fetched.balanceCents ?? null,
    };
  } catch (err: unknown) {
    console.error("Fehler bei der Umsatz-Synchronisation:", err);
    if (syncAccountId) {
      recordSyncFailure(syncAccountId, syncBankId, syncFailureCount, err);
    }
    return {
      success: false,
      importedCount: 0,
      skippedCount: 0,
      balanceCents: null,
      error: (err as Error)?.message || "Synchronisationsfehler.",
    };
  }
}

function deferredResult(balanceCents: number | null, reason: string): SyncResult {
  return {
    success: false,
    deferred: true,
    importedCount: 0,
    skippedCount: 0,
    balanceCents,
    error: reason,
  };
}

/**
 * Speichert einen Sync-Fehler und setzt einen Backoff:
 * - 429 (PSD2-Limit): bis zum nächsten UTC-Tag
 * - 401/403 (Consent ungültig): Verbindung als abgelaufen markieren
 * - sonst exponentiell ab 15 Minuten, maximal 24 Stunden
 */
function recordSyncFailure(
  bankAccountId: string,
  connectedBankId: string | null,
  previousFailures: number,
  err: unknown
) {
  try {
    const now = new Date();
    const failures = previousFailures + 1;
    const status = err instanceof BankApiError ? err.status : null;

    let backoffUntil: Date;
    if (status === 429) {
      backoffUntil = nextUtcMidnight(now);
    } else {
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
      backoffUntil = new Date(now.getTime() + delay);
    }

    db.update(bankAccounts)
      .set({
        syncFailureCount: failures,
        syncBackoffUntil: backoffUntil,
        lastSyncError: ((err as Error)?.message || "Synchronisationsfehler.").slice(0, 500),
      })
      .where(eq(bankAccounts.id, bankAccountId))
      .run();

    if (connectedBankId && (status === 401 || status === 403)) {
      db.update(connectedBanks)
        .set({ status: "expired", updatedAt: now })
        .where(eq(connectedBanks.id, connectedBankId))
        .run();
    }
  } catch (recordErr) {
    console.warn("Sync-Fehler konnte nicht gespeichert werden:", recordErr);
  }
}

/**
 * Synchronisiert alle aktiven Bankkonten eines Benutzers mit aktiviertem Auto-Sync.
 */
export async function syncAllActiveBankAccounts(
  userId: string,
  options: SyncOptions = {}
): Promise<{
  success: boolean;
  totalImported: number;
  totalSkipped: number;
  errors: string[];
}> {
  const accounts = db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(eq(bankAccounts.userId, userId), eq(bankAccounts.autoSync, true))
    )
    .all();

  let totalImported = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  for (const acc of accounts) {
    const res = await syncBankAccountTransactions(acc.id, userId, options);
    if (res.success) {
      totalImported += res.importedCount;
      totalSkipped += res.skippedCount;
    } else if (res.deferred) {
      // Bewusst ausgelassen (Tageslimit/Backoff/Consent) – kein Fehler
    } else if (res.error) {
      errors.push(res.error);
    }
  }

  return {
    success: errors.length === 0,
    totalImported,
    totalSkipped,
    errors,
  };
}
