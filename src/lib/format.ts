const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formatiert Integer-Cent in deutsches Währungsformat (z.B. 123456 -> "1.234,56 €")
 */
export function formatCents(cents: number): string {
  return eurFormatter.format(cents / 100);
}

/**
 * Formatiert Integer-Cent für ein Input-Feld (z.B. 1250 -> "12,50")
 */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Parst deutsche oder englische Betragseingaben ("12,50", "1.234,56", "12.5") sicher zu Integer-Cent
 */
export function parseEuroToCents(input: string | number): number | null {
  if (typeof input === "number") {
    if (Number.isNaN(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  const raw = input.trim().replace(/\s|€/g, "");
  if (!raw) return null;

  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) {
    // Deutsches Format mit Tausenderpunkt: 1.234,56 -> 1234.56
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    normalized = raw.replace(",", ".");
  }

  const parsed = Number(normalized);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed * 100);
}

/**
 * Parst vorzeichenbehaftete Beträge ("-450,00", "+120,50", "0") sicher zu Integer-Cent
 */
export function parseSignedCents(input: string | number): number | null {
  if (typeof input === "number") {
    if (Number.isNaN(input) || !Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const raw = input.trim().replace(/\s|€/g, "");
  if (!raw) return null;
  const isNegative = raw.startsWith("-");
  const clean = raw.replace(/^[+-]/, "");
  if (clean === "0" || clean === "0,00" || clean === "0.00") return 0;
  const cents = parseEuroToCents(clean);
  if (cents === null) return null;
  return isNegative ? -cents : cents;
}

/**
 * Formatiert ein ISO-Datum (YYYY-MM-DD) ins deutsche Format (DD.MM.YYYY)
 */
export function formatDateDE(isoDate: string): string {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

/**
 * Gibt das heutige Datum als YYYY-MM-DD zurück
 */
export function todayISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  apple_pay: "Apple Pay",
  card: "Kartenzahlung",
  cash: "Bargeld",
  direct_debit: "Lastschrift",
  transfer: "Überweisung",
  paypal: "PayPal",
  other: "Sonstiges",
};

export const INTERVAL_LABELS: Record<string, string> = {
  weekly: "Wöchentlich",
  monthly: "Monatlich",
  quarterly: "Vierteljährlich",
  half_yearly: "Halbjährlich",
  yearly: "Jährlich",
};

/**
 * Schützt zusätzlich vor CSV-Formula-Injection (Excel / Apple Numbers DDE-Injektion),
 * wenn ein Textfeld mit =, +, -, @, Tab oder CR beginnt.
 */
export function escapeCsvField(val: string | number | null | undefined): string {
  let str = val === null || val === undefined ? "" : String(val);

  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (str.includes(";") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

