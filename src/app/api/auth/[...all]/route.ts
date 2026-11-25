import {
  auth,
  checkAccountLoginLock,
  recordLoginFailure,
  resetLoginFailures,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

async function readEmail(req: NextRequest): Promise<string | null> {
  try {
    const body = (await req.clone().json()) as { email?: unknown };
    return typeof body?.email === "string" && body.email.trim()
      ? body.email.trim().toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const pathname = req.nextUrl.pathname.replace(/\/+$/, "").toLowerCase();

  // Registrierung läuft ausschließlich über registerUserAction (prüft Einladung
  // bzw. offene Registrierung). Der öffentliche Better-Auth-Endpunkt ist gesperrt.
  if (pathname.includes("/sign-up/")) {
    logAudit({ action: "auth.signup.blocked", headers: req.headers });
    return NextResponse.json(
      { message: "Registrierung ist nur über die Registrierungsseite möglich." },
      { status: 403 }
    );
  }

  if (!pathname.endsWith("/sign-in/email")) {
    return handlers.POST(req);
  }

  // IP-basiertes Rate-Limiting übernimmt Better Auth (rate_limit-Tabelle).
  // Hier zusätzlich: Sperre pro Konto und Prüfung gesperrter Benutzer.
  const email = await readEmail(req);

  if (email) {
    const lock = checkAccountLoginLock(email);
    if (lock.locked) {
      logAudit({ action: "auth.login.locked", target: email, headers: req.headers });
      return NextResponse.json(
        {
          message: `Zu viele fehlgeschlagene Anmeldeversuche. Bitte warte ${Math.ceil(
            (lock.retryAfterSeconds ?? 60) / 60
          )} Minute(n).`,
        },
        { status: 429, headers: { "Retry-After": String(lock.retryAfterSeconds ?? 60) } }
      );
    }

    const u = db
      .select({ id: userTable.id, banned: userTable.banned })
      .from(userTable)
      .where(eq(userTable.email, email))
      .get();

    if (u?.banned) {
      logAudit({
        action: "auth.login.failure",
        userId: u.id,
        target: email,
        details: { reason: "banned" },
        headers: req.headers,
      });
      return NextResponse.json(
        { message: "Dieses Benutzerkonto wurde vom Administrator gesperrt." },
        { status: 403 }
      );
    }

    const response = await handlers.POST(req);

    if (response.status === 200) {
      resetLoginFailures(email);
      logAudit({ action: "auth.login.success", userId: u?.id, target: email, headers: req.headers });
    } else if (response.status === 401 || response.status === 403) {
      recordLoginFailure(email);
      logAudit({
        action: "auth.login.failure",
        userId: u?.id,
        target: email,
        details: { status: response.status },
        headers: req.headers,
      });
    }
    return response;
  }

  return handlers.POST(req);
}
