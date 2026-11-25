import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSignedStateToken,
  verifySignedStateToken,
  encryptBankToken,
  decryptBankToken,
} from "../../src/lib/crypto/vault";
import {
  getBankSyncProvider,
  normalizePrivateKey,
  EnableBankingLiveProvider,
} from "../../src/lib/bank-sync/provider";
import crypto from "node:crypto";

process.env.AUTH_SECRET = "test_secret_for_consent_callback_unit_test_32_chars";

describe("Bank-Sync Consent, CSRF-State & Callback Flow", () => {
  const userIdA = "user-alice-123";
  const userIdB = "user-bob-456";

  it("erstellt ein signiertes State-Token und validiert es erfolgreich", () => {
    const stateToken = createSignedStateToken(userIdA, "ING_DE");
    assert.ok(stateToken);
    assert.equal(typeof stateToken, "string");

    const result = verifySignedStateToken(stateToken, userIdA);
    assert.equal(result.valid, true);
    assert.equal(result.institutionId, "ING_DE");
    assert.equal(result.error, undefined);
  });

  it("verhindert CSRF-Angriffe: weist State-Token für fremde Benutzer strikt ab", () => {
    // Angreifer Bob versucht das State-Token von Alice zu verwenden
    const aliceStateToken = createSignedStateToken(userIdA, "C24_DE");

    const attackResult = verifySignedStateToken(aliceStateToken, userIdB);
    assert.equal(attackResult.valid, false);
    assert.ok(attackResult.error?.includes("CSRF"));
  });

  it("erkennt Manipulationen am State-Token (Integritätsschutz via HMAC-SHA256)", () => {
    const validToken = createSignedStateToken(userIdA, "SPARKASSE_DE");
    const decoded = Buffer.from(validToken, "base64url").toString("utf8");
    const parts = decoded.split(".");

    // Manipulation des Institution-Namens von SPARKASSE_DE zu ATTACKER_BANK
    parts[2] = "ATTACKER_BANK";
    const tamperedToken = Buffer.from(parts.join(".")).toString("base64url");

    const tamperedResult = verifySignedStateToken(tamperedToken, userIdA);
    assert.equal(tamperedResult.valid, false);
    assert.ok(tamperedResult.error?.includes("Signatur"));
  });

  it("weist abgelaufene State-Tokens nach Ablaufzeit strikt ab", () => {
    // Simuliertes Token mit Timestamp vor 20 Minuten
    const expiredTimestamp = (Date.now() - 20 * 60 * 1000).toString();
    const nonce = "testnonce1234567";
    const payload = `${nonce}.${userIdA}.TF_BANK_DE.${expiredTimestamp}`;
    const crypto = require("node:crypto");
    const sig = crypto
      .createHmac("sha256", process.env.AUTH_SECRET!)
      .update(payload)
      .digest("hex");
    const expiredToken = Buffer.from(`${payload}.${sig}`).toString("base64url");

    const expiredResult = verifySignedStateToken(expiredToken, userIdA);
    assert.equal(expiredResult.valid, false);
    assert.ok(expiredResult.error?.includes("abgelaufen"));
  });

  it("erzeugt im PSD2-Provider korrekte Autorisierungs-URLs mit State-Weitergabe", async () => {
    const provider = getBankSyncProvider();
    const state = createSignedStateToken(userIdA, "ADVANZIA_LU");
    const redirectUrl = "http://localhost:3000/api/bank-sync/callback";

    const session = await provider.createAuthSession({
      institutionId: "ADVANZIA_LU",
      userId: userIdA,
      redirectUrl,
      state,
    });

    assert.ok(session.authUrl);
    const parsedUrl = new URL(session.authUrl);
    assert.equal(parsedUrl.searchParams.get("state"), state);
    assert.ok(parsedUrl.searchParams.get("code")?.startsWith("mock_code_ADVANZIA_LU"));
  });

  it("tauscht Session-Code für Kreditkarten-Anbieter (TF Bank & Advanzia) in valide Konten", async () => {
    const provider = getBankSyncProvider();

    // Test TF Bank Mastercard
    const tfResult = await provider.exchangeSessionCode({
      code: "mock_code_TF_BANK_DE_123",
      institutionId: "TF_BANK_DE",
      userId: userIdA,
    });

    assert.ok(tfResult.accessToken.startsWith("psd2_access_tf_bank_de_"));
    assert.equal(tfResult.accounts.length, 1);
    assert.equal(tfResult.accounts[0].accountType, "credit_card");
    assert.ok(tfResult.accounts[0].accountName.includes("Mastercard"));

    // Verschlüsselungstest mit AES-256-GCM Vault
    const encrypted = encryptBankToken(tfResult.accessToken, userIdA);
    const decrypted = decryptBankToken(encrypted, userIdA);
    assert.equal(decrypted, tfResult.accessToken);
  });

  it("tauscht Session-Code für Vollbanken (ING, Sparkasse, C24) in Girokonto & Karte", async () => {
    const provider = getBankSyncProvider();

    // Test C24 Bank
    const c24Result = await provider.exchangeSessionCode({
      code: "mock_code_C24_DE_456",
      institutionId: "C24_DE",
      userId: userIdA,
    });

    assert.equal(c24Result.accounts.length, 2);
    assert.ok(c24Result.accounts.some((a) => a.accountType === "checking"));
    assert.ok(c24Result.accounts.some((a) => a.accountType === "credit_card"));
  });

  it("normalisiert private Schlüssel mit literalen \\n und Anführungszeichen (behebt ERR_OSSL_UNSUPPORTED)", () => {
    // Generiere Test-RSA-Schlüssel
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const standardPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

    // 1. Testfall: Docker/ENV-Format mit literalen "\n"
    const literalBackslashNPem = standardPem.replace(/\n/g, "\\n");
    const keyObj1 = normalizePrivateKey(literalBackslashNPem);
    assert.ok(keyObj1);
    assert.equal(keyObj1.type, "private");

    // 2. Testfall: Eingefasst in Anführungszeichen + literal "\n"
    const quotedPem = `"${literalBackslashNPem}"`;
    const keyObj2 = normalizePrivateKey(quotedPem);
    assert.ok(keyObj2);

    // 3. Testfall: JWT-Erzeugung mit EnableBankingLiveProvider funktioniert ohne DECODER error
    const provider = new EnableBankingLiveProvider(
      "test-app-id-12345",
      literalBackslashNPem
    );
    assert.ok(provider);
    // JWT generieren und Signatur prüfen
    const jwt = (provider as unknown as { generateJwt: () => string }).generateJwt();
    assert.ok(jwt);
    const [headerB64, payloadB64, signatureB64] = jwt.split(".");
    assert.ok(headerB64 && payloadB64 && signatureB64);

    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
    assert.equal(header.alg, "RS256");
    assert.equal(header.kid, "test-app-id-12345");
  });

  it("priorisiert Enable Banking acc.uid als accountExternalId und löst IBAN bei Transaktionsabruf zu UUID auf", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const standardPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const provider = new EnableBankingLiveProvider("test-app", standardPem);

    const originalFetch = global.fetch;
    const testSessionId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
    const testAccountUid = "11843183-1234-5678-abcd-123456789abc";
    const testIban = "DE30500105175457647813";

    try {
      // 1. Test exchangeSessionCode
      global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = input.toString();
        if (urlStr.includes("/sessions")) {
          return new Response(
            JSON.stringify({
              session_id: testSessionId,
              accounts: [
                {
                  uid: testAccountUid,
                  account_id: { iban: testIban },
                  account_type: "CACC",
                  currency: "EUR",
                  name: "ING Girokonto",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const exchange = await provider.exchangeSessionCode({
        code: "test_auth_code",
        institutionId: "ING_DE",
        userId: "user-test",
      });

      assert.equal(exchange.accessToken, testSessionId);
      assert.equal(exchange.accounts.length, 1);
      // Stellt sicher, dass die UUID als accountExternalId gesetzt wird und NICHT die IBAN
      assert.equal(exchange.accounts[0].accountExternalId, testAccountUid);
      assert.equal(exchange.accounts[0].accountName, "ING Girokonto");

      // 2. Test fetchTransactions mit IBAN als Fallback-Auflösung
      const fetchedUrls: string[] = [];
      global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
        const urlStr = input.toString();
        fetchedUrls.push(urlStr);

        if (urlStr.includes(`/sessions/${testSessionId}`)) {
          return new Response(
            JSON.stringify({
              session_id: testSessionId,
              accounts: [
                {
                  uid: testAccountUid,
                  account_id: { iban: testIban },
                  currency: "EUR",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes(`/accounts/${testAccountUid}/transactions`)) {
          return new Response(
            JSON.stringify({
              transactions: {
                booked: [
                  {
                    transaction_id: "tx-100",
                    booking_date: "2026-11-22",
                    transaction_amount: { amount: "50.00", currency: "EUR" },
                    credit_debit_indicator: "CRDT",
                    creditor: { name: "Test Sender" },
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (urlStr.includes(`/accounts/${testAccountUid}/balances`)) {
          return new Response(
            JSON.stringify({
              balances: [
                {
                  balance_amount: { amount: "1520.45", currency: "EUR" },
                  balance_type: "CLBD",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("Not found", { status: 404 });
      };

      // Aufruf mit alter IBAN
      const result = await provider.fetchTransactions({
        accountExternalId: testIban,
        accessToken: testSessionId,
      });

      assert.equal(result.transactions.length, 1);
      assert.equal(result.transactions[0].amountCents, 5000);
      assert.equal(result.balanceCents, 152045);
      // Wurde zur korrekten UUID aufgelöst
      assert.equal(result.resolvedAccountExternalId, testAccountUid);
      assert.ok(fetchedUrls.some((u) => u.includes(`/accounts/${testAccountUid}/transactions`)));
      assert.ok(fetchedUrls.some((u) => u.includes("strategy=longest") && u.includes("date_from=")));
      assert.ok(fetchedUrls.some((u) => u.includes(`/accounts/${testAccountUid}/balances`)));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("unterstützt Paginierung via continuation_key und parst unterschiedliche Betrags- und Verwendungszweck-Formate robust", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const standardPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const provider = new EnableBankingLiveProvider("test-app", standardPem);

    const originalFetch = global.fetch;
    const testSessionId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
    const testAccountUid = "account-uuid-9999";

    try {
      let page1Called = false;
      let page2Called = false;

      global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
        const urlStr = input.toString();

        if (urlStr.includes(`/accounts/${testAccountUid}/transactions`)) {
          if (urlStr.includes("continuation_key=page2token")) {
            page2Called = true;
            return new Response(
              JSON.stringify({
                transactions: [
                  {
                    entry_reference: "ref-202",
                    booking_date: "2026-11-20",
                    // Alternative Struktur: tx.amount.value als negativer String
                    amount: { value: "-12.99", currency: "EUR" },
                    // Remittance als Objekt { unstructured }
                    remittance_information: { unstructured: "Apotheke am Markt" },
                    debtor_name: "Apotheke",
                    status: "BOOK",
                  },
                ],
                continuation_key: null,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          } else {
            page1Called = true;
            return new Response(
              JSON.stringify({
                transactions: [
                  {
                    transaction_id: "tx-101",
                    transaction_date: "2026-11-21",
                    // Alternative Struktur: tx.transaction_amount.amount mit Komma
                    transaction_amount: { amount: "1.250,50", currency: "EUR" },
                    credit_debit_indicator: "CRDT",
                    // Remittance als Array
                    remittance_information: ["Gehaltsabrechnung", "November 2026"],
                    creditor_name: "Arbeitgeber AG",
                  },
                ],
                continuation_key: "page2token",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
        }

        if (urlStr.includes(`/accounts/${testAccountUid}/balances`)) {
          return new Response(
            JSON.stringify({
              balances: [
                {
                  balance_amount: { amount: "3240.50", currency: "EUR" },
                  balance_type: "CLBD",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("Not found", { status: 404 });
      };

      const result = await provider.fetchTransactions({
        accountExternalId: testAccountUid,
        accessToken: testSessionId,
      });

      assert.ok(page1Called, "Seite 1 muss aufgerufen worden sein");
      assert.ok(page2Called, "Seite 2 via continuation_key muss aufgerufen worden sein");
      assert.equal(result.transactions.length, 2);

      // Transaktion 1 (Gehalt)
      assert.equal(result.transactions[0].bankTransactionId, "tx-101");
      assert.equal(result.transactions[0].amountCents, 125050);
      assert.equal(result.transactions[0].remittanceInformation, "Gehaltsabrechnung November 2026");

      // Transaktion 2 (Apotheke, aus Seite 2, negatives value)
      assert.equal(result.transactions[1].bankTransactionId, "ref-202");
      assert.equal(result.transactions[1].amountCents, -1299);
      assert.equal(result.transactions[1].remittanceInformation, "Apotheke am Markt");

      assert.equal(result.balanceCents, 324050);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
