/**
 * Hell-/Dunkelmodus: ein Speicherort und eine Funktion für alle Stellen, die
 * das Design umschalten (Theme-Knopf, Befehlsleiste). Das Inline-Skript in
 * src/app/layout.tsx liest denselben Schlüssel vor dem ersten Rendern.
 */

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "cashflow_theme";
export const THEME_CHANGE_EVENT = "cashflow-theme-change";

export function parseThemeMode(value: string | null | undefined): ThemeMode | null {
  return value === "dark" || value === "light" ? value : null;
}

export interface ThemeEnvironment {
  storage: Pick<Storage, "setItem">;
  classList: Pick<DOMTokenList, "toggle">;
  dispatch: (event: Event) => void;
}

function browserEnvironment(): ThemeEnvironment {
  return {
    storage: window.localStorage,
    classList: document.documentElement.classList,
    dispatch: (event) => window.dispatchEvent(event),
  };
}

/** Setzt die Klasse am Wurzelelement, ohne zu speichern. */
export function applyThemeClass(mode: ThemeMode, env: Pick<ThemeEnvironment, "classList"> = browserEnvironment()) {
  env.classList.toggle("dark", mode === "dark");
}

/** Speichert den Modus, wendet ihn an und benachrichtigt andere Komponenten. */
export function setThemeMode(mode: ThemeMode, env: ThemeEnvironment = browserEnvironment()) {
  try {
    env.storage.setItem(THEME_STORAGE_KEY, mode);
  } catch (err) {
    // Speicher gesperrt (z. B. privater Modus): Modus gilt dann nur bis zum Neuladen
    console.warn("[Theme] Design konnte nicht gespeichert werden.", err);
  }
  applyThemeClass(mode, env);
  env.dispatch(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: mode }));
}
