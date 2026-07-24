/**
 * Theme system — CSS-variable-based theming with presets.
 * Variables use RGB space-channel format: "88 166 255" for Tailwind <alpha-value> support.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface Theme {
  name: string;
  label: string;
  description: string;
  vars: Record<string, string>;
}

// Helper: hex "#58a6ff" → "88 166 255"
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

const THEMES: Theme[] = [
  {
    name: "dark",
    label: "Dark",
    description: "GitHub-inspired dark",
    vars: rgbVars({
      "--bg": "#0b0d10", "--bg-surface": "#161b22", "--bg-elevated": "#1c2330", "--bg-input": "#0d1117",
      "--border": "#30363d", "--border-subtle": "#21262d",
      "--fg": "#e6edf3", "--fg-muted": "#8b949e", "--fg-subtle": "#6e7681",
      "--accent": "#58a6ff", "--accent-hover": "#a5c9ff",
      "--success": "#3fb950", "--warning": "#e3b341", "--danger": "#f85149", "--purple": "#a371f7", "--orange": "#f0883e",
    }),
  },
  {
    name: "midnight",
    label: "Midnight",
    description: "Deep blue-violet",
    vars: rgbVars({
      "--bg": "#0a0a1f", "--bg-surface": "#12122e", "--bg-elevated": "#1a1a3a", "--bg-input": "#08081a",
      "--border": "#2a2a50", "--border-subtle": "#1e1e3a",
      "--fg": "#e0e0ff", "--fg-muted": "#8888bb", "--fg-subtle": "#5a5a8a",
      "--accent": "#7c7fff", "--accent-hover": "#9999ff",
      "--success": "#22aa66", "--warning": "#ddaa22", "--danger": "#ff4466", "--purple": "#aa77ff", "--orange": "#ff9944",
    }),
  },
  {
    name: "teal",
    label: "Teal",
    description: "Classic teal glow",
    vars: rgbVars({
      "--bg": "#041c1c", "--bg-surface": "#0a2828", "--bg-elevated": "#103535", "--bg-input": "#021414",
      "--border": "#1a4040", "--border-subtle": "#122e2e",
      "--fg": "#e0f0e8", "--fg-muted": "#7aaa9a", "--fg-subtle": "#4a7a6a",
      "--accent": "#3dd6b0", "--accent-hover": "#5de6c0",
      "--success": "#2cb568", "--warning": "#e0a830", "--danger": "#e84545", "--purple": "#a870d8", "--orange": "#e89548",
    }),
  },
  {
    name: "ember",
    label: "Ember",
    description: "Warm dark amber",
    vars: rgbVars({
      "--bg": "#1a0a06", "--bg-surface": "#241008", "--bg-elevated": "#2e180c", "--bg-input": "#140804",
      "--border": "#3a2010", "--border-subtle": "#281608",
      "--fg": "#f5e6d0", "--fg-muted": "#aa9078", "--fg-subtle": "#70604a",
      "--accent": "#ff9854", "--accent-hover": "#ffb074",
      "--success": "#66aa44", "--warning": "#ddaa22", "--danger": "#ee4444", "--purple": "#bb66dd", "--orange": "#ff7733",
    }),
  },
  {
    name: "mono",
    label: "Mono",
    description: "Minimal monochrome",
    vars: rgbVars({
      "--bg": "#0e0e0e", "--bg-surface": "#1a1a1a", "--bg-elevated": "#242424", "--bg-input": "#0a0a0a",
      "--border": "#333333", "--border-subtle": "#222222",
      "--fg": "#eaeaea", "--fg-muted": "#888888", "--fg-subtle": "#555555",
      "--accent": "#bbbbbb", "--accent-hover": "#ffffff",
      "--success": "#7fdb7f", "--warning": "#e3b341", "--danger": "#f85149", "--purple": "#a371f7", "--orange": "#f0883e",
    }),
  },
];

// Convert hex-based var map to RGB space-channel format
function rgbVars(hexMap: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(hexMap)) {
    out[k] = hexToRgb(v);
  }
  return out;
}

const THEME_KEY = "mya-theme";

interface ThemeContextValue {
  theme: Theme;
  themes: Theme[];
  setTheme: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Previously-applied CSS var keys. Before applying a new theme we remove all
 * of these from `:root` so stale values from the previous theme can't bleed
 * across switches (a theme that no longer defines a key must clear it).
 */
const appliedVarKeys = new Set<string>();

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // Clear every var we previously set, so keys absent from the new theme are
  // removed rather than lingering with stale values.
  for (const key of appliedVarKeys) {
    root.style.removeProperty(key);
  }
  appliedVarKeys.clear();
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key, value);
    appliedVarKeys.add(key);
  }
  root.setAttribute("data-theme", theme.name);
}

/** Remove all theme CSS vars from `:root` and reset tracking (test helper). */
export function clearThemeVars(): void {
  const root = document.documentElement;
  for (const key of appliedVarKeys) {
    root.style.removeProperty(key);
  }
  appliedVarKeys.clear();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    return THEMES.find((t) => t.name === stored) ?? THEMES[0]!;
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme.name);
  }, [theme]);

  function setTheme(name: string) {
    const found = THEMES.find((t) => t.name === name);
    if (found) setThemeState(found);
  }

  return (
    <ThemeContext.Provider value={{ theme, themes: THEMES, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
