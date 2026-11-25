"use client";

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";

export interface AuditLogRow {
  id: string;
  createdAt: string;
  action: string;
  userLabel: string | null;
  actorLabel: string | null;
  target: string | null;
  ipAddress: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  "auth.login.success": "Anmeldung erfolgreich",
  "auth.login.failure": "Anmeldung fehlgeschlagen",
  "auth.login.locked": "Anmeldung gesperrt (zu viele Versuche)",
  "auth.signup.blocked": "Registrierung blockiert",
  "auth.register": "Registrierung",
  "auth.password.change": "Passwort geändert",
  "auth.email.change": "E-Mail-Adresse geändert",
  "auth.sessions.revoke": "Andere Sitzungen beendet",
  "auth.password.reset": "Passwort zurückgesetzt",
  "auth.password.reset_failed": "Passwort-Wiederherstellung fehlgeschlagen",
  "auth.recovery_codes.generate": "Wiederherstellungscodes erzeugt",
  "admin.user.create": "Benutzer angelegt",
  "admin.user.role": "Rolle geändert",
  "admin.user.ban": "Benutzer gesperrt",
  "admin.user.unban": "Benutzer entsperrt",
  "admin.user.password_reset": "Passwort zurückgesetzt",
  "admin.user.delete": "Benutzer gelöscht",
  "admin.settings.update": "Einstellungen geändert",
  "admin.invite.create": "Einladung erstellt",
  "admin.invite.delete": "Einladung gelöscht",
  "admin.backup.download": "Backup heruntergeladen",
  "admin.backup.create": "Sicherung erstellt",
  "admin.backup.verify": "Sicherung geprüft",
  "admin.backup.restore_staged": "Wiederherstellung vorgemerkt",
  "bank.connect": "Bank verbunden",
  "bank.disconnect": "Bank getrennt",
  "bank.consent_expired": "Bank-Zustimmung abgelaufen",
};

function isWarning(action: string) {
  return (
    action === "auth.login.failure" ||
    action === "auth.login.locked" ||
    action === "auth.signup.blocked" ||
    action === "auth.password.reset_failed"
  );
}

type Group = "all" | "warnings" | "auth" | "admin" | "bank";

const GROUP_LABELS: Record<Group, string> = {
  all: "Alle Ereignisse",
  warnings: "Nur Warnungen",
  auth: "Anmeldung & Konto",
  admin: "Administration",
  bank: "Banking",
};

function inGroup(action: string, group: Group) {
  if (group === "all") return true;
  if (group === "warnings") return isWarning(action);
  return action.startsWith(`${group}.`);
}

export function AuditLogSection({ entries }: { entries: AuditLogRow[] }) {
  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        inGroup(e.action, group) &&
        (!q ||
          [e.userLabel, e.actorLabel, e.target, e.ipAddress].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [entries, group, query]);

  // Auffällig viele Fehlversuche in den letzten 24 Stunden
  const recentFailures = useMemo(() => {
    const since = Date.now() - 24 * 3600 * 1000;
    return entries.filter(
      (e) =>
        (e.action === "auth.login.failure" || e.action === "auth.login.locked") &&
        new Date(e.createdAt).getTime() >= since
    ).length;
  }, [entries]);

  return (
    <section aria-labelledby="audit-log-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-zinc-500" aria-hidden="true" />
        <h2
          id="audit-log-heading"
          className="text-sm font-bold text-zinc-900 dark:text-zinc-100"
        >
          Sicherheitsprotokoll
        </h2>
        <span className="text-xs text-zinc-500">
          (letzte {entries.length} Einträge, Aufbewahrung 12 Monate)
        </span>
      </div>

      {recentFailures >= 5 && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {recentFailures} fehlgeschlagene oder gesperrte Anmeldungen in den letzten 24 Stunden.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="audit-group">Ereignisart</label>
        <select
          id="audit-group"
          value={group}
          onChange={(e) => setGroup(e.target.value as Group)}
          className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
        >
          {(Object.keys(GROUP_LABELS) as Group[]).map((g) => (
            <option key={g} value={g}>{GROUP_LABELS[g]}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="audit-query">Benutzer, Ziel oder IP suchen</label>
        <input
          id="audit-query"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Benutzer, Ziel oder IP"
          className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 min-w-48"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-zinc-500">{entries.length === 0 ? "Noch keine Einträge." : "Keine Einträge für diesen Filter."}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <caption className="sr-only">Sicherheitsrelevante Ereignisse</caption>
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Zeit</th>
                <th scope="col" className="px-3 py-2 font-semibold">Ereignis</th>
                <th scope="col" className="px-3 py-2 font-semibold">Benutzer</th>
                <th scope="col" className="px-3 py-2 font-semibold">Ausgeführt von</th>
                <th scope="col" className="px-3 py-2 font-semibold">Ziel</th>
                <th scope="col" className="px-3 py-2 font-semibold">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visible.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-400">
                    {new Date(e.createdAt).toLocaleString("de-DE")}
                  </td>
                  <td
                    className={`px-3 py-2 whitespace-nowrap font-medium ${
                      isWarning(e.action)
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                                        {ACTION_LABELS[e.action] ?? e.action}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{e.userLabel ?? "–"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{e.actorLabel ?? "–"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400 break-all">{e.target ?? "–"}</td>
                  <td className="px-3 py-2 text-zinc-500 tabular-nums">{e.ipAddress ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
