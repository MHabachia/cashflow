import { z } from "zod";

/**
 * Gemeinsame Bausteine für die Eingabeprüfung in Server Actions.
 * Server Actions sind öffentlich aufrufbare Endpunkte: TypeScript-Typen
 * gelten dort nicht, der Client kann beliebiges JSON schicken
 * (z. B. Strings statt Zahlen oder Kommazahlen in Cent-Feldern).
 */

/** Obergrenze für Beträge: 1 Milliarde Euro in Cent. */
export const MAX_ABS_CENTS = 100_000_000_000;

/** Betrag in Cent, ganzzahlig, darf negativ sein (z. B. Saldo einer Kreditkarte). */
export const signedCentsSchema = z
  .number({ error: "Ungültiger Betrag." })
  .int("Betrag muss in ganzen Cent angegeben werden.")
  .min(-MAX_ABS_CENTS, "Betrag ist zu groß.")
  .max(MAX_ABS_CENTS, "Betrag ist zu groß.");

export const nonNegativeCentsSchema = signedCentsSchema.min(0, "Betrag darf nicht negativ sein.");

export const positiveCentsSchema = signedCentsSchema.min(1, "Betrag muss größer als 0 sein.");

function isRealCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** Kalenderdatum im Format YYYY-MM-DD, das es tatsächlich gibt (kein 30.02.). */
export const isoDateSchema = z
  .string({ error: "Ungültiges Datum." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum (erwartet: JJJJ-MM-TT).")
  .refine(isRealCalendarDate, "Ungültiges Datum.");

/** Datensatz-ID aus dem Client (UUID oder ähnlich). */
export const idSchema = z.string({ error: "Ungültige ID." }).min(1, "ID fehlt.").max(100);

/** Liste von IDs für Massenaktionen, nach oben begrenzt. */
export const idListSchema = z
  .array(idSchema)
  .min(1, "Keine Einträge ausgewählt.")
  .max(5000, "Zu viele Einträge auf einmal ausgewählt.");

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ungültige Farbe.");

/** Optionaler Freitext: leer oder null wird zu null. */
export function optionalText(max: number) {
  return z
    .string()
    .max(max, `Text ist zu lang (höchstens ${max} Zeichen).`)
    .nullable()
    .optional();
}

/** Erste Fehlermeldung eines fehlgeschlagenen safeParse für die Oberfläche. */
export function firstIssueMessage(error: z.ZodError, fallback = "Ungültige Eingaben."): string {
  return error.issues[0]?.message || fallback;
}
