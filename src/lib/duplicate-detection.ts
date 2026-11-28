/**
 * Erkennung möglicher Dubletten: gleicher Betrag, gleicher Typ, Datum höchstens
 * 3 Tage auseinander (z. B. Kartenzahlung Samstag, Verbuchung Dienstag) und
 * ähnlicher Text.
 *
 * Verglichen wird nur innerhalb von Gruppen mit gleichem Betrag und Typ, und
 * innerhalb einer Gruppe nur, solange das Datum im Fenster liegt. Vorher wurde
 * jede Buchung mit jeder verglichen (bei 50.000 Buchungen rund 9 s). Ergebnis
 * und Reihenfolge der Gruppen bleiben gleich.
 */

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

export interface DuplicateCandidate {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  type: "expense" | "income";
  bankAccountId: string | null;
  bankTransactionId: string | null;
  categoryId: string;
}

const MAX_DAY_DIFF = 3;
const DAY_MS = 1000 * 60 * 60 * 24;

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function textsMatch(normA: string, normB: string): boolean {
  return normA === normB || normA.includes(normB.slice(0, 6)) || normB.includes(normA.slice(0, 6));
}

/**
 * @param rows Buchungen aufsteigend nach Datum sortiert
 * @param accountNames Kontoname je Konto-ID
 */
export function findDuplicateGroups(
  rows: DuplicateCandidate[],
  accountNames: Map<string, string>
): DuplicateGroup[] {
  const prepared = rows.map((row) => ({
    row,
    time: new Date(row.date).getTime(),
    norm: normalizeText(row.description),
  }));
  type Prepared = (typeof prepared)[number];

  // Gruppen mit gleichem Betrag und Typ, jeweils in der Reihenfolge der Eingabe
  const buckets = new Map<string, Prepared[]>();
  const positionInBucket = new Map<Prepared, number>();
  for (const entry of prepared) {
    const key = `${entry.row.type}:${entry.row.amountCents}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    positionInBucket.set(entry, bucket.length);
    bucket.push(entry);
  }

  const toItem = (row: DuplicateCandidate): DuplicateGroupItem => ({
    id: row.id,
    date: row.date,
    description: row.description,
    amountCents: row.amountCents,
    type: row.type,
    bankAccountName: row.bankAccountId ? accountNames.get(row.bankAccountId) || "Konto" : "Manuell",
    bankTransactionId: row.bankTransactionId,
    categoryId: row.categoryId,
  });

  const groups: DuplicateGroup[] = [];
  const usedIds = new Set<string>();

  // Äußere Schleife in Eingabereihenfolge, damit die Gruppen wie bisher sortiert sind
  for (const a of prepared) {
    if (usedIds.has(a.row.id)) continue;
    const bucket = buckets.get(`${a.row.type}:${a.row.amountCents}`)!;
    const matches: DuplicateGroupItem[] = [];

    for (let j = positionInBucket.get(a)! + 1; j < bucket.length; j++) {
      const b = bucket[j];
      const dayDiff = Math.abs(b.time - a.time) / DAY_MS;
      // Aufsteigend sortiert: Ab hier liegen alle weiteren außerhalb des Fensters
      if (dayDiff > MAX_DAY_DIFF) break;
      // Ungültiges Datum (NaN) zählt wie bisher nie als Treffer
      if (!(dayDiff <= MAX_DAY_DIFF)) continue;
      if (usedIds.has(b.row.id)) continue;
      if (!textsMatch(a.norm, b.norm)) continue;
      matches.push(toItem(b.row));
      usedIds.add(b.row.id);
    }

    if (matches.length > 0) {
      usedIds.add(a.row.id);
      groups.push({
        groupId: `dup_${a.row.id}`,
        amountCents: a.row.amountCents,
        items: [toItem(a.row), ...matches],
      });
    }
  }
  return groups;
}
