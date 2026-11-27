import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { db } from "./db";
import * as schema from "./db/schema";
import { ensureDefaultCategoriesForUser } from "./db/defaults";
import { count, eq } from "drizzle-orm";
import { validateAuthSecret } from "./auth-guard";
import { isSignUpAllowedInContext } from "./signup-guard";
import { buildTrustedOrigins } from "./trusted-origins";
import { isUserBanned } from "./user-status";
import { logAudit } from "./audit";
import { APIError } from "better-auth/api";

const BANNED_MESSAGE = "Dieses Benutzerkonto wurde vom Administrator gesperrt.";

/**
 * Kontobezogene Sperre nach fehlgeschlagenen Anmeldungen.
 * Ergänzt das IP-basierte Rate-Limit von Better Auth: Der Schlüssel ist die
 * E-Mail-Adresse und lässt sich daher nicht über gefälschte IP-Header umgehen.
 * Nach 10 Fehlversuchen innerhalb von 15 Minuten wird das Konto für den Rest
 * des Fensters für Passwort-Anmeldungen gesperrt.
 */
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_MAX = 10;
const MAX_TRACKED_ACCOUNTS = 5000;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function normalizeLoginKey(email: string): string {
  return email.trim().toLowerCase();
}

export function checkAccountLoginLock(email: string): {
  locked: boolean;
  retryAfterSeconds?: number;
} {
  const entry = loginFailures.get(normalizeLoginKey(email));
  const now = Date.now();
  if (!entry || now > entry.resetAt) return { locked: false };
  if (entry.count >= LOGIN_FAILURE_MAX) {
    return { locked: true, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { locked: false };
}

export function recordLoginFailure(email: string) {
  const key = normalizeLoginKey(email);
  const now = Date.now();
  if (loginFailures.size > MAX_TRACKED_ACCOUNTS) {
    for (const [k, v] of loginFailures) if (now > v.resetAt) loginFailures.delete(k);
    if (loginFailures.size > MAX_TRACKED_ACCOUNTS) {
      const oldest = loginFailures.keys().next().value;
      if (oldest) loginFailures.delete(oldest);
    }
  }
  const entry = loginFailures.get(key);
  if (!entry || now > entry.resetAt) {
    loginFailures.set(key, { count: 1, resetAt: now + LOGIN_FAILURE_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function resetLoginFailures(email: string) {
  loginFailures.delete(normalizeLoginKey(email));
}

/**
 * IP-Erkennung für Rate-Limiting: Nur Header verwenden, die ein vorgeschalteter
 * Proxy zuverlässig setzt. Konfigurierbar über IP_ADDRESS_HEADERS (z. B.
 * "cf-connecting-ip") und TRUSTED_PROXIES (IPs/CIDR des Reverse-Proxys).
 */
function parseList(value: string | undefined): string[] | undefined {
  const list = (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * Prüft, ob bereits mindestens ein Benutzer in der Datenbank existiert.
 * Falls 0 Benutzer existieren, wird der erste registrierte Benutzer automatisch Admin.
 */
export function getUserCount(): number {
  const res = db.select({ value: count() }).from(schema.user).get();
  return res?.value ?? 0;
}

const rawAuthSecret =
  process.env.BETTER_AUTH_SECRET ||
  process.env.AUTH_SECRET ||
  "lokales-entwicklungs-secret-mindestens-32-zeichen-lang";

const authSecretValidation = validateAuthSecret({
  secret: rawAuthSecret,
  nodeEnv: process.env.NODE_ENV,
  isBuildPhase:
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build",
});

if (!authSecretValidation.valid && authSecretValidation.error) {
  throw new Error(authSecretValidation.error);
}
if (authSecretValidation.warning && process.env.NODE_ENV === "production") {
  console.warn(authSecretValidation.warning);
}

export const auth = betterAuth({
  appName: "Cashflow",
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      twoFactor: schema.twoFactor,
      passkey: schema.passkey,
      rateLimit: schema.rateLimit,
    },
  }),
  rateLimit: {
    // Standardmäßig nur in Produktion aktiv; RATE_LIMIT_ENABLED=true erzwingt es
    enabled:
      process.env.RATE_LIMIT_ENABLED === "true" ||
      (process.env.NODE_ENV === "production" && process.env.RATE_LIMIT_ENABLED !== "false"),
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/*": { window: 60, max: 5 },
      "/two-factor/*": { window: 60, max: 5 },
      "/passkey/*": { window: 60, max: 20 },
      "/change-password": { window: 300, max: 5 },
    },
  },
  secret: rawAuthSecret,
  baseURL:
    process.env.BETTER_AUTH_URL ||
    process.env.APP_URL ||
    "http://localhost:3000",
  trustedOrigins: buildTrustedOrigins(),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
      banned: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 Tage (ideal für iPhone PWA)
    updateAge: 60 * 60 * 24, // 1 Tag
    // Kein Cookie-Cache: Sonst bleiben beendete Sitzungen (Passwort-Reset,
    // Sperre, „andere Geräte abmelden“) bis zu 5 Minuten gültig. Die Prüfung
    // gegen die lokale SQLite-Datenbank kostet praktisch nichts.
    cookieCache: {
      enabled: false,
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: parseList(process.env.IP_ADDRESS_HEADERS) ?? [
        "x-forwarded-for",
        "x-real-ip",
      ],
      trustedProxies: parseList(process.env.TRUSTED_PROXIES),
    },
    useSecureCookies: process.env.NODE_ENV === "production" && (process.env.APP_URL?.startsWith("https://") ?? false),
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const existingCount = getUserCount();
          // Nur der allererste Benutzer oder explizit freigegebene Serverpfade
          // (Einladung geprüft, Admin-Anlage, Seed) dürfen Konten anlegen.
          if (existingCount > 0 && !isSignUpAllowedInContext()) {
            console.warn(
              "[Auth] Blockierter Registrierungsversuch außerhalb des Einladungssystems."
            );
            return false;
          }
          const role = existingCount === 0 ? "admin" : "user";
          return {
            data: {
              ...user,
              role,
            },
          };
        },
        after: async (user) => {
          // Automatisch Standardkategorien & variable Vorlagen für den neuen User anlegen
          ensureDefaultCategoriesForUser(user.id);
        },
      },
    },
    session: {
      create: {
        // Gesperrte Benutzer erhalten über keinen Anmeldeweg eine Sitzung
        // (Passwort, Passkey, 2FA). Der APIError bricht die Anmeldung mit 403
        // und verständlicher Meldung ab statt mit einem Serverfehler.
        before: async (session, context) => {
          if (!isUserBanned(session.userId)) return;
          logAudit({
            action: "auth.login.failure",
            userId: session.userId,
            details: { reason: "banned", path: context?.path ?? null },
            headers: context?.headers ?? context?.request?.headers ?? null,
          });
          throw new APIError("FORBIDDEN", { message: BANNED_MESSAGE });
        },
        // Schließt das Zeitfenster, in dem ein Benutzer zwischen Prüfung und
        // Anlage der Sitzung gesperrt wird: Die Sperre hat dessen Sitzungen
        // bereits gelöscht, diese hier entstand danach und wird entfernt.
        after: async (session) => {
          if (isUserBanned(session.userId)) {
            db.delete(schema.session).where(eq(schema.session.id, session.id)).run();
          }
        },
      },
    },
  },
  plugins: [
    twoFactor({
      issuer: "Cashflow",
    }),
    passkey({
      rpName: "Cashflow",
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
