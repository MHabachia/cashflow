import { normalizeMerchant } from "@/lib/subscription-detection";

/**
 * Zuordnung echter Bankumsätze zu Fixkosten-Vorlagen.
 *
 * Bisher mussten Betrag exakt und Name wörtlich übereinstimmen – bei jeder
 * Preisänderung oder abweichender Empfängerschreibweise entstand eine
 * Dublette (automatische Buchung + Bankumsatz). Jetzt:
 * - Name: normalisierter Händlername (ohne Rechtsform, Ziffern, Referenzen)
 * - Betrag: Abweichung bis 15 % bzw. 3 € (Preisänderungen)
 * - Bei mehreren Kandidaten gewinnt der mit dem nächsten Betrag
 */

export const RECURRING_MATCH_WINDOW_DAYS = 10;

export interface RecurringCandidate {
  id: string;
  name: string;
  amountCents: number;
  categoryId: string;
  type: "expense" | "income";
}

export function amountWithinTolerance(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) <= Math.max(expected * 0.15, 300);
}

export function namesMatch(recurringName: string, bankText: string): boolean {
  const key = normalizeMerchant(recurringName, recurringName);
  const text = normalizeMerchant(bankText, bankText);
  if (key.length < 3 || text.length < 3) {
    return bankText.toLowerCase().includes(recurringName.toLowerCase().trim());
  }
  return (
    text.includes(key) ||
    key.includes(text) ||
    bankText.toLowerCase().includes(recurringName.toLowerCase().trim())
  );
}

export function findMatchingRecurring<T extends RecurringCandidate>(
  candidates: T[],
  tx: { type: "expense" | "income"; amountCents: number; text: string }
): T | undefined {
  return candidates
    .filter(
      (r) =>
        r.type === tx.type &&
        amountWithinTolerance(r.amountCents, tx.amountCents) &&
        namesMatch(r.name, tx.text)
    )
    .sort(
      (a, b) =>
        Math.abs(a.amountCents - tx.amountCents) - Math.abs(b.amountCents - tx.amountCents)
    )[0];
}

export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
