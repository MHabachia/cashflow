import { and, eq, gte, isNotNull, isNull, like, lte } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "./db";
import { bankAccounts, transactions } from "./db/schema";
import { shiftIsoDate } from "./recurring-matching";
import { getOrCreateTransferCategory } from "./transfer-detection";
import { matchesSettlementPattern } from "./card-settlement-pattern";

/**
 * Automatischer Kartenausgleich für manuell geführte Kreditkarten.
 *
 * Eine Karte (z. B. Advanzia) kann mit dem Girokonto verknüpft werden, von
 * dem ihr Ausgleich abgebucht wird. Jede Abbuchung auf diesem Girokonto, deren
 * Text den Erkennungsbegriff enthält, wird als Umbuchung markiert, und auf der
 * Karte entsteht die passende Gutschrift (Saldo steigt). Jede Abbuchung wird
 * nur einmal verarbeitet; der Schlüssel steht in `transactions.client_temp_id`.
 */

export const SETTLEMENT_KEY_PREFIX = "card-settlement:";
/** Höchster Abstand zwischen Abbuchung und Gutschrift auf dem Kartenauszug */
const DUPLICATE_WINDOW_DAYS = 5;

export function settlementKey(sourceTransactionId: string): string {
  return `${SETTLEMENT_KEY_PREFIX}${sourceTransactionId}`;
}

interface SettlementCard {
  id: string;
  accountName: string;
  balanceCents: number | null;
  settlementAccountId: string;
  settlementMatchPattern: string;
  settlementSince: string;
}

function linkedCards(userId: string, cardId?: string): SettlementCard[] {
  return db
    .select({
      id: bankAccounts.id,
      accountName: bankAccounts.accountName,
      balanceCents: bankAccounts.balanceCents,
      settlementAccountId: bankAccounts.settlementAccountId,
      settlementMatchPattern: bankAccounts.settlementMatchPattern,
      settlementSince: bankAccounts.settlementSince,
    })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.userId, userId),
        eq(bankAccounts.accountType, "credit_card"),
        // Per Bank angebundene Karten liefern die Gutschrift selbst
        isNull(bankAccounts.connectedBankId),
        isNotNull(bankAccounts.settlementAccountId),
        isNotNull(bankAccounts.settlementMatchPattern),
        isNotNull(bankAccounts.settlementSince),
        cardId ? eq(bankAccounts.id, cardId) : undefined
      )
    )
    .all() as SettlementCard[];
}

/** Abbuchungen auf dem Ausgleichskonto, die den Begriff enthalten (ab `since`). */
export function findSettlementDebits(
  userId: string,
  settlementAccountId: string,
  pattern: string,
  since: string
) {
  return db
    .select({
      id: transactions.id,
      amountCents: transactions.amountCents,
      date: transactions.date,
      description: transactions.description,
      merchant: transactions.merchant,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.bankAccountId, settlementAccountId),
        eq(transactions.type, "expense"),
        gte(transactions.date, since)
      )
    )
    .all()
    .filter((t) => matchesSettlementPattern(`${t.description} ${t.merchant ?? ""}`, pattern));
}

/**
 * Verarbeitet alle noch offenen Kartenausgleiche des Benutzers (optional nur
 * für eine Karte). Gibt die Anzahl neu verarbeiteter Abbuchungen zurück.
 */
export function applyCardSettlements(userId: string, cardId?: string): number {
  const cards = linkedCards(userId, cardId);
  if (cards.length === 0) return 0;

  const transferCategory = getOrCreateTransferCategory(userId);
  if (!transferCategory) return 0;

  let processed = 0;
  for (const card of cards) {
    const settlementAccount = db
      .select({ accountName: bankAccounts.accountName })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, card.settlementAccountId), eq(bankAccounts.userId, userId)))
      .get();
    if (!settlementAccount) continue;

    const debits = findSettlementDebits(userId, card.settlementAccountId, card.settlementMatchPattern, card.settlementSince);
    for (const debit of debits) {
      const key = settlementKey(debit.id);
      const alreadyProcessed = db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.clientTempId, key)))
        .get();
      if (alreadyProcessed) continue;

      const now = new Date();
      db.transaction((tx) => {
        // 1. Abbuchung auf dem Girokonto ist keine Ausgabe, sondern Umbuchung
        tx.update(transactions)
          .set({ costType: "transfer", categoryId: transferCategory.id, recurringId: null, updatedAt: now })
          .where(and(eq(transactions.id, debit.id), eq(transactions.userId, userId)))
          .run();

        // 2. Schon importierte Gutschrift auf der Karte (z. B. PDF-Auszug)?
        //    Dann nur verknüpfen, sonst zählte die Zahlung doppelt
        const existingCredit = tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              eq(transactions.bankAccountId, card.id),
              eq(transactions.type, "income"),
              eq(transactions.amountCents, debit.amountCents),
              gte(transactions.date, shiftIsoDate(debit.date, -DUPLICATE_WINDOW_DAYS)),
              lte(transactions.date, shiftIsoDate(debit.date, DUPLICATE_WINDOW_DAYS)),
              isNull(transactions.clientTempId)
            )
          )
          .get();

        if (existingCredit) {
          tx.update(transactions)
            .set({ costType: "transfer", categoryId: transferCategory.id, clientTempId: key, updatedAt: now })
            .where(eq(transactions.id, existingCredit.id))
            .run();
          return;
        }

        // 3. Gutschrift auf der Karte anlegen und Saldo erhöhen
        tx.insert(transactions)
          .values({
            id: crypto.randomUUID(),
            userId,
            categoryId: transferCategory.id,
            type: "income",
            costType: "transfer",
            amountCents: debit.amountCents,
            date: debit.date,
            description: `Ausgleich von ${settlementAccount.accountName}`,
            paymentMethod: "transfer",
            bankAccountId: card.id,
            clientTempId: key,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        const current = tx
          .select({ balanceCents: bankAccounts.balanceCents })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, card.id))
          .get();
        if (current && current.balanceCents !== null) {
          tx.update(bankAccounts)
            .set({ balanceCents: current.balanceCents + debit.amountCents, updatedAt: now })
            .where(eq(bankAccounts.id, card.id))
            .run();
        }
      });
      processed++;
    }
  }
  return processed;
}

/**
 * true, wenn eine Gutschrift auf der Karte schon als automatischer Ausgleich
 * existiert (gleicher Betrag, wenige Tage Abstand). Für den Import von
 * Kartenauszügen: Die Zahlung steht dort noch einmal als Eingang.
 */
export function isCoveredByCardSettlement(
  userId: string,
  cardAccountId: string,
  amountCents: number,
  date: string
): boolean {
  return !!db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.bankAccountId, cardAccountId),
        eq(transactions.type, "income"),
        eq(transactions.amountCents, amountCents),
        gte(transactions.date, shiftIsoDate(date, -DUPLICATE_WINDOW_DAYS)),
        lte(transactions.date, shiftIsoDate(date, DUPLICATE_WINDOW_DAYS)),
        like(transactions.clientTempId, `${SETTLEMENT_KEY_PREFIX}%`)
      )
    )
    .get();
}
