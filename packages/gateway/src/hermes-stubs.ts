/**
 * mya fork: stub responses for Hermes SPA endpoints that don't exist in mya.
 *
 * The Hermes dashboard SPA is served as-is (the PWA shell); these endpoints
 * return static defaults so the SPA doesn't 404 on mount and crash.
 */

/** Stub responses for Hermes SPA endpoints (path → static default body). */
export const HERMES_STUBS: Record<string, unknown> = {
  "/auth/me": { authenticated: true, user: "local", provider: "loopback" },
  "/profiles": { profiles: [{ name: "default", description: "Default profile", is_default: true }] },
  "/dashboard/plugins": { plugins: [], manifests: [] },
  "/dashboard/themes": { themes: [], current: "default" },
  "/dashboard/font": { font: "theme" },
  "/dashboard/plugin-providers": { providers: [] },
  "/dashboard/plugins/hub": { plugins: [] },
  "/dashboard/plugins/rescan": { ok: true },
  "/dashboard/theme": { ok: true },
  "/api/auth/me": { authenticated: true, user: "local" },
  "/api/profiles": { profiles: [{ name: "default", description: "Default", is_default: true }] },
  "/api/dashboard/plugins": { plugins: [] },
  "/api/dashboard/themes": { themes: [], current: "default" },
  "/api/dashboard/font": { font: "theme" },
};

/** True when the path has a registered Hermes SPA stub response. */
export function hasHermesStub(pathname: string): boolean {
  return pathname in HERMES_STUBS;
}

/** Look up a Hermes SPA stub body for a path — exact-map match first, then the
 * pattern-based stubs. Returns undefined when not stubbed. */
export function getHermesStub(pathname: string): unknown {
  if (pathname in HERMES_STUBS) return HERMES_STUBS[pathname];
  if (pathname === "/sessions/stats") return { total: 0, active: 0, today: 0 };
  if (pathname === "/sessions/empty/count") return { count: 0 };
  if (pathname === "/profiles/active") return { name: "default" };
  return undefined;
}
