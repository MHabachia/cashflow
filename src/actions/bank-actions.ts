"use server";

import { db } from "@/lib/db";
import {
  connectedBanks,
  bankAccounts,
  transactions,
  categories,
  BANK_ACCOUNT_TYPES,
  type BankAccountType,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { decryptBankToken, encryptBankToken } from "@/lib/crypto/vault";
import { POPULAR_BANK_INSTITUTIONS } from "@/lib/bank-institutions";
import {
  BANK_SYNC_NOT_CONFIGURED_ERROR,
  BankApiError,
  getBankSyncProvider,
  isLiveBankingMode,
  isMockBankingAllowed,
} from "@/lib/bank-sync/provider";
import {
  syncBankAccountTransactions,
  syncAllActiveBankAccounts,
} from "@/lib/bank-sync/sync-engine";
import { getOrCreateTransferCategory } from "@/lib/transfer-detection";
import { applyCardSettlements, findSettlementDebits } from "@/lib/card-settlement";
import {
  MIN_SETTLEMENT_PATTERN_LENGTH,
  normalizeSettlementPattern,
} from "@/lib/card-settlement-pattern";
import {
  firstIssueMessage,
  idSchema,
  isoDateSchema,
  nonNegativeCentsSchema,
  optionalText,
  positiveCentsSchema,
  signedCentsSchema,
} from "@/lib/validation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";
import { shiftedLocalISODate, todayISO } from "@/lib/format";

const BILLING_DAY_ERROR = "Der Abrechnungstag muss zwischen 1 und 31 liegen.";
const billingDaySchema = z.number({ error: BILLING_DAY_ERROR }).int(BILLING_DAY_ERROR).min(1, BILLING_DAY_ERROR).max(31, BILLING_DAY_ERROR);

const createManualAccountSchema = z.object({
  accountName: z.string().trim().min(1, "Bitte gib einen Namen für das Konto oder die Karte an.").max(100),
  accountType: z.enum(BANK_ACCOUNT_TYPES, { error: "Ungültige Kontoart." }),
  balanceCents: signedCentsSchema.nullable().optional(),
  creditLimitCents: nonNegativeCentsSchema.nullable().optional(),
  billingDayOfMonth: billingDaySchema.nullable().optional(),
  ibanMasked: optionalText(50),
  notes: optionalText(500),
  /** Nur Kreditkarten: Girokonto, von dem der Kartenausgleich abgebucht wird */
  settlementAccountId: idSchema.nullable().optional(),
  settlementMatchPattern: z.string().trim().max(60).nullable().optional(),
});

const updateBankAccountSchema = createManualAccountSchema
  .omit({ accountType: true })
  .partial()
  .extend({ accountId: idSchema, accountName: z.string().trim().max(100).optional() });

type SettlementLink =
  | { ok: true; settlementAccountId: string | null; settlementMatchPattern: string | null }
  | { ok: false; error: string };

/**
 * Prüft die Verknüpfung einer Karte mit ihrem Ausgleichskonto: nur manuelle
 * Kreditkarten, Ausgleichskonto gehört dem Benutzer und ist keine Kreditkarte,
 * Erkennungsbegriff mit Mindestlänge (zu allgemeine Begriffe träfen fremde
 * Abbuchungen).
 */
function resolveSettlementLink(
  userId: string,
  card: { id?: string; accountType: BankAccountType; connectedBankId: string | null },
  settlementAccountId: string | null | undefined,
  pattern: string | null | undefined
): SettlementLink {
  if (!settlementAccountId) {
    return { ok: true, settlementAccountId: null, settlementMatchPattern: null };
  }
  if (card.accountType !== "credit_card") {
    return { ok: false, error: "Ein Ausgleichskonto lässt sich nur für Kreditkarten festlegen." };
  }
  if (card.connectedBankId) {
    return { ok: false, error: "Per Bank angebundene Karten erhalten den Ausgleich direkt von der Bank." };
  }
  const normalized = normalizeSettlementPattern(pattern);
  if (normalized.length < MIN_SETTLEMENT_PATTERN_LENGTH) {
    return {
      ok: false,
      error: `Der Erkennungsbegriff braucht mindestens ${MIN_SETTLEMENT_PATTERN_LENGTH} Zeichen.`,
    };
  }
  const settlementAccount = db
    .select({ id: bankAccounts.id, accountType: bankAccounts.accountType })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, settlementAccountId), eq(bankAccounts.userId, userId)))
    .get();
  if (!settlementAccount || settlementAccount.id === card.id || settlementAccount.accountType === "credit_card") {
    return { ok: false, error: "Bitte ein eigenes Konto wählen, das keine Kreditkarte ist." };
  }
  return { ok: true, settlementAccountId, settlementMatchPattern: normalized };
}

/** Wendet den Kartenausgleich direkt nach dem Speichern an; Fehler blockieren das Speichern nicht. */
function applySettlementsAfterSave(userId: string, cardId: string) {
  try {
    applyCardSettlements(userId, cardId);
  } catch (err) {
    console.warn("Kartenausgleich nach dem Speichern fehlgeschlagen:", err);
  }
}

const accountTransferSchema = z.object({
  sourceAccountId: idSchema,
  targetAccountId: idSchema,
  amountCents: positiveCentsSchema,
  date: isoDateSchema.optional(),
  description: z.string().max(200).optional(),
  /** Einmal-Schlüssel des Formulars: Wiederholte Anfragen buchen nicht doppelt */
  clientRequestId: idSchema.optional(),
});

const reconcileBalanceSchema = z.object({
  accountId: idSchema,
  actualBalanceCents: signedCentsSchema,
  mode: z.enum(["adjustment_transaction", "set_balance"]).optional(),
  date: isoDateSchema.optional(),
  description: z.string().max(200).optional(),
});

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside Next.js request context (z. B. in Unit-Tests), ist revalidatePath ein No-Op
  }
}

/**
 * Beendet die Session beim Anbieter, bevor die lokalen Daten gelöscht werden.
 * Scheitert das, wird trotzdem getrennt: Der Nutzer soll sich auch bei
 * ausgefallener Bank-API lösen können; die Zustimmung läuft dann spätestens
 * zum gespeicherten Ablaufdatum aus.
 */
async function revokeBankSession(
  userId: string,
  bank: { id: string; encryptedAccessToken: string }
): Promise<boolean> {
  try {
    const accessToken = decryptBankToken(bank.encryptedAccessToken, userId);
    await getBankSyncProvider().revokeSession(accessToken);
    logAudit({ action: "bank.revoke", userId, target: bank.id, details: { ok: true } });
    return true;
  } catch (err: unknown) {
    const status = err instanceof BankApiError ? err.status : null;
    console.warn("[BankDisconnect] Session konnte beim Anbieter nicht beendet werden", {
      connectedBankId: bank.id,
      status,
      error: err instanceof Error ? err.name : "unknown",
    });
    logAudit({ action: "bank.revoke", userId, target: bank.id, details: { ok: false, status } });
    return false;
  }
}

export async function disconnectBankAction(connectedBankId: string) {
  try {
    const user = await requireUser();
    logAudit({ action: "bank.disconnect", userId: user.id, target: connectedBankId });

    // 0. Session beim Anbieter beenden (nur echte PSD2-Verbindungen des Nutzers)
    let revocationFailed = false;
    let consentExpiresAt: string | null = null;
    if (connectedBankId !== "manual_banks_group") {
      const bank = db
        .select({
          id: connectedBanks.id,
          encryptedAccessToken: connectedBanks.encryptedAccessToken,
          consentExpiresAt: connectedBanks.consentExpiresAt,
        })
        .from(connectedBanks)
        .where(and(eq(connectedBanks.id, connectedBankId), eq(connectedBanks.userId, user.id)))
        .get();
      if (bank) {
        revocationFailed = !(await revokeBankSession(user.id, bank));
        consentExpiresAt = bank.consentExpiresAt;
      }
    }

    // 1. Alle zugehörigen Konten ermitteln (für PSD2 oder manuelle Gruppe)
    const accounts =
      connectedBankId === "manual_banks_group"
        ? db
            .select({ id: bankAccounts.id })
            .from(bankAccounts)
            .where(
              and(
                isNull(bankAccounts.connectedBankId),
                eq(bankAccounts.userId, user.id)
              )
            )
            .all()
        : db
            .select({ id: bankAccounts.id })
            .from(bankAccounts)
            .where(
              and(
                eq(bankAccounts.connectedBankId, connectedBankId),
                eq(bankAccounts.userId, user.id)
              )
            )
            .all();

    const accountIds = accounts.map((a) => a.id);

    // 2. Transaktionen sicher entkoppeln
    for (const accId of accountIds) {
      db.update(transactions)
        .set({ bankAccountId: null })
        .where(
          and(
            eq(transactions.bankAccountId, accId),
            eq(transactions.userId, user.id)
          )
        )
        .run();

      db.delete(bankAccounts)
        .where(
          and(eq(bankAccounts.id, accId), eq(bankAccounts.userId, user.id))
        )
        .run();
    }

    // 3. Bankverbindung entfernen (nur bei echten PSD2 Banken)
    if (connectedBankId !== "manual_banks_group") {
      db.delete(connectedBanks)
        .where(
          and(
            eq(connectedBanks.id, connectedBankId),
            eq(connectedBanks.userId, user.id)
          )
        )
        .run();
    }

    safeRevalidatePath("/settings");
    safeRevalidatePath("/banking");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/");
    return { success: true, revocationFailed, consentExpiresAt: revocationFailed ? consentExpiresAt : null };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Bankverbindung konnte nicht getrennt werden.", "bank-actions"),
    };
  }
}

export async function toggleAccountAutoSyncAction(
  accountId: string,
  autoSync: boolean
) {
  try {
    const user = await requireUser();
    if (typeof autoSync !== "boolean" || !idSchema.safeParse(accountId).success) {
      return { success: false, error: "Ungültige Eingaben." };
    }

    db.update(bankAccounts)
      .set({
        autoSync,
        updatedAt: new Date(),
      })
      .where(
        and(eq(bankAccounts.id, accountId), eq(bankAccounts.userId, user.id))
      )
      .run();

    safeRevalidatePath("/settings");
    safeRevalidatePath("/banking");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Synchronisationsstatus konnte nicht geändert werden.", "bank-actions"),
    };
  }
}

export async function deleteBankAccountAction(accountId: string) {
  try {
    const user = await requireUser();

    // 1. Transaktionen entkoppeln, damit keine Fremdschlüssel-Fehler auftreten
    db.update(transactions)
      .set({ bankAccountId: null })
      .where(
        and(
          eq(transactions.bankAccountId, accountId),
          eq(transactions.userId, user.id)
        )
      )
      .run();

    // 2. Konto oder Karte löschen
    db.delete(bankAccounts)
      .where(
        and(eq(bankAccounts.id, accountId), eq(bankAccounts.userId, user.id))
      )
      .run();

    safeRevalidatePath("/settings");
    safeRevalidatePath("/banking");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Konto konnte nicht entfernt werden.", "bank-actions"),
    };
  }
}

export async function syncBankAccountAction(accountId: string) {
  try {
    const user = await requireUser();
    const result = await syncBankAccountTransactions(accountId, user.id);

    if (result.success) {
      safeRevalidatePath("/settings");
    safeRevalidatePath("/banking");
      safeRevalidatePath("/transactions");
      safeRevalidatePath("/");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      importedCount: 0,
      skippedCount: 0,
      balanceCents: null,
      error: publicErrorMessage(err, "Synchronisation fehlgeschlagen.", "bank-actions"),
    };
  }
}

export async function syncAllAccountsAction() {
  try {
    const user = await requireUser();
    const result = await syncAllActiveBankAccounts(user.id);

    if (result.success) {
      safeRevalidatePath("/settings");
    safeRevalidatePath("/banking");
      safeRevalidatePath("/transactions");
      safeRevalidatePath("/");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      totalImported: 0,
      totalSkipped: 0,
      errors: [publicErrorMessage(err, "Synchronisation fehlgeschlagen.", "bank-actions")],
    };
  }
}

/**
 * Verbindet eine Bank-Institution sicher mit dem Konto des Benutzers.
 * Verschlüsselt das Token atomar mit AES-256-GCM über den Krypto-Vault.
 */
export async function connectBankInstitutionAction(institutionId: string) {
  try {
    const user = await requireUser();

    // Diese Aktion legt nur simulierte Demo-Verbindungen an. Echte Banken laufen
    // über /api/bank-sync/authorize; in Produktion ohne Opt-in gesperrt.
    if (isLiveBankingMode() || !isMockBankingAllowed()) {
      return {
        success: false,
        error: isLiveBankingMode()
          ? "Im Live-Modus bitte die Bank über die PSD2-Autorisierung verbinden."
          : BANK_SYNC_NOT_CONFIGURED_ERROR,
      };
    }

    const inst = POPULAR_BANK_INSTITUTIONS.find((i) => i.id === institutionId);
    if (!inst) {
      return { success: false, error: "Unbekannte Bank ausgewählt." };
    }

    // Prüfen, ob diese Bank bereits verbunden ist
    const existing = db
      .select({ id: connectedBanks.id })
      .from(connectedBanks)
      .where(
        and(
          eq(connectedBanks.userId, user.id),
          eq(connectedBanks.institutionId, inst.id)
        )
      )
      .get();

    if (existing) {
      return {
        success: false,
        error: `„${inst.name}“ ist bereits mit deinem Profil verknüpft.`,
      };
    }

    const now = new Date();
    // 90 Tage Consent-Gültigkeit nach PSD2-Standard
    const expiresDate = new Date();
    expiresDate.setDate(expiresDate.getDate() + 90);
    const consentExpiresAt = expiresDate.toISOString().slice(0, 10);

    const bankId = crypto.randomUUID();
    const rawMockToken = `psd2_access_${inst.id.toLowerCase()}_${crypto.randomBytes(16).toString("hex")}`;
    const encryptedAccessToken = encryptBankToken(rawMockToken, user.id);
    const consentId = `consent_${crypto.randomUUID()}`;

    db.transaction((tx) => {
      tx.insert(connectedBanks)
        .values({
          id: bankId,
          userId: user.id,
          provider: "enable_banking",
          institutionId: inst.id,
          institutionName: inst.name,
          institutionLogo: inst.brandColor,
          encryptedAccessToken,
          encryptedRefreshToken: null,
          consentId,
          consentExpiresAt,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // Konten anlegen je nach Banktyp (Girokonto, Kreditkarte oder beides)
      const isPureCard = inst.category === "credit_card";
      const sampleIbanSuffix = Math.floor(1000 + Math.random() * 9000);

      if (!isPureCard) {
        tx.insert(bankAccounts)
          .values({
            id: crypto.randomUUID(),
            connectedBankId: bankId,
            userId: user.id,
            accountExternalId: `acc_giro_${bankId}`,
            ibanMasked: `DE** **** **** **** ${sampleIbanSuffix}`,
            accountName: `${inst.name} Girokonto`,
            accountType: "checking" as BankAccountType,
            currency: "EUR",
            balanceCents: null,
            autoSync: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      if (inst.category === "credit_card" || inst.id === "ING_DE" || inst.id === "C24_DE") {
        const cardSuffix = Math.floor(1000 + Math.random() * 9000);
        const cardBrand = inst.id === "ING_DE" ? "VISA Card" : "Mastercard Gold";
        tx.insert(bankAccounts)
          .values({
            id: crypto.randomUUID(),
            connectedBankId: bankId,
            userId: user.id,
            accountExternalId: `acc_card_${bankId}`,
            ibanMasked: `**** **** **** ${cardSuffix}`,
            accountName: `${inst.name} ${cardBrand}`,
            accountType: "credit_card" as BankAccountType,
            currency: "EUR",
            balanceCents: null,
            autoSync: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    });

    safeRevalidatePath("/settings");
    safeRevalidatePath("/banking");
    return {
      success: true,
      bankName: inst.name,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Bankverbindung konnte nicht hergestellt werden.", "bank-actions"),
    };
  }
}

export interface CreateManualAccountInput {
  accountName: string;
  accountType: BankAccountType;
  balanceCents?: number | null;
  creditLimitCents?: number | null;
  billingDayOfMonth?: number | null;
  ibanMasked?: string | null;
  notes?: string | null;
  settlementAccountId?: string | null;
  settlementMatchPattern?: string | null;
}

/**
 * Erstellt eine manuelle Geldquelle oder Kreditkarte (z. B. Advanzia Mastercard, TF Bank, Bargeld),
 * die nicht über PSD2 angebunden werden kann.
 */
export async function createManualBankAccountAction(
  rawInput: CreateManualAccountInput
) {
  try {
    const user = await requireUser();
    const parsed = createManualAccountSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: firstIssueMessage(parsed.error) };
    }
    const input = parsed.data;
    const cleanName = input.accountName;

    const now = new Date();
    const accountId = crypto.randomUUID();

    const link = resolveSettlementLink(
      user.id,
      { id: accountId, accountType: input.accountType, connectedBankId: null },
      input.settlementAccountId,
      input.settlementMatchPattern
    );
    if (!link.ok) return { success: false, error: link.error };

    db.insert(bankAccounts)
      .values({
        id: accountId,
        userId: user.id,
        connectedBankId: null,
        accountExternalId: `manual_${crypto.randomUUID()}`,
        ibanMasked: input.ibanMasked?.trim() || null,
        accountName: cleanName,
        accountType: input.accountType,
        currency: "EUR",
        balanceCents: input.balanceCents !== undefined ? input.balanceCents : null,
        creditLimitCents:
          input.creditLimitCents !== undefined ? input.creditLimitCents : null,
        billingDayOfMonth: input.billingDayOfMonth || null,
        notes: input.notes?.trim() || null,
        settlementAccountId: link.settlementAccountId,
        settlementMatchPattern: link.settlementMatchPattern,
        // Nur Abbuchungen ab heute: ältere Ausgleiche sind schon erfasst
        settlementSince: link.settlementAccountId ? todayISO() : null,
        autoSync: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    if (link.settlementAccountId) applySettlementsAfterSave(user.id, accountId);

    safeRevalidatePath("/banking");
    safeRevalidatePath("/settings");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/");

    return { success: true, accountId };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Konto konnte nicht angelegt werden.", "bank-actions"),
    };
  }
}

export interface UpdateBankAccountInput {
  accountId: string;
  accountName?: string;
  creditLimitCents?: number | null;
  billingDayOfMonth?: number | null;
  balanceCents?: number | null;
  ibanMasked?: string | null;
  notes?: string | null;
  settlementAccountId?: string | null;
  settlementMatchPattern?: string | null;
}

/**
 * Aktualisiert Stammdaten, Saldo, Limit oder Abrechnungstag eines Bankkontos / einer Karte.
 */
export async function updateBankAccountAction(rawInput: UpdateBankAccountInput) {
  try {
    const user = await requireUser();
    const parsed = updateBankAccountSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: firstIssueMessage(parsed.error) };
    }
    const input = parsed.data;
    const account = db
      .select()
      .from(bankAccounts)
      .where(
        and(eq(bankAccounts.id, input.accountId), eq(bankAccounts.userId, user.id))
      )
      .get();

    if (!account) {
      return { success: false, error: "Konto nicht gefunden." };
    }

    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.accountName !== undefined && input.accountName.trim()) {
      updatePayload.accountName = input.accountName.trim();
    }
    if (input.creditLimitCents !== undefined) {
      updatePayload.creditLimitCents = input.creditLimitCents;
    }
    if (input.billingDayOfMonth !== undefined) {
      updatePayload.billingDayOfMonth = input.billingDayOfMonth;
    }
    if (input.balanceCents !== undefined) {
      updatePayload.balanceCents = input.balanceCents;
    }
    if (input.ibanMasked !== undefined) {
      updatePayload.ibanMasked = input.ibanMasked ? input.ibanMasked.trim() : null;
    }
    if (input.notes !== undefined) {
      updatePayload.notes = input.notes ? input.notes.trim() : null;
    }

    let linkChanged = false;
    if (input.settlementAccountId !== undefined) {
      const link = resolveSettlementLink(user.id, account, input.settlementAccountId, input.settlementMatchPattern);
      if (!link.ok) return { success: false, error: link.error };
      updatePayload.settlementAccountId = link.settlementAccountId;
      updatePayload.settlementMatchPattern = link.settlementMatchPattern;
      if (!link.settlementAccountId) {
        updatePayload.settlementSince = null;
      } else if (link.settlementAccountId !== account.settlementAccountId || !account.settlementSince) {
        // Neue Verknüpfung: erst ab heute abgleichen
        updatePayload.settlementSince = todayISO();
      }
      linkChanged = link.settlementAccountId !== null;
    }

    db.update(bankAccounts)
      .set(updatePayload)
      .where(eq(bankAccounts.id, account.id))
      .run();

    if (linkChanged) applySettlementsAfterSave(user.id, account.id);

    safeRevalidatePath("/banking");
    safeRevalidatePath("/settings");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Konto konnte nicht aktualisiert werden.", "bank-actions"),
    };
  }
}

export interface AccountTransferInput {
  sourceAccountId: string;
  targetAccountId: string;
  amountCents: number;
  date?: string;
  description?: string;
  clientRequestId?: string;
}

/**
 * Führt eine interne Umbuchung oder einen Kartenausgleich durch (z. B. Girokonto -> Advanzia/TF Bank).
 * Belastet das Ausgangskonto, schreibt dem Zielkonto gut und verbucht dies als neutrale Transfer-Buchung,
 * sodass der Monats-Cashflow und Lebenshaltungsausgaben nicht fälschlich doppelt gezählt werden.
 */
export async function transferBetweenAccountsAction(
  rawInput: AccountTransferInput
) {
  try {
    const user = await requireUser();
    const parsed = accountTransferSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: firstIssueMessage(parsed.error) };
    }
    const input = parsed.data;
    if (input.sourceAccountId === input.targetAccountId) {
      return {
        success: false,
        error: "Ausgangs- und Zielkonto dürfen nicht identisch sein.",
      };
    }

    const sourceAccount = db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, input.sourceAccountId),
          eq(bankAccounts.userId, user.id)
        )
      )
      .get();
    if (!sourceAccount) {
      return { success: false, error: "Ausgangskonto wurde nicht gefunden." };
    }

    const targetAccount = db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, input.targetAccountId),
          eq(bankAccounts.userId, user.id)
        )
      )
      .get();
    if (!targetAccount) {
      return { success: false, error: "Zielkonto wurde nicht gefunden." };
    }

    const transferCategory = getOrCreateTransferCategory(user.id);
    const now = new Date();
    const transferDate = input.date || todayISO();
    if (!transferCategory) {
      return { success: false, error: "Umbuchungs-Kategorie konnte nicht angelegt werden." };
    }

    // Bank-synchronisierte Konten liefern ihre Seite der Umbuchung selbst –
    // dort weder Saldo ändern noch eine eigene Buchung anlegen (sonst doppelt)
    const sourceSynced = Boolean(sourceAccount.connectedBankId);
    const targetSynced = Boolean(targetAccount.connectedBankId);
    if (sourceSynced && targetSynced) {
      return {
        success: false,
        error:
          "Beide Konten werden von der Bank synchronisiert – die Umbuchung erscheint dort automatisch.",
      };
    }

    const customDesc = input.description?.trim();
    const outDesc =
      customDesc ||
      `Kartenausgleich / Umbuchung an ${targetAccount.accountName}`;
    const inDesc =
      customDesc ||
      `Ausgleichszahlung von ${sourceAccount.accountName}`;

    // Doppelte Anfrage (Doppelklick, Wiederholung nach Verbindungsabbruch):
    // Die erste hat bereits gebucht. Prüfung und Buchung laufen ohne await
    // dazwischen; der eindeutige Index auf client_temp_id sichert zusätzlich.
    const requestKeys = input.clientRequestId
      ? { out: `transfer:${input.clientRequestId}:out`, in: `transfer:${input.clientRequestId}:in` }
      : null;
    if (requestKeys) {
      const alreadyBooked = db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, user.id),
            inArray(transactions.clientTempId, [requestKeys.out, requestKeys.in])
          )
        )
        .get();
      if (alreadyBooked) return { success: true };
    }

    db.transaction((tx) => {
      // 1. Ausgangskonto belasten
      if (!sourceSynced && sourceAccount.balanceCents !== null) {
        tx.update(bankAccounts)
          .set({
            balanceCents: sourceAccount.balanceCents - input.amountCents,
            updatedAt: now,
          })
          .where(eq(bankAccounts.id, sourceAccount.id))
          .run();
      }

      // 2. Zielkonto gutschreiben
      if (!targetSynced && targetAccount.balanceCents !== null) {
        tx.update(bankAccounts)
          .set({
            balanceCents: targetAccount.balanceCents + input.amountCents,
            updatedAt: now,
          })
          .where(eq(bankAccounts.id, targetAccount.id))
          .run();
      }

      // 3. Ausgehende Buchung auf Ausgangskonto (costType: transfer -> neutral für Konsumausgaben)
      if (!sourceSynced) tx.insert(transactions)
        .values({
          id: crypto.randomUUID(),
          userId: user.id,
          categoryId: transferCategory!.id,
          type: "expense",
          costType: "transfer",
          amountCents: input.amountCents,
          date: transferDate,
          description: outDesc,
          bankAccountId: sourceAccount.id,
          paymentMethod: "transfer",
          clientTempId: requestKeys?.out ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // 4. Eingehende Buchung auf Zielkonto (costType: transfer -> neutral für Einnahmen)
      if (!targetSynced) tx.insert(transactions)
        .values({
          id: crypto.randomUUID(),
          userId: user.id,
          categoryId: transferCategory!.id,
          type: "income",
          costType: "transfer",
          amountCents: input.amountCents,
          date: transferDate,
          description: inDesc,
          bankAccountId: targetAccount.id,
          paymentMethod: "transfer",
          clientTempId: requestKeys?.in ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });

    safeRevalidatePath("/banking");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/");
    safeRevalidatePath("/settings");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Umbuchung fehlgeschlagen.", "bank-actions"),
    };
  }
}

export interface ReconcileBalanceInput {
  accountId: string;
  actualBalanceCents: number;
  mode?: "adjustment_transaction" | "set_balance"; // Default: adjustment_transaction
  date?: string;
  description?: string;
}

/**
 * Kassensturz & Saldenabgleich:
 * Gleicht das Konto auf den tatsächlich eingegebenen Cent-Betrag ab.
 * Im Modus "adjustment_transaction" wird automatisch eine Ausgleichsbuchung angelegt,
 * im Modus "set_balance" wird der Saldo direkt angepasst.
 */
export async function reconcileAccountBalanceAction(rawInput: ReconcileBalanceInput) {
  try {
    const user = await requireUser();
    const parsed = reconcileBalanceSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: firstIssueMessage(parsed.error) };
    }
    const input = parsed.data;
    const account = db
      .select()
      .from(bankAccounts)
      .where(
        and(eq(bankAccounts.id, input.accountId), eq(bankAccounts.userId, user.id))
      )
      .get();

    if (!account) {
      return { success: false, error: "Konto nicht gefunden." };
    }

    const currentBal = account.balanceCents ?? 0;
    const targetBal = input.actualBalanceCents;
    const diff = targetBal - currentBal;

    if (diff === 0) {
      return {
        success: true,
        diffCents: 0,
        message: "Der Kontostand stimmt bereits exakt überein.",
      };
    }

    const mode = input.mode || "adjustment_transaction";
    const now = new Date();
    const bookingDate = input.date || todayISO();

    if (mode === "adjustment_transaction") {
      // Passende Kategorie für Ausgleich / Sonstiges finden
      const userCats = db
        .select()
        .from(categories)
        .where(eq(categories.userId, user.id))
        .all();

      const targetCategory =
        userCats.find((c) => /umbuchung|ausgleich|sonstig/i.test(c.name)) ||
        userCats[0];

      if (!targetCategory) {
        return { success: false, error: "Keine Kategorie für Ausgleichsbuchung gefunden." };
      }

      const isDiffPositive = diff > 0;
      const absDiff = Math.abs(diff);
      const desc =
        input.description?.trim() ||
        `Kassensturz / Saldenabgleich (${account.accountName})`;

      db.transaction((tx) => {
        // Transaktion erfassen
        tx.insert(transactions)
          .values({
            id: crypto.randomUUID(),
            userId: user.id,
            categoryId: targetCategory.id,
            type: isDiffPositive ? "income" : "expense",
            costType: "transfer",
            amountCents: absDiff,
            date: bookingDate,
            description: desc,
            bankAccountId: account.id,
            paymentMethod:
              account.accountType === "cash"
                ? "cash"
                : account.accountType === "credit_card"
                  ? "card"
                  : "transfer",
            createdAt: now,
            updatedAt: now,
          })
          .run();

        // Saldo auf den Zielbetrag setzen
        tx.update(bankAccounts)
          .set({
            balanceCents: targetBal,
            updatedAt: now,
          })
          .where(eq(bankAccounts.id, account.id))
          .run();
      });
    } else {
      // Nur Saldo direkt überschreiben
      db.update(bankAccounts)
        .set({
          balanceCents: targetBal,
          updatedAt: now,
        })
        .where(eq(bankAccounts.id, account.id))
        .run();
    }

    safeRevalidatePath("/banking");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/");

    return {
      success: true,
      diffCents: diff,
      message: `Kontostand erfolgreich auf ${(targetBal / 100).toFixed(2).replace(".", ",")} € abgeglichen.`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: publicErrorMessage(err, "Saldenabgleich fehlgeschlagen.", "bank-actions"),
    };
  }
}

const settlementPreviewSchema = z.object({
  settlementAccountId: idSchema,
  pattern: z.string().max(60),
});

/** Tage, die die Vorschau des Erkennungsbegriffs zurückblickt */
const SETTLEMENT_PREVIEW_DAYS = 90;

/**
 * Vorschau für den Konto-Dialog: Wie viele Abbuchungen der letzten 90 Tage
 * auf dem Ausgleichskonto träfe der Erkennungsbegriff? So fällt ein zu
 * allgemeiner Begriff auf, bevor er Buchungen umwandelt.
 */
export async function previewCardSettlementAction(rawInput: { settlementAccountId: string; pattern: string }) {
  try {
    const user = await requireUser();
    const parsed = settlementPreviewSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false as const, error: firstIssueMessage(parsed.error) };
    const { settlementAccountId, pattern } = parsed.data;
    if (normalizeSettlementPattern(pattern).length < MIN_SETTLEMENT_PATTERN_LENGTH) {
      return { success: true as const, matchCount: 0, examples: [] as string[] };
    }
    const owned = db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, settlementAccountId), eq(bankAccounts.userId, user.id)))
      .get();
    if (!owned) return { success: false as const, error: "Konto nicht gefunden." };

    const debits = findSettlementDebits(user.id, settlementAccountId, pattern, shiftedLocalISODate(-SETTLEMENT_PREVIEW_DAYS));
    return {
      success: true as const,
      matchCount: debits.length,
      examples: debits.slice(0, 3).map((d) => d.description),
    };
  } catch (err: unknown) {
    return {
      success: false as const,
      error: publicErrorMessage(err, "Vorschau nicht möglich.", "bank-actions"),
    };
  }
}
