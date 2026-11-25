"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Zeigt einen Hinweis, sobald eine neue App-Version installiert ist.
 * Der neue Service Worker übernimmt erst nach Klick auf „Aktualisieren“,
 * damit laufende Eingaben nicht durch ein automatisches Neuladen verloren gehen.
 */
export function SwUpdateNotifier() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let cancelled = false;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || cancelled) return;

      // Bereits wartende Version (z. B. nach Neustart des Browsers)
      if (reg.waiting && navigator.serviceWorker.controller) {
        setWaiting(reg.waiting);
      }

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setWaiting(reg.waiting ?? installing);
          }
        });
      });

      // Beim Zurückkehren in die App nach Updates suchen
      const onVisible = () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", onVisible);
    });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-blue-500/10 border border-blue-500/25 text-blue-800 dark:text-blue-300 px-4 py-2.5 rounded-2xl text-xs font-medium flex items-center justify-between gap-2"
    >
      <span>Eine neue Version der App ist verfügbar.</span>
      <button
        type="button"
        onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        Aktualisieren
      </button>
    </div>
  );
}
