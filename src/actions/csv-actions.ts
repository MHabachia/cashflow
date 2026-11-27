"use server";

import { db } from "@/lib/db";
import {
  categories,
  transactions,
  bankAccounts,
  categoryRules,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/errors";
import { parseEuroToCents, todayISO } from "@/lib/format";
import { findMatchingRule } from "@/lib/category-rules";
import { detectOwnAccountTransfers } from "@/lib/transfer-detection";
import { getOrCreateImportBankAccount } from "@/lib/import-bank-account";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // In Unit Tests ist revalidatePath ein No-Op
  }
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // DD.MM.YYYY
  const deMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    const d = deMatch[1].padStart(2, "0");
    const m = deMatch[2].padStart(2, "0");
    const y = deMatch[3];
    return `${y}-${m}-${d}`;
  }
  // DD.MM.YY (zweistelliges Jahr)
  const deMatchShort = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (deMatchShort) {
    const d = deMatchShort[1].padStart(2, "0");
    const m = deMatchShort[2].padStart(2, "0");
    const y = `20${deMatchShort[3]}`;
    return `${y}-${m}-${d}`;
  }
  // DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const d = slashMatch[1].padStart(2, "0");
    const m = slashMatch[2].padStart(2, "0");
    const y = slashMatch[3];
    return `${y}-${m}-${d}`;
  }
  return todayISO();
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export type CsvImportResult =
  | {
    success: true;
    importedCount: number;
    skippedDuplicates: number;
  }
  | {
    success: false;
    error: string;
  };

export async function importCsvTransactionsAction(
  csvText: string,
  targetBankAccountId?: string | null,
  updateBalance: boolean = false
): Promise<CsvImportResult> {
  const user = await requireUser();

  // Die Konto-ID kommt vom Client: Nur eigene Konten sind als Ziel erlaubt
  if (targetBankAccountId) {
    const ownAccount = db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, targetBankAccountId),
          eq(bankAccounts.userId, user.id)
        )
      )
      .get();
    if (!ownAccount) {
      return { success: false, error: "Das gewählte Konto wurde nicht gefunden." };
    }
  }

  const cleanText = csvText.replace(/^\uFEFF/, "").trim();
  if (!cleanText) {
    return { success: false, error: "Die CSV-Datei ist leer." };
  }

  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      success: false,
      error: "Die CSV-Datei enthält keine Datenzeilen.",
    };
  }

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map((h) =>
    h.toLowerCase().trim()
  );

  const idxDate = headers.findIndex(
    (h) =>
      h.includes("datum") ||
      h.includes("date") ||
      h.includes("zeitpunkt") ||
      h.includes("tag") ||
      h.includes("valuta")
  );
  const idxAmount = headers.findIndex(
    (h) =>
      h.includes("betrag") ||
      h.includes("amount") ||
      h.includes("eur") ||
      h.includes("umsatz") ||
      h.includes("saldo") ||
      h.includes("wert") ||
      h.includes("preis")
  );
  const idxType = headers.findIndex(
    (h) =>
      h === "typ" ||
      h === "type" ||
      h.includes("soll/haben") ||
      h.includes("s/h") ||
      h.includes("buchungsart") ||
      h.includes("art")
  );
  const idxCostType = headers.findIndex(
    (h) => h.includes("kostenart") || h.includes("cost")
  );
  const idxCat = headers.findIndex(
    (h) =>
      h.includes("kategorie") ||
      h.includes("category") ||
      h.includes("rubrik")
  );
  const idxDesc = headers.findIndex(
    (h) =>
      h.includes("beschreibung") ||
      h.includes("description") ||
      h.includes("buchungstext") ||
      h.includes("verwendungszweck") ||
      h.includes("zweck") ||
      h.includes("text") ||
      h.includes("händler") ||
      h.includes("haendler") ||
      h.includes("empfänger") ||
      h.includes("empfaenger") ||
      h.includes("auftraggeber") ||
      h.includes("partner") ||
      h.includes("details") ||
      h.includes("transaktion")
  );
  const idxPayment = headers.findIndex(
    (h) => h.includes("zahlung") || h.includes("payment") || h.includes("methode")
  );

  if (idxAmount === -1) {
    return {
      success: false,
      error:
        "Spalte 'Betrag' oder 'Umsatz' wurde in der CSV-Kopfzeile nicht gefunden.",
    };
  }

  const userCategories = db
    .select()
    .from(categories)
    .where(eq(categories.userId, user.id))
    .all();

  const userRules = db
    .select()
    .from(categoryRules)
    .where(
      and(eq(categoryRules.userId, user.id), eq(categoryRules.isActive, true))
    )
    .orderBy(desc(categoryRules.priority))
    .all();

  const catByName = new Map<string, string>(
    userCategories.map((c) => [c.name.toLowerCase(), c.id])
  );
  const fallbackCatId = userCategories[0]?.id;

  let importedCount = 0;
  let skippedDuplicates = 0;
  let netDeltaCents = 0;
  const now = new Date();

  // Wie oft eine (Datum, Betrag, Typ, Text)-Kombination in dieser Datei schon
  // vorkam – zwei gleiche Käufe am selben Tag sind legitim und werden nur
  // übersprungen, soweit sie für dieses Konto bereits gespeichert sind.
  const fileOccurrences = new Map<string, number>();

  // Ohne Typ-Spalte entscheidet das Vorzeichen, sofern die Datei überhaupt
  // Vorzeichen nutzt (Kontoauszug: "-49,99" Ausgabe, "2.500,00" Einnahme).
  // Reine Ausgabenlisten ohne Minuszeichen bleiben wie bisher Ausgaben.
  const isNegativeAmount = (raw: string) => raw.trim().startsWith("-");
  const typeFromSign =
    idxType === -1 &&
    lines.slice(1).some((line) => isNegativeAmount(splitCsvLine(line, delimiter)[idxAmount] || ""));

  db.transaction((tx) => {
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i], delimiter);
      if (cols.length === 0) continue;

      const rawAmount = cols[idxAmount] || "";
      const rawType = (idxType >= 0 ? cols[idxType] : "").toLowerCase();
      const isExplicitIncome =
        rawType.includes("einnahme") ||
        rawType === "income" ||
        rawType.includes("haben") ||
        rawType === "h" ||
        rawType.includes("gutschrift") ||
        rawType.includes("crdt");

      const type: "expense" | "income" =
        isExplicitIncome || (typeFromSign && !isNegativeAmount(rawAmount)) ? "income" : "expense";
      const amountCents = parseEuroToCents(rawAmount.replace(/^[+-]/, ""));
      if (!amountCents) continue;

      const date =
        idxDate >= 0 ? normalizeDate(cols[idxDate] || "") : todayISO();

      const rawCostType = (
        idxCostType >= 0 ? cols[idxCostType] : ""
      ).toLowerCase();
      let costType: "variable" | "fixed" =
        rawCostType.includes("fix") || rawCostType === "fixed"
          ? "fixed"
          : "variable";

      const rawCatName = (idxCat >= 0 ? cols[idxCat] : "").trim();
      let categoryId =
        catByName.get(rawCatName.toLowerCase()) || fallbackCatId || "";

      if (rawCatName && !catByName.has(rawCatName.toLowerCase())) {
        const newCatId = crypto.randomUUID();
        tx.insert(categories)
          .values({
            id: newCatId,
            userId: user.id,
            name: rawCatName,
            color: "#3b82f6",
            icon: "ShoppingCart",
            type,
            sortOrder: 50,
            isDefault: false,
            isArchived: false,
            createdAt: now,
          })
          .run();
        catByName.set(rawCatName.toLowerCase(), newCatId);
        categoryId = newCatId;
      }

      const description =
        (idxDesc >= 0 ? cols[idxDesc] : "")?.trim() ||
        rawCatName ||
        "Kartenabrechnung";

      // Prüfen, ob eine benutzerdefinierte Auto-Kategorisierungs-Regel zutrifft
      const matchingRule = findMatchingRule(
        {
          merchant: description,
          description,
        },
        userRules
      );

      if (matchingRule) {
        categoryId = matchingRule.categoryId;
        if (matchingRule.costType) {
          costType = matchingRule.costType as "variable" | "fixed";
        }
      }

      // Deduplizierung je Konto mit Vorkommenszählung (Re-Import idempotent,
      // mehrere gleiche Käufe am selben Tag bleiben erhalten)
      const dedupeKey = `${date}|${amountCents}|${type}|${description}`;
      const occurrence = fileOccurrences.get(dedupeKey) ?? 0;
      fileOccurrences.set(dedupeKey, occurrence + 1);
      const alreadyStored =
        tx
          .select({ value: sql<number>`count(*)` })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, user.id),
              eq(transactions.date, date),
              eq(transactions.amountCents, amountCents),
              eq(transactions.type, type),
              eq(transactions.description, description),
              targetBankAccountId
                ? eq(transactions.bankAccountId, targetBankAccountId)
                : isNull(transactions.bankAccountId)
            )
          )
          .get()?.value ?? 0;

      if (occurrence < alreadyStored) {
        skippedDuplicates++;
        continue;
      }

      const rawPayment = (idxPayment >= 0 ? cols[idxPayment] : "")
        .trim()
        .toLowerCase() as PaymentMethod;
      const paymentMethod: PaymentMethod = (
        PAYMENT_METHODS as readonly string[]
      ).includes(rawPayment)
        ? rawPayment
        : "card";

      const newTxId = crypto.randomUUID();
      tx.insert(transactions)
        .values({
          id: newTxId,
          userId: user.id,
          categoryId,
          type,
          costType,
          amountCents,
          date,
          description,
          paymentMethod,
          bankAccountId: targetBankAccountId || null,
          reviewStatus: "pending",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      importedCount++;
      netDeltaCents += (type === "income" ? amountCents : -amountCents);

    }

    if (updateBalance && targetBankAccountId && netDeltaCents !== 0) {
      const acc = tx
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, targetBankAccountId),
            eq(bankAccounts.userId, user.id)
          )
        )
        .get();
      if (acc) {
        const currentBalance = acc.balanceCents ?? 0;
        tx.update(bankAccounts)
          .set({
            balanceCents: currentBalance + netDeltaCents,
            updatedAt: now,
          })
          .where(
            and(
              eq(bankAccounts.id, targetBankAccountId),
              eq(bankAccounts.userId, user.id)
            )
          )
          .run();
      }
    }
  });

  // Umbuchungen zwischen eigenen Konten erkennen (z. B. Giro-Export + Tagesgeld-Export)
  if (importedCount > 0 && targetBankAccountId) {
    try {
      detectOwnAccountTransfers(user.id, "2000-01-01");
    } catch {
      // nicht blockierend
    }
  }

  safeRevalidatePath("/");
  safeRevalidatePath("/transactions");
  safeRevalidatePath("/categories");
  safeRevalidatePath("/banking");

  return {
    success: true,
    importedCount,
    skippedDuplicates,
  };
}

export type StatementImportResult =
  | {
    success: true;
    importedCount: number;
    skippedDuplicates: number;
    format: "pdf" | "csv" | "camt";
  }
  | {
    success: false;
    error: string;
    format?: "pdf" | "csv" | "camt";
  };

export async function importStatementFileAction(
  formData: FormData
): Promise<StatementImportResult> {
  const user = await requireUser();
  const file = formData.get("file");
  const explicitBankAccountId = (formData.get("bankAccountId") as string | null) || null;
  const updateBalance = formData.get("updateBalance") === "true";

  if (!file || typeof file === "string") {
    return { success: false, error: "Keine Datei ausgewählt." };
  }

  const blob = file as File;
  const fileName = blob.name.toLowerCase();
  const isPdf = fileName.endsWith(".pdf") || blob.type === "application/pdf";

  if (isPdf) {
    try {
      const {
        parsePdfStatementWithMetadata,
        convertParsedTransactionsToCsv,
      } = await import("@/lib/pdf-statement-parser");
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const { transactions: txs, detectedBank } =
        await parsePdfStatementWithMetadata(buffer, fileName);

      if (txs.length === 0) {
        return {
          success: false,
          error:
            "Es konnten keine Buchungen im PDF-Kontoauszug gefunden werden. Bitte prüfe, ob die Datei lesbaren Text enthält.",
          format: "pdf",
        };
      }

      let targetBankAccountId = explicitBankAccountId;
      if (!targetBankAccountId && detectedBank) {
        targetBankAccountId = getOrCreateImportBankAccount(
          user.id,
          detectedBank.bankName,
          detectedBank.bankKey
        );
      }

      const csvText = convertParsedTransactionsToCsv(txs);
      const res = await importCsvTransactionsAction(csvText, targetBankAccountId, updateBalance);
      if (!res.success) {
        return {
          success: false,
          error: res.error,
          format: "pdf",
        };
      }
      return {
        success: true,
        importedCount: res.importedCount,
        skippedDuplicates: res.skippedDuplicates,
        format: "pdf",
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: publicErrorMessage(
          err,
          "Der PDF-Kontoauszug konnte nicht verarbeitet werden.",
          "csv-actions:pdf"
        ),
        format: "pdf",
      };
    }
  }

  // CAMT.053/052 (ISO-20022-XML) – Kontoauszug im Bankenstandard
  const looksLikeXml = fileName.endsWith(".xml") || blob.type.includes("xml");
  if (looksLikeXml) {
    try {
      const text = await blob.text();
      const { isCamtXml, parseCamtStatement } = await import("@/lib/camt-parser");
      if (!isCamtXml(text)) {
        return {
          success: false,
          error: "Die XML-Datei ist kein CAMT-Kontoauszug (camt.052/053/054).",
          format: "camt",
        };
      }
      const statement = parseCamtStatement(text);
      // Nur gebuchte Umsätze übernehmen; vorgemerkte ändern sich noch
      const booked = statement.transactions.filter((t) => t.status === "booked");
      if (booked.length === 0) {
        return {
          success: false,
          error: "Im CAMT-Kontoauszug wurden keine gebuchten Umsätze gefunden.",
          format: "camt",
        };
      }

      let targetBankAccountId = explicitBankAccountId;
      if (!targetBankAccountId && statement.iban) {
        // Konto über die letzten vier IBAN-Stellen zuordnen
        const last4 = statement.iban.replace(/\s+/g, "").slice(-4);
        const match = db
          .select({ id: bankAccounts.id, iban: bankAccounts.ibanMasked })
          .from(bankAccounts)
          .where(eq(bankAccounts.userId, user.id))
          .all()
          .find((a) => (a.iban || "").replace(/\s+/g, "").endsWith(last4));
        targetBankAccountId = match?.id ?? null;
      }

      const { convertParsedTransactionsToCsv } = await import("@/lib/pdf-statement-parser");
      const res = await importCsvTransactionsAction(
        convertParsedTransactionsToCsv(booked),
        targetBankAccountId,
        updateBalance
      );
      if (!res.success) {
        return { success: false, error: res.error, format: "camt" };
      }
      return {
        success: true,
        importedCount: res.importedCount,
        skippedDuplicates: res.skippedDuplicates,
        format: "camt",
      };
    } catch (err) {
      return {
        success: false,
        error: publicErrorMessage(
          err,
          "Die CAMT-Datei konnte nicht verarbeitet werden.",
          "csv-actions:camt"
        ),
        format: "camt",
      };
    }
  }

  // Standard CSV-Verarbeitung
  try {
    const text = await blob.text();
    const { detectStatementBank } = await import("@/lib/pdf-statement-parser");
    const detected = detectStatementBank(text, fileName);

    let targetBankAccountId = explicitBankAccountId;
    if (!targetBankAccountId && detected) {
      targetBankAccountId = getOrCreateImportBankAccount(
        user.id,
        detected.bankName,
        detected.bankKey
      );
    }

    const res = await importCsvTransactionsAction(text, targetBankAccountId, updateBalance);
    if (!res.success) {
      return {
        success: false,
        error: res.error,
        format: "csv",
      };
    }
    return {
      success: true,
      importedCount: res.importedCount,
      skippedDuplicates: res.skippedDuplicates,
      format: "csv",
    };
  } catch {
    return {
      success: false,
      error: "Fehler beim Lesen der CSV-Datei.",
      format: "csv",
    };
  }
}
