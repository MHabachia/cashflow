import type { ParsedStatementTransaction } from "@/lib/pdf-statement-parser";
import { UserFacingError } from "@/lib/errors";

/**
 * Parser für ISO-20022-Kontoauszüge (CAMT.053, auch CAMT.052/054), wie sie
 * deutsche Banken im Online-Banking anbieten.
 *
 * Bewusst ohne XML-Bibliothek: Es werden nur die benötigten Elemente gelesen,
 * Namensraum-Präfixe werden ignoriert und Entitäten dekodiert. Externe
 * Entitäten/DTDs werden nie aufgelöst (kein XXE-Risiko).
 */

export interface CamtTransaction extends ParsedStatementTransaction {
  status: "booked" | "pending";
  reference?: string;
  counterparty?: string;
}

export interface CamtStatement {
  iban?: string;
  currency?: string;
  transactions: CamtTransaction[];
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Entfernt Namensraum-Präfixe (`<ns2:Ntry>` → `<Ntry>`), Kommentare und DTDs. */
function normalizeXml(xml: string): string {
  return xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<(\/?)[A-Za-z0-9_.-]+:/g, "<$1");
}

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return Array.from(xml.matchAll(re), (m) => m[1]);
}

function first(xml: string, path: string[]): string | undefined {
  let current: string | undefined = xml;
  for (const tag of path) {
    if (current === undefined) return undefined;
    current = blocks(current, tag)[0];
  }
  return current === undefined ? undefined : decode(current);
}

function amountWithCurrency(xml: string): { value: number; currency?: string } | null {
  const m = xml.match(/<Amt(?:\s+Ccy="([A-Z]{3})")?[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/Amt>/);
  if (!m) return null;
  return { value: Number(m[2]), currency: m[1] };
}

export function isCamtXml(text: string): boolean {
  return /urn:iso:std:iso:20022:tech:xsd:camt\.05[234]/.test(text) || /<(\w+:)?BkToCstmrStmt>/.test(text);
}

export function parseCamtStatement(xmlText: string): CamtStatement {
  const xml = normalizeXml(xmlText);
  if (!/<(BkToCstmrStmt|BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn)>/.test(xml)) {
    throw new UserFacingError("Keine CAMT-Datei (BkToCstmrStmt nicht gefunden).");
  }

  const iban = first(xml, ["Acct", "Id", "IBAN"]);
  const currency = first(xml, ["Acct", "Ccy"]);
  const transactions: CamtTransaction[] = [];

  for (const entry of blocks(xml, "Ntry")) {
    const amount = amountWithCurrency(entry);
    if (!amount || !Number.isFinite(amount.value)) continue;

    const indicator = first(entry, ["CdtDbtInd"]);
    // Storno (RvslInd=true) kehrt die Richtung um
    const reversal = first(entry, ["RvslInd"]) === "true";
    let isCredit = indicator === "CRDT";
    if (reversal) isCredit = !isCredit;

    const statusRaw = first(entry, ["Sts", "Cd"]) ?? first(entry, ["Sts"]) ?? "BOOK";
    const status = /PDNG|INFO/i.test(statusRaw) ? "pending" : "booked";

    const dateRaw =
      first(entry, ["BookgDt", "Dt"]) ??
      first(entry, ["BookgDt", "DtTm"]) ??
      first(entry, ["ValDt", "Dt"]) ??
      first(entry, ["ValDt", "DtTm"]);
    if (!dateRaw) continue;
    const date = dateRaw.slice(0, 10);

    const details = blocks(entry, "TxDtls")[0] ?? entry;
    // Gegenpartei: bei Lastschrift der Zahlungsempfänger, bei Gutschrift der Zahler
    const creditor =
      first(details, ["RltdPties", "Cdtr", "Pty", "Nm"]) ?? first(details, ["RltdPties", "Cdtr", "Nm"]);
    const debtor =
      first(details, ["RltdPties", "Dbtr", "Pty", "Nm"]) ?? first(details, ["RltdPties", "Dbtr", "Nm"]);
    const counterparty = isCredit ? debtor : creditor;

    const remittance = blocks(details, "Ustrd").map(decode).join(" ").trim();
    const additional = first(entry, ["AddtlNtryInf"]);
    const reference = first(entry, ["AcctSvcrRef"]) ?? first(details, ["Refs", "EndToEndId"]);

    const description =
      [counterparty, remittance || additional].filter(Boolean).join(" – ").slice(0, 200) ||
      "Kontoumsatz";

    transactions.push({
      date,
      amountCents: Math.round(amount.value * 100),
      type: isCredit ? "income" : "expense",
      description,
      status,
      reference: reference && reference !== "NOTPROVIDED" ? reference : undefined,
      counterparty,
    });
  }

  return { iban, currency, transactions };
}
