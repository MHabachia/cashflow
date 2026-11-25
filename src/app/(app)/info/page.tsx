import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { getGlobalAppSettings } from "@/lib/settings";
import { CashflowLogo } from "@/components/ui/cashflow-logo";
import packageJson from "../../../../package.json";
import {
  Layers,
  Webhook,
  ExternalLink,
  Database,
  ShieldCheck,
  Smartphone,
  Cpu,
  CheckCircle2,
  GitBranch,
} from "lucide-react";

const TECH_STACK = [
  {
    name: "Next.js 15 & React 19",
    category: "Framework",
    description: "App Router, Server Actions & Standalone Container-Build.",
    badge: "v15.5",
  },
  {
    name: "TypeScript & Zod v4",
    category: "Validierung",
    description: "Strict-Mode Typisierung & End-to-End Schema-Validierung.",
    badge: "Strict",
  },
  {
    name: "SQLite WAL + Drizzle ORM",
    category: "Datenbank",
    description: "In-Process Engine (<0.1ms), Composite-Indizes & Cent-Werte.",
    badge: "ACID",
  },
  {
    name: "Better Auth & FIDO2",
    category: "Authentifizierung",
    description: "Passkeys, 2FA/TOTP, DB-Rate-Limit, Kontosperre & Passwort-Reset ohne E-Mail.",
    badge: "OWASP",
  },
  {
    name: "Open Banking (PSD2)",
    category: "Bank-Sync",
    description: "Enable Banking, PSD2-Tageslimit, AES-256-GCM Vault mit Schlüsselrotation.",
    badge: "AIS",
  },
  {
    name: "unpdf & Smart CSV Parser",
    category: "Daten-Import",
    description: "PDF-, CSV- & CAMT.053-Import mit Dublettenerkennung je Konto.",
    badge: "PDF/CSV",
  },
  {
    name: "Tailwind CSS v4",
    category: "UI & Design",
    description: "Mobile-First, Safe-Area-Support & nahtloser Dark/Light Mode.",
    badge: "v4.0",
  },
  {
    name: "Serwist PWA & IndexedDB",
    category: "Offline-Sync",
    description: "Offline-Erfassung, Update-Hinweis & Web-Push (VAPID, RFC 8291).",
    badge: "PWA",
  },
  {
    name: "Sharp & Recharts",
    category: "Engine & Charts",
    description: "WebP-Belegkomprimierung (EXIF/Magic-Bytes) & Finanz-Charts.",
    badge: "WebP",
  },
];

const API_ROUTES = [
  {
    method: "GET",
    path: "/api/health",
    auth: "Public",
    description: "Live-Status von SQLite-DB & Container-Healthcheck.",
  },
  {
    method: "GET / POST",
    path: "/api/auth/[...all]",
    auth: "Better Auth",
    description: "Login, Passkeys, 2FA, Session-Prüfung & Rate-Limit (Registrierung gesperrt).",
  },
  {
    method: "POST",
    path: "/api/cron/bank-sync",
    auth: "CRON_SECRET",
    description: "Externer Auslöser für den Bank-Sync (PSD2-Tageslimit beachtet).",
  },
  {
    method: "GET / POST",
    path: "/api/backup",
    auth: "Admin",
    description: "SQLite-Backup herunterladen bzw. Wiederherstellung vormerken.",
  },
  {
    method: "GET",
    path: "/api/backup/auto/[name]",
    auth: "Admin",
    description: "Automatische Sicherung als .sqlite herunterladen.",
  },
  {
    method: "GET",
    path: "/api/bank-sync/authorize",
    auth: "Session",
    description: "Initiiert PSD2-Bankverbindung mit signiertem CSRF-State.",
  },
  {
    method: "GET",
    path: "/api/bank-sync/callback",
    auth: "Session + HMAC",
    description: "Tauscht Bank-Auth-Code in verschlüsselte Konten & startet Sync.",
  },
  {
    method: "POST",
    path: "/api/receipts/upload",
    auth: "Session",
    description: "Prüft Magic-Bytes via sharp & speichert Belege als WebP.",
  },
  {
    method: "GET / DELETE",
    path: "/api/receipts/[userId]/[file]",
    auth: "Owner-Check",
    description: "Liefert oder löscht Belegfotos eigentümergeschützt.",
  },
  {
    method: "POST / DELETE",
    path: "/api/profile/avatar",
    auth: "Session",
    description: "Erstellt (256×256 WebP) oder entfernt Profilbilder.",
  },
  {
    method: "GET",
    path: "/api/csv/export",
    auth: "Session",
    description: "UTF-8 CSV-Export aller Buchungen (inkl. DDE-Schutz).",
  },
  {
    method: "GET",
    path: "/manifest.webmanifest",
    auth: "Public",
    description: "Dynamisches PWA-Manifest inkl. Custom Branding.",
  },
];

export default async function InfoPage() {
  // Technische Systeminfos (Stack, API-Routen) nur für Admins
  const user = await requireUser();
  if ((user as { role?: string }).role !== "admin") redirect("/");
  const settings = getGlobalAppSettings();

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* 1. Open Canvas Header: Cashflow Info & Single Top GitHub Action */}
      <div className="space-y-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <CashflowLogo
              className="w-12 h-12 rounded-lg shrink-0"
              primaryColor={settings.primaryColor}
              customLogoPath={settings.customLogoPath}
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {settings.appName}
                </h1>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  v{packageJson.version} Production
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {settings.appSubtitle} • Selbst gehostete Web-App & PWA
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://github.com/MHabachia/cashflow"
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 rounded-xl bg-brand text-white text-xs font-bold flex items-center gap-2 hover:opacity-90 transition"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>GitHub Repository</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs font-semibold flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            >
              <Cpu className="w-3.5 h-3.5 text-emerald-500" />
              <span>Health-JSON</span>
            </a>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 text-center">
          <div className="p-2.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-900/60">
            <Database className="w-4 h-4 text-blue-600 mx-auto mb-1" />
            <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">SQLite WAL</p>
            <p className="text-xs text-zinc-400">/data/app.db</p>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-900/60">
            <ShieldCheck className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
            <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Better Auth</p>
            <p className="text-xs text-zinc-400">Passkeys & 2FA</p>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-900/60">
            <Smartphone className="w-4 h-4 text-indigo-600 mx-auto mb-1" />
            <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Web & PWA</p>
            <p className="text-xs text-zinc-400">Offline IndexedDB</p>
          </div>
        </div>
      </div>

      {/* 2. Kompakter Techstack */}
      <div className="space-y-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <h2 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
              Techstack & Architektur
            </h2>
          </div>
          <span className="text-xs text-zinc-400 font-medium">Modern Self-Hosted Architecture</span>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80 border-t border-b border-zinc-200/80 dark:border-zinc-800">
          {TECH_STACK.map((item) => (
            <div
              key={item.name}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400 w-24 shrink-0">
                  {item.category}
                </span>
                <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {item.name}
                </span>
              </div>
              <div className="flex items-center gap-3 sm:text-right">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {item.description}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 tabular-nums font-semibold text-zinc-600 dark:text-zinc-300 shrink-0">
                  {item.badge}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Kompakte API-Routes Übersicht */}
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <Webhook className="w-4 h-4 text-indigo-600" />
            <h2 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
              API-Endpunkte
            </h2>
          </div>
          <span className="text-xs text-zinc-400 font-medium">REST & Route-Handler</span>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {API_ROUTES.map((route) => (
            <div
              key={route.path}
              className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 tabular-nums text-xs font-bold shrink-0">
                  {route.method}
                </span>
                <code className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100 text-xs">
                  {route.path}
                </code>
                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-medium">
                  {route.auth}
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 sm:text-right">
                {route.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
