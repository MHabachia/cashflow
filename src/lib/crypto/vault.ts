import crypto from "node:crypto";

/**
 * Kryptografischer Vault zur sicheren Speicherung von Bank-API-Tokens (AES-256-GCM).
 *
 * Schlüssel:
 * - Eigener Schlüssel `TOKEN_ENCRYPTION_KEY` (mind. 32 Zeichen), getrennt vom
 *   Session-Secret. Fehlt er, wird – abwärtskompatibel – das Auth-Secret verwendet.
 * - `TOKEN_ENCRYPTION_KEY_PREVIOUS` (optional, kommagetrennt) erlaubt eine
 *   Rotation: alte Tokens bleiben lesbar und werden beim nächsten Sync mit dem
 *   aktuellen Schlüssel neu verschlüsselt (`needsReencryption`).
 *
 * Format v2: `v2.<keyId>:<iv>:<authTag>:<ciphertext>` (hex)
 * - Schlüssel pro Benutzer via HKDF-SHA256 (Info = userId), userId zusätzlich als AAD.
 * - keyId = erste 8 Hex-Zeichen von SHA-256 über das Schlüsselmaterial.
 *
 * Legacy-Format v1: `<iv>:<authTag>:<ciphertext>` (PBKDF2 aus dem Auth-Secret) –
 * wird nur noch entschlüsselt.
 */

const CIPHER_ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const V2_PREFIX = "v2.";
const LEGACY_PBKDF2_ROUNDS = 100_000;
const LEGACY_DEFAULT_SECRET = "default_auth_secret_cashflow_app_32_chars";

interface KeyMaterial {
  id: string;
  secret: string;
}

function keyIdFor(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

function getAuthSecret(): string | undefined {
  return process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET || undefined;
}

let warnedAboutFallback = false;

/** Aktueller Schlüssel für neue Verschlüsselungen. */
function getCurrentKey(): KeyMaterial {
  const dedicated = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (dedicated) {
    if (dedicated.length < 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY muss mindestens 32 Zeichen lang sein.");
    }
    return { id: keyIdFor(dedicated), secret: dedicated };
  }

  const authSecret = getAuthSecret();
  if (authSecret) {
    if (process.env.NODE_ENV === "production" && !warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn(
        "[Vault] TOKEN_ENCRYPTION_KEY ist nicht gesetzt – Bank-Tokens werden mit dem Auth-Secret verschlüsselt. Empfohlen: eigenen Schlüssel setzen (openssl rand -base64 32)."
      );
    }
    return { id: keyIdFor(authSecret), secret: authSecret };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Kein Schlüssel für die Token-Verschlüsselung konfiguriert.");
  }
  return { id: keyIdFor(LEGACY_DEFAULT_SECRET), secret: LEGACY_DEFAULT_SECRET };
}

/** Alle Schlüssel, mit denen entschlüsselt werden darf (aktueller zuerst). */
function getDecryptionKeys(): KeyMaterial[] {
  const keys: KeyMaterial[] = [getCurrentKey()];
  const extra = [
    ...(process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS || "").split(","),
    getAuthSecret() || "",
  ];
  for (const raw of extra) {
    const secret = raw.trim();
    if (secret && !keys.some((k) => k.secret === secret)) {
      keys.push({ id: keyIdFor(secret), secret });
    }
  }
  return keys;
}

function deriveV2Key(secret: string, userId: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", secret, "cashflow-bank-token-v2", `user:${userId}`, KEY_BYTES)
  );
}

const legacyKeyCache = new Map<string, Buffer>();

function deriveLegacyKey(secret: string, userId: string): Buffer {
  const cacheKey = `${keyIdFor(secret)}:${userId}`;
  const cached = legacyKeyCache.get(cacheKey);
  if (cached) return cached;
  const key = crypto.pbkdf2Sync(
    secret,
    `cashflow-bank-token-v1:${userId}`,
    LEGACY_PBKDF2_ROUNDS,
    KEY_BYTES,
    "sha256"
  );
  if (legacyKeyCache.size > 1000) legacyKeyCache.clear();
  legacyKeyCache.set(cacheKey, key);
  return key;
}

function assertUserId(userId: string) {
  if (!userId || typeof userId !== "string") {
    throw new Error("Gültige userId zur Schlüsselableitung erforderlich.");
  }
}

function decryptWithKey(
  key: Buffer,
  ivHex: string,
  tagHex: string,
  ciphertext: string,
  aad?: string
): string {
  const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, Buffer.from(ivHex, "hex"));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const DECRYPT_ERROR =
  "Entschlüsselung fehlgeschlagen: Token ist manipuliert oder gehört zu einem anderen Benutzer/Secret.";

/**
 * Verschlüsselt ein Bank-Token mit dem aktuellen Schlüssel (Format v2).
 */
export function encryptBankToken(plaintext: string, userId: string): string {
  if (!plaintext) {
    throw new Error("Zu verschlüsselnder Text darf nicht leer sein.");
  }
  assertUserId(userId);

  const current = getCurrentKey();
  const key = deriveV2Key(current.secret, userId);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));

  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${V2_PREFIX}${current.id}:${iv.toString("hex")}:${authTag}:${ciphertext}`;
}

/**
 * Entschlüsselt ein Bank-Token (v2 oder Legacy v1).
 */
export function decryptBankToken(encryptedPayload: string, userId: string): string {
  if (!encryptedPayload || typeof encryptedPayload !== "string") {
    throw new Error("Ungültiges verschlüsseltes Token.");
  }
  assertUserId(userId);

  const parts = encryptedPayload.split(":");

  // Format v2
  if (encryptedPayload.startsWith(V2_PREFIX)) {
    if (parts.length !== 4) {
      throw new Error("Ungültiges Token-Format (erwartet: v2.<keyId>:iv:authTag:ciphertext).");
    }
    const [versionAndKid, ivHex, tagHex, ciphertext] = parts;
    const kid = versionAndKid.slice(V2_PREFIX.length);
    const keyMaterial = getDecryptionKeys().find((k) => k.id === kid);
    if (!keyMaterial) {
      throw new Error(
        "Entschlüsselung fehlgeschlagen: Schlüssel nicht verfügbar. Bank über „Neu verbinden“ erneut freigeben oder den alten Schlüssel in TOKEN_ENCRYPTION_KEY_PREVIOUS hinterlegen."
      );
    }
    try {
      return decryptWithKey(
        deriveV2Key(keyMaterial.secret, userId),
        ivHex,
        tagHex,
        ciphertext,
        userId
      );
    } catch {
      throw new Error(DECRYPT_ERROR);
    }
  }

  // Legacy-Format v1
  if (parts.length !== 3) {
    throw new Error("Ungültiges Token-Format (erwartet: iv:authTag:ciphertext).");
  }
  const [ivHex, tagHex, ciphertext] = parts;
  if (!ivHex || !tagHex || !ciphertext) {
    throw new Error("Beschädigtes Token-Format.");
  }

  const legacySecrets = [
    ...getDecryptionKeys().map((k) => k.secret),
    ...(process.env.NODE_ENV === "production" ? [] : [LEGACY_DEFAULT_SECRET]),
  ];
  for (const secret of new Set(legacySecrets)) {
    try {
      return decryptWithKey(deriveLegacyKey(secret, userId), ivHex, tagHex, ciphertext);
    } catch {
      // nächsten Schlüssel probieren
    }
  }
  throw new Error(DECRYPT_ERROR);
}

/**
 * true, wenn das Token im Legacy-Format oder mit einem älteren Schlüssel
 * verschlüsselt ist und neu verschlüsselt werden sollte.
 */
export function needsReencryption(encryptedPayload: string): boolean {
  if (!encryptedPayload?.startsWith(V2_PREFIX)) return true;
  const kid = encryptedPayload.split(":")[0].slice(V2_PREFIX.length);
  return kid !== getCurrentKey().id;
}

/** Eigener, abgeleiteter HMAC-Schlüssel für OAuth-State-Tokens. */
function getStateHmacKey(): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", getCurrentKey().secret, "cashflow-oauth-state", "state-hmac", 32)
  );
}

/**
 * Erstellt ein kryptografisch signiertes State-Token für den OAuth-/PSD2-Consent-Flow (CSRF-Schutz).
 * Format: base64url(nonce.userId.institutionId.timestamp.hmacSignature)
 */
export function createSignedStateToken(userId: string, institutionId: string): string {
  if (!userId || !institutionId) {
    throw new Error("userId und institutionId sind für State-Token erforderlich.");
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const payload = `${nonce}.${userId}.${institutionId}.${timestamp}`;
  const signature = crypto.createHmac("sha256", getStateHmacKey()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

/**
 * Validiert ein übergebenes State-Token auf kryptografische Signatur, Benutzer-Übereinstimmung und Ablaufzeit (15 Minuten).
 */
export function verifySignedStateToken(
  token: string,
  expectedUserId: string
): { valid: boolean; institutionId?: string; error?: string } {
  try {
    if (!token || typeof token !== "string") {
      return { valid: false, error: "Kein State-Token übergeben." };
    }
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 5) {
      return { valid: false, error: "Ungültiges State-Format." };
    }
    const [nonce, tokenUserId, institutionId, timestampStr, signature] = parts;

    if (tokenUserId !== expectedUserId) {
      return { valid: false, error: "Token-Benutzer stimmt nicht überein (CSRF-Verdacht)." };
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp) || Date.now() - timestamp > 15 * 60 * 1000) {
      return { valid: false, error: "Die Bank-Autorisierungssitzung ist abgelaufen. Bitte erneut starten." };
    }

    const payload = `${nonce}.${tokenUserId}.${institutionId}.${timestampStr}`;
    const expectedSig = crypto
      .createHmac("sha256", getStateHmacKey())
      .update(payload)
      .digest("hex");

    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expectedSig, "hex");

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "Ungültige Token-Signatur (Manipulationsversuch)." };
    }

    return { valid: true, institutionId };
  } catch (err: unknown) {
    return { valid: false, error: (err as Error)?.message || "Validierungsfehler." };
  }
}
