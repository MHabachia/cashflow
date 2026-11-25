import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { runBackgroundBankSync } from "@/lib/bank-sync/scheduler";

export const dynamic = "force-dynamic";

/**
 * Externer Trigger für den Bank-Sync (z. B. System-Cron).
 * Erfordert ein eigenes CRON_SECRET (mind. 32 Zeichen) als Bearer-Token.
 * Ohne konfiguriertes Secret ist der Endpunkt deaktiviert – das Auth-Secret
 * wird bewusst NICHT wiederverwendet.
 */
function isAuthorized(req: Request): { ok: boolean; status: number; error?: string } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) {
    return {
      ok: false,
      status: 503,
      error: "Cron-Endpunkt deaktiviert (CRON_SECRET mit mind. 32 Zeichen setzen).",
    };
  }

  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  // Timing-sicherer Vergleich über gleich lange Hashes
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  if (!provided || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true, status: 200 };
}

export async function POST(req: Request) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const result = await runBackgroundBankSync();
  return NextResponse.json({ success: true, ...result });
}
