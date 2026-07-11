/**
 * Phase 21: themes for the Ink TUI.
 *
 * Three built-in themes (dark, light, dim) + optional user override via
 * ~/.my-agent/theme.toml (single line: `theme = "light"`).
 *
 * Persistence is fire-and-forget — failure to write the file is logged
 * but never blocks the session.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";

/** A theme is a complete color palette mapping roles to ANSI colors. */
export interface Theme {
  name: string;
  /** Foreground colors for each semantic role. */
  text: string;
  meta: string;
  user: string;
  assistant: string;
  tool: string;
  approval: string;
  ok: string;
  warn: string;
  error: string;
  info: string;
  status: string;
  /** Whether the terminal background is dark (affects default assumptions). */
  darkBg: boolean;
}

export const defaultTheme: Theme = {
  name: "dark",
  text: "white",
  meta: "gray",
  user: "green",
  assistant: "cyan",
  tool: "magenta",
  approval: "yellow",
  ok: "green",
  warn: "yellow",
  error: "red",
  info: "blue",
  status: "gray",
  darkBg: true,
};

export const LIGHT_THEME: Theme = {
  name: "light",
  text: "black",
  meta: "gray",
  user: "green",
  assistant: "blue",
  tool: "magenta",
  approval: "yellow",
  ok: "green",
  warn: "yellow",
  error: "red",
  info: "blue",
  status: "gray",
  darkBg: false,
};

export const DIM_THEME: Theme = {
  name: "dim",
  text: "gray",
  meta: "darkgray",
  user: "green",
  assistant: "gray",
  tool: "darkmagenta",
  approval: "yellow",
  ok: "green",
  warn: "yellow",
  error: "red",
  info: "darkblue",
  status: "darkgray",
  darkBg: true,
};

export const BUILTIN_THEMES: Record<string, Theme> = {
  dark: defaultTheme,
  light: LIGHT_THEME,
  dim: DIM_THEME,
};

/** The singleton theme store — emits "change" when the active theme changes. */
class ThemeStore extends EventEmitter {
  private active: Theme = defaultTheme;

  current(): Theme {
    return this.active;
  }

  setActive(t: Theme): void {
    this.active = t;
    this.emit("change", t);
  }

  /** Switch to a theme by name; returns the resolved theme or null. */
  setByName(name: string): Theme | null {
    const t = BUILTIN_THEMES[name];
    if (!t) return null;
    this.setActive(t);
    return t;
  }

  /** List theme names (built-in only). */
  list(): string[] {
    return Object.keys(BUILTIN_THEMES);
  }
}

/** Process-wide theme store. */
export const themeStore = new ThemeStore();

/** Path to the user's theme override file. */
export function themePath(): string {
  return join(homedir(), ".my-agent", "theme.toml");
}

/** Best-effort persistence (never throws). */
async function saveThemeOverride(name: string): Promise<void> {
  try {
    const path = themePath();
    await writeFile(path, `theme = "${name}"\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

/** Load the persisted theme (if any) at startup. */
export async function loadPersistedTheme(): Promise<void> {
  try {
    const path = themePath();
    if (!existsSync(path)) return;
    const txt = await readFile(path, "utf8");
    const m = txt.match(/^\s*theme\s*=\s*"?([a-zA-Z_-]+)"?\s*$/m);
    if (!m) return;
    const t = BUILTIN_THEMES[m[1]!];
    if (t) themeStore.setActive(t);
  } catch {
    /* best-effort */
  }
}

/** Switch + persist. */
export async function switchTheme(name: string): Promise<Theme | null> {
  const t = themeStore.setByName(name);
  if (t) await saveThemeOverride(name);
  return t;
}
