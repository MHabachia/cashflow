import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  parseThemeMode,
  setThemeMode,
  type ThemeEnvironment,
} from "../../src/lib/theme";

function fakeEnvironment(options: { storageFails?: boolean } = {}) {
  const stored = new Map<string, string>();
  const classes = new Set<string>();
  const events: CustomEvent[] = [];
  const env: ThemeEnvironment = {
    storage: {
      setItem: (key, value) => {
        if (options.storageFails) throw new Error("gesperrt");
        stored.set(key, value);
      },
    },
    classList: {
      toggle: (token: string, force?: boolean) => {
        if (force) classes.add(token);
        else classes.delete(token);
        return classes.has(token);
      },
    },
    dispatch: (event) => {
      events.push(event as CustomEvent);
    },
  };
  return { env, stored, classes, events };
}

describe("Design (Hell/Dunkel)", () => {
  it("speichert unter dem Schlüssel, den das Inline-Skript liest", () => {
    const { env, stored, classes } = fakeEnvironment();
    setThemeMode("dark", env);
    assert.equal(stored.get(THEME_STORAGE_KEY), "dark");
    assert.equal(THEME_STORAGE_KEY, "cashflow_theme");
    assert.equal(classes.has("dark"), true);

    setThemeMode("light", env);
    assert.equal(stored.get(THEME_STORAGE_KEY), "light");
    assert.equal(classes.has("dark"), false);
  });

  it("meldet die Änderung, damit der Theme-Knopf sein Symbol nachzieht", () => {
    const { env, events } = fakeEnvironment();
    setThemeMode("dark", env);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, THEME_CHANGE_EVENT);
    assert.equal(events[0].detail, "dark");
  });

  it("wendet den Modus auch an, wenn der Speicher gesperrt ist", (t) => {
    t.mock.method(console, "warn", () => {});
    const { env, classes, events } = fakeEnvironment({ storageFails: true });
    setThemeMode("dark", env);
    assert.equal(classes.has("dark"), true);
    assert.equal(events.length, 1);
  });

  it("akzeptiert nur bekannte Werte", () => {
    assert.equal(parseThemeMode("dark"), "dark");
    assert.equal(parseThemeMode("light"), "light");
    assert.equal(parseThemeMode("system"), null);
    assert.equal(parseThemeMode(null), null);
  });

  it("kein Bestandteil speichert das Design noch unter einem anderen Schlüssel", () => {
    for (const file of ["src/components/layout/command-bar.tsx", "src/components/ui/theme-toggle.tsx"]) {
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(source, /localStorage\.setItem\(\s*["']theme["']/, file);
    }
  });
});
