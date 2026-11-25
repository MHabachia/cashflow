import { Activity } from "lucide-react";
import type { BankHealthRow, HealthCheck } from "@/lib/system-health";
import type { UpdateInfo } from "@/lib/update-check";
import { formatDateDE } from "@/lib/format";

export function SystemHealthSection({
  checks,
  banks,
  update,
}: {
  checks: HealthCheck[];
  banks: BankHealthRow[];
  update: UpdateInfo;
}) {
  return (
    <section aria-labelledby="health-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-zinc-500" aria-hidden="true" />
        <h2 id="health-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Systemzustand
        </h2>
      </div>

      {update.updateAvailable && update.latest && (
        <p role="status" className="text-sm text-zinc-700 dark:text-zinc-300">
          Neue Version {update.latest} verfügbar (installiert: {update.current}).{" "}
          {update.url && (
            <a href={update.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
              Änderungen ansehen
            </a>
          )}
        </p>
      )}

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 border-y border-zinc-100 dark:border-zinc-800">
        <li className="flex items-baseline justify-between gap-3 py-2 text-sm">
          <span className="text-zinc-500">Version</span>
          <span className="tabular-nums">
            {update.current}
            {update.checked && !update.updateAvailable && <span className="text-zinc-400"> · aktuell</span>}
          </span>
        </li>
        {checks.map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="text-zinc-500">{c.label}</span>
            <span className={c.level === "warn" ? "text-amber-700 dark:text-amber-400" : ""}>
                            {c.detail}
            </span>
          </li>
        ))}
      </ul>

      {banks.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 mb-1">Bankverbindungen</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Bankverbindungen aller Benutzer</caption>
              <thead className="text-zinc-500 text-left">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Benutzer</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Bank</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Letzter Abruf</th>
                  <th scope="col" className="py-1.5 font-medium">Zustimmung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {banks.map((b, i) => (
                  <tr key={`${b.userLabel}-${b.institution}-${i}`}>
                    <td className="py-1.5 pr-3 truncate max-w-40">{b.userLabel}</td>
                    <td className="py-1.5 pr-3">{b.institution}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {b.lastSyncedAt ? formatDateDE(b.lastSyncedAt.slice(0, 10)) : "noch nie"}
                    </td>
                    <td className={`py-1.5 tabular-nums ${b.daysLeft <= 7 || b.status !== "active" ? "text-amber-700 dark:text-amber-400" : ""}`}>
                      {b.status !== "active"
                        ? b.status === "expired" ? "abgelaufen" : b.status === "revoked" ? "widerrufen" : "Fehler"
                        : b.daysLeft < 0
                          ? "abgelaufen"
                          : `noch ${b.daysLeft} ${b.daysLeft === 1 ? "Tag" : "Tage"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
