import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "bigtts.theme";

const THEME_ORDER: ThemeMode[] = ["light", "dark", "system"];
const DARK_QUERY = "(prefers-color-scheme: dark)";
const THEME_COLORS = { light: "#f6f7f9", dark: "#0b0e13" } as const;

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

// jsdom ships a thin media-query implementation, so every hop is optional.
function darkMediaQuery() {
  return window.matchMedia?.(DARK_QUERY);
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (theme === "system") delete root.dataset.theme;
      else root.dataset.theme = theme;
      const dark = theme === "dark" || (theme === "system" && Boolean(darkMediaQuery()?.matches));
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light);
    };
    apply();
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* Storage unavailable — the choice simply does not persist. */
    }
    if (theme !== "system") return;
    const query = darkMediaQuery();
    query?.addEventListener?.("change", apply);
    return () => query?.removeEventListener?.("change", apply);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((current) => THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]);
  }, []);

  return { theme, setTheme, cycleTheme };
}
