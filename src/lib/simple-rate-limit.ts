import { getIP } from "better-auth/api";
import { auth } from "./auth";

/**
 * Einfaches Rate-Limit im Speicher für Server-Actions, die nicht über die
 * Better-Auth-Endpunkte laufen (z. B. Passwort-Wiederherstellung).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 10_000;

export function hitRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= max,
    retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

/** Schlüssel, wenn sich keine vertrauenswürdige Client-IP ermitteln lässt. */
export const NO_TRUSTED_IP_KEY = "no-trusted-ip";

/**
 * Client-IP nach denselben Regeln wie das Rate-Limit von Better Auth:
 * nur Header aus IP_ADDRESS_HEADERS, mehrteilige X-Forwarded-For-Ketten nur
 * mit TRUSTED_PROXIES. Ohne vertrauenswürdige IP teilen sich alle Anfragen
 * einen Zähler, statt dass ein gefälschter Header einen neuen erzeugt.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  return getIP(headers, auth.options) ?? NO_TRUSTED_IP_KEY;
}
