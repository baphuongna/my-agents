/**
 * Resolve a route pathname to a localized page title — adapted from Hermes
 * `lib/resolve-page-title.ts` for mya's flat translation dictionary.
 *
 * mya keeps a flat `Translations` shape (nav labels are top-level keys), so the
 * builtin route→key map maps directly to translation keys. Plugin tabs (an
 * optional list of extra routes with their own labels) take priority, and any
 * unrecognised single-segment path falls back to a capitalized title
 * (`/profiles` → "Profiles").
 */
import type { Translations } from "@/lib/i18n";

const BUILTIN: Record<string, keyof Translations> = {
  "/chat": "chat",
  "/sessions": "sessions",
  "/events": "events",
  "/cron": "cron",
  "/models": "models",
  "/tools": "tools",
  "/files": "files",
  "/analytics": "analytics",
  "/logs": "logs",
  "/channels": "channels",
  "/mcp": "mcp",
  "/skills": "skills",
  "/sync": "sync",
  "/keys": "keys",
  "/config": "config",
  "/system": "system",
  "/push": "push",
  "/collab": "collab",
};

export interface PluginTab {
  path: string;
  label: string;
}

export function resolvePageTitle(
  pathname: string,
  t: Translations,
  pluginTabs?: PluginTab[],
): string {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (normalized === "/") {
    return t.main;
  }

  const plugin = pluginTabs?.find((p) => p.path === normalized);
  if (plugin) {
    return plugin.label;
  }

  const key = BUILTIN[normalized];
  if (key) {
    return t[key];
  }

  // Derive title from the first path segment: "/profiles/new" → "Profiles".
  const segment = normalized.slice(1).split("/")[0] ?? "";
  if (segment) {
    return segment.charAt(0).toUpperCase() + segment.slice(1);
  }
  return t.main;
}
