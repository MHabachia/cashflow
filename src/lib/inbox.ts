import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { and, count, eq } from "drizzle-orm";

/** Anzahl importierter Umsätze, die noch nicht geprüft wurden. */
export function getInboxCount(userId: string): number {
  return (
    db
      .select({ value: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.reviewStatus, "pending")))
      .get()?.value ?? 0
  );
}

/**
 * Leitet aus Händler/Beschreibung ein Suchmuster für eine Kategorie-Regel ab.
 * Regeln prüfen per Teilstring (siehe category-rules.ts), daher werden die
 * ersten Wörter unverändert übernommen – bis zum ersten Wort mit Ziffern
 * (Filialnummern, Referenzen, Datumsangaben).
 */
export function deriveRulePattern(merchant: string | null, description: string): string {
  const source = (merchant || description || "").toLowerCase().replace(/\s+/g, " ").trim();
  const words: string[] = [];
  for (const word of source.split(" ")) {
    if (/\d/.test(word)) break;
    words.push(word);
    if (words.length === 3) break;
  }
  return words.join(" ").replace(/[,|]/g, " ").trim().slice(0, 40);
}
