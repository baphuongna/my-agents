/**
 * Plugin manifest types — minimal schema for dashboard plugins.
 *
 * Distilled from hermes-agent/web/plugins/types.ts. Only the fields mya
 * uses today (or is wiring up in this distill pass) are exported; the
 * hermes schema has more (css, integrity, sdkVersion, etc.) that we
 * leave for follow-up work when the plugin runtime lands.
 */

/**
 * Plugin tab descriptor — when present, the plugin contributes a top-level
 * route via `buildRoutes()` (see `lib/plugin-routes.ts`).
 *
 * - `path`     the URL path (e.g. "/billing"). Required if `override` is unset.
 * - `override` replace the built-in route at this path (e.g. "/chat").
 * - `hidden`   register a route that's reachable by URL but NOT shown in the
 *              sidebar nav (debug pages, settings sub-routes, etc.).
 * - `label`    human-readable label for the sidebar nav entry.
 * - `icon`     lucide-react icon name string (parsed by sidebar).
 * - `group`    nav group ("main" | "config" | undefined = main).
 *
 * At least one of `path` or `override` is required.
 */
export interface PluginTab {
  path?: string;
  override?: string;
  hidden?: boolean;
  label?: string;
  icon?: string;
  group?: "main" | "config";
}

/** Sidebar nav item produced by `buildNavItems()` (pure data). */
export interface PluginNavItem {
  path: string;
  label: string;
  icon?: string;
  group?: "main" | "config";
  /** Plugin name — used by `<PluginPage>` to resolve the component. */
  pluginName: string;
}

/**
 * Dashboard plugin manifest. The shape is intentionally loose — extra
 * fields are passed through to plugin scripts as-is.
 */
export interface PluginManifest {
  name: string;
  version?: string;
  /** Optional tab descriptor — when present, the plugin registers a route. */
  tab?: PluginTab;
  /** Additional fields (e.g. css, integrity, entry, sdkVersion) are allowed. */
  [extra: string]: unknown;
}
