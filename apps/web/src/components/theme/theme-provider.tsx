"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  THEME_CHANGE_EVENT,
  THEME_MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  readThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme-contract";

const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  mode: ThemeMode;
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  theme: "light",
  setMode: () => {},
});

function currentResolvedTheme(): ResolvedTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function currentSnapshot(): `${ThemeMode}:${ResolvedTheme}` {
  return `${readThemeMode(localStorage)}:${currentResolvedTheme()}`;
}

function applyThemeMode(mode: ThemeMode, persistMode: boolean) {
  const theme = resolveTheme(mode, window.matchMedia(DARK_QUERY).matches);
  if (persistMode) localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function subscribeTheme(onStoreChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  const onThemeChange = () => onStoreChange();
  const onMediaChange = () => {
    const mode = readThemeMode(localStorage);
    if (mode === "system") applyThemeMode(mode, false);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_MODE_STORAGE_KEY && event.key !== THEME_STORAGE_KEY) return;
    applyThemeMode(readThemeMode(localStorage), false);
  };

  window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onMediaChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onMediaChange);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeTheme,
    currentSnapshot,
    () => "system:light" as const,
  );
  const separator = snapshot.indexOf(":");
  const mode = snapshot.slice(0, separator) as ThemeMode;
  const theme = snapshot.slice(separator + 1) as ResolvedTheme;

  useEffect(() => {
    applyThemeMode(readThemeMode(localStorage), false);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, theme, setMode: (nextMode) => applyThemeMode(nextMode, true) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
