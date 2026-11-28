"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  Receipt,
  Landmark,
  Repeat,
  Folder,
  Settings,
  Info,
  Shield,
  Plus,
  ArrowRightLeft,
  CreditCard,
  FileSpreadsheet,
  Moon,
  Sun,
  X,
  ArrowRight,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { setThemeMode } from "@/lib/theme";

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "Navigation" | "Aktionen" | "Konten" | "Kategorien";
  action: () => void;
  keywords?: string[];
}

export function CommandBar({
  categories = [],
  bankAccounts = [],
  userRole = "user",
}: {
  categories?: Array<{ id: string; name: string; type: string }>;
  bankAccounts?: Array<{ id: string; accountName: string; accountType: string }>;
  userRole?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Globaler Keyboard-Listener: Cmd+K / Ctrl+K & Event-Listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    }

    function handleCustomToggle() {
      setOpen((prev) => !prev);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("toggle-command-bar", handleCustomToggle);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("toggle-command-bar", handleCustomToggle);
    };
  }, [open]);

  // Autofokus beim Öffnen
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Navigation Helper
  function navigate(path: string) {
    setOpen(false);
    router.push(path);
  }

  // Alle Befehle und Aktionen
  const allCommands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      // Navigation
      {
        id: "nav-dashboard",
        title: "Dashboard",
        subtitle: "Monatsüberblick, Saldo & Budget",
        icon: LayoutDashboard,
        group: "Navigation",
        keywords: ["home", "übersicht", "start"],
        action: () => navigate("/"),
      },
      {
        id: "nav-transactions",
        title: "Umsätze & Ausgaben",
        subtitle: "Transaktionsliste, Belege & Historie",
        icon: Receipt,
        group: "Navigation",
        keywords: ["buchungen", "ausgaben", "einnahmen"],
        action: () => navigate("/transactions"),
      },
      {
        id: "nav-banking",
        title: "Banken & Konten",
        subtitle: "PSD2 Open Banking & Kreditkarten",
        icon: Landmark,
        group: "Navigation",
        keywords: ["ing", "advanzia", "giro", "kreditkarte", "saldo"],
        action: () => navigate("/banking"),
      },
      {
        id: "nav-recurring",
        title: "Fixkosten & Verträge",
        subtitle: "Regelmäßige Ausgaben & Verträge",
        icon: Repeat,
        group: "Navigation",
        keywords: ["abos", "dauerauftrag", "miete", "vertrag"],
        action: () => navigate("/recurring"),
      },
      {
        id: "nav-categories",
        title: "Kategorien & Budgets",
        subtitle: "Kategorien verwalten, Budgets & Auto-Regeln",
        icon: Folder,
        group: "Navigation",
        keywords: ["budget", "grenze", "limits", "regeln"],
        action: () => navigate("/categories"),
      },
      {
        id: "nav-tools",
        title: "Tools, Import & Export",
        subtitle: "CSV/PDF-Import, Backups & Auto-Regeln",
        icon: FileSpreadsheet,
        group: "Navigation",
        keywords: ["tools", "import", "export", "csv", "pdf", "advanzia", "backup", "regeln"],
        action: () => navigate("/tools"),
      },
      {
        id: "nav-settings",
        title: "Profil & Einstellungen",
        subtitle: "Nutzerprofil, PWA & CSV Import/Export",
        icon: Settings,
        group: "Navigation",
        keywords: ["profil", "sicherheit", "daten"],
        action: () => navigate("/settings"),
      },
      ...(userRole === "admin"
        ? [
            {
              id: "nav-info",
              title: "System-Info (Admin)",
              subtitle: "Version, Architektur & Open-Banking",
              icon: Info,
              group: "Navigation" as const,
              keywords: ["version", "status", "api", "changelog"],
              action: () => navigate("/info"),
            },
          ]
        : []),

      // Schnellaktionen
      {
        id: "action-add-expense",
        title: "Neue Ausgabe erfassen",
        subtitle: "Schnellbuchung öffnen",
        icon: Plus,
        group: "Aktionen",
        keywords: ["neu", "buchen", "ausgabe", "beleg"],
        action: () => {
          setOpen(false);
          window.dispatchEvent(new CustomEvent("open-quick-add", { detail: { type: "expense" } }));
        },
      },
      {
        id: "action-add-income",
        title: "Neue Einnahme erfassen",
        subtitle: "Gehalt, Rückzahlung oder Bonus buchen",
        icon: Plus,
        group: "Aktionen",
        keywords: ["einnahme", "gehalt", "plus"],
        action: () => {
          setOpen(false);
          window.dispatchEvent(new CustomEvent("open-quick-add", { detail: { type: "income" } }));
        },
      },
      {
        id: "action-card-transfer",
        title: "Kartenausgleich / Umbuchung",
        subtitle: "Geld von Giro auf Kreditkarte überweisen",
        icon: ArrowRightLeft,
        group: "Aktionen",
        keywords: ["ausgleich", "transfer", "umbuchung", "schulden"],
        action: () => navigate("/banking"),
      },
      {
        id: "action-import-csv",
        title: "Kontoauszug importieren (CSV / PDF)",
        subtitle: "Advanzia, TF Bank oder Giroauszüge einlesen",
        icon: FileSpreadsheet,
        group: "Aktionen",
        keywords: ["import", "pdf", "csv", "auszug"],
        action: () => navigate("/transactions?tab=import"),
      },
      {
        id: "action-add-card",
        title: "Manuelle Kreditkarte / Geldquelle anlegen",
        subtitle: "z. B. Advanzia, TF Bank oder Bargeld",
        icon: CreditCard,
        group: "Aktionen",
        keywords: ["karte", "kreditkarte", "geldquelle", "konto anlegen"],
        action: () => navigate("/banking"),
      },
      {
        id: "action-theme-toggle",
        title: "Design wechseln (Hell / Dunkel)",
        subtitle: "Theme umschalten",
        icon: Moon,
        group: "Aktionen",
        keywords: ["theme", "dark", "light", "modus", "design"],
        action: () => {
          setOpen(false);
          const isDark = document.documentElement.classList.contains("dark");
          setThemeMode(isDark ? "light" : "dark");
        },
      },
    ];

    if (userRole === "admin") {
      items.push({
        id: "nav-admin",
        title: "Admin-Konsole",
        subtitle: "Benutzerverwaltung, Logs & System",
        icon: Shield,
        group: "Navigation",
        keywords: ["admin", "users", "benutzer", "rollen"],
        action: () => navigate("/admin"),
      });
    }

    // Konten des Nutzers
    for (const acc of bankAccounts) {
      items.push({
        id: `account-${acc.id}`,
        title: acc.accountName,
        subtitle: `Konto öffnen (${acc.accountType === "credit_card" ? "Kreditkarte" : "Konto"})`,
        icon: Wallet,
        group: "Konten",
        keywords: ["konto", acc.accountName.toLowerCase(), acc.accountType],
        action: () => navigate("/banking"),
      });
    }

    // Kategorien des Nutzers
    for (const cat of categories) {
      items.push({
        id: `cat-${cat.id}`,
        title: cat.name,
        subtitle: `Kategorie anzeigen (${cat.type === "income" ? "Einnahme" : "Ausgabe"})`,
        icon: Folder,
        group: "Kategorien",
        keywords: ["kategorie", cat.name.toLowerCase()],
        action: () => navigate("/categories"),
      });
    }

    return items;
  }, [categories, bankAccounts, userRole]);

  // Suchfilter
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands;
    const lower = query.toLowerCase().trim();
    return allCommands.filter((cmd) => {
      if (cmd.title.toLowerCase().includes(lower)) return true;
      if (cmd.subtitle?.toLowerCase().includes(lower)) return true;
      if (cmd.keywords?.some((k) => k.toLowerCase().includes(lower))) return true;
      return false;
    });
  }, [allCommands, query]);

  // Tastaturnavigation im Suchfenster
  function handleKeyDownInBox(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? Math.max(0, filteredCommands.length - 1) : prev - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
      }
    }
  }

  // Automatisches Scrollen zum ausgewählten Element
  useEffect(() => {
    if (!listRef.current) return;
    const selectedElem = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    if (selectedElem) {
      selectedElem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-14 sm:pt-20 px-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-150"
        onKeyDown={handleKeyDownInBox}
      >
        {/* Suchfeld */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50">
          <Search className="w-5 h-5 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Seiten, Aktionen, Konten oder Kategorien suchen..."
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition"
            aria-label="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Ergebnisliste */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredCommands.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-400">
              Keine Treffer für „{query}“ gefunden.
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = cmd.icon;

              return (
                <button
                  key={cmd.id}
                  type="button"
                  data-index={idx}
                  onClick={() => cmd.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition cursor-pointer group",
                    isSelected
                      ? "bg-blue-600 text-white shadow-xs"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition",
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-xs truncate">
                        {cmd.title}
                      </div>
                      {cmd.subtitle && (
                        <div
                          className={cn(
                            "text-xs truncate",
                            isSelected
                              ? "text-blue-100"
                              : "text-zinc-400 dark:text-zinc-500"
                          )}
                        >
                          {cmd.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span
                      className={cn(
                        "text-[9px] font-semibold px-1.5 py-0.5 rounded-md",
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                      )}
                    >
                      {cmd.group}
                    </span>
                    <ArrowRight
                      className={cn(
                        "w-3.5 h-3.5 transition opacity-0 group-hover:opacity-100",
                        isSelected && "opacity-100"
                      )}
                    />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Tastatur-Tipps Fußzeile */}
        <div className="px-3.5 py-2 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/50 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span>↑↓ Auswählen</span>
            <span>↵ Öffnen</span>
            <span>ESC Schließen</span>
          </div>
          <div className="flex items-center gap-1 font-mono">
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
              ⌘K
            </kbd>
          </div>
        </div>
      </div>
    </div>
  );
}