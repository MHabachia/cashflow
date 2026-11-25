import { parseEuroToCents, todayISO } from "@/lib/format";

// Polyfills für Node.js / Docker-Container ohne Canvas oder Browser-DOM
function ensureNodePdfPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m13 = 0; m14 = 0;
      m21 = 0; m22 = 1; m23 = 0; m24 = 0;
      m31 = 0; m32 = 0; m33 = 1; m34 = 0;
      m41 = 0; m42 = 0; m43 = 0; m44 = 1;
      is2D = true;
      isIdentity = true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_init?: unknown) {}
      multiply() { return this; }
      translate() { return this; }
      scale() { return this; }
      rotate() { return this; }
      transformPoint<T>(p: T): T { return p; }
    };
  }
  if (typeof globalThis.ImageData === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ImageData = class ImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(w = 0, h = 0) {
        this.width = w;
        this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
      }
    };
  }
  if (typeof globalThis.Path2D === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Path2D = class Path2D {
      addPath() {}
    };
  }
}

ensureNodePdfPolyfills();

export interface ParsedStatementTransaction {
  date: string; // YYYY-MM-DD
  amountCents: number; // Cent-Betrag (immer positiv)
  type: "expense" | "income";
  description: string;
  category?: string;
}

const MONTH_NAMES_MAP: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
  mär: "03",
  mai: "05",
  okt: "10",
  dez: "12",
};

// Regex für deutsches Datum (DD.MM.YYYY, DD.MM.YY, DD/MM/YYYY) oder englisches Format (YYYY-MM-DD, June 15, 2026, 15 Jun 2026)
function normalizeStatementDate(raw: string): string {
  const trimmed = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // DD.MM.YYYY
  const deMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    return `${deMatch[3]}-${deMatch[2].padStart(2, "0")}-${deMatch[1].padStart(2, "0")}`;
  }
  // DD.MM.YY (zweistelliges Jahr)
  const deMatchShort = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (deMatchShort) {
    return `20${deMatchShort[3]}-${deMatchShort[2].padStart(2, "0")}-${deMatchShort[1].padStart(2, "0")}`;
  }
  // DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2].padStart(2, "0")}-${slashMatch[1].padStart(2, "0")}`;
  }
  // June 15, 2026 oder Jun 15, 2026
  const eng1 = trimmed.match(/^([a-zäöü]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (eng1) {
    const m = MONTH_NAMES_MAP[eng1[1].toLowerCase()];
    if (m) return `${eng1[3]}-${m}-${eng1[2].padStart(2, "0")}`;
  }
  // 15 June 2026 oder 15 Jun 2026
  const eng2 = trimmed.match(/^(\d{1,2})\.?\s+([a-zäöü]+),?\s+(\d{4})$/i);
  if (eng2) {
    const m = MONTH_NAMES_MAP[eng2[2].toLowerCase()];
    if (m) return `${eng2[3]}-${m}-${eng2[1].padStart(2, "0")}`;
  }
  return todayISO();
}

// Zeilen, die typische Tabellen-Kopfzeilen oder Salden-Zusammenfassungen sind und ignoriert werden sollen
const IGNORED_LINE_PATTERNS = [
  /dear\s+/i,
  /exported date range/i,
  /date\s+counterparty/i,
  /counterparty/i,
  /kaufdatum/i,
  /buchungsdatum/i,
  /transaktionsdetails/i,
  /neuer saldo/i,
  /alter saldo/i,
  /kontostand/i,
  /gesamtfälligkeit/i,
  /rechnungsbetrag/i,
  /zwischensumme/i,
  /mindestbetrag/i,
  /verfügungsrahmen/i,
  /kreditrahmen/i,
  /iban/i,
  /bic/i,
  /kartennummer/i,
  /seite \d+/i,
  /page \d+/i,
];

/**
 * Parst den unformatierten Text aus einem Bank- oder Kreditkarten-Kontoauszug (z. B. Advanzia, ING, DKB, Sparkasse)
 */
export function parseStatementText(text: string): ParsedStatementTransaction[] {
  const lines = text.split(/\r?\n/);
  const results: ParsedStatementTransaction[] = [];

  const DATE_REGEX_STR =
    "(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}[./](?:\\d{4}|\\d{2})|(?:[a-zA-ZäöüÄÖÜ]+)\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}\\.?\\s+(?:[a-zA-ZäöüÄÖÜ]+),?\\s+\\d{4})";
  const AMOUNT_REGEX_STR =
    "([+-]?\\s*\\d{1,3}(?:[.,]\\d{3})*[.,]\\d{2}\\s*(?:EUR|€)?\\s*[+-]?|[+-]?\\s*\\d+[.,]\\d{2}\\s*(?:EUR|€)?\\s*[+-]?|\\d+[.,]\\d{2}\\s*(?:EUR|€)?\\s*[+-SH])$";

  const lineRegex = new RegExp(
    "^(" +
      DATE_REGEX_STR +
      ")(?:\\s+(" +
      DATE_REGEX_STR +
      "))?\\s+(.+?)\\s+" +
      AMOUNT_REGEX_STR,
    "i"
  );

  let lastTx: ParsedStatementTransaction | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Prüfen, ob die Zeile ignoriert werden soll
    if (IGNORED_LINE_PATTERNS.some((pat) => pat.test(line))) {
      continue;
    }

    const match = line.match(lineRegex);
    if (match) {
      const rawDate1 = match[1];
      const descPart = match[3].trim();
      const rawAmount = match[4].trim();

      // Sign / Vorzeichen analysieren
      const isNegative =
        rawAmount.startsWith("-") ||
        rawAmount.endsWith("-") ||
        rawAmount.toUpperCase().endsWith("S");

      const isExplicitPositive =
        rawAmount.startsWith("+") ||
        rawAmount.endsWith("+") ||
        rawAmount.toUpperCase().endsWith("H") ||
        (!isNegative &&
          /gutschrift|rückzahlung|überweisung|einzahlung|crdt|\bpayment\s+received\b/i.test(
            descPart
          ));

      // Bei Kreditkartenabrechnungen: Wenn Minus vorhanden oder nicht explizit positiv -> Ausgabe
      const type: "expense" | "income" =
        !isNegative && isExplicitPositive ? "income" : "expense";

      // Reinen Zahlenwert säubern (z. B. "45,99 -" -> "45,99", "+3.250,00 EUR" -> "3.250,00")
      const cleanAmountStr = rawAmount
        .replace(/EUR|€/gi, "")
        .replace(/[+\-SH]/gi, "")
        .trim();

      const cents = parseEuroToCents(cleanAmountStr);
      if (!cents) continue;

      const date = normalizeStatementDate(rawDate1);
      const cleanDesc = descPart.replace(/\s+/g, " ");

      const tx: ParsedStatementTransaction = {
        date,
        amountCents: cents,
        type,
        description: cleanDesc,
      };

      results.push(tx);
      lastTx = tx;
    } else if (
      lastTx &&
      !line.match(/^\d{1,2}[./]\d{1,2}/) &&
      line.length < 100 &&
      !line.includes("===")
    ) {
      // Mögliche Folgezeile der vorherigen Buchungsbeschreibung (z. B. Verwendungszweck)
      lastTx.description += ` ${line}`;
    }
  }

  return results;
}

/**
 * Wandelt geparste Buchungen in ein internes CSV-Format um,
 * das 1:1 vom existierenden CSV-Importer importiert werden kann.
 */
export function convertParsedTransactionsToCsv(
  transactions: ParsedStatementTransaction[]
): string {
  const header =
    "Datum;Betrag_EUR;Typ;Kostenart;Kategorie;Beschreibung;Zahlungsmethode";
  const rows = transactions.map((t) => {
    const euroVal = (t.amountCents / 100).toFixed(2).replace(".", ",");
    const typVal = t.type === "income" ? "Einnahme" : "Ausgabe";
    const catVal = t.category?.replace(/;/g, " ") || "Sonstiges";
    // Sichere Beschreibung vor Semikolons
    const safeDesc = t.description.replace(/;/g, " ");
    return `${t.date};${euroVal};${typVal};variable;${catVal};${safeDesc};Kreditkarte`;
  });

  return [header, ...rows].join("\n");
}

/**
 * Erkennt anhand des Dateinamens und Inhalts die ausstellende Bank (z. B. Advanzia, TF Bank, ING).
 */
export interface DetectedBankInfo {
  bankKey: "advanzia" | "tfbank" | "ing" | "other";
  bankName: string;
}

export function detectStatementBank(
  text: string,
  fileName?: string
): DetectedBankInfo | null {
  const combined = `${fileName || ""} ${text}`.toLowerCase();
  if (
    combined.includes("advanzia") ||
    combined.includes("gebührenfrei") ||
    combined.includes("gebuehrenfrei") ||
    (combined.includes("counterparty") && combined.includes("exported date range"))
  ) {
    return { bankKey: "advanzia", bankName: "Advanzia Mastercard" };
  }
  if (
    combined.includes("tf bank") ||
    combined.includes("tfbank") ||
    combined.includes("tf-bank")
  ) {
    return { bankKey: "tfbank", bankName: "TF Bank Mastercard" };
  }
  if (
    combined.includes("ing-diba") ||
    combined.includes("ing girokonto") ||
    combined.includes("ing diba")
  ) {
    return { bankKey: "ing", bankName: "ING Girokonto" };
  }
  return null;
}

/**
 * Extrahiert den Text aus einer PDF-Datei und parst die Buchungen.
 * Verwendet unpdf (optimiert für Serverless, Node.js und Next.js ohne Worker- oder Canvas-Probleme).
 */
export async function parsePdfStatement(
  buffer: Buffer | Uint8Array,
  fileName?: string
): Promise<ParsedStatementTransaction[]> {
  const { extractText } = await import("unpdf");
  const res = await extractText(new Uint8Array(buffer));
  const fullText = Array.isArray(res.text)
    ? res.text.join("\n")
    : String(res.text || "");

  return parseStatementText(fullText);
}

export async function parsePdfStatementWithMetadata(
  buffer: Buffer | Uint8Array,
  fileName?: string
): Promise<{
  transactions: ParsedStatementTransaction[];
  detectedBank: DetectedBankInfo | null;
}> {
  const { extractText } = await import("unpdf");
  const res = await extractText(new Uint8Array(buffer));
  const fullText = Array.isArray(res.text)
    ? res.text.join("\n")
    : String(res.text || "");

  const transactions = parseStatementText(fullText);
  const detectedBank = detectStatementBank(fullText, fileName);

  return { transactions, detectedBank };
}
