"use server";

import { z } from "zod";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/errors";
import { firstIssueMessage } from "@/lib/validation";
import {
  ALL_MONTHS,
  decodeCursor,
  listTransactionIds,
  queryTransactions,
  type TransactionListFilter,
} from "@/lib/transactions-list";

const filterSchema = z.object({
  month: z.union([z.literal(ALL_MONTHS), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]),
  search: z.string().max(100),
  categoryId: z.string().min(1).max(200),
  costType: z.enum(["all", "variable", "fixed"]),
  bankAccountId: z.string().min(1).max(200),
});

const loadMoreSchema = z.object({
  filter: filterSchema,
  cursor: z.string().min(1).max(1000),
});

/** Nächste Seite der Umsatzliste („Weitere laden“). */
export async function loadMoreTransactionsAction(input: { filter: TransactionListFilter; cursor: string }) {
  try {
    const user = await requireUser();
    const parsed = loadMoreSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: firstIssueMessage(parsed.error) };
    const cursor = decodeCursor(parsed.data.cursor);
    if (!cursor) return { success: false as const, error: "Ungültige Seitenangabe. Bitte die Seite neu laden." };
    // Alle Abfragen filtern nach user.id: fremde Kategorie- oder Konto-IDs liefern nichts
    const page = queryTransactions(user.id, parsed.data.filter, cursor);
    return { success: true as const, ...page };
  } catch (err: unknown) {
    return {
      success: false as const,
      error: publicErrorMessage(err, "Weitere Buchungen konnten nicht geladen werden.", "transaction-list-actions"),
    };
  }
}

/** IDs aller gefilterten Buchungen für „Alle auswählen“. */
export async function listTransactionIdsAction(input: { filter: TransactionListFilter }) {
  try {
    const user = await requireUser();
    const parsed = z.object({ filter: filterSchema }).safeParse(input);
    if (!parsed.success) return { success: false as const, error: firstIssueMessage(parsed.error) };
    return { success: true as const, ids: listTransactionIds(user.id, parsed.data.filter) };
  } catch (err: unknown) {
    return {
      success: false as const,
      error: publicErrorMessage(err, "Auswahl konnte nicht geladen werden.", "transaction-list-actions"),
    };
  }
}
