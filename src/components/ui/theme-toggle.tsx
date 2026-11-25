"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export type ThemeMode = "light" | "dark";

function applyThemeClass(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (mode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function ThemeToggleButton() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("cashflow_theme");
    let initial: ThemeMode;
    if (saved === "dark" || saved === "light") {
      initial = saved;
    } else {
      // Wenn noch nichts gespeichert ist, Systempräferenz einmalig ermitteln
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      initial = prefersDark ? "dark" : "light";
    }
    setTheme(initial);
    applyThemeClass(initial);
  }, []);

  function toggleTheme() {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("cashflow_theme", next);
    } catch {}
    applyThemeClass(next);
  }

  // Bevor gemountet ist, neutralen Platzhalter rendern um Hydration Mismatch zu verhindern
  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Design umschalten"
        className="p-2 rounded-md text-zinc-400 opacity-60"
        disabled
      >
        <Moon className="w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={
        theme === "dark"
          ? "Hellen Modus verwenden"
          : "Dunklen Modus verwenden"
      }
      aria-label="Zwischen Hell- und Dunkelmodus umschalten"
      className="min-w-11 min-h-11 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition flex items-center justify-center cursor-pointer"
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4" aria-hidden="true" />
      )}
    </button>
  );
}
