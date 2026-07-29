/**
 * Plugin route merging — pure data transformation ported from
 * hermes-agent/web App.tsx buildRoutes() (commit a61183b5).
 *
 * Behaviour:
 *   1. For each builtin route, check if any manifest has `tab.override`
 *      pointing at it. If yes, the manifest wins (rendered as <PluginPage>).
 *      If no, render the built-in component.
 *   2. Append manifests that contribute a new path (`tab.path`) that isn't
 *      already a builtin route and isn't reserved ("/plugins").
 *   3. Hidden plugins (`tab.hidden: true`) are reachable by URL but their
 *      nav entries are not added; their routes are still appended as long
 *      as the path isn't already covered.
 *
 * The function is pure data — it does NOT touch the registry. `<PluginPage>`
 * resolves the actual component from `plugin-registry` at render time.
 */
import type { ComponentType, ReactNode } from "react";
import type { PluginManifest, PluginNavItem } from "./plugin-manifest";

export interface BuiltinRoute {
  path: string;
  component: ComponentType;
}

/** Type-safe descriptor of what a MergedRoute renders. */
export type RouteDescriptor =
  | { kind: "builtin"; component: ComponentType }
  | { kind: "plugin"; pluginName: string };

export interface MergedRoute {
  /** Unique key for React list rendering. */
  key: string;
  path: string;
  /** Resolved at render time via `resolveRouteElement`. */
  element: RouteDescriptor;
}

/** Paths reserved by the dashboard shell — plugins can't claim them. */
const RESERVED_PATHS = new Set(["/plugins"]);

export function buildRoutes(
  builtinRoutes: BuiltinRoute[],
  manifests: PluginManifest[],
): MergedRoute[] {
  // Index builtins for quick lookup.
  const builtinByPath = new Map<string, ComponentType>();
  for (const r of builtinRoutes) builtinByPath.set(r.path, r.component);

  // Partition manifests: overrides (replace builtin) vs addons (new path).
  const byOverride = new Map<string, PluginManifest>();
  const addons: PluginManifest[] = [];

  for (const m of manifests) {
    const tab = m.tab;
    if (!tab) continue;
    if (tab.override) {
      byOverride.set(tab.override, m);
    } else if (tab.path && !tab.hidden) {
      // Hidden plugins get their route only via Pass 3 (below), with a
      // `plugin:hidden:` key prefix so consumers can distinguish them.
      addons.push(m);
    }
  }

  const routes: MergedRoute[] = [];

  // Pass 1: walk builtins. Overrides win.
  for (const r of builtinRoutes) {
    const override = byOverride.get(r.path);
    if (override) {
      routes.push({
        key: `override:${override.name}`,
        path: r.path,
        element: { kind: "plugin", pluginName: override.name },
      });
    } else {
      routes.push({
        key: `builtin:${r.path}`,
        path: r.path,
        element: { kind: "builtin", component: r.component },
      });
    }
  }

  // Pass 2: append addons (non-hidden new paths).
  for (const m of addons) {
    const path = m.tab!.path!;
    if (RESERVED_PATHS.has(path)) continue;
    if (builtinByPath.has(path)) continue; // collide with builtin → skip
    routes.push({
      key: `plugin:${m.name}`,
      path,
      element: { kind: "plugin", pluginName: m.name },
    });
  }

  // Pass 3: append hidden plugins (URL-reachable, no nav entry).
  for (const m of manifests) {
    const tab = m.tab;
    if (!tab || !tab.hidden) continue;
    const path = tab.path ?? tab.override;
    if (!path) continue;
    if (RESERVED_PATHS.has(path)) continue;
    if (builtinByPath.has(path)) continue;
    if (byOverride.has(path)) continue; // already rendered above
    routes.push({
      key: `plugin:hidden:${m.name}`,
      path,
      element: { kind: "plugin", pluginName: m.name },
    });
  }

  return routes;
}

/**
 * Build sidebar nav items from builtin nav + plugin manifests.
 * Pure data — icons are kept as strings (sidebar component maps to
 * lucide-react components).
 */
export function buildNavItems(
  builtinNav: Array<{ path: string; label: string; group?: "main" | "config" }>,
  manifests: PluginManifest[],
): PluginNavItem[] {
  const seenPaths = new Set<string>();
  const out: PluginNavItem[] = [];

  // Builtins first.
  for (const item of builtinNav) {
    if (seenPaths.has(item.path)) continue;
    seenPaths.add(item.path);
    out.push({ ...item, pluginName: "__builtin__" });
  }

  // Plugin overrides REPLACE the builtin nav entry.
  for (const m of manifests) {
    const tab = m.tab;
    if (!tab?.override || !tab.label) continue;
    const idx = out.findIndex((n) => n.path === tab.override);
    if (idx >= 0) {
      out[idx] = {
        path: tab.override,
        label: tab.label,
        icon: tab.icon,
        group: tab.group ?? out[idx]?.group,
        pluginName: m.name,
      };
    }
  }

  // Plugin addons append (skip hidden).
  for (const m of manifests) {
    const tab = m.tab;
    if (!tab?.path || tab.hidden) continue;
    if (seenPaths.has(tab.path)) continue;
    seenPaths.add(tab.path);
    out.push({
      path: tab.path,
      label: tab.label ?? m.name,
      icon: tab.icon,
      group: tab.group ?? "main",
      pluginName: m.name,
    });
  }

  return out;
}

/**
 * Materialize a RouteDescriptor into a real ReactNode. Returns `null` when a
 * plugin page is referenced but not yet registered (the `<PluginPage>`
 * component handles the "loading" / "not found" UI for the latter case).
 */
export function resolveRouteElement(
  descriptor: RouteDescriptor,
  resolvePluginPage: (name: string) => ComponentType | undefined,
): ReactNode {
  if (descriptor.kind === "builtin") {
    const C = descriptor.component;
    return <C />;
  }
  // descriptor.kind === "plugin"
  const C = resolvePluginPage(descriptor.pluginName);
  if (C) return <C />;
  return null;
}
