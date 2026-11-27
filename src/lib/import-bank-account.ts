import crypto from "node:crypto";
import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "./db";
import { bankAccounts, connectedBanks } from "./db/schema";
import { UserFacingError } from "./errors";

/**
 * Bewusst KEINE Server Action (kein "use server"): Die Funktion vertraut der
 * übergebenen userId und darf nur serverseitig nach `requireUser()` laufen.
 */

/** Teilstring-Suche ohne Groß-/Kleinschreibung; ohne LIKE, damit % und _ keine Platzhalter sind. */
function containsIgnoreCase(column: SQLWrapper, needle: string) {
  return sql`instr(lower(${column}), ${needle}) > 0`;
}

function searchNeedle(bankName: string, bankKey: string): string {
  if (bankKey === "advanzia") return "advanzia";
  // "tf" allein träfe jedes Konto, dessen Name die Buchstabenfolge enthält
  if (bankKey === "tfbank") return "tf bank";
  return bankName.trim().toLowerCase();
}

/**
 * Findet ein bestehendes Bankkonto des Benutzers oder legt ein dediziertes
 * Import-Konto (z. B. "Advanzia Mastercard" oder "TF Bank Mastercard") an.
 */
export function getOrCreateImportBankAccount(
  userId: string,
  bankName: string,
  bankKey: string
): string {
  const needle = searchNeedle(bankName, bankKey);
  // Ein leerer Suchbegriff würde auf jedes Konto passen
  if (!needle) {
    throw new UserFacingError("Bankname für das Import-Konto fehlt.");
  }

  const existing = db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.userId, userId),
        containsIgnoreCase(bankAccounts.accountName, needle)
      )
    )
    .get();

  if (existing) {
    return existing.id;
  }

  const now = new Date();

  // Sicherstellen, dass eine verbundene Bank existiert (FK-Integrität)
  let bank = db
    .select({ id: connectedBanks.id })
    .from(connectedBanks)
    .where(
      and(
        eq(connectedBanks.userId, userId),
        containsIgnoreCase(connectedBanks.institutionName, needle)
      )
    )
    .get();

  if (!bank) {
    const newBankId = crypto.randomUUID();
    db.insert(connectedBanks)
      .values({
        id: newBankId,
        userId,
        provider: "enable_banking",
        institutionId: bankKey,
        institutionName: bankName,
        encryptedAccessToken: "manual_import",
        consentId: "manual_import",
        consentExpiresAt: "2099-12-31",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    bank = { id: newBankId };
  }

  const newId = crypto.randomUUID();
  db.insert(bankAccounts)
    .values({
      id: newId,
      userId,
      connectedBankId: bank.id,
      accountExternalId: `manual_${bankKey}_${crypto.randomBytes(4).toString("hex")}`,
      ibanMasked:
        bankKey === "advanzia"
          ? "Advanzia Mastercard"
          : bankKey === "tfbank"
            ? "TF Bank Mastercard"
            : "Importiertes Konto",
      accountName: bankName,
      accountType: "credit_card",
      currency: "EUR",
      balanceCents: null,
      autoSync: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return newId;
}
