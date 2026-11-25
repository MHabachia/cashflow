"use client";

import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { SlidersHorizontal, Check, RotateCcw, X, Eye, EyeOff } from "lucide-react";

export type WidgetId =
  | "hero_balance"
  | "accounts"
  | "forecast"
  | "recent_transactions"
  | "fixed_costs"
  | "trend_chart"
  | "budgets"
  | "categories"
  | "savings"
  | "tools";

export interface WidgetConfig {
  id: WidgetId;
  label: string;
  description: string;
  defaultVisible: boolean;
}

export const AVAILABLE_WIDGETS: WidgetConfig[] = [
  {
    id: "hero_balance",
    label: "Monatsbilanz & Tagesbudget",
    description: "Saldo, Einnahmen, Fixkosten, freies Budget & tägliche Burn-Rate",
    defaultVisible: true,
  },
  {
    id: "accounts",
    label: "Konten & Karten Leiste",
    description: "Live-Salden von Bankkonten, Kreditkarten & PayPal",
    defaultVisible: true,
  },
  {
    id: "forecast",
    label: "Prognose & Nettovermögen",
    description: "Voraussichtlicher Kontostand am Monatsende und Vermögensverlauf",
    defaultVisible: false,
  },
  {
    id: "recent_transactions",
    label: "Letzte Aktivitäten",
    description: "Chronologische Liste der jüngsten Ausgaben & Einnahmen",
    defaultVisible: true,
  },
  {
    id: "fixed_costs",
    label: "Fixkosten & Abos",
    description: "Geplante monatliche Daueraufträge und anstehende Abbuchungen",
    defaultVisible: false,
  },
  {
    id: "trend_chart",
    label: "12-Monate Ausgaben-Trend",
    description: "Historischer Balken-Chart für Fix- vs. variable Kosten",
    defaultVisible: false,
  },
  {
    id: "budgets",
    label: "Monatsbudgets",
    description: "Fortschrittsbalken und Ampel-Status für Budgetgrenzen",
    defaultVisible: true,
  },
  {
    id: "categories",
    label: "Ausgaben nach Kategorien",
    description: "Prozentuale Verteilung der aktuellen Monatsausgaben",
    defaultVisible: false,
  },
  {
    id: "savings",
    label: "Sparziele & Sinking Funds",
    description: "Sparfortschritt, Zielbeträge & monatliche Sparraten",
    defaultVisible: false,
  },
  {
    id: "tools",
    label: "Werkzeuge & Daten",
    description: "Schnellzugriff auf Import, Export und Sicherungen",
    // Doppelt zur Navigation (Menü → Werkzeuge), daher standardmäßig aus
    defaultVisible: false,
  },
];

const STORAGE_KEY = "cashflow_dashboard_widgets_v1";

interface WidgetContextType {
  visibleWidgets: Record<WidgetId, boolean>;
  toggleWidget: (id: WidgetId) => void;
  applyPreset: (preset: "minimal" | "budget" | "full") => void;
  resetToDefault: () => void;
  isCustomized: boolean;
}

const WidgetContext = createContext<WidgetContextType | null>(null);

export function useDashboardWidgets() {
  const ctx = useContext(WidgetContext);
  if (!ctx) {
    throw new Error("useDashboardWidgets must be used within DashboardWidgetSystem");
  }
  return ctx;
}

export function DashboardWidget({
  id,
  children,
  className = "",
}: {
  id: WidgetId;
  children: ReactNode;
  className?: string;
}) {
  const { visibleWidgets } = useDashboardWidgets();
  if (visibleWidgets[id] === false) {
    return null;
  }
  return <div className={className}>{children}</div>;
}

export function DashboardWidgetSystem({ children }: { children: ReactNode }) {
  const [visibleWidgets, setVisibleWidgets] = useState<Record<WidgetId, boolean>>(() => {
    const initial: Record<WidgetId, boolean> = {} as Record<WidgetId, boolean>;
    AVAILABLE_WIDGETS.forEach((w) => {
      initial[w.id] = w.defaultVisible;
    });
    return initial;
  });
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const open = () => setModalOpen(true);
    window.addEventListener("open-dashboard-customize", open);
    return () => window.removeEventListener("open-dashboard-customize", open);
  }, []);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setVisibleWidgets((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  function saveConfig(updated: Record<WidgetId, boolean>) {
    setVisibleWidgets(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  }

  function toggleWidget(id: WidgetId) {
    const updated = {
      ...visibleWidgets,
      [id]: !visibleWidgets[id],
    };
    saveConfig(updated);
  }

  function applyPreset(preset: "minimal" | "budget" | "full") {
    const updated: Record<WidgetId, boolean> = {} as Record<WidgetId, boolean>;
    AVAILABLE_WIDGETS.forEach((w) => {
      if (preset === "minimal") {
        updated[w.id] = ["hero_balance", "accounts", "recent_transactions"].includes(w.id);
      } else if (preset === "budget") {
        updated[w.id] = [
          "hero_balance",
          "accounts",
          "forecast",
          "budgets",
          "savings",
          "recent_transactions",
        ].includes(w.id);
      } else {
        updated[w.id] = true;
      }
    });
    saveConfig(updated);
  }

  function resetToDefault() {
    const def: Record<WidgetId, boolean> = {} as Record<WidgetId, boolean>;
    AVAILABLE_WIDGETS.forEach((w) => {
      def[w.id] = w.defaultVisible;
    });
    saveConfig(def);
  }

  const isCustomized = Object.values(visibleWidgets).some((v) => v === false);

  return (
    <WidgetContext.Provider
      value={{
        visibleWidgets,
        toggleWidget,
        applyPreset,
        resetToDefault,
        isCustomized,
      }}
    >
      {children}

      {/* Anpassungs-Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-zinc-900 dark:text-zinc-100">
                    Dashboard-Widgets & Ansicht anpassen
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Wähle, welche Bereiche für dich relevant sind
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Schnell-Presets */}
            <div className="p-4 bg-zinc-50/70 dark:bg-zinc-950/70 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                1-Klick Vorlagen:
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => applyPreset("minimal")}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 text-zinc-700 dark:text-zinc-300 transition"
                >
                  Minimal / Fokus
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("budget")}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 text-zinc-700 dark:text-zinc-300 transition"
                >
                  Budget-Fokus
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("full")}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 text-zinc-700 dark:text-zinc-300 transition"
                >
                  Vollständig
                </button>
              </div>
            </div>

            {/* Widget Toggle Liste */}
            <div className="p-4 overflow-y-auto space-y-2 flex-1 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {AVAILABLE_WIDGETS.map((w) => {
                const isVis = visibleWidgets[w.id] !== false;
                return (
                  <div
                    key={w.id}
                    onClick={() => toggleWidget(w.id)}
                    className="pt-2.5 first:pt-0 flex items-center justify-between gap-3 cursor-pointer py-1.5 group"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 transition truncate">
                        {w.label}
                      </p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-tight">
                        {w.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      aria-label={`${w.label} ein- oder ausschalten`}
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                        isVis ? "bg-blue-600" : "bg-zinc-200 dark:bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow-xs transform transition-transform ${
                          isVis ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <button
                type="button"
                onClick={resetToDefault}
                className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 inline-flex items-center gap-1 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Standard wiederherstellen</span>
              </button>

              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
              >
                Fertig
              </button>
            </div>
          </div>
        </div>
      )}
    </WidgetContext.Provider>
  );
}

/** Öffnet die Dashboard-Anpassung (Knopf in der Kopfzeile des Dashboards). */
export function CustomizeDashboardButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("open-dashboard-customize"))}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
    >
      <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
      <span className="hidden sm:inline">Anpassen</span>
      <span className="sr-only sm:hidden">Dashboard anpassen</span>
    </button>
  );
}
