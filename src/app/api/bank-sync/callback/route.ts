import { NextResponse, type NextRequest } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { verifySignedStateToken, encryptBankToken } from "@/lib/crypto/vault";
import { getBankSyncProvider } from "@/lib/bank-sync/provider";
import { syncBankAccountTransactions } from "@/lib/bank-sync/sync-engine";
import { POPULAR_BANK_INSTITUTIONS } from "@/lib/bank-institutions";
import { db } from "@/lib/db";
import { connectedBanks, bankAccounts } from "@/lib/db/schema";
import { and, eq, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { createAbsoluteUrl } from "@/lib/url";
import { logAudit } from "@/lib/audit";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.redirect(createAbsoluteUrl("/login", request));
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code") || undefined;
    const state = searchParams.get("state");

    const cookieStore = await cookies();
    const cookieState = cookieStore.get("bank_sync_state")?.value;

    // Cookie bereinigen
    cookieStore.delete("bank_sync_state");

    // 1. CSRF & State Validierung: State muss exakt dem HttpOnly-Cookie dieses
    //    Browsers entsprechen (Cookie wird oben sofort gelöscht → einmalig nutzbar)
    if (!state || !cookieState) {
      return NextResponse.redirect(
        createAbsoluteUrl("/banking?bank_error=csrf", request)
      );
    }
    if (state !== cookieState) {
      return NextResponse.redirect(
        createAbsoluteUrl("/banking?bank_error=csrf", request)
      );
    }

    // 2. Kryptografische Signatur & Ablaufzeit & User-Binding prüfen
    const validation = verifySignedStateToken(state, session.user.id);
    if (!validation.valid || !validation.institutionId) {
      return NextResponse.redirect(
        createAbsoluteUrl(
          `/banking?bank_error=${encodeURIComponent(validation.error || "csrf")}`,
          request
        )
      );
    }

    const institutionId = validation.institutionId;
    const inst = POPULAR_BANK_INSTITUTIONS.find((i) => i.id === institutionId);
    if (!inst) {
      return NextResponse.redirect(
        createAbsoluteUrl("/banking?bank_error=unknown_institution", request)
      );
    }

    // 3. Code gegen Access Token & Kontenliste beim PSD2-Provider tauschen
    const provider = getBankSyncProvider();
    const exchange = await provider.exchangeSessionCode({
      code,
      institutionId,
      userId: session.user.id,
    });

    const now = new Date();
    const encryptedAccessToken = encryptBankToken(
      exchange.accessToken,
      session.user.id
    );
    const encryptedRefreshToken = exchange.refreshToken
      ? encryptBankToken(exchange.refreshToken, session.user.id)
      : null;

    // 4. Atomare Speicherung in Datenbank
    let savedBankId = "";
    db.transaction((tx) => {
      const existingBank = tx
        .select()
        .from(connectedBanks)
        .where(
          and(
            eq(connectedBanks.userId, session.user.id),
            eq(connectedBanks.institutionId, inst.id)
          )
        )
        .get();

      let targetBankId: string;

      if (existingBank) {
        targetBankId = existingBank.id;
        savedBankId = existingBank.id;
        tx.update(connectedBanks)
          .set({
            encryptedAccessToken,
            encryptedRefreshToken,
            consentId: exchange.consentId,
            consentExpiresAt: exchange.consentExpiresAt,
            status: "active",
            updatedAt: now,
          })
          .where(eq(connectedBanks.id, existingBank.id))
          .run();
      } else {
        targetBankId = crypto.randomUUID();
        savedBankId = targetBankId;
        tx.insert(connectedBanks)
          .values({
            id: targetBankId,
            userId: session.user.id,
            provider: provider.name,
            institutionId: inst.id,
            institutionName: inst.name,
            institutionLogo: inst.brandColor,
            encryptedAccessToken,
            encryptedRefreshToken,
            consentId: exchange.consentId,
            consentExpiresAt: exchange.consentExpiresAt,
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      // Konten aktualisieren oder anlegen
      for (const acc of exchange.accounts) {
        const existingAccount = tx
          .select()
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.connectedBankId, targetBankId),
              or(
                eq(bankAccounts.accountExternalId, acc.accountExternalId),
                eq(bankAccounts.ibanMasked, acc.ibanMasked)
              )
            )
          )
          .get();

        if (existingAccount) {
          tx.update(bankAccounts)
            .set({
              accountExternalId: acc.accountExternalId,
              // Selbst vergebenen Namen behalten
              accountName: existingAccount.accountName || acc.accountName,
              ibanMasked: acc.ibanMasked,
              balanceCents: acc.balanceCents !== null ? acc.balanceCents : existingAccount.balanceCents,
              // Neue Freigabe: alten Fehler und Abruf-Pause zurücksetzen
              lastSyncError: null,
              syncBackoffUntil: null,
              updatedAt: now,
            })
            .where(eq(bankAccounts.id, existingAccount.id))
            .run();
        } else {
          tx.insert(bankAccounts)
            .values({
              id: crypto.randomUUID(),
              connectedBankId: targetBankId,
              userId: session.user.id,
              accountExternalId: acc.accountExternalId,
              ibanMasked: acc.ibanMasked,
              accountName: acc.accountName,
              accountType: acc.accountType,
              currency: acc.currency,
              balanceCents: acc.balanceCents,
              autoSync: true,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
      }
    });

    logAudit({
      action: "bank.connect",
      userId: session.user.id,
      target: inst.id,
      headers: request.headers,
    });

    // 5. Automatische Erst-Synchronisation der Umsätze & Historie direkt nach erfolgreicher Verknüpfung
    try {
      const activeAccounts = db
        .select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.connectedBankId, savedBankId),
            eq(bankAccounts.userId, session.user.id)
          )
        )
        .all();

      for (const a of activeAccounts) {
        await syncBankAccountTransactions(a.id, session.user.id);
      }
    } catch (syncErr) {
      console.warn("Erst-Synchronisation nach Bankverknüpfung fehlgeschlagen:", syncErr);
    }

    return NextResponse.redirect(
      createAbsoluteUrl("/banking?bank_connected=1", request)
    );
  } catch (err: unknown) {
    console.error("Fehler im Bank-Sync Callback:", err);
    const msg = (err as Error)?.message || "callback_failed";
    return NextResponse.redirect(
      createAbsoluteUrl(
        `/banking?bank_error=${encodeURIComponent(msg)}`,
        request
      )
    );
  }
}
