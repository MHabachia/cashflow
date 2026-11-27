import { eq } from "drizzle-orm";
import { db } from "./db";
import { user as userTable } from "./db/schema";

/**
 * true, wenn der Benutzer vom Admin gesperrt wurde.
 * Liest bewusst direkt aus der Datenbank: Die Sperre muss für jeden
 * Anmeldeweg (Passwort, Passkey, 2FA) und jede bestehende Sitzung sofort gelten.
 */
export function isUserBanned(userId: string): boolean {
  const row = db
    .select({ banned: userTable.banned })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .get();
  return row?.banned === true;
}
