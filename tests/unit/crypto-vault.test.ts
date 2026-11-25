import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  encryptBankToken,
  decryptBankToken,
  needsReencryption,
} from "../../src/lib/crypto/vault";

describe("Krypto-Vault (AES-256-GCM Token-Verschlüsselung)", () => {
  const userIdA = "user-uuid-1234";
  const userIdB = "user-uuid-5678";
  const sampleToken =
    "secret_access_token_from_enable_banking_live_session_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

  it("verschlüsselt und entschlüsselt ein Bank-Token erfolgreich (Roundtrip)", () => {
    const encrypted = encryptBankToken(sampleToken, userIdA);
    assert.ok(encrypted);
    assert.notEqual(encrypted, sampleToken);

    // Format: v2.<keyId>:iv:authTag:ciphertext (4 Teile)
    const parts = encrypted.split(":");
    assert.equal(parts.length, 4);
    assert.match(parts[0], /^v2\.[0-9a-f]{8}$/);
    assert.equal(parts[1].length, 24); // 12 Bytes IV = 24 Hex Chars
    assert.equal(parts[2].length, 32); // 16 Bytes Auth Tag = 32 Hex Chars
    assert.ok(parts[3].length > 0); // Ciphertext

    // Entschlüsseln
    const decrypted = decryptBankToken(encrypted, userIdA);
    assert.equal(decrypted, sampleToken);
  });

  it("erzeugt bei jedem Aufruf einen neuen Zufalls-IV (keine Wiederholung des Ciphertexts)", () => {
    const enc1 = encryptBankToken(sampleToken, userIdA);
    const enc2 = encryptBankToken(sampleToken, userIdA);

    assert.notEqual(enc1, enc2);
    assert.equal(decryptBankToken(enc1, userIdA), sampleToken);
    assert.equal(decryptBankToken(enc2, userIdA), sampleToken);
  });

  it("verhindert Entschlüsselung durch einen anderen Benutzer (Mandantentrennung via PBKDF2)", () => {
    const encrypted = encryptBankToken(sampleToken, userIdA);

    assert.throws(
      () => {
        decryptBankToken(encrypted, userIdB);
      },
      {
        message: /Entschlüsselung fehlgeschlagen/,
      }
    );
  });

  it("erkennt Manipulationen an Ciphertext oder Auth Tag (AEAD Integritätsschutz)", () => {
    const encrypted = encryptBankToken(sampleToken, userIdA);
    const [prefix, iv, authTag, ciphertext] = encrypted.split(":");

    // 1. Manipulierter Ciphertext (letztes Zeichen geändert)
    const lastChar = ciphertext.slice(-1);
    const corruptedCiphertext =
      ciphertext.slice(0, -1) + (lastChar === "a" ? "b" : "a");
    const tamperedPayload = `${prefix}:${iv}:${authTag}:${corruptedCiphertext}`;

    assert.throws(
      () => {
        decryptBankToken(tamperedPayload, userIdA);
      },
      {
        message: /Entschlüsselung fehlgeschlagen/,
      }
    );

    // 2. Manipulierter Auth Tag
    const corruptedTag = authTag.slice(0, -1) + (authTag.slice(-1) === "0" ? "1" : "0");
    const tamperedTagPayload = `${prefix}:${iv}:${corruptedTag}:${ciphertext}`;

    assert.throws(
      () => {
        decryptBankToken(tamperedTagPayload, userIdA);
      },
      {
        message: /Entschlüsselung fehlgeschlagen/,
      }
    );
  });

  it("weist ungültige Formate und leere Eingaben strikt ab", () => {
    assert.throws(() => encryptBankToken("", userIdA), {
      message: /darf nicht leer sein/,
    });

    assert.throws(() => decryptBankToken("invalid-format-string", userIdA), {
      message: /Ungültiges Token-Format/,
    });

    assert.throws(() => decryptBankToken("a:b", userIdA), {
      message: /Ungültiges Token-Format/,
    });
  });

  it("entschlüsselt Legacy-Tokens (v1, PBKDF2 aus Auth-Secret) und markiert sie zur Neuverschlüsselung", () => {
    const secret =
      process.env.AUTH_SECRET ||
      process.env.BETTER_AUTH_SECRET ||
      "default_auth_secret_cashflow_app_32_chars";
    const key = crypto.pbkdf2Sync(secret, `cashflow-bank-token-v1:${userIdA}`, 100_000, 32, "sha256");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = cipher.update(sampleToken, "utf8", "hex") + cipher.final("hex");
    const legacy = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct}`;

    assert.equal(decryptBankToken(legacy, userIdA), sampleToken);
    assert.equal(needsReencryption(legacy), true);
    assert.equal(needsReencryption(encryptBankToken(sampleToken, userIdA)), false);
  });

  it("unterstützt Schlüsselrotation über TOKEN_ENCRYPTION_KEY_PREVIOUS", () => {
    const saved = {
      current: process.env.TOKEN_ENCRYPTION_KEY,
      previous: process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS,
    };
    try {
      process.env.TOKEN_ENCRYPTION_KEY = "alter-schluessel-mindestens-32-zeichen-lang-1";
      const oldToken = encryptBankToken(sampleToken, userIdA);

      process.env.TOKEN_ENCRYPTION_KEY = "neuer-schluessel-mindestens-32-zeichen-lang-2";
      assert.throws(() => decryptBankToken(oldToken, userIdA), {
        message: /Schlüssel nicht verfügbar/,
      });

      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = "alter-schluessel-mindestens-32-zeichen-lang-1";
      assert.equal(decryptBankToken(oldToken, userIdA), sampleToken);
      assert.equal(needsReencryption(oldToken), true);
    } finally {
      if (saved.current === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = saved.current;
      if (saved.previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
      else process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = saved.previous;
    }
  });
});
