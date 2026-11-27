import { auth } from "./auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensureDefaultCategoriesForUser } from "./db/defaults";
import { db } from "./db";
import { session as sessionTable } from "./db/schema";
import { eq, and, ne } from "drizzle-orm";
import { isUserBanned } from "./user-status";

/**
 * Aktuelle Sitzung ohne Sperrprüfung. Nur für `requireUser`, das gesperrte
 * Benutzer mit eigenem Hinweis auf die Anmeldeseite leitet.
 */
async function loadSession() {
  // Test-Session ausschließlich in der Unit-Test-Umgebung (NODE_ENV=test).
  // In jeder anderen Umgebung wird TEST_USER_ID ignoriert, damit eine falsch
  // gesetzte Variable niemals die Authentifizierung aushebelt.
  if (process.env.NODE_ENV === "test" && process.env.TEST_USER_ID) {
    return {
      user: {
        id: process.env.TEST_USER_ID,
        name: "Test User",
        email: "banktester@kosten.local",
        emailVerified: true,
        image: null as string | null,
        role: "user",
        banned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: { id: "test-session-id", userId: process.env.TEST_USER_ID },
    };
  }
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}

/**
 * Aktuelle Sitzung oder `null`. Gesperrte Benutzer gelten als nicht angemeldet,
 * damit API-Routen sie ohne eigene Prüfung abweisen.
 */
export async function getCurrentSession() {
  const session = await loadSession();
  if (!session?.user || isUserBanned(session.user.id)) return null;
  return session;
}

export async function requireUser() {
  const session = await loadSession();
  if (!session?.user) {
    redirect("/login");
  }
  if (isUserBanned(session.user.id)) {
    redirect("/login?banned=1");
  }
  ensureDefaultCategoriesForUser(session.user.id);
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if ((user as { role?: string }).role !== "admin") {
    throw new Error("Keine Administrator-Berechtigung.");
  }
  return user;
}

/**
 * Revidiert/Löscht alle Sessions eines Benutzers mit Ausnahme der übergebenen keepSessionId.
 * Falls keine keepSessionId übergeben wird, werden alle Sessions des Benutzers ungültig gemacht.
 */
export function revokeOtherUserSessions(
  userId: string,
  keepSessionId?: string | null
): number {
  if (keepSessionId) {
    const res = db
      .delete(sessionTable)
      .where(
        and(
          eq(sessionTable.userId, userId),
          ne(sessionTable.id, keepSessionId)
        )
      )
      .run();
    return res.changes;
  }
  const res = db
    .delete(sessionTable)
    .where(eq(sessionTable.userId, userId))
    .run();
  return res.changes;
}
