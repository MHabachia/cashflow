import { unstable_rethrow } from "next/navigation";

/**
 * Fehler, deren Meldung bewusst für Nutzer formuliert ist und unverändert
 * in der Oberfläche erscheinen darf. Alle anderen Fehler (SQLite, sharp,
 * Antworten externer APIs, Programmierfehler) können interne Details
 * enthalten und werden nur protokolliert.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

function bankStatusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Der Bankzugang ist abgelaufen oder ungültig. Bitte die Bank neu verbinden.";
  }
  if (status === 429) {
    return "Die Bank begrenzt gerade die Abrufe. Bitte später erneut versuchen.";
  }
  return "Die Bank ist gerade nicht erreichbar. Bitte später erneut versuchen.";
}

/** Fehler aus der Better-Auth-API sind für Clients gedacht (z. B. „Invalid password“). */
function isAuthApiError(err: unknown): err is Error {
  return err instanceof Error && err.name === "APIError";
}

function isBankApiError(err: unknown): err is Error & { status: number } {
  return (
    err instanceof Error &&
    err.name === "BankApiError" &&
    typeof (err as { status?: unknown }).status === "number"
  );
}

/**
 * Meldung für die Oberfläche. Gibt nur Meldungen von `UserFacingError` und
 * Better-Auth-APIErrors weiter; Bank-API-Fehler werden auf eine Meldung je
 * Statuscode abgebildet. Alles andere wird mit Kontext protokolliert und
 * durch `fallback` ersetzt.
 */
export function publicErrorMessage(err: unknown, fallback: string, context: string): string {
  // Weiterleitungen von Next.js (z. B. requireUser → /login) sind keine
  // Fehler und dürfen nicht als Meldung verschluckt werden
  unstable_rethrow(err);
  if (err instanceof UserFacingError || isAuthApiError(err)) return err.message;
  console.error(`[${context}]`, err);
  if (isBankApiError(err)) return bankStatusMessage(err.status);
  return fallback;
}
