"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CashflowLogo } from "@/components/ui/cashflow-logo";
import { ThemeToggleButton } from "@/components/ui/theme-toggle";
import {
  LogOut,
  Shield,
  User,
  KeyRound,
  Info,
  Search,
  Wrench,
  LayoutDashboard,
  ListOrdered,
  Landmark,
  Tag,
  BarChart3,
  Inbox,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { clearLocalUserData, getOfflineQueue } from "@/lib/offline-queue";
import { removePushSubscriptionAction } from "@/actions/notification-actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function TopHeader({
  userName,
  userEmail = "",
  userImage = null,
  userRole,
  appName = "Cashflow",
  appSubtitle = "Fixkosten & Variable Ausgaben",
  primaryColor = "#2563eb",
  customLogoPath = null,
  inboxCount = 0,
}: {
  userName: string;
  userEmail?: string;
  userImage?: string | null;
  userRole: string;
  appName?: string;
  appSubtitle?: string;
  primaryColor?: string;
  customLogoPath?: string | null;
  inboxCount?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleLogout() {
    setMenuOpen(false);
    const pending = await getOfflineQueue();
    if (
      pending.length > 0 &&
      !confirm(
        `${pending.length} offline erfasste Buchung(en) wurden noch nicht synchronisiert und gehen beim Abmelden verloren. Trotzdem abmelden?`
      )
    ) {
      return;
    }
    // Push-Abo dieses Geräts entfernen, damit nach dem Abmelden keine
    // Meldungen dieses Kontos mehr auf dem (evtl. geteilten) Gerät erscheinen
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
    } catch {
      // Push nicht verfügbar
    }
    await authClient.signOut();
    await clearLocalUserData();
    toast.success("Abgemeldet");
    router.push("/login");
    router.refresh();
  }

  const desktopNavItems = [
    { href: "/", label: "Übersicht", icon: LayoutDashboard },
    { href: "/transactions", label: "Umsätze", icon: ListOrdered },
    { href: "/banking", label: "Banking", icon: Landmark },
    { href: "/categories", label: "Kategorien", icon: Tag },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 pt-safe">
      <div
        className={cn(
          "mx-auto px-4 h-14 flex items-center justify-between gap-3 transition-all duration-200",
          "max-w-2xl lg:max-w-7xl"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2.5 min-w-0 shrink-0">
            <CashflowLogo
              className="w-7 h-7 rounded-lg shrink-0"
              primaryColor={primaryColor}
              customLogoPath={customLogoPath}
            />
            <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
              {appName}
            </span>
          </Link>

          {/* Desktop-Navigation direkt im Header, wenn Desktop-Breitbild aktiv ist */}
          {(
            <nav className="hidden lg:flex items-center gap-1 ml-6" aria-label="Hauptnavigation">
              {desktopNavItems.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : item.href === "/transactions"
                    ? pathname.startsWith("/transactions") ||
                      pathname.startsWith("/recurring")
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm transition",
                      active
                        ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* Info-Link + Command-Bar + View-Toggle + Theme Toggle + Runder Profil-Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            href="/inbox"
            className="relative min-w-11 min-h-11 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            aria-label={
              inboxCount > 0
                ? `Umsätze prüfen (${inboxCount} offen)`
                : "Umsätze prüfen"
            }
            title="Neue Umsätze prüfen"
          >
            <Inbox className="w-4 h-4" aria-hidden="true" />
            {inboxCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold leading-none flex items-center justify-center">
                {inboxCount > 99 ? "99+" : inboxCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("toggle-command-bar"))}
            title="Spotlight-Suche & Schnellaktionen (⌘K)"
            aria-label="Spotlight-Suche (⌘K)"
            className="min-w-11 min-h-11 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
          </button>

          <ThemeToggleButton />

          {/* Eleganter runder Profil-Button */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Benutzerprofil & Menü öffnen"
              title={userName}
              className="ml-1 w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
            >
              {userImage ? (
                <img
                  src={userImage}
                  alt={userName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: primaryColor }}
                >
                  {getInitials(userName || "U")}
                </div>
              )}
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg py-1 z-50">
                <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
                  {userImage ? (
                    <img
                      src={userImage}
                      alt={userName}
                      className="w-10 h-10 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                      style={{ backgroundColor: primaryColor }}
                    >
                      {getInitials(userName || "U")}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{userName}</p>
                    {userEmail && (
                      <p className="text-xs text-zinc-500 truncate">
                        {userEmail}
                      </p>
                    )}
                  </div>
                </div>

                <div className="py-1">
                  <Link
                    href="/settings?section=profile"
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2 text-sm flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition"
                  >
                    <User className="w-4 h-4 text-zinc-400" />
                    <span>Profil</span>
                  </Link>

                  <Link
                    href="/settings?section=password"
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2 text-sm flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition"
                  >
                    <KeyRound className="w-4 h-4 text-zinc-400" />
                    <span>Sicherheit</span>
                  </Link>

                  <Link
                    href="/tools"
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2 text-sm flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition"
                  >
                    <Wrench className="w-4 h-4 text-zinc-400" />
                    <span>Werkzeuge</span>
                  </Link>

                  <Link
                    href="/reports"
                    onClick={() => setMenuOpen(false)}
                    className="px-4 py-2 text-sm flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition"
                  >
                    <BarChart3 className="w-4 h-4 text-zinc-400" />
                    <span>Jahresbericht</span>
                  </Link>

                  {userRole === "admin" && (
                    <Link
                      href="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="px-4 py-2 text-sm flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition"
                    >
                      <Shield className="w-4 h-4 text-zinc-400" />
                      <span>Administration</span>
                    </Link>
                  )}
                  {userRole === "admin" && (
                    <Link
                      href="/info"
                      onClick={() => setMenuOpen(false)}
                      aria-label="System-Info (nur Admins)"
                      className="px-4 py-2 text-sm flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition"
                    >
                      <Info className="w-4 h-4 text-zinc-400" />
                      <span>System-Info</span>
                    </Link>
                  )}
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-1 mt-1">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition text-left cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 text-zinc-400" />
                    <span>Abmelden</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
