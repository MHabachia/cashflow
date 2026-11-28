import { db } from "@/lib/db";
import { bankAccounts, transactions, type PaymentMethod } from "@/lib/db/schema";
import { and, desc, eq, gte, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { monthRange } from "@/lib/date-range";

/**
 * Daten für die Umsatzliste. Filter, Suche, Summen und Seiten werden auf dem
 * Server berechnet; der Browser bekommt nur die angezeigten Buchungen.
 */

import { ALL_MONTHS, MANUAL_ACCOUNT, MAX_SELECTABLE_IDS, PAGE_SIZE } from "@/lib/transactions-list-constants";

export { ALL_MONTHS, MANUAL_ACCOUNT, MAX_SELECTABLE_IDS, PAGE_SIZE };

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_SEARCH_LENGTH = 100;
const MAX_ID_LENGTH = 200;

export type CostTypeFilter = "all" | "variable" | "fixed";

export interface TransactionListFilter {
  /** "YYYY-MM" oder ALL_MONTHS */
  month: string;
  search: string;
  categoryId: string; // "all" oder Kategorie-ID
  costType: CostTypeFilter;
  bankAccountId: string; // "all", MANUAL_ACCOUNT oder Konto-ID
}

export interface TransactionListRow {
  id: string;
  categoryId: string;
  type: "expense" | "income";
  costType: "variable" | "fixed" | "transfer";
  amountCents: number;
  date: string;
  description: string;
  merchant: string | null;
  paymentMethod: PaymentMethod;
  receiptPath: string | null;
  isSplit: boolean;
  bankAccountId: string | null;
  isBankSynced: boolean;
  bankAccountName: string | null;
}

export interface TransactionListSummary {
  count: number;
  variableExpenses: number;
  fixedExpenses: number;
  totalExpenses: number;
  income: number;
}

export interface TransactionListPage {
  rows: TransactionListRow[];
  /** Für „Weitere laden“; null, wenn alles geladen ist */
  nextCursor: string | null;
}

type SearchParamValue = string | string[] | undefined;

function first(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Liest `?month=` aus der URL; Unbekanntes fällt auf den aktuellen Monat zurück. */
export function parseListMonth(param: SearchParamValue, currentMonth: string): string {
  const value = first(param);
  if (value === ALL_MONTHS) return ALL_MONTHS;
  if (value && MONTH_PATTERN.test(value)) return value;
  return currentMonth;
}

/** Filter aus der URL; ungültige Werte fallen auf „alle“ zurück. */
export function parseListFilter(
  params: Record<string, SearchParamValue>,
  currentMonth: string
): TransactionListFilter {
  const id = (value: SearchParamValue) => {
    const v = first(value)?.trim();
    return v && v.length <= MAX_ID_LENGTH ? v : "all";
  };
  const costType = first(params.costType);
  return {
    month: parseListMonth(params.month, currentMonth),
    search: (first(params.q) ?? "").trim().slice(0, MAX_SEARCH_LENGTH),
    categoryId: id(params.category),
    costType: costType === "variable" || costType === "fixed" ? costType : "all",
    bankAccountId: id(params.bankAccountId),
  };
}

/** `%` und `_` sind in LIKE Platzhalter; in der Suche sollen sie wörtlich gelten. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function filterConditions(userId: string, filter: TransactionListFilter): SQL[] {
  const conditions: SQL[] = [eq(transactions.userId, userId)];
  if (filter.month !== ALL_MONTHS) {
    const range = monthRange(filter.month);
    conditions.push(gte(transactions.date, range.from), lt(transactions.date, range.to));
  }
  if (filter.categoryId !== "all") conditions.push(eq(transactions.categoryId, filter.categoryId));
  if (filter.costType !== "all") conditions.push(eq(transactions.costType, filter.costType));
  if (filter.bankAccountId === MANUAL_ACCOUNT) {
    conditions.push(isNull(transactions.bankAccountId));
  } else if (filter.bankAccountId !== "all") {
    conditions.push(eq(transactions.bankAccountId, filter.bankAccountId));
  }
  const search = filter.search.trim();
  if (search) {
    // Wie bisher im Browser: Beschreibung, Kategoriename oder Kontoname
    const pattern = `%${escapeLike(search.toLowerCase())}%`;
    conditions.push(
      or(
        sql`lower_unicode(${transactions.description}) LIKE ${pattern} ESCAPE '\\'`,
        sql`${transactions.categoryId} IN (SELECT id FROM categories WHERE user_id = ${userId} AND lower_unicode(name) LIKE ${pattern} ESCAPE '\\')`,
        sql`${transactions.bankAccountId} IN (SELECT id FROM bank_accounts WHERE user_id = ${userId} AND lower_unicode(account_name) LIKE ${pattern} ESCAPE '\\')`
      )!
    );
  }
  return conditions;
}

interface Cursor {
  date: string;
  createdAt: number; // ms
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** Liefert null bei manipuliertem oder unlesbarem Cursor. */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed?.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) &&
      Number.isFinite(parsed.createdAt) &&
      typeof parsed.id === "string" &&
      parsed.id.length <= MAX_ID_LENGTH
    ) {
      return { date: parsed.date, createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // ungültiger Cursor: fällt unten auf null
  }
  return null;
}

/** Nach dem Cursor in der Sortierung Datum, Anlagezeit, ID (jeweils absteigend). */
function afterCursor(cursor: Cursor): SQL {
  const createdAt = new Date(cursor.createdAt);
  return or(
    lt(transactions.date, cursor.date),
    and(eq(transactions.date, cursor.date), lt(transactions.createdAt, createdAt)),
    and(eq(transactions.date, cursor.date), eq(transactions.createdAt, createdAt), lt(transactions.id, cursor.id))
  )!;
}

export function queryTransactions(
  userId: string,
  filter: TransactionListFilter,
  cursor: Cursor | null = null,
  limit = PAGE_SIZE
): TransactionListPage {
  const conditions = filterConditions(userId, filter);
  if (cursor) conditions.push(afterCursor(cursor));

  const rows = db
    .select({
      tx: transactions,
      accountName: bankAccounts.accountName,
    })
    .from(transactions)
    .leftJoin(
      bankAccounts,
      and(eq(transactions.bankAccountId, bankAccounts.id), eq(bankAccounts.userId, userId))
    )
    .where(and(...conditions))
    .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
    .limit(limit + 1)
    .all();

  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1]?.tx;
  return {
    rows: pageRows.map(({ tx, accountName }) => ({
      id: tx.id,
      categoryId: tx.categoryId,
      type: tx.type,
      costType: tx.costType,
      amountCents: tx.amountCents,
      date: tx.date,
      description: tx.description,
      merchant: tx.merchant,
      paymentMethod: tx.paymentMethod,
      receiptPath: tx.receiptPath,
      isSplit: tx.isSplit,
      bankAccountId: tx.bankAccountId,
      isBankSynced: Boolean(tx.bankTransactionId),
      bankAccountName: tx.bankAccountId ? accountName || "Bankkonto" : null,
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ date: last.date, createdAt: last.createdAt.getTime(), id: last.id })
        : null,
  };
}

/** Anzahl und Summen nach denselben Regeln wie bisher im Browser. */
export function summarizeTransactions(userId: string, filter: TransactionListFilter): TransactionListSummary {
  const row = db
    .select({
      count: sql<number>`count(*)`,
      income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amountCents} else 0 end), 0)`,
      fixed: sql<number>`coalesce(sum(case when ${transactions.type} <> 'income' and ${transactions.costType} = 'fixed' then ${transactions.amountCents} else 0 end), 0)`,
      variable: sql<number>`coalesce(sum(case when ${transactions.type} <> 'income' and ${transactions.costType} <> 'fixed' then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(...filterConditions(userId, filter)))
    .get();
  const variableExpenses = Number(row?.variable ?? 0);
  const fixedExpenses = Number(row?.fixed ?? 0);
  return {
    count: Number(row?.count ?? 0),
    variableExpenses,
    fixedExpenses,
    totalExpenses: variableExpenses + fixedExpenses,
    income: Number(row?.income ?? 0),
  };
}

/** IDs aller gefilterten Buchungen für „Alle auswählen“, höchstens MAX_SELECTABLE_IDS. */
export function listTransactionIds(userId: string, filter: TransactionListFilter): string[] {
  return db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(...filterConditions(userId, filter)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
    .limit(MAX_SELECTABLE_IDS)
    .all()
    .map((r) => r.id);
}

/** Monate mit Buchungen, neueste zuerst; der aktuelle Monat ist immer dabei. */
export function listAvailableMonths(userId: string, currentMonth: string): string[] {
  const rows = db
    .select({ month: sql<string>`DISTINCT substr(${transactions.date}, 1, 7)` })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .all();
  const months = new Set<string>([currentMonth]);
  for (const row of rows) {
    if (MONTH_PATTERN.test(row.month)) months.add(row.month);
  }
  return Array.from(months).sort().reverse();
}

/** Neueste Buchungen unabhängig vom gewählten Monat (für die Offline-Ansicht). */
export function loadRecentTransactions(userId: string, limit = 15) {
  return db
    .select({
      id: transactions.id,
      description: transactions.description,
      amountCents: transactions.amountCents,
      date: transactions.date,
      type: transactions.type,
      costType: transactions.costType,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(limit)
    .all();
}
