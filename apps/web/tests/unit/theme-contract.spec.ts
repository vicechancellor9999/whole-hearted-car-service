import { expect, test } from "@playwright/test";
import {
  readThemeMode,
  resolveTheme,
  type ThemeMode,
} from "../../src/components/theme/theme-contract";

function memoryStorage(entries: Array<[string, string]> = []) {
  const values = new Map<string, string>(entries);
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  };
}

test("system mode resolves from the operating-system preference", () => {
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("system", true)).toBe("dark");
});

test("explicit modes ignore the operating-system preference", () => {
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

test("legacy explicit dark migrates to dark mode", () => {
  const { storage, values } = memoryStorage([
    ["wh_theme", "dark"],
    ["wh_theme_source", "user"],
  ]);

  expect(readThemeMode(storage)).toBe("dark" satisfies ThemeMode);
  expect(values.get("wh_theme_mode")).toBe("dark");
  expect(values.has("wh_theme_source")).toBe(false);
});

test("legacy explicit light migrates to light mode", () => {
  const { storage, values } = memoryStorage([
    ["wh_theme", "light"],
    ["wh_theme_source", "user"],
  ]);

  expect(readThemeMode(storage)).toBe("light" satisfies ThemeMode);
  expect(values.get("wh_theme_mode")).toBe("light");
});

test("new origins and legacy automatic values migrate to system mode", () => {
  for (const entries of [[], [["wh_theme", "dark"]] as Array<[string, string]>]) {
    const { storage, values } = memoryStorage(entries);
    expect(readThemeMode(storage)).toBe("system" satisfies ThemeMode);
    expect(values.get("wh_theme_mode")).toBe("system");
  }
});

test("valid stored modes remain authoritative", () => {
  for (const mode of ["system", "light", "dark"] as const) {
    const { storage, values } = memoryStorage([
      ["wh_theme_mode", mode],
      ["wh_theme", mode === "system" ? "dark" : mode],
    ]);
    expect(readThemeMode(storage)).toBe(mode satisfies ThemeMode);
    expect(values.get("wh_theme_mode")).toBe(mode);
  }
});
