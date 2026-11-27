/**
 * Fehlercodes für die Weiterleitung nach /banking?bank_error=<code>.
 * Über die URL laufen nur diese festen Codes, keine Fehlertexte: Antworten
 * der Bank-API können interne Details enthalten, und ein frei wählbarer Text
 * ließe sich per präpariertem Link als Meldung der App ausgeben.
 * Wird von Server (Routen) und Client (Banking-Seite) genutzt.
 */
export const BANK_ERROR_MESSAGES = {
  csrf: "Sicherheitsprüfung fehlgeschlagen (CSRF/Sitzungsablauf). Bitte erneut versuchen.",
  expired: "Die Bank-Autorisierung ist abgelaufen. Bitte erneut starten.",
  missing_institution: "Es wurde keine Bank ausgewählt.",
  unknown_institution: "Diese Bank wird nicht unterstützt.",
  redirect_uri_not_allowed:
    "Redirect URI nicht erlaubt: Bitte trage die Callback-URL in deiner Enable Banking Application unter Redirect URLs ein.",
  auth_failed: "Die Verbindung zur Bank konnte nicht gestartet werden. Bitte später erneut versuchen.",
  callback_failed: "Die Freigabe bei der Bank konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
} as const;

export type BankErrorCode = keyof typeof BANK_ERROR_MESSAGES;

/** Ordnet einen Fehler beim Verbinden einem Code zu; Details gehören ins Log. */
export function bankErrorCodeFor(err: unknown, fallback: BankErrorCode): BankErrorCode {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("REDIRECT_URI_NOT_ALLOWED") || message.includes("Redirect URI nicht erlaubt")) {
    return "redirect_uri_not_allowed";
  }
  return fallback;
}

/** Meldung zu einem Code aus der URL; unbekannte Codes ergeben eine allgemeine Meldung. */
export function bankErrorMessage(code: string): string {
  return Object.hasOwn(BANK_ERROR_MESSAGES, code)
    ? BANK_ERROR_MESSAGES[code as BankErrorCode]
    : "Die Bankverbindung ist fehlgeschlagen. Bitte erneut versuchen.";
}
