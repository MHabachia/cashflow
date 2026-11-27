"use server";

import { db } from "@/lib/db";
import {
  transactions,
  transactionSplits,
  categories,
  variablePresets,
  bankAccounts,
  PAYMENT_METHODS,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { userOwnsAllCategories, userOwnsCategory } from "@/lib/ownership";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside Next.js request context (z. B. in Unit-Tests), ist revalidatePath ein No-Op
  }
}

function removeReceiptFileFromDisk(
  userId: string,
  receiptPath: string | null | undefined
) {
  if (!receiptPath) return;
  try {
    const [ownerId, filename] = receiptPath.split("/");
    if (ownerId !== userId || !filename) return;
    const uploadsRoot = path.resolve(
      process.env.UPLOADS_DIR || "./data/uploads"
    );
    const fullPath = path.join(uploadsRoot, userId, path.basename(filename));
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch {
    // Datei bereits entfernt oder nicht erreichbar
  }
}

const transactionSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1, "Bitte eine Kategorie wählen."),
  type: z.enum(["expense", "income"]).default("expense"),
  costType: z.enum(["variable", "fixed", "transfer"]).default("variable"),
  amountCents: z
    .number()
    .int()
    .positive("Betrag muss größer als 0,00 € sein."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datumsformat (YYYY-MM-DD)."),
  description: z.string().min(1, "Bitte eine Beschreibung eingeben.").max(200),
  merchant: z.string().max(120).optional().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).default("card"),
  receiptPath: z.string().optional().nullable(),
  presetId: z.string().optional().nullable(),
  bankAccountId: z.string().optional().nullable(),
  clientTempId: z.string().optional().nullable(),
  saveAsPreset: z.boolean().optional(),
  savePresetWithAmount: z.boolean().optional(),
});

export type TransactionInput = z.input<typeof transactionSchema>;

export async function createTransactionAction(input: TransactionInput) {
  const user = await requireUser();
  const parsed = transactionSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Eingaben.",
    };
  }

  const data = parsed.data;
  const now = new Date();

  if (!userOwnsCategory(user.id, data.categoryId)) {
    return { success: false, error: "Ungültige Kategorie." };
  }

  if (
    data.bankAccountId &&
    !db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(
        and(eq(bankAccounts.id, data.bankAccountId), eq(bankAccounts.userId, user.id))
      )
      .get()
  ) {
    return { success: false, error: "Ungültiges Konto." };
  }

  if (data.clientTempId) {
    const existing = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, user.id),
          eq(transactions.clientTempId, data.clientTempId)
        )
      )
      .get();

    if (existing) {
      return { success: true, id: existing.id, deduplicated: true };
    }
  }

  const txId = crypto.randomUUID();

  db.transaction((tx) => {
    let usedPresetId = data.presetId || null;

    if (usedPresetId) {
      tx.update(variablePresets)
        .set({
          usageCount: sql`${variablePresets.usageCount} + 1`,
        })
        .where(
          and(
            eq(variablePresets.id, usedPresetId),
            eq(variablePresets.userId, user.id)
          )
        )
        .run();
    } else if (data.saveAsPreset) {
      const newPresetId = crypto.randomUUID();
      tx.insert(variablePresets)
        .values({
          id: newPresetId,
          userId: user.id,
          categoryId: data.categoryId,
          type: data.type,
          name: data.description.trim(),
          defaultAmountCents: data.savePresetWithAmount
            ? data.amountCents
            : null,
          paymentMethod: data.paymentMethod,
          usageCount: 1,
          sortOrder: 0,
          createdAt: now,
        })
        .run();
      usedPresetId = newPresetId;
    }

    tx.insert(transactions)
      .values({
        id: txId,
        userId: user.id,
        categoryId: data.categoryId,
        type: data.type,
        costType: data.costType,
        amountCents: data.amountCents,
        date: data.date,
        description: data.description.trim(),
        merchant: data.merchant?.trim() || null,
        paymentMethod: data.paymentMethod,
        receiptPath: data.receiptPath || null,
        presetId: usedPresetId,
        bankAccountId: data.bankAccountId || null,
        clientTempId: data.clientTempId || null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    if (data.bankAccountId) {
      const bankAcc = tx
        .select({ id: bankAccounts.id, balanceCents: bankAccounts.balanceCents })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, data.bankAccountId),
            eq(bankAccounts.userId, user.id)
          )
        )
        .get();

      if (bankAcc && bankAcc.balanceCents !== null) {
        const delta =
          data.type === "expense" ? -data.amountCents : data.amountCents;
        tx.update(bankAccounts)
          .set({
            balanceCents: bankAcc.balanceCents + delta,
            updatedAt: now,
          })
          .where(eq(bankAccounts.id, bankAcc.id))
          .run();
      }
    }
  });

  safeRevalidatePath("/");
  safeRevalidatePath("/transactions");
  safeRevalidatePath("/categories");
  safeRevalidatePath("/banking");

  return { success: true, id: txId };
}

export async function updateTransactionAction(input: TransactionInput) {
  const user = await requireUser();
  const parsed = transactionSchema.safeParse(input);

  if (!parsed.success || !parsed.data.id) {
    return {
      success: false,
      error: parsed.error?.issues[0]?.message || "Ungültige Eingaben.",
    };
  }

  const data = parsed.data;

  if (!userOwnsCategory(user.id, data.categoryId)) {
    return { success: false, error: "Ungültige Kategorie." };
  }

  const oldRow = db
    .select({
      receiptPath: transactions.receiptPath,
      bankAccountId: transactions.bankAccountId,
      bankTransactionId: transactions.bankTransactionId,
      amountCents: transactions.amountCents,
      type: transactions.type,
    })
    .from(transactions)
    .where(
      and(eq(transactions.id, data.id!), eq(transactions.userId, user.id))
    )
    .get();

  if (!oldRow) {
    return { success: false, error: "Buchung nicht gefunden." };
  }

  // Prüfen, ob ein altes Belegfoto ersetzt oder entfernt wurde
  if (oldRow.receiptPath && oldRow.receiptPath !== data.receiptPath) {
    removeReceiptFileFromDisk(user.id, oldRow.receiptPath);
  }

  db.transaction((tx) => {
    // Kontostand um die Differenz korrigieren, wenn Betrag oder Typ geändert wurden.
    // Bank-synchronisierte Buchungen ausgenommen: dort liefert die Bank den Saldo.
    if (oldRow.bankAccountId && !oldRow.bankTransactionId) {
      const signed = (type: string, cents: number) =>
        type === "expense" ? -cents : cents;
      const delta =
        signed(data.type, data.amountCents) -
        signed(oldRow.type, oldRow.amountCents);

      if (delta !== 0) {
        const bankAcc = tx
          .select({ id: bankAccounts.id, balanceCents: bankAccounts.balanceCents })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.id, oldRow.bankAccountId),
              eq(bankAccounts.userId, user.id)
            )
          )
          .get();
        if (bankAcc && bankAcc.balanceCents !== null) {
          tx.update(bankAccounts)
            .set({ balanceCents: bankAcc.balanceCents + delta, updatedAt: new Date() })
            .where(eq(bankAccounts.id, bankAcc.id))
            .run();
        }
      }
    }

    tx.update(transactions)
    .set({
      categoryId: data.categoryId,
      type: data.type,
      costType: data.costType,
      amountCents: data.amountCents,
      date: data.date,
      description: data.description.trim(),
      merchant: data.merchant?.trim() || null,
      paymentMethod: data.paymentMethod,
      receiptPath: data.receiptPath ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(transactions.id, data.id!), eq(transactions.userId, user.id))
    )
    .run();
  });

  safeRevalidatePath("/");
  safeRevalidatePath("/transactions");
  safeRevalidatePath("/banking");

  return { success: true };
}

export async function deleteTransactionAction(id: string) {
  const user = await requireUser();

  const existing = db
    .select({
      receiptPath: transactions.receiptPath,
      bankAccountId: transactions.bankAccountId,
      amountCents: transactions.amountCents,
      type: transactions.type,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
    .get();

  if (existing?.receiptPath) {
    removeReceiptFileFromDisk(user.id, existing.receiptPath);
  }

  db.transaction((tx) => {
    if (existing?.bankAccountId) {
      const bankAcc = tx
        .select({ id: bankAccounts.id, balanceCents: bankAccounts.balanceCents })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, existing.bankAccountId),
            eq(bankAccounts.userId, user.id)
          )
        )
        .get();

      if (bankAcc && bankAcc.balanceCents !== null) {
        // Revert: Bei Ausgabe Betrag wieder gutschreiben, bei Einnahme wieder abziehen
        const delta =
          existing.type === "expense"
            ? existing.amountCents
            : -existing.amountCents;
        tx.update(bankAccounts)
          .set({
            balanceCents: bankAcc.balanceCents + delta,
            updatedAt: new Date(),
          })
          .where(eq(bankAccounts.id, bankAcc.id))
          .run();
      }
    }

    tx.delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
      .run();
  });

  safeRevalidatePath("/");
  safeRevalidatePath("/transactions");
  safeRevalidatePath("/banking");

  return { success: true };
}

/**
 * Massen-Aktualisierung von ausgewählten Transaktionen (Kategorie oder Kostentyp).
 */
export async function batchUpdateTransactionsAction(input: {
  ids: string[];
  categoryId?: string;
  costType?: "variable" | "fixed" | "transfer";
}) {
  try {
    const user = await requireUser();
    if (!input.ids || input.ids.length === 0) {
      return { success: false, error: "Keine Buchungen ausgewählt." };
    }
    if (input.categoryId && !userOwnsCategory(user.id, input.categoryId)) {
      return { success: false, error: "Ungültige Kategorie." };
    }

    const payload: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.categoryId) payload.categoryId = input.categoryId;
    if (input.costType) payload.costType = input.costType;

    db.transaction((tx) => {
      for (const id of input.ids) {
        tx.update(transactions)
          .set(payload)
          .where(and(eq(transactions.id, id), eq(transactions.userId, user.id)))
          .run();
      }
    });

    safeRevalidatePath("/");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/categories");

    return { success: true, count: input.ids.length };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Fehler bei der Massenaktualisierung.",
    };
  }
}

/**
 * Massen-Löschung von ausgewählten Transaktionen inklusive sauberer Saldenrückabwicklung.
 */
export async function batchDeleteTransactionsAction(ids: string[]) {
  try {
    const user = await requireUser();
    if (!ids || ids.length === 0) {
      return { success: false, error: "Keine Buchungen zum Löschen ausgewählt." };
    }

    let deletedCount = 0;
    for (const id of ids) {
      await deleteTransactionAction(id);
      deletedCount++;
    }

    safeRevalidatePath("/");
    safeRevalidatePath("/transactions");
    safeRevalidatePath("/banking");

    return { success: true, count: deletedCount };
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error)?.message || "Fehler beim Löschen der Buchungen.",
    };
  }
}

export interface DuplicateGroupItem {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  type: "expense" | "income";
  bankAccountName?: string | null;
  bankTransactionId?: string | null;
  categoryId?: string;
}

export interface DuplicateGroup {
  groupId: string;
  amountCents: number;
  items: DuplicateGroupItem[];
}

/**
 * Findet potenzielle Duplikate (gleicher Betrag, gleicher Typ, Datum innerhalb von 2 Tagen und ähnlicher Text).
 */
export async function findDuplicateTransactionsAction() {
  try {
    const user = await requireUser();

    const userTx = db
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        amountCents: transactions.amountCents,
        type: transactions.type,
        bankAccountId: transactions.bankAccountId,
        bankTransactionId: transactions.bankTransactionId,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .where(eq(transactions.userId, user.id))
      .orderBy(transactions.date)
      .all();

    const accounts = db
      .select({ id: bankAccounts.id, name: bankAccounts.accountName })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, user.id))
      .all();
    const accMap = new Map(accounts.map((a) => [a.id, a.name]));

    const duplicateGroups: DuplicateGroup[] = [];
    const usedIds = new Set<string>();

    for (let i = 0; i < userTx.length; i++) {
      const a = userTx[i];
      if (usedIds.has(a.id)) continue;

      const groupMatches: DuplicateGroupItem[] = [];

      for (let j = i + 1; j < userTx.length; j++) {
        const b = userTx[j];
        if (usedIds.has(b.id)) continue;

        // Gleicher Betrag und gleicher Typ
        if (a.amountCents === b.amountCents && a.type === b.type) {
          // Datumsdifferenz maximal 3 Tage (z. B. Kartenzahlung Samstag, Verbuchung Dienstag)
          const timeA = new Date(a.date).getTime();
          const timeB = new Date(b.date).getTime();
          const dayDiff = Math.abs(timeA - timeB) / (1000 * 60 * 60 * 24);

          if (dayDiff <= 3) {
            // Text-Ähnlichkeit prüfen
            const normA = a.description.toLowerCase().replace(/[^a-z0-9]/g, "");
            const normB = b.description.toLowerCase().replace(/[^a-z0-9]/g, "");

            const textMatch =
              normA === normB ||
              normA.includes(normB.slice(0, 6)) ||
              normB.includes(normA.slice(0, 6));

            if (textMatch) {
              groupMatches.push({
                id: b.id,
                date: b.date,
                description: b.description,
                amountCents: b.amountCents,
                type: b.type as "expense" | "income",
                bankAccountName: b.bankAccountId ? accMap.get(b.bankAccountId) || "Konto" : "Manuell",
                bankTransactionId: b.bankTransactionId,
                categoryId: b.categoryId,
              });
              usedIds.add(b.id);
            }
          }
        }
      }

      if (groupMatches.length > 0) {
        usedIds.add(a.id);
        duplicateGroups.push({
          groupId: `dup_${a.id}`,
          amountCents: a.amountCents,
          items: [
            {
              id: a.id,
              date: a.date,
              description: a.description,
              amountCents: a.amountCents,
              type: a.type as "expense" | "income",
              bankAccountName: a.bankAccountId ? accMap.get(a.bankAccountId) || "Konto" : "Manuell",
              bankTransactionId: a.bankTransactionId,
              categoryId: a.categoryId,
            },
            ...groupMatches,
          ],
        });
      }
    }

    return {
      success: true,
      groups: duplicateGroups,
      totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.items.length - 1, 0),
    };
  } catch (err: unknown) {
    return {
      success: false,
      groups: [],
      totalDuplicates: 0,
      error: (err as Error)?.message || "Fehler beim Suchen von Duplikaten.",
    };
  }
}

const splitItemSchema = z.object({
  categoryId: z.string().min(1, "Bitte eine Kategorie wählen."),
  amountCents: z.number().int().positive("Betrag muss größer als 0 sein."),
  description: z.string().max(200).optional().nullable(),
});

const splitTransactionSchema = z.object({
  transactionId: z.string().min(1, "Transaktions-ID fehlt."),
  splits: z
    .array(splitItemSchema)
    .min(2, "Eine Split-Buchung muss aus mindestens 2 Teilen bestehen."),
});

export async function splitTransactionAction(input: {
  transactionId: string;
  splits: Array<{
    categoryId: string;
    amountCents: number;
    description?: string | null;
  }>;
}) {
  const user = await requireUser();
  const parsed = splitTransactionSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Ungültige Split-Eingaben.",
    };
  }

  const { transactionId, splits } = parsed.data;

  if (!userOwnsAllCategories(user.id, splits.map((s) => s.categoryId))) {
    return { success: false, error: "Ungültige Kategorie." };
  }

  const targetTx = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, user.id)))
    .get();

  if (!targetTx) {
    return { success: false, error: "Buchung nicht gefunden oder keine Berechtigung." };
  }

  const splitSum = splits.reduce((acc, s) => acc + s.amountCents, 0);
  if (splitSum !== targetTx.amountCents) {
    const diff = (targetTx.amountCents - splitSum) / 100;
    return {
      success: false,
      error: `Die Summe der Split-Posten stimmt nicht mit dem Gesamtbetrag überein (Differenz: ${diff.toFixed(2)} €).`,
    };
  }

  const now = new Date();

  db.transaction((tx) => {
    tx.delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, targetTx.id))
      .run();

    for (const item of splits) {
      tx.insert(transactionSplits)
        .values({
          id: crypto.randomUUID(),
          transactionId: targetTx.id,
          categoryId: item.categoryId,
          amountCents: item.amountCents,
          description: item.description?.trim() || null,
          createdAt: now,
        })
        .run();
    }

    tx.update(transactions)
      .set({
        isSplit: true,
        updatedAt: now,
      })
      .where(eq(transactions.id, targetTx.id))
      .run();
  });

  safeRevalidatePath("/transactions");
  safeRevalidatePath("/");

  return { success: true };
}

export async function unsplitTransactionAction(transactionId: string) {
  const user = await requireUser();

  const targetTx = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, user.id)))
    .get();

  if (!targetTx) {
    return { success: false, error: "Buchung nicht gefunden." };
  }

  db.transaction((tx) => {
    tx.delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, targetTx.id))
      .run();

    tx.update(transactions)
      .set({
        isSplit: false,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, targetTx.id))
      .run();
  });

  safeRevalidatePath("/transactions");
  safeRevalidatePath("/");

  return { success: true };
}

export async function getTransactionSplitsAction(transactionId: string) {
  const user = await requireUser();

  const targetTx = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, user.id)))
    .get();

  if (!targetTx) {
    return { success: false, error: "Buchung nicht gefunden.", splits: [] };
  }

  const rows = db
    .select({
      id: transactionSplits.id,
      categoryId: transactionSplits.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      amountCents: transactionSplits.amountCents,
      description: transactionSplits.description,
    })
    .from(transactionSplits)
    .innerJoin(
      categories,
      and(eq(transactionSplits.categoryId, categories.id), eq(categories.userId, user.id))
    )
    .where(eq(transactionSplits.transactionId, targetTx.id))
    .all();

  return { success: true, splits: rows };
}

