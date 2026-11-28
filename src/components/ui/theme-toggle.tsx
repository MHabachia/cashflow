"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyThemeClass,
  parseThemeMode,
  setThemeMode,
  type ThemeMode,
} from "@/lib/theme";

export type { ThemeMode };

export function ThemeToggleButton() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Wenn noch nichts gespeichert ist, Systempräferenz einmalig ermitteln
    const initial =
      parseThemeMode(localStorage.getItem(THEME_STORAGE_KEY)) ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
    applyThemeClass(initial);

    // Umschalten an anderer Stelle (z. B. Befehlsleiste) im Symbol nachziehen
    const handleChange = (event: Event) => {
      const mode = parseThemeMode((event as CustomEvent<string>).detail);
      if (mode) setTheme(mode);
    };
    window.addEventListener(THEME_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleChange);
  }, []);

  function toggleTheme() {
    setThemeMode(theme === "dark" ? "light" : "dark");
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
