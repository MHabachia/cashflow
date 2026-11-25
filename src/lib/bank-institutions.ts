export interface BankInstitution {
  id: string;
  name: string;
  brandColor: string;
  category: "giro" | "credit_card" | "both";
  description: string;
  supportedTypes: ("checking" | "credit_card" | "savings")[];
  popular?: boolean;
  aspspName?: string;
  country?: string;
}

/**
 * Katalog der gängigen deutschen und europäischen Banken & Kreditkarteninstitute
 * mit Fokus auf die Benutzer-Banken (ING, Sparkasse, C24, Commerzbank, TF Bank, Advanzia).
 */
export const POPULAR_BANK_INSTITUTIONS: BankInstitution[] = [
  {
    id: "ING_DE",
    name: "ING Deutschland",
    aspspName: "ING",
    country: "DE",
    brandColor: "#ff6200",
    category: "both",
    description: "Girokonto, VISA Card Debit & Extra-Konto",
    supportedTypes: ["checking", "credit_card", "savings"],
    popular: true,
  },
  {
    id: "SPARKASSE_DE",
    name: "Sparkasse (Finanzgruppe)",
    aspspName: "Sparkasse",
    country: "DE",
    brandColor: "#e2001a",
    category: "both",
    description: "Girokonten, Sparkassen-Card & Kreditkarten",
    supportedTypes: ["checking", "credit_card", "savings"],
    popular: true,
  },
  {
    id: "C24_DE",
    name: "C24 Bank (CHECK24)",
    aspspName: "C24",
    country: "DE",
    brandColor: "#0050aa",
    category: "both",
    description: "Smart / Plus / Max Girokonto & Mastercard",
    supportedTypes: ["checking", "credit_card", "savings"],
    popular: true,
  },
  {
    id: "COMMERZBANK_DE",
    name: "Commerzbank",
    aspspName: "Commerzbank",
    country: "DE",
    brandColor: "#ffcc00",
    category: "both",
    description: "Girokonto, Mastercard & Visa Kreditkarten",
    supportedTypes: ["checking", "credit_card"],
    popular: true,
  },
  {
    id: "TF_BANK_DE",
    name: "TF Bank",
    aspspName: "TF Bank",
    country: "DE",
    brandColor: "#1d3557",
    category: "credit_card",
    description: "TF Bank Mastercard Gold (gebührenfrei)",
    supportedTypes: ["credit_card"],
    popular: true,
  },
  {
    id: "ADVANZIA_LU",
    name: "Advanzia Bank",
    aspspName: "Advanzia Bank",
    country: "LU",
    brandColor: "#d62828",
    category: "credit_card",
    description: "Gebührenfrei Mastercard Gold",
    supportedTypes: ["credit_card"],
    popular: true,
  },
  {
    id: "DKB_DE",
    name: "DKB (Deutsche Kreditbank)",
    aspspName: "DKB",
    country: "DE",
    brandColor: "#0066b3",
    category: "both",
    description: "Girokonto, Visa Debit & Tagesgeld",
    supportedTypes: ["checking", "credit_card", "savings"],
    popular: true,
  },
  {
    id: "DEUTSCHE_BANK_DE",
    name: "Deutsche Bank",
    aspspName: "Deutsche Bank",
    country: "DE",
    brandColor: "#0018a8",
    category: "both",
    description: "Girokonto, Mastercard & Kreditkarten",
    supportedTypes: ["checking", "credit_card"],
    popular: false,
  },
  {
    id: "N26_DE",
    name: "N26 Bank",
    aspspName: "N26",
    country: "DE",
    brandColor: "#36a18b",
    category: "both",
    description: "Girokonto & Debit Mastercard",
    supportedTypes: ["checking", "credit_card"],
    popular: false,
  },
  {
    id: "VOLKSBANK_DE",
    name: "Volks- und Raiffeisenbanken",
    aspspName: "Volksbank",
    country: "DE",
    brandColor: "#003399",
    category: "both",
    description: "Girokonten, VR-Kreditkarten & Sparkonten",
    supportedTypes: ["checking", "credit_card", "savings"],
    popular: false,
  },
  {
    id: "POSTBANK_DE",
    name: "Postbank",
    aspspName: "Postbank",
    country: "DE",
    brandColor: "#ffbe00",
    category: "both",
    description: "Girokonto & Postbank Visa Card",
    supportedTypes: ["checking", "credit_card"],
    popular: false,
  },
  {
    id: "REVOLUT_DE",
    name: "Revolut",
    aspspName: "Revolut",
    country: "LT",
    brandColor: "#0075eb",
    category: "both",
    description: "Standard / Premium Girokonto & Debitkarten",
    supportedTypes: ["checking", "credit_card"],
    popular: false,
  },
];
