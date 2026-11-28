import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateGroups,
  type DuplicateCandidate,
  type DuplicateGroup,
  type DuplicateGroupItem,
} from "../../src/lib/duplicate-detection";

/** Bisheriger Vergleich jeder Buchung mit jeder, als Referenz für das Ergebnis. */
function referenceGroups(userTx: DuplicateCandidate[], accMap: Map<string, string>): DuplicateGroup[] {
  const toItem = (t: DuplicateCandidate): DuplicateGroupItem => ({
    id: t.id,
    date: t.date,
    description: t.description,
    amountCents: t.amountCents,
    type: t.type,
    bankAccountName: t.bankAccountId ? accMap.get(t.bankAccountId) || "Konto" : "Manuell",
    bankTransactionId: t.bankTransactionId,
    categoryId: t.categoryId,
  });
  const groups: DuplicateGroup[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < userTx.length; i++) {
    const a = userTx[i];
    if (usedIds.has(a.id)) continue;
    const matches: DuplicateGroupItem[] = [];
    for (let j = i + 1; j < userTx.length; j++) {
      const b = userTx[j];
      if (usedIds.has(b.id)) continue;
      if (a.amountCents !== b.amountCents || a.type !== b.type) continue;
      const dayDiff = Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) / 86400000;
      if (dayDiff > 3 || Number.isNaN(dayDiff)) continue;
      const normA = a.description.toLowerCase().replace(/[^a-z0-9]/g, "");
      const normB = b.description.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normA === normB || normA.includes(normB.slice(0, 6)) || normB.includes(normA.slice(0, 6))) {
        matches.push(toItem(b));
        usedIds.add(b.id);
      }
    }
    if (matches.length > 0) {
      usedIds.add(a.id);
      groups.push({ groupId: `dup_${a.id}`, amountCents: a.amountCents, items: [toItem(a), ...matches] });
    }
  }
  return groups;
}

/** Deterministischer Zufall, damit ein Fehlschlag reproduzierbar ist. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomRows(count: number, seed: number, spread = { days: 40, amounts: [999, 1500, 4200] }): DuplicateCandidate[] {
  const rand = seededRandom(seed);
  const texts = ["REWE Markt", "rewe markt gmbh", "Spotify AB", "SPOTIFY", "Miete", "", "Amazon Mktp", "amazon"];
  const rows: DuplicateCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const day = 1 + Math.floor(rand() * spread.days);
    const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
    rows.push({
      id: `t${i}`,
      date,
      description: texts[Math.floor(rand() * texts.length)],
      amountCents: spread.amounts[Math.floor(rand() * spread.amounts.length)],
      type: rand() < 0.8 ? "expense" : "income",
      bankAccountId: rand() < 0.5 ? "acc" : null,
      bankTransactionId: rand() < 0.3 ? `b${i}` : null,
      categoryId: "c",
    });
  }
  // Wie die Abfrage: aufsteigend nach Datum, gleiche Tage in Eingabereihenfolge
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

const accounts = new Map([["acc", "Girokonto"]]);

describe("Duplikatsuche", () => {
  it("liefert dieselben Gruppen in derselben Reihenfolge wie der bisherige Vergleich", () => {
    for (const seed of [1, 7, 42, 2026]) {
      const rows = randomRows(400, seed);
      assert.deepEqual(findDuplicateGroups(rows, accounts), referenceGroups(rows, accounts), `Seed ${seed}`);
    }
  });

  it("erkennt Dubletten nur innerhalb von 3 Tagen", () => {
    const base = { amountCents: 1299, type: "expense" as const, bankAccountId: null, bankTransactionId: null, categoryId: "c" };
    const rows: DuplicateCandidate[] = [
      { ...base, id: "a", date: "2026-03-01", description: "Netflix" },
      { ...base, id: "b", date: "2026-03-04", description: "NETFLIX.COM" },
      { ...base, id: "c", date: "2026-03-09", description: "Netflix" },
    ];
    const groups = findDuplicateGroups(rows, accounts);
    assert.deepEqual(groups.map((g) => g.items.map((i) => i.id)), [["a", "b"]]);
  });

  it("vergleicht keine unterschiedlichen Beträge oder Typen", () => {
    const base = { date: "2026-03-01", description: "Gehalt", bankAccountId: null, bankTransactionId: null, categoryId: "c" };
    const rows: DuplicateCandidate[] = [
      { ...base, id: "a", amountCents: 100, type: "expense" },
      { ...base, id: "b", amountCents: 100, type: "income" },
      { ...base, id: "c", amountCents: 101, type: "expense" },
    ];
    assert.deepEqual(findDuplicateGroups(rows, accounts), []);
  });

  it("ein ungültiges Datum zählt nie als Treffer", () => {
    const base = { amountCents: 500, type: "expense" as const, description: "Bäcker", bankAccountId: null, bankTransactionId: null, categoryId: "c" };
    const rows: DuplicateCandidate[] = [
      { ...base, id: "a", date: "kein-datum" },
      { ...base, id: "b", date: "2026-03-01" },
    ];
    assert.deepEqual(findDuplicateGroups(rows, accounts), referenceGroups(rows, accounts));
    assert.deepEqual(findDuplicateGroups(rows, accounts), []);
  });

  it("bleibt bei vielen Buchungen schnell", () => {
    // Etwa sieben Jahre mit typischer Streuung der Beträge
    const amounts = Array.from({ length: 2000 }, (_, i) => 100 + i * 7);
    const rows = randomRows(50_000, 3, { days: 2500, amounts });
    const start = performance.now();
    findDuplicateGroups(rows, accounts);
    const elapsed = performance.now() - start;
    // Großzügige Grenze für langsame CI-Rechner; der alte Vergleich brauchte rund 9 s
    assert.ok(elapsed < 2000, `${elapsed.toFixed(0)} ms`);
  });
});
