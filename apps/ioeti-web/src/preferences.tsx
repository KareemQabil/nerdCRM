import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "luxury";
export type Language = "ar" | "en";
export type Density = "comfortable" | "compact";
export type NavigationStyle = "rail" | "expanded";

type Preferences = {
  theme: Theme;
  language: Language;
  density: Density;
  navigation: NavigationStyle;
  setTheme: (next: Theme) => void;
  setLanguage: (next: Language) => void;
  setDensity: (next: Density) => void;
  setNavigation: (next: NavigationStyle) => void;
};

const KEY = "ioeti.ui.preferences.v1";
const allowed = {
  theme: ["light", "dark", "luxury"],
  language: ["ar", "en"],
  density: ["comfortable", "compact"],
  navigation: ["rail", "expanded"],
} as const;

function readPreferences(): Pick<Preferences, "theme" | "language" | "density" | "navigation"> {
  const defaults = { theme: "dark" as Theme, language: "ar" as Language, density: "comfortable" as Density, navigation: "expanded" as NavigationStyle };
  try {
    const source: unknown = JSON.parse(window.localStorage.getItem(KEY) || "null");
    if (!source || typeof source !== "object") return defaults;
    const values = source as Record<string, unknown>;
    return {
      theme: allowed.theme.includes(values.theme as Theme) ? values.theme as Theme : defaults.theme,
      language: allowed.language.includes(values.language as Language) ? values.language as Language : defaults.language,
      density: allowed.density.includes(values.density as Density) ? values.density as Density : defaults.density,
      navigation: allowed.navigation.includes(values.navigation as NavigationStyle) ? values.navigation as NavigationStyle : defaults.navigation,
    };
  } catch {
    return defaults;
  }
}

const Context = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, update] = useState(readPreferences);
  const setTheme = (theme: Theme) => update((s) => ({ ...s, theme }));
  const setLanguage = (language: Language) => update((s) => ({ ...s, language }));
  const setDensity = (density: Density) => update((s) => ({ ...s, density }));
  const setNavigation = (navigation: NavigationStyle) => update((s) => ({ ...s, navigation }));

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-theme", preferences.theme);
    html.setAttribute("data-density", preferences.density);
    html.setAttribute("data-navigation", preferences.navigation);
    html.lang = preferences.language;
    html.dir = preferences.language === "ar" ? "rtl" : "ltr";
    document.title = preferences.language === "ar" ? "IOETI · نظام الأعمال" : "IOETI · Business OS";
    window.localStorage.setItem(KEY, JSON.stringify(preferences));
  }, [preferences]);

  const value = useMemo(() => ({
    ...preferences, setTheme, setLanguage, setDensity, setNavigation,
  }), [preferences]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("usePreferences must be inside PreferencesProvider");
  return value;
}
