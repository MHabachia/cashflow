import crypto from "node:crypto";
import { db } from "@/lib/db";
import { appSecrets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Minimaler Web-Push-Client (ohne Fremdbibliothek):
 * - VAPID-Authentifizierung (RFC 8292) mit ES256-signiertem JWT
 * - Nutzlast-Verschlüsselung "aes128gcm" (RFC 8188 / RFC 8291)
 *
 * Schlüssel: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url, roh) aus der
 * Umgebung; fehlen sie, wird einmalig ein Schlüsselpaar erzeugt und in der
 * Tabelle app_secrets gespeichert.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, 65 Byte (unkomprimierter P-256-Punkt)
  auth: string; // base64url, 16 Byte
}

interface VapidKeys {
  publicKey: string; // base64url, 65 Byte
  privateKey: crypto.KeyObject;
}

const b64u = (buf: Buffer) => buf.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

/** Erlaubte Push-Dienste – verhindert, dass der Server beliebige URLs aufruft (SSRF). */
const ALLOWED_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && ALLOWED_PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

function privateKeyFromRaw(publicRaw: Buffer, privateRaw: Buffer): crypto.KeyObject {
  return crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64u(publicRaw.subarray(1, 33)),
      y: b64u(publicRaw.subarray(33, 65)),
      d: b64u(privateRaw),
    },
    format: "jwk",
  });
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwkPub = publicKey.export({ format: "jwk" });
  const jwkPriv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([0x04]), fromB64u(jwkPub.x!), fromB64u(jwkPub.y!)]);
  return { publicKey: b64u(raw), privateKey: jwkPriv.d! };
}

let cachedKeys: VapidKeys | null = null;

export function getVapidKeys(): VapidKeys {
  if (cachedKeys) return cachedKeys;

  let publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  let privateKey = process.env.VAPID_PRIVATE_KEY?.trim();

  if (!publicKey || !privateKey) {
    const stored = db.select().from(appSecrets).where(eq(appSecrets.name, "vapid")).get();
    if (stored) {
      ({ publicKey, privateKey } = JSON.parse(stored.value));
    } else {
      const generated = generateVapidKeys();
      db.insert(appSecrets)
        .values({ name: "vapid", value: JSON.stringify(generated), createdAt: new Date() })
        .onConflictDoNothing()
        .run();
      // Bei parallelem Start gewinnt der zuerst gespeicherte Schlüssel
      const winner = db.select().from(appSecrets).where(eq(appSecrets.name, "vapid")).get()!;
      ({ publicKey, privateKey } = JSON.parse(winner.value));
    }
  }

  cachedKeys = {
    publicKey: publicKey!,
    privateKey: privateKeyFromRaw(fromB64u(publicKey!), fromB64u(privateKey!)),
  };
  return cachedKeys;
}

/** Für Tests: zwischengespeicherte Schlüssel verwerfen. */
export function resetVapidKeyCache() {
  cachedKeys = null;
}

export function createVapidJwt(audience: string, subject: string, keys: VapidKeys, now = Date.now()): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(
    Buffer.from(
      JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })
    )
  );
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64u(signature)}`;
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));
}

/**
 * Verschlüsselt die Nutzlast für ein Abonnement (RFC 8291, aes128gcm).
 * Optional mit festem Absender-Schlüssel/Salt für Tests.
 */
export function encryptPushPayload(
  sub: PushSubscriptionKeys,
  plaintext: Buffer,
  testing?: { senderKeys?: crypto.ECDH; salt?: Buffer }
): Buffer {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) {
    throw new Error("Ungültige Schlüssel im Push-Abonnement.");
  }

  const sender = testing?.senderKeys ?? crypto.createECDH("prime256v1");
  if (!testing?.senderKeys) sender.generateKeys();
  const asPublic = sender.getPublicKey();
  const sharedSecret = sender.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = testing?.salt ?? crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // Ein einzelner Datensatz: Klartext + Trennbyte 0x02 (letzter Datensatz)
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, ciphertext]);
}

export type PushSendResult = "sent" | "gone" | "failed";

export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: Record<string, unknown>,
  options: { ttlSeconds?: number; urgency?: "low" | "normal" | "high"; topic?: string } = {}
): Promise<PushSendResult> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return "gone";

  const keys = getVapidKeys();
  const audience = new URL(sub.endpoint).origin;
  // Push-Dienste (v. a. Apple) verlangen eine Kontaktadresse: mailto: oder https:
  const configured = (process.env.VAPID_SUBJECT || process.env.APP_URL || "").replace(/\/+$/, "");
  const subject = /^(mailto:|https:\/\/)/.test(configured) ? configured : "mailto:admin@localhost";
  const jwt = createVapidJwt(audience, subject, keys);
  const body = encryptPushPayload(sub, Buffer.from(JSON.stringify(payload)));

  const headers: Record<string, string> = {
    Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds ?? 24 * 3600),
    Urgency: options.urgency ?? "normal",
  };
  if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) {
      console.warn(`[Push] Versand fehlgeschlagen (${res.status}): ${await res.text().catch(() => "")}`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.warn("[Push] Versand fehlgeschlagen:", err);
    return "failed";
  }
}
