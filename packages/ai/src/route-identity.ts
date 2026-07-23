/**
 * Canonicalize route URLs for identity comparison.
 * Ported from Hermes route_identity.py (deep-dive-r2.md §4.2).
 */

/**
 * Normalize a base URL for identity comparison:
 *   - lowercase scheme/host
 *   - strip default ports (80/http, 443/https)
 *   - strip ONE trailing slash (but keep root "/")
 *   - preserve userinfo + query params (route change indicators)
 *
 * FAIL CLOSED: any control/whitespace char in the URL string → return raw
 * (un-normalized). This guarantees the comparison will mismatch, preventing a
 * hidden whitespace injection from silently matching a normalized route.
 */
export function normalizeRouteBaseUrl(baseUrl: string | undefined | null): string {
  if (!baseUrl) return "";
  const raw = String(baseUrl);
  // FAIL CLOSED: any control char or non-newline whitespace → return raw
  if (/[^\S\n\r]/.test(raw) || /[\x00-\x1f]/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    // Scheme: lowercase (URL already lowercases protocol)
    // Host: lowercase (URL already lowercases hostname)
    // Port: strip default (80/http, 443/https)
    let port = url.port;
    if ((url.protocol === "http:" && port === "80") ||
        (url.protocol === "https:" && port === "443")) {
      port = "";
    }
    // Path: strip ONE trailing slash (but not if it's just "/")
    let path = url.pathname;
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    // Userinfo: preserve (route change indicator)
    const userinfo = url.username
      ? `${url.username}${url.password ? `:${url.password}` : ""}@`
      : "";
    // Reconstruct
    const host = port ? `${userinfo}${url.hostname}:${port}` : `${userinfo}${url.hostname}`;
    return `${url.protocol}//${host}${path}${url.search}`;
  } catch {
    return raw; // Not a valid URL — return as-is
  }
}

export interface RouteConfig {
  model: string;
  baseUrl?: string;
  provider?: string;
}

export interface RouteActive {
  model: string;
  baseUrl?: string;
  provider?: string;
}

/**
 * Check if the configured route differs from the active runtime route.
 *
 * - If a baseUrl is configured, normalizes both and compares.
 *   No configured URL → always a match (route-wise; model is checked separately).
 * - If no baseUrl is configured but provider is, compares provider identity.
 *
 * FAIL CLOSED: any error → return true (drop the pin, never trust silently).
 */
export function contextRouteMismatch(
  configured: RouteConfig,
  active: RouteActive,
): boolean {
  try {
    const configuredRoute = normalizeRouteBaseUrl(configured.baseUrl);
    const activeRoute = normalizeRouteBaseUrl(active.baseUrl);

    if (configuredRoute) {
      return configuredRoute !== activeRoute;
    }
    // No URL → provider identity comparison
    const cp = (configured.provider ?? "").toLowerCase();
    const ap = (active.provider ?? "").toLowerCase();
    return Boolean(cp && ap && cp !== ap);
  } catch {
    return true; // FAIL CLOSED
  }
}

/**
 * Decide whether to clear the context_length pin.
 *
 * A pin is cleared when:
 *   - the model differs (always clears — different token limits), OR
 *   - the route differs (different upstream endpoint → cache may be cold).
 *
 * FAIL CLOSED: any error → clear the pin.
 */
export function shouldClearContextPin(
  configuredModel: string,
  activeModel: string,
  configuredBaseUrl?: string,
  activeBaseUrl?: string,
  configuredProvider?: string,
  activeProvider?: string,
): boolean {
  // Model mismatch always clears
  if (configuredModel && configuredModel !== activeModel) return true;
  return contextRouteMismatch(
    { model: configuredModel, baseUrl: configuredBaseUrl, provider: configuredProvider },
    { model: activeModel, baseUrl: activeBaseUrl, provider: activeProvider },
  );
}
