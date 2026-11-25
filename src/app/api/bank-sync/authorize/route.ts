import { NextResponse, type NextRequest } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { createSignedStateToken } from "@/lib/crypto/vault";
import { getBankSyncProvider } from "@/lib/bank-sync/provider";
import { POPULAR_BANK_INSTITUTIONS } from "@/lib/bank-institutions";
import { cookies } from "next/headers";
import { getAppBaseUrl, createAbsoluteUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.redirect(createAbsoluteUrl("/login", request));
    }

    const { searchParams } = new URL(request.url);
    const institutionId = searchParams.get("institutionId");

    if (!institutionId) {
      return NextResponse.redirect(
        createAbsoluteUrl("/banking?bank_error=missing_institution", request)
      );
    }

    const inst = POPULAR_BANK_INSTITUTIONS.find((i) => i.id === institutionId);
    if (!inst) {
      return NextResponse.redirect(
        createAbsoluteUrl("/banking?bank_error=unknown_institution", request)
      );
    }

    // CSRF-Schutz: HMAC-signiertes State-Token erzeugen
    const stateToken = createSignedStateToken(session.user.id, institutionId);

    // State im HttpOnly Cookie sichern (15 Minuten Gültigkeit)
    const proto =
      request.headers.get("x-forwarded-proto") ||
      (request.url.startsWith("https://") ? "https" : "http");
    const isHttps = proto === "https";

    const cookieStore = await cookies();
    cookieStore.set("bank_sync_state", stateToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60,
    });

    const baseUrl = getAppBaseUrl(request);
    const redirectUrl =
      process.env.ENABLE_BANKING_REDIRECT_URL ||
      `${baseUrl}/api/bank-sync/callback`;

    const provider = getBankSyncProvider();
    const sessionResult = await provider.createAuthSession({
      institutionId,
      userId: session.user.id,
      redirectUrl,
      state: stateToken,
    });

    return NextResponse.redirect(sessionResult.authUrl);
  } catch (err: unknown) {
    console.error("Fehler bei Bank-Autorisierung:", err);
    const msg = (err as Error)?.message || "auth_failed";
    return NextResponse.redirect(
      createAbsoluteUrl(
        `/banking?bank_error=${encodeURIComponent(msg)}`,
        request
      )
    );
  }
}
