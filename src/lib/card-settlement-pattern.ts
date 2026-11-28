/**
 * Reine Hilfsfunktionen zum Erkennungsbegriff des Kartenausgleichs.
 * Ohne Datenbankzugriff, damit auch der Konto-Dialog im Browser sie nutzen kann.
 */

export const MIN_SETTLEMENT_PATTERN_LENGTH = 4;

export function normalizeSettlementPattern(pattern: string | null | undefined): string {
  return (pattern ?? "").trim().toLowerCase();
}

export function matchesSettlementPattern(text: string, pattern: string): boolean {
  const needle = normalizeSettlementPattern(pattern);
  return needle.length >= MIN_SETTLEMENT_PATTERN_LENGTH && text.toLowerCase().includes(needle);
}

/** Vorschlag aus dem Kartennamen: erstes Wort mit mindestens 4 Zeichen. */
export function suggestSettlementPattern(accountName: string): string {
  const word = accountName
    .split(/[^\p{L}\p{N}]+/u)
    .find((w) => w.length >= MIN_SETTLEMENT_PATTERN_LENGTH);
  return word ? word.toLowerCase() : "";
}
