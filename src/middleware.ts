import { NextResponse, type NextRequest } from "next/server";

/**
 * Setzt pro Anfrage eine Content-Security-Policy mit Nonce.
 * Next.js liest die Nonce aus dem CSP-Request-Header und versieht seine
 * eigenen Skripte damit; das Theme-Skript im Root-Layout liest `x-nonce`.
 */
function buildCsp(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Recharts, sonner und dynamische Brand-Farben setzen Inline-Styles
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded ? forwarded === "https" : request.nextUrl.protocol === "https:";
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";
  const https = isHttps(request);

  let csp = buildCsp(nonce, isDev);
  // Über HTTP (z. B. LAN ohne TLS) würde upgrade-insecure-requests Ressourcen brechen
  if (!https) csp = csp.replace("; upgrade-insecure-requests", "");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  // HSTS nur über HTTPS (Browser ignorieren es über HTTP ohnehin)
  if (https && !isDev) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|sw.js|swe-worker|favicon.ico|icon-|screenshots/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
