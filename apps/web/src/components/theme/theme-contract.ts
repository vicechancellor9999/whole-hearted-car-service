export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_MODE_STORAGE_KEY = "wh_theme_mode";
export const THEME_STORAGE_KEY = "wh_theme";
export const THEME_CHANGE_EVENT = "wh:theme-change";

const LEGACY_THEME_SOURCE_STORAGE_KEY = "wh_theme_source";

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function readThemeMode(storage: ThemeStorage): ThemeMode {
  const storedMode = storage.getItem(THEME_MODE_STORAGE_KEY);
  if (storedMode === "system" || storedMode === "light" || storedMode === "dark") {
    return storedMode;
  }

  const legacyTheme = storage.getItem(THEME_STORAGE_KEY);
  const legacySource = storage.getItem(LEGACY_THEME_SOURCE_STORAGE_KEY);
  const migratedMode: ThemeMode =
    legacySource === "user" && (legacyTheme === "light" || legacyTheme === "dark")
      ? legacyTheme
      : "system";

  storage.setItem(THEME_MODE_STORAGE_KEY, migratedMode);
  storage.removeItem(LEGACY_THEME_SOURCE_STORAGE_KEY);
  return migratedMode;
}
