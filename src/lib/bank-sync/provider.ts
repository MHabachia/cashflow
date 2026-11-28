import { POPULAR_BANK_INSTITUTIONS } from "../bank-institutions";
import type { BankAccountType, BankProvider } from "../db/schema";
import crypto from "node:crypto";
import { UserFacingError } from "../errors";
import fs from "node:fs";

export interface DiscoveredAccount {
  accountExternalId: string;
  ibanMasked: string;
  accountName: string;
  accountType: BankAccountType;
  currency: string;
  balanceCents: number | null;
}

export interface BankSyncAuthSessionResult {
  authUrl: string;
  sessionId?: string;
}

export interface BankSyncExchangeResult {
  accessToken: string;
  refreshToken?: string | null;
  consentId: string;
  consentExpiresAt: string;
  accounts: DiscoveredAccount[];
}

export interface RawBankTransaction {
  bankTransactionId: string;
  bookingDate: string; // YYYY-MM-DD
  amountCents: number; // Negativ für Belastungen/Ausgaben, positiv für Gutschriften/Einnahmen
  currency: string;
  remittanceInformation?: string;
  creditorName?: string;
  debtorName?: string;
  status: "booked" | "pending";
}

export interface BankSyncProvider {
  name: BankProvider;
  createAuthSession(params: {
    institutionId: string;
    userId: string;
    redirectUrl: string;
    state: string;
  }): Promise<BankSyncAuthSessionResult>;

  exchangeSessionCode(params: {
    code?: string;
    sessionId?: string;
    institutionId: string;
    userId: string;
  }): Promise<BankSyncExchangeResult>;

  fetchTransactions(params: {
    accountExternalId: string;
    accessToken: string;
    dateFrom?: string;
  }): Promise<{
    transactions: RawBankTransaction[];
    balanceCents?: number | null;
    resolvedAccountExternalId?: string;
  }>;

  /**
   * Beendet die Session beim Anbieter, damit die Zustimmung nicht bis zu ihrem
   * Ablauf weiterläuft. Eine bereits unbekannte Session gilt als beendet.
   */
  revokeSession(accessToken: string): Promise<void>;
}

/**
 * Fehler der Bank-API mit HTTP-Status (z. B. 429 = PSD2-Abruflimit erreicht,
 * 401/403 = Consent abgelaufen oder widerrufen).
 */
export class BankApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "BankApiError";
  }
}

const BANK_API_TIMEOUT_MS = 20_000;

/** fetch mit Timeout, damit hängende Bank-APIs den Sync nicht blockieren. */
function fetchBank(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(BANK_API_TIMEOUT_MS) });
}

/**
 * Erzeugt eine stabile ID für Buchungen ohne Bank-ID (transaction_id /
 * entry_reference). Basis sind die fachlichen Merkmale; identische Buchungen
 * am selben Tag werden über einen Laufindex unterschieden.
 */
export function buildFallbackTransactionId(
  accountUid: string,
  tx: {
    bookingDate: string;
    amountCents: number;
    counterparty?: string;
    remittance?: string;
  },
  occurrence: number
): string {
  const fingerprint = [
    accountUid,
    tx.bookingDate,
    tx.amountCents,
    (tx.counterparty || "").trim().toLowerCase(),
    (tx.remittance || "").replace(/\s+/g, " ").trim().toLowerCase(),
  ].join("|");
  const hash = crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);
  return `gen_${hash}_${occurrence}`;
}

/**
 * Erzeugt eine mock/sandbox PSD2-Session für lokale Entwicklung & Tests,
 * wenn keine echten Enable Banking API-Credentials hinterlegt sind.
 */
class MockBankSyncProvider implements BankSyncProvider {
  name: BankProvider = "enable_banking";

  // Sandbox ohne echte Session beim Anbieter: nichts zu beenden
  async revokeSession(_accessToken: string): Promise<void> {}

  async createAuthSession(params: {
    institutionId: string;
    userId: string;
    redirectUrl: string;
    state: string;
  }): Promise<BankSyncAuthSessionResult> {
    const inst = POPULAR_BANK_INSTITUTIONS.find(
      (i) => i.id === params.institutionId
    );
    if (!inst) {
      throw new UserFacingError("Diese Bank wird nicht unterstützt.");
    }

    const mockCode = `mock_code_${inst.id}_${crypto.randomBytes(8).toString("hex")}`;
    const url = new URL(params.redirectUrl);
    url.searchParams.set("code", mockCode);
    url.searchParams.set("state", params.state);

    return {
      authUrl: url.toString(),
      sessionId: `mock_session_${crypto.randomBytes(12).toString("hex")}`,
    };
  }

  async exchangeSessionCode(params: {
    code?: string;
    sessionId?: string;
    institutionId: string;
    userId: string;
  }): Promise<BankSyncExchangeResult> {
    const inst = POPULAR_BANK_INSTITUTIONS.find(
      (i) => i.id === params.institutionId
    );
    if (!inst) {
      throw new UserFacingError("Diese Bank wird nicht unterstützt.");
    }

    const now = new Date();
    const expiresDate = new Date();
    expiresDate.setDate(now.getDate() + 90);
    const consentExpiresAt = expiresDate.toISOString().slice(0, 10);

    const accessToken = `psd2_access_${inst.id.toLowerCase()}_${crypto.randomBytes(16).toString("hex")}`;
    const consentId = `consent_${inst.id.toLowerCase()}_${crypto.randomBytes(12).toString("hex")}`;

    const accounts: DiscoveredAccount[] = [];
    const isPureCard = inst.category === "credit_card";
    const sampleIbanSuffix = Math.floor(1000 + Math.random() * 9000);

    if (!isPureCard) {
      accounts.push({
        accountExternalId: `acc_giro_${inst.id.toLowerCase()}_${crypto.randomBytes(6).toString("hex")}`,
        ibanMasked: `DE** **** **** **** ${sampleIbanSuffix}`,
        accountName: `${inst.name} Girokonto`,
        accountType: "checking",
        currency: "EUR",
        balanceCents: null,
      });
    }

    if (inst.category === "credit_card" || inst.category === "both") {
      const cardSuffix = Math.floor(1000 + Math.random() * 9000);
      let cardBrand = "Kreditkarte";
      if (inst.id === "TF_BANK_DE" || inst.id === "ADVANZIA_LU" || inst.id === "C24_DE") {
        cardBrand = "Mastercard";
      } else if (inst.id === "ING_DE") {
        cardBrand = "VISA Card Debit";
      }

      accounts.push({
        accountExternalId: `acc_card_${inst.id.toLowerCase()}_${crypto.randomBytes(6).toString("hex")}`,
        ibanMasked: `**** **** **** ${cardSuffix}`,
        accountName: `${inst.name} ${cardBrand}`,
        accountType: "credit_card",
        currency: "EUR",
        balanceCents: null,
      });
    }

    return {
      accessToken,
      refreshToken: null,
      consentId,
      consentExpiresAt,
      accounts,
    };
  }

  async fetchTransactions(params: {
    accountExternalId: string;
    accessToken: string;
    dateFrom?: string;
  }): Promise<{
    transactions: RawBankTransaction[];
    balanceCents?: number | null;
    resolvedAccountExternalId?: string;
  }> {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

    const isCard = params.accountExternalId.includes("card");

    const sampleTransactions: RawBankTransaction[] = isCard
      ? [
          {
            bankTransactionId: `tx_card_${params.accountExternalId.slice(-6)}_1`,
            bookingDate: today,
            amountCents: -4580, // -45,80 €
            currency: "EUR",
            creditorName: "REWE Supermarkt",
            remittanceInformation: "Kartenzahlung REWE Filiale 1042",
            status: "booked",
          },
          {
            bankTransactionId: `tx_card_${params.accountExternalId.slice(-6)}_2`,
            bookingDate: yesterday,
            amountCents: -1799, // -17,99 €
            currency: "EUR",
            creditorName: "Netflix International B.V.",
            remittanceInformation: "Abonnement Monatlich",
            status: "booked",
          },
          {
            bankTransactionId: `tx_card_${params.accountExternalId.slice(-6)}_3`,
            bookingDate: threeDaysAgo,
            amountCents: -3490, // -34,90 €
            currency: "EUR",
            creditorName: "Deutsche Bahn",
            remittanceInformation: "DB Vertrieb GmbH ICE Fahrkarte",
            status: "booked",
          },
        ]
      : [
          {
            bankTransactionId: `tx_giro_${params.accountExternalId.slice(-6)}_1`,
            bookingDate: today,
            amountCents: -7500, // -75,00 €
            currency: "EUR",
            creditorName: "Stadtwerke Energie",
            remittanceInformation: "Abschlag Strom & Gas SEPA-Lastschrift",
            status: "booked",
          },
          {
            bankTransactionId: `tx_giro_${params.accountExternalId.slice(-6)}_2`,
            bookingDate: yesterday,
            amountCents: -6250, // -62,50 €
            currency: "EUR",
            creditorName: "EDEKA Markt",
            remittanceInformation: "Kartenzahlung EDEKA",
            status: "booked",
          },
          {
            bankTransactionId: `tx_giro_${params.accountExternalId.slice(-6)}_3`,
            bookingDate: threeDaysAgo,
            amountCents: 285000, // +2.850,00 €
            currency: "EUR",
            debtorName: "Arbeitgeber GmbH",
            remittanceInformation: "Gehalt / Bezuege Abrechnung",
            status: "booked",
          },
        ];

    return {
      transactions: sampleTransactions,
      balanceCents: isCard ? -12450 : 284520,
      resolvedAccountExternalId: params.accountExternalId,
    };
  }
}

/**
 * Normalisiert und validiert einen privaten RSA-Schlüssel (PEM/PKCS8/PKCS1),
 * selbst wenn er als Environment-Variable mit literalen "\\n", Anführungszeichen,
 * oder ohne vollständige PEM-Header übergeben wurde.
 */
export function normalizePrivateKey(rawKey: string): crypto.KeyObject {
  if (!rawKey || typeof rawKey !== "string") {
    throw new Error("ENABLE_BANKING_PRIVATE_KEY fehlt oder ist leer.");
  }

  let key = rawKey.trim();

  // 1. Umschließende Anführungszeichen (z. B. aus .env oder docker-compose) entfernen
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  // 2. Falls ein Dateipfad übergeben wurde (/run/secrets/key.pem, ./key.pem, etc.)
  if (
    (key.startsWith("/") ||
      key.startsWith("./") ||
      key.endsWith(".pem") ||
      key.endsWith(".key")) &&
    fs.existsSync(key)
  ) {
    try {
      key = fs.readFileSync(key, "utf8").trim();
    } catch {
      // Falls Lesefehler, mit dem Original-String fortfahren
    }
  }

  // 3. Literale "\\n" und "\\r\\n" durch echte Newlines ersetzen (OpenSSL benötigt echte Newlines)
  key = key.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");

  // 4. PEM-Header & Formatierung sicherstellen
  if (!key.includes("-----BEGIN")) {
    const cleanBase64 = key.replace(/[^A-Za-z0-9+/=]/g, "");
    const formatted = cleanBase64.match(/.{1,64}/g)?.join("\n") || cleanBase64;
    key = `-----BEGIN PRIVATE KEY-----\n${formatted}\n-----END PRIVATE KEY-----`;
  } else {
    const match = key.match(
      /(-----BEGIN [A-Z0-9 ]+-----)([\s\S]*?)(-----END [A-Z0-9 ]+-----)/
    );
    if (match) {
      const header = match[1];
      const body = match[2].replace(/\s+/g, "");
      const footer = match[3];
      const formattedBody = body.match(/.{1,64}/g)?.join("\n") || body;
      key = `${header}\n${formattedBody}\n${footer}`;
    }
  }

  // 5. Mit crypto.createPrivateKey parsen (gibt sauberes KeyObject zurück)
  try {
    return crypto.createPrivateKey({
      key,
      format: "pem",
    });
  } catch (err: unknown) {
    throw new Error(
      `ENABLE_BANKING_PRIVATE_KEY ist ungültig oder konnte nicht als RSA Private Key decodiert werden (${(err as Error)?.message || "unsupported"}). Bitte prüfe das Format in deiner docker-compose.yml oder .env.`
    );
  }
}

/**
 * Enable Banking Live-Provider für echte PSD2 Open Banking Verbindungen
 * (erfordert ENABLE_BANKING_APPLICATION_ID und ENABLE_BANKING_PRIVATE_KEY).
 */
export class EnableBankingLiveProvider implements BankSyncProvider {
  name: BankProvider = "enable_banking";
  private appId: string;
  private keyObject: crypto.KeyObject;
  private aspspCache = new Map<string, Array<{ name: string; country: string }>>();

  constructor(appId: string, privateKey: string) {
    this.appId = appId;
    this.keyObject = normalizePrivateKey(privateKey);
  }

  private generateJwt(): string {
    const header = {
      alg: "RS256",
      typ: "JWT",
      kid: this.appId,
    };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: now,
      exp: now + 3600,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signInput = `${encodedHeader}.${encodedPayload}`;

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signInput);
    const signature = signer.sign(this.keyObject, "base64url");

    return `${signInput}.${signature}`;
  }

  private async fetchAspsps(country: string): Promise<Array<{ name: string; country: string }>> {
    if (this.aspspCache.has(country)) {
      return this.aspspCache.get(country)!;
    }
    try {
      const jwt = this.generateJwt();
      const res = await fetchBank(`https://api.enablebanking.com/aspsps?country=${country}`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      });
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      const list: Array<{ name: string; country: string }> = Array.isArray(data)
        ? data
        : Array.isArray(data.aspsps)
          ? data.aspsps
          : [];
      this.aspspCache.set(country, list);
      return list;
    } catch {
      return [];
    }
  }

  private async resolveAspsp(
    inst: (typeof POPULAR_BANK_INSTITUTIONS)[number]
  ): Promise<{ name: string; country: string }> {
    const targetCountry =
      inst.country ||
      (inst.id.endsWith("_LU") ? "LU" : inst.id.endsWith("_LT") ? "LT" : "DE");

    const remoteList = await this.fetchAspsps(targetCountry);

    if (remoteList.length > 0) {
      const searchTerms = [
        inst.aspspName,
        inst.name,
        inst.id.replace(/_[A-Z]{2}$/, "").replace(/_/g, " "),
      ]
        .filter(Boolean)
        .map((s) => s!.toLowerCase());

      // 1. Exakter Match
      for (const term of searchTerms) {
        const exact = remoteList.find((a) => a.name.toLowerCase() === term);
        if (exact) {
          return { name: exact.name, country: exact.country || targetCountry };
        }
      }

      // 2. Teilstring-Match
      for (const term of searchTerms) {
        const partial = remoteList.find(
          (a) =>
            a.name.toLowerCase().includes(term) ||
            term.includes(a.name.toLowerCase())
        );
        if (partial) {
          return { name: partial.name, country: partial.country || targetCountry };
        }
      }

      // 3. Fallback: Auch DE prüfen, falls anderes Land gewählt war
      if (targetCountry !== "DE") {
        const deList = await this.fetchAspsps("DE");
        for (const term of searchTerms) {
          const m = deList.find(
            (a) =>
              a.name.toLowerCase().includes(term) ||
              term.includes(a.name.toLowerCase())
          );
          if (m) {
            return { name: m.name, country: m.country || "DE" };
          }
        }
      }
    }

    return {
      name: inst.aspspName || inst.name,
      country: targetCountry,
    };
  }

  async createAuthSession(params: {
    institutionId: string;
    userId: string;
    redirectUrl: string;
    state: string;
  }): Promise<BankSyncAuthSessionResult> {
    const inst = POPULAR_BANK_INSTITUTIONS.find(
      (i) => i.id === params.institutionId
    );
    if (!inst) {
      throw new UserFacingError("Diese Bank wird nicht unterstützt.");
    }

    const expiresDate = new Date();
    expiresDate.setDate(expiresDate.getDate() + 90);

    const aspsp = await this.resolveAspsp(inst);

    const jwt = this.generateJwt();
    const response = await fetchBank("https://api.enablebanking.com/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        access: {
          balances: true,
          transactions: true,
          valid_until: expiresDate.toISOString(),
          max_historical_days: 730,
        },
        aspsp: {
          name: aspsp.name,
          country: aspsp.country,
        },
        psu_type: "personal",
        state: params.state,
        redirect_url: params.redirectUrl,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let detailMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error === "WRONG_ASPSP_PROVIDED") {
          const available = await this.fetchAspsps(aspsp.country);
          const sampleNames = available
            .slice(0, 10)
            .map((a) => a.name)
            .join(", ");
          detailMsg = `Bank „${inst.name}“ (ASPSP: „${aspsp.name}“, Land: ${aspsp.country}) wurde nicht erkannt. Verfügbare Institute: ${sampleNames || "keine gelistet"}`;
        } else if (parsed.error === "REDIRECT_URI_NOT_ALLOWED") {
          detailMsg = `Redirect URI nicht erlaubt (${params.redirectUrl}). Bitte trage diese URL im Enable Banking Dashboard ein.`;
        } else if (parsed.message) {
          detailMsg = parsed.message;
        }
      } catch {
        // Fallback auf errText
      }
      throw new BankApiError(
        `Enable Banking API Fehler (${response.status}): ${detailMsg}`,
        response.status
      );
    }

    const data = await response.json();
    return {
      authUrl: data.url,
      sessionId: data.session_id,
    };
  }

  async exchangeSessionCode(params: {
    code?: string;
    sessionId?: string;
    institutionId: string;
    userId: string;
  }): Promise<BankSyncExchangeResult> {
    const jwt = this.generateJwt();
    const response = await fetchBank("https://api.enablebanking.com/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        code: params.code,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new BankApiError(
        `Enable Banking Session Fehler (${response.status}): ${errText}`,
        response.status
      );
    }

    const data = await response.json();
    // Tatsächliche Consent-Laufzeit aus der API übernehmen (Fallback: 90 Tage)
    const apiValidUntil = data.access?.valid_until
      ? new Date(data.access.valid_until)
      : null;
    const expiresDate =
      apiValidUntil && !isNaN(apiValidUntil.getTime())
        ? apiValidUntil
        : new Date(Date.now() + 90 * 86400000);

    const accounts: DiscoveredAccount[] = (data.accounts || []).map(
      (acc: {
        uid?: string;
        id?: string;
        account_id?: { iban?: string; bban?: string };
        account_type?: string;
        currency?: string;
        name?: string;
      }) => {
        const rawIban = acc.account_id?.iban || "";
        const masked = rawIban.length > 8
          ? `${rawIban.slice(0, 2)}** **** **** **** ${rawIban.slice(-4)}`
          : "**** **** **** ****";
        const isCard = acc.account_type?.toLowerCase().includes("card");
        const accountUid = acc.uid || acc.id || "";

        return {
          accountExternalId: accountUid || rawIban || `acc_${crypto.randomBytes(8).toString("hex")}`,
          ibanMasked: masked,
          accountName: acc.name || (isCard ? "Kreditkarte" : "Girokonto"),
          accountType: (isCard ? "credit_card" : "checking") as BankAccountType,
          currency: acc.currency || "EUR",
          balanceCents: null,
        };
      }
    );

    return {
      accessToken: data.session_id,
      refreshToken: null,
      consentId: data.session_id,
      consentExpiresAt: expiresDate.toISOString().slice(0, 10),
      accounts,
    };
  }

  /**
   * DELETE /sessions/{session_id}: Laut Enable Banking wird dabei auch die
   * Zustimmung bei der Bank beendet, soweit die Bank das unterstützt.
   */
  async revokeSession(accessToken: string): Promise<void> {
    const response = await fetchBank(
      `https://api.enablebanking.com/sessions/${encodeURIComponent(accessToken)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.generateJwt()}` },
      }
    );
    // 404: Session existiert nicht mehr (abgelaufen oder schon beendet)
    if (response.ok || response.status === 404) return;
    const errText = await response.text();
    throw new BankApiError(
      `Enable Banking Session konnte nicht beendet werden (${response.status}): ${errText}`,
      response.status
    );
  }

  async fetchTransactions(params: {
    accountExternalId: string;
    accessToken: string;
    dateFrom?: string;
  }): Promise<{
    transactions: RawBankTransaction[];
    balanceCents?: number | null;
    resolvedAccountExternalId?: string;
  }> {
    const jwt = this.generateJwt();
    let accountUid = params.accountExternalId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountUid);

    // Fallback: Falls die ID keine UUID ist (z.B. zuvor IBAN gespeichert), UID über Session auflösen
    if (!isUuid && params.accessToken) {
      try {
        const sessionRes = await fetchBank(
          `https://api.enablebanking.com/sessions/${encodeURIComponent(params.accessToken)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${jwt}`,
            },
          }
        );
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          const accountsList = sessionData.accounts || [];
          const cleanExternalId = accountUid.replace(/\s+/g, "").toUpperCase();
          const matched = accountsList.find((a: any) => {
            const iban = (a.account_id?.iban || a.iban || "").replace(/\s+/g, "").toUpperCase();
            return iban === cleanExternalId || a.uid === accountUid;
          });
          if (matched?.uid) {
            accountUid = matched.uid;
          } else if (accountsList.length > 0 && accountsList[0]?.uid) {
            accountUid = accountsList[0].uid;
          }
        }
      } catch (e) {
        console.warn("Konnte Account-UID aus Enable Banking Session nicht auflösen:", e);
      }
    }

    const url = new URL(
      `https://api.enablebanking.com/accounts/${encodeURIComponent(accountUid)}/transactions`
    );
    // Bis zu 730 Tage (2 Jahre) Historie anfordern; mit strategy=longest liefert die Bank das Maximum
    const defaultDateFrom = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
    url.searchParams.set("date_from", params.dateFrom || defaultDateFrom);
    url.searchParams.set("strategy", "longest");

    const response = await fetchBank(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new BankApiError(
        `Enable Banking Transaktionsabruf fehlgeschlagen (${response.status}): ${errText}`,
        response.status
      );
    }

    const data = await response.json();
    let rawList: any[] = [];
    if (Array.isArray(data.transactions)) {
      rawList = data.transactions;
    } else if (data.transactions && typeof data.transactions === "object") {
      const booked = Array.isArray(data.transactions.booked) ? data.transactions.booked : [];
      const pending = Array.isArray(data.transactions.pending)
        ? data.transactions.pending.map((p: any) => ({ ...p, status: "PDNG" }))
        : [];
      rawList = [...booked, ...pending];
    } else if (Array.isArray(data)) {
      rawList = data;
    }

    // Paginierung über continuation_key (Obergrenze als Schutz vor Endlosschleifen)
    const MAX_PAGES = 50;
    let continuationKey = data.continuation_key || null;
    let pageCount = 1;
    while (continuationKey && pageCount < MAX_PAGES) {
      try {
        const nextUrl = new URL(url.toString());
        nextUrl.searchParams.set("continuation_key", continuationKey);
        const nextRes = await fetchBank(nextUrl.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${jwt}` },
        });
        if (!nextRes.ok) {
          throw new BankApiError(
            `Enable Banking Transaktionsabruf (Seite ${pageCount + 1}) fehlgeschlagen (${nextRes.status})`,
            nextRes.status
          );
        }
        const nextData = await nextRes.json();
        const nextItems = Array.isArray(nextData.transactions)
          ? nextData.transactions
          : nextData.transactions?.booked || [];
        rawList.push(...nextItems);
        continuationKey = nextData.continuation_key || null;
        pageCount++;
      } catch (pageErr) {
        // Unvollständige Historie nicht still übernehmen
        throw pageErr;
      }
    }
    if (continuationKey) {
      console.warn(
        `[BankSync] Paginierungsgrenze (${MAX_PAGES} Seiten) erreicht – ältere Umsätze wurden nicht geladen.`
      );
    }

    const fallbackOccurrences = new Map<string, number>();
    const transactions: RawBankTransaction[] = rawList.map(
      (tx: any, idx: number) => {
        // Betrag tolerant extrahieren: tx.transaction_amount?.amount, tx.amount?.value, etc.
        const valRaw =
          tx.transaction_amount?.amount ??
          tx.amount?.value ??
          tx.amount?.amount ??
          tx.transaction_amount?.value ??
          tx.amount;

        let cents = 0;
        if (typeof valRaw === "number") {
          cents = Math.round(valRaw * 100);
        } else if (typeof valRaw === "string") {
          const raw = valRaw.trim().replace(/\s|€/g, "");
          const isNeg = raw.startsWith("-");
          const clean = raw.replace(/^[+-]/, "");
          let normalized = clean;
          if (clean.includes(",") && clean.includes(".")) {
            if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
              normalized = clean.replace(/\./g, "").replace(",", ".");
            } else {
              normalized = clean.replace(/,/g, "");
            }
          } else if (clean.includes(",")) {
            normalized = clean.replace(",", ".");
          }
          const parsed = Number(normalized);
          if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            const rawCents = Math.round(parsed * 100);
            cents = isNeg ? -rawCents : rawCents;
          }
        }

        if (tx.credit_debit_indicator === "DBIT" && cents > 0) {
          cents = -cents;
        } else if (tx.credit_debit_indicator === "CRDT" && cents < 0) {
          cents = Math.abs(cents);
        }

        const bookingDate =
          tx.booking_date ||
          tx.transaction_date ||
          tx.value_date ||
          new Date().toISOString().slice(0, 10);
        const bankProvidedId = tx.transaction_id || tx.entry_reference || tx.id;

        // Verwendungszweck tolerant zusammenbauen (Array, String oder Object)
        let remittanceInfo = "";
        if (Array.isArray(tx.remittance_information)) {
          remittanceInfo = tx.remittance_information
            .map((r: any) => (typeof r === "string" ? r : r?.unstructured || JSON.stringify(r)))
            .join(" ");
        } else if (typeof tx.remittance_information === "string") {
          remittanceInfo = tx.remittance_information;
        } else if (tx.remittance_information && typeof tx.remittance_information === "object") {
          remittanceInfo = tx.remittance_information.unstructured || "";
        }

        const creditorName =
          tx.creditor?.name ||
          tx.creditor_name ||
          tx.creditor_account?.holder_name ||
          tx.creditor_account?.name;

        const debtorName =
          tx.debtor?.name ||
          tx.debtor_name ||
          tx.debtor_account?.holder_name ||
          tx.debtor_account?.name;

        const currency =
          tx.transaction_amount?.currency ||
          tx.amount?.currency ||
          "EUR";

        let txId: string;
        if (bankProvidedId) {
          txId = String(bankProvidedId);
        } else {
          const baseKey = [
            bookingDate,
            cents,
            creditorName || debtorName || "",
            remittanceInfo,
          ].join("|");
          const occurrence = fallbackOccurrences.get(baseKey) ?? 0;
          fallbackOccurrences.set(baseKey, occurrence + 1);
          txId = buildFallbackTransactionId(
            accountUid,
            {
              bookingDate,
              amountCents: cents,
              counterparty: creditorName || debtorName,
              remittance: remittanceInfo,
            },
            occurrence
          );
        }

        return {
          bankTransactionId: txId,
          bookingDate,
          amountCents: cents,
          currency,
          remittanceInformation: remittanceInfo.trim(),
          creditorName,
          debtorName,
          status: (/pdng|pend/i.test(String(tx.status || "")) ? "pending" : "booked") as
            | "booked"
            | "pending",
        };
      }
    );

    let balanceCents: number | null = null;
    if (Array.isArray(data.balances) && data.balances.length > 0) {
      const rawBal = parseFloat(data.balances[0].balance_amount?.amount || "0");
      balanceCents = Math.round(rawBal * 100);
    } else {
      // Separaten Balances-Endpunkt abfragen
      try {
        const balRes = await fetchBank(
          `https://api.enablebanking.com/accounts/${encodeURIComponent(accountUid)}/balances`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${jwt}`,
            },
          }
        );
        if (balRes.ok) {
          const balData = await balRes.json();
          const balList = balData.balances || [];
          if (balList.length > 0 && balList[0].balance_amount?.amount) {
            const rawBal = parseFloat(balList[0].balance_amount.amount);
            balanceCents = Math.round(rawBal * 100);
          }
        }
      } catch (balErr) {
        console.warn("Balances konnten nicht separat abgerufen werden:", balErr);
      }
    }

    return {
      transactions,
      balanceCents,
      resolvedAccountExternalId: accountUid,
    };
  }
}

/**
 * Prüft, ob echte Enable Banking Live-Zugangsdaten konfiguriert und valide sind.
 */
export function isLiveBankingMode(): boolean {
  const appId = process.env.ENABLE_BANKING_APPLICATION_ID;
  const privateKey = process.env.ENABLE_BANKING_PRIVATE_KEY;
  if (!appId || !privateKey || process.env.BANK_SYNC_MOCK === "true") {
    return false;
  }
  try {
    normalizePrivateKey(privateKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Der Demo-/Sandbox-Provider erzeugt simulierte Konten und Buchungen.
 * In Produktion ist er nur bei ausdrücklichem Opt-in (BANK_SYNC_MOCK=true)
 * erlaubt, damit nie unbemerkt Fake-Daten in echte Finanzdaten gelangen.
 */
export function isMockBankingAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.BANK_SYNC_MOCK === "true"
  );
}

export const BANK_SYNC_NOT_CONFIGURED_ERROR =
  "Bank-Synchronisation ist nicht konfiguriert. Hinterlege ENABLE_BANKING_APPLICATION_ID und ENABLE_BANKING_PRIVATE_KEY oder aktiviere den Demo-Modus ausdrücklich mit BANK_SYNC_MOCK=true.";

let cachedMockProvider: MockBankSyncProvider | null = null;

/**
 * Gibt den konfigurierten PSD2-Bank-Sync-Provider zurück.
 * Falls keine Live-Keys konfiguriert sind, wird automatisch der Sandbox-Provider genutzt.
 */
export function getBankSyncProvider(): BankSyncProvider {
  const appId = process.env.ENABLE_BANKING_APPLICATION_ID;
  const privateKey = process.env.ENABLE_BANKING_PRIVATE_KEY;

  if (appId && privateKey && process.env.BANK_SYNC_MOCK !== "true") {
    return new EnableBankingLiveProvider(appId, privateKey);
  }

  if (!isMockBankingAllowed()) {
    throw new UserFacingError(BANK_SYNC_NOT_CONFIGURED_ERROR);
  }

  if (!cachedMockProvider) {
    cachedMockProvider = new MockBankSyncProvider();
  }
  return cachedMockProvider;
}
