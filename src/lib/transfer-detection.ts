import { db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { and, eq, gte, isNotNull, isNull, ne } from "drizzle-orm";
import crypto from "node:crypto";
import { shiftedLocalISODate } from "@/lib/format";

/**
 * Erkennung von Umbuchungen zwischen eigenen Konten.
 *
 * Ersetzt das frühere ING-spezifische „Kleingeld Plus“-Sparen: Wird auf einem
 * eigenen Konto ein Betrag abgebucht und auf einem anderen eigenen Konto
 * innerhalb weniger Tage derselbe Betrag gutgeschrieben (Giro → Tagesgeld,
 * Giro → Kreditkarte, Aufrundungssparen …), werden beide Buchungen als
 * vermögensneutrale Umbuchung markiert. Funktioniert für synchronisierte und
 * manuell geführte Konten gleichermaßen.
 */

export const TRANSFER_CATEGORY_NAME = "Umbuchung & Ausgleich";
const MAX_DAY_DIFF = 3;

/** Liefert die Kategorie „Umbuchung & Ausgleich“ und legt sie bei Bedarf an. */
export function getOrCreateTransferCategory(userId: string) {
  const find = () =>
    db
      .select()
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.name, TRANSFER_CATEGORY_NAME)))
      .get();
  const existing = find();
  if (existing) return existing;
  db.insert(categories)
    .values({
      id: crypto.randomUUID(),
      userId,
      name: TRANSFER_CATEGORY_NAME,
      color: "#6366f1",
      icon: "Repeat",
      type: "expense",
      sortOrder: 11,
      isDefault: true,
      createdAt: new Date(),
    })
    .run();
  return find();
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
}

export interface TransferCandidate {
  id: string;
  type: "expense" | "income";
  amountCents: number;
  date: string;
  bankAccountId: string;
}

/**
 * Reine Paarungslogik: ordnet jeder Abbuchung höchstens eine Gutschrift auf
 * einem anderen Konto mit gleichem Betrag zu (nächstes Datum gewinnt).
 */
export function pairTransfers(candidates: TransferCandidate[]): Array<[string, string]> {
  const incomes = candidates.filter((c) => c.type === "income");
  const used = new Set<string>();
  const pairs: Array<[string, string]> = [];
  const expenses = candidates
    .filter((c) => c.type === "expense")
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const out of expenses) {
    const match = incomes
      .filter(
        (inc) =>
          !used.has(inc.id) &&
          inc.bankAccountId !== out.bankAccountId &&
          inc.amountCents === out.amountCents &&
          dayDiff(inc.date, out.date) <= MAX_DAY_DIFF
      )
      .sort((a, b) => dayDiff(a.date, out.date) - dayDiff(b.date, out.date))[0];
    if (match) {
      used.add(match.id);
      pairs.push([out.id, match.id]);
    }
  }
  return pairs;
}

/**
 * Markiert erkannte Umbuchungen eines Benutzers ab `sinceDate`.
 * Vom Nutzer zugeordnete Buchungen und Fixkosten-Buchungen bleiben außen vor:
 * Die Erkennung läuft nach jedem Abruf und Import erneut und würde sonst
 * manuelle Korrekturen und die Verknüpfung mit Fixkosten wieder überschreiben.
 * Gibt die Anzahl der markierten Paare zurück.
 */
export function detectOwnAccountTransfers(userId: string, sinceDate?: string): number {
  const since = sinceDate ?? shiftedLocalISODate(-60);
  const rows = db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountCents: transactions.amountCents,
      date: transactions.date,
      bankAccountId: transactions.bankAccountId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        ne(transactions.costType, "transfer"),
        eq(transactions.manuallyClassified, false),
        isNull(transactions.recurringId),
        isNotNull(transactions.bankAccountId),
        gte(transactions.date, since)
      )
    )
    .all() as TransferCandidate[];

  const pairs = pairTransfers(rows);
  if (pairs.length === 0) return 0;

  const transferCategory = getOrCreateTransferCategory(userId);
  if (!transferCategory) return 0;
  const now = new Date();
  db.transaction((tx) => {
    for (const [outId, inId] of pairs) {
      for (const id of [outId, inId]) {
        tx.update(transactions)
          .set({ costType: "transfer", categoryId: transferCategory.id, updatedAt: now })
          .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
          .run();
      }
    }
  });
  return pairs.length;
}
