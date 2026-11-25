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

export function clientKeyFromHeaders(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}
