import type { NextRequest } from "next/server";

/**
 * Ermittelt die Basis-URL der Applikation für Browser-Redirects und Callbacks.
 *
 * Sicherheit: `Host` / `X-Forwarded-Host` stammen vom Client und dürfen nicht
 * ungeprüft übernommen werden (Host-Header-Injection → Open Redirect,
 * manipulierte Bank-Callback-URL). Reihenfolge:
 *   1. Request-Host, wenn er in der Allowlist steht (Host aus APP_URL bzw.
 *      BETTER_AUTH_URL plus optional TRUSTED_HOSTS, kommagetrennt).
 *   2. Konfigurierte APP_URL / NEXT_PUBLIC_APP_URL / BETTER_AUTH_URL.
 *   3. Nur ohne Konfiguration: Loopback-Host aus dem Request (lokale Entwicklung),
 *      sonst http://localhost:3000.
 */

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;

function getConfiguredUrl(): URL | null {
  const candidates = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BETTER_AUTH_URL,
  ];
  for (const raw of candidates) {
    if (!raw || raw === "undefined" || raw.includes("placeholder")) continue;
    try {
      const parsed = new URL(raw);
      if (parsed.hostname === "0.0.0.0") continue;
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      return parsed;
    } catch {
      // ungültige URL ignorieren
    }
  }
  return null;
}

function getTrustedHosts(configured: URL | null): Set<string> {
  const hosts = new Set<string>();
  if (configured) hosts.add(configured.host.toLowerCase());
  for (const h of (process.env.TRUSTED_HOSTS || "").split(",")) {
    const trimmed = h.trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  }
  return hosts;
}

function readRequestHost(request?: NextRequest | Request): {
  host: string | null;
  proto: "http" | "https";
} {
  if (!request) return { host: null, proto: "http" };
  const headers = request.headers;
  const host =
    headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    headers.get("host")?.trim() ||
    null;
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto === "https" ||
    (!forwardedProto && request.url.startsWith("https://"))
      ? "https"
      : "http";
  return { host: host ? host.toLowerCase() : null, proto };
}

function toBase(url: URL): string {
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export function getAppBaseUrl(request?: NextRequest | Request): string {
  const configured = getConfiguredUrl();
  const { host, proto } = readRequestHost(request);

  // 1. Request-Host nur aus der Allowlist übernehmen
  if (host && getTrustedHosts(configured).has(host)) {
    if (configured && configured.host.toLowerCase() === host) {
      return toBase(configured);
    }
    return `${proto}://${host}`;
  }

  // 2. Konfigurierte öffentliche URL
  if (configured) {
    return toBase(configured);
  }

  // 3. Lokale Entwicklung ohne Konfiguration: nur Loopback-Hosts zulassen
  if (host && LOOPBACK_HOST.test(host)) {
    return `${proto}://${host.replace(/^0\.0\.0\.0/, "localhost")}`;
  }

  return "http://localhost:3000";
}

/**
 * Erzeugt eine garantierte absolute URL für Redirects.
 */
export function createAbsoluteUrl(
  path: string,
  request?: NextRequest | Request
): URL {
  const base = getAppBaseUrl(request);
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(cleanPath, base);
}
