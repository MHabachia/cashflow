import { MATCH_FIELDS } from "@/lib/db/schema";

export type RuleMatchCandidate = {
  id?: string;
  pattern: string;
  matchField: string;
  categoryId: string;
  costType: string | null;
  priority?: number;
  isActive?: boolean;
};

/**
 * Prüft, ob ein Text (z.B. Empfänger oder Verwendungszweck) mit dem Muster übereinstimmt.
 * Unterstützt Pipe-Trennzeichen ("rewe|edeka|aldi" oder "REWE | edeka | aldi")
 * sowie Komma-Trennzeichen ("rewe, edeka, aldi").
 */
export function checkTextContainsPattern(haystack: string, needle: string): boolean {
  const normHaystack = haystack.toLowerCase();
  const rawNeedle = needle.toLowerCase().trim();
  if (!rawNeedle || !normHaystack) return false;

  // Wenn der Begriff Pipes (|) enthält (z. B. "rewe|edeka|aldi" oder "REWE | edeka | aldi")
  if (rawNeedle.includes("|")) {
    const parts = rawNeedle
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.some((part) => normHaystack.includes(part));
  }

  // Wenn der Begriff Kommas (,) enthält (z. B. "rewe, edeka, aldi")
  if (rawNeedle.includes(",")) {
    const parts = rawNeedle
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.some((part) => normHaystack.includes(part));
  }

  return normHaystack.includes(rawNeedle);
}

/**
 * Prüft, ob ein Text (z.B. Empfänger, Betreff, Verwendungszweck) mit einer Regel übereinstimmt.
 */
export function matchesRule(
  text: string,
  rule: { pattern: string; matchField: string },
  fields?: { merchant?: string | null; description?: string | null; remittance?: string | null }
): boolean {
  const p = rule.pattern;
  if (!p || !p.trim()) return false;

  if (rule.matchField === "merchant") {
    return checkTextContainsPattern(fields?.merchant || text, p);
  }
  if (rule.matchField === "description") {
    return checkTextContainsPattern(fields?.description || text, p);
  }
  if (rule.matchField === "remittance") {
    return checkTextContainsPattern(fields?.remittance || fields?.description || text, p);
  }

  // Fallback / "all": über alle vorhandenen Textfelder suchen
  const combined = `${fields?.merchant || ""} ${fields?.description || ""} ${fields?.remittance || ""} ${text}`.trim();
  return checkTextContainsPattern(combined, p);
}

/**
 * Findet die am besten passende Kategorie anhand der benutzerdefinierten Regeln.
 */
export function findMatchingRule<T extends RuleMatchCandidate>(
  target: {
    merchant?: string | null;
    description?: string | null;
    remittance?: string | null;
  },
  rules: T[]
): T | null {
  const combinedText = `${target.merchant || ""} ${target.description || ""} ${target.remittance || ""}`.trim();

  for (const rule of rules) {
    if (rule.isActive === false) continue;
    if (matchesRule(combinedText, rule, target)) {
      return rule;
    }
  }

  return null;
}
