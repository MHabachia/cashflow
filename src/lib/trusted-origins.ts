function parseList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Erlaubte Ursprünge für Anfragen an die Auth-API: APP_URL und die Hosts aus
 * TRUSTED_HOSTS. Die lokalen Entwicklungs-Adressen nur außerhalb von Produktion.
 */
export function buildTrustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>();
  if (env.APP_URL) origins.add(env.APP_URL.replace(/\/+$/, ""));
  for (const host of parseList(env.TRUSTED_HOSTS)) {
    origins.add(`https://${host}`);
    origins.add(`http://${host}`);
  }
  if (env.NODE_ENV !== "production") {
    for (const o of ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3123", "http://127.0.0.1:3123"]) {
      origins.add(o);
    }
  }
  return [...origins];
}

