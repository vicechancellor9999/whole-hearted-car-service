"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "wh_theme";
const THEME_SOURCE_STORAGE_KEY = "wh_theme_source";
const THEME_CHANGE_EVENT = "wh:theme-change";

function storedTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const source = localStorage.getItem(THEME_SOURCE_STORAGE_KEY);
  return stored === "dark" && source === "user" ? "dark" : "light";
}

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme, explicit: boolean) {
  if (explicit) localStorage.setItem(THEME_SOURCE_STORAGE_KEY, "user");
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function subscribeTheme(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== THEME_SOURCE_STORAGE_KEY) return;
    document.documentElement.classList.toggle("dark", storedTheme() === "dark");
    onStoreChange();
  };
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggle: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, currentTheme, () => "light");

  useEffect(() => {
    applyTheme(storedTheme(), false);
  }, []);

  const toggle = () => applyTheme(theme === "light" ? "dark" : "light", true);
  const setTheme = (nextTheme: Theme) => applyTheme(nextTheme, true);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
