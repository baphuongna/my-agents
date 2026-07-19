/**
 * config.ts — `web.*` cross-capability configuration schema + loader.
 *
 * Phase 5 of docs/PLAN-BROWSER.md: a single typed config surface that the
 * orchestrator (orchestrator.ts) and the per-capability resolvers consume.
 *
 * Schema (hand-written — no zod dep, per AGENTS.md §18 minimal-core):
 *
 *   - preferredEngine   "camofox" | "cloud" | "local" | "auto"
 *   - searchBackend     "tavily" | "exa" | "parallel" | "firecrawl"
 *                       | "searxng" | "brave" | "ddgs" | "auto"
 *   - extractBackend    "firecrawl" | "tavily" | "exa" | "parallel" | "auto"
 *   - allowPrivateUrls  boolean       (RFC1918 / loopback / link-local)
 *   - fallbackToFetch   boolean       (default true) — browser all-fail →
 *                                       web_fetch universal floor.
 *
 * Precedence (highest → lowest):
 *
 *   1. Caller-supplied overrides (e.g. `args.meta.preferredEngine`)
 *   2. Process environment (MYA_WEB_PREFERRED_ENGINE, MYA_WEB_SEARCH_BACKEND,
 *                          MYA_WEB_EXTRACT_BACKEND, MYA_WEB_ALLOW_PRIVATE_URLS,
 *                          MYA_WEB_FALLBACK_TO_FETCH)
 *   3. Hardcoded defaults (preferredEngine="auto", searchBackend="auto",
 *                          extractBackend="auto", allowPrivateUrls=false,
 *                          fallbackToFetch=true)
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM; never throws
 * (unknown / malformed env values silently fall back to the default —
 *  observers can call `validateWebConfig` to surface issues explicitly).
 */

/** Known backend names (kept as readonly tuples to derive unions). */
const SEARCH_BACKENDS = [
  "tavily",
  "exa",
  "parallel",
  "firecrawl",
  "searxng",
  "brave",
  "ddgs",
] as const;
const EXTRACT_BACKENDS = ["firecrawl", "tavily", "exa", "parallel"] as const;
const ENGINES = ["camofox", "cloud", "local", "auto"] as const;

export type SearchBackendName = (typeof SEARCH_BACKENDS)[number] | "auto";
export type ExtractBackendName = (typeof EXTRACT_BACKENDS)[number] | "auto";
export type PreferredEngineName = (typeof ENGINES)[number];

export interface WebConfig {
  /** Browser engine preference. "auto" walks the chain. */
  preferredEngine: PreferredEngineName;
  /** Search backend override. "auto" walks the search chain. */
  searchBackend: SearchBackendName;
  /** Extract backend override. "auto" walks the extract chain (then web_fetch). */
  extractBackend: ExtractBackendName;
  /** Whether private/internal URLs are allowed through the security guard. */
  allowPrivateUrls: boolean;
  /** When true, browser chain all-fail → fall back to web_fetch (the floor). */
  fallbackToFetch: boolean;
  /** Operator-managed host deny-list (fnmatch patterns, e.g. `"*.evil.com"`).
   *  Populated from `MYA_WEB_BLOCKLIST` (comma-separated). Always applies to
   *  every guard call — the model cannot override it via tool args. */
  blocklist: string[];
}

/** Hardcoded defaults. */
export const DEFAULT_WEB_CONFIG: WebConfig = {
  preferredEngine: "auto",
  searchBackend: "auto",
  extractBackend: "auto",
  allowPrivateUrls: false,
  fallbackToFetch: true,
  blocklist: [],
};

/** Env-var names the loader reads (exported for tests + observability). */
export const WEB_CONFIG_ENV = {
  preferredEngine: "MYA_WEB_PREFERRED_ENGINE",
  searchBackend: "MYA_WEB_SEARCH_BACKEND",
  extractBackend: "MYA_WEB_EXTRACT_BACKEND",
  allowPrivateUrls: "MYA_WEB_ALLOW_PRIVATE_URLS",
  fallbackToFetch: "MYA_WEB_FALLBACK_TO_FETCH",
  blocklist: "MYA_WEB_BLOCKLIST",
} as const;

// ─── Type-narrowing helpers ─────────────────────────────────────────────────

function isPreferredEngineName(v: string): v is PreferredEngineName {
  return (ENGINES as readonly string[]).includes(v);
}

function isSearchBackendName(v: string): v is SearchBackendName {
  return v === "auto" || (SEARCH_BACKENDS as readonly string[]).includes(v);
}

function isExtractBackendName(v: string): v is ExtractBackendName {
  return v === "auto" || (EXTRACT_BACKENDS as readonly string[]).includes(v);
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const norm = raw.trim().toLowerCase();
  if (norm === "" || norm === "1" || norm === "true" || norm === "yes" || norm === "on") {
    return true;
  }
  if (norm === "0" || norm === "false" || norm === "no" || norm === "off") {
    return false;
  }
  return fallback;
}

/** Parse a comma-separated list env var into a trimmed, non-empty string[]
 *  (e.g. `"*.evil.com, *.malware.net"` → `["*.evil.com", "*.malware.net"]`).
 *  Empty / undefined → `[]`. */
function parseList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const parts = raw.split(",");
  const out: string[] = [];
  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/**
 * Read one env var and narrow it to a permitted value. Unknown / empty values
 * fall back to the supplied default (no throw — surfaces to validateWebConfig).
 */
function pickEnvString<T extends string>(
  raw: string | undefined,
  allowed: readonly string[],
  fallback: T,
): T {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  return (allowed.includes(trimmed) ? trimmed : fallback) as T;
}

// ─── Public loader ──────────────────────────────────────────────────────────

/**
 * Load the `web.*` config.
 *
 * Precedence:
 *   1. `overrides` (caller-supplied, e.g. `args.meta`)
 *   2. Process environment (`MYA_WEB_*`)
 *   3. Hardcoded defaults
 *
 * Untyped override values (e.g. `overrides.preferredEngine = 42`) are
 * silently dropped — narrowing guards kick in for env, then for overrides
 * via the same validators (typed but unknown strings fall to default).
 *
 * Designed to be cheap: pure string reads + type narrowing, no network.
 * Safe to call on every tool run (the cost is a handful of `process.env`
 * reads + a small object allocation).
 */
export function loadWebConfig(overrides?: Partial<WebConfig>): WebConfig {
  // Env layer — read once, narrow with the validators.
  const envPreferred = pickEnvString(
    process.env[WEB_CONFIG_ENV.preferredEngine],
    ENGINES,
    DEFAULT_WEB_CONFIG.preferredEngine,
  );
  const envSearch = pickEnvString(
    process.env[WEB_CONFIG_ENV.searchBackend],
    [...SEARCH_BACKENDS, "auto"],
    DEFAULT_WEB_CONFIG.searchBackend,
  );
  const envExtract = pickEnvString(
    process.env[WEB_CONFIG_ENV.extractBackend],
    [...EXTRACT_BACKENDS, "auto"],
    DEFAULT_WEB_CONFIG.extractBackend,
  );
  const envAllowPrivate = parseBool(
    process.env[WEB_CONFIG_ENV.allowPrivateUrls],
    DEFAULT_WEB_CONFIG.allowPrivateUrls,
  );
  const envFallback = parseBool(
    process.env[WEB_CONFIG_ENV.fallbackToFetch],
    DEFAULT_WEB_CONFIG.fallbackToFetch,
  );
  const envBlocklist = parseList(process.env[WEB_CONFIG_ENV.blocklist]);

  const cfg: WebConfig = {
    preferredEngine: envPreferred,
    searchBackend: envSearch,
    extractBackend: envExtract,
    allowPrivateUrls: envAllowPrivate,
    fallbackToFetch: envFallback,
    blocklist: envBlocklist,
  };

  // Override layer — narrow each supplied field against its allowed set.
  if (overrides) {
    if (overrides.preferredEngine !== undefined) {
      if (isPreferredEngineName(overrides.preferredEngine)) {
        cfg.preferredEngine = overrides.preferredEngine;
      }
    }
    if (overrides.searchBackend !== undefined) {
      if (isSearchBackendName(overrides.searchBackend)) {
        cfg.searchBackend = overrides.searchBackend;
      }
    }
    if (overrides.extractBackend !== undefined) {
      if (isExtractBackendName(overrides.extractBackend)) {
        cfg.extractBackend = overrides.extractBackend;
      }
    }
    if (typeof overrides.allowPrivateUrls === "boolean") {
      cfg.allowPrivateUrls = overrides.allowPrivateUrls;
    }
    if (typeof overrides.fallbackToFetch === "boolean") {
      cfg.fallbackToFetch = overrides.fallbackToFetch;
    }
    if (
      Array.isArray(overrides.blocklist) &&
      overrides.blocklist.every((p) => typeof p === "string")
    ) {
      cfg.blocklist = [...cfg.blocklist, ...overrides.blocklist];
    }
  }

  return cfg;
}

// ─── Validator (observability / config-mistake detection) ───────────────────

/**
 * Validate a WebConfig object. Returns a list of human-readable issues
 * (empty array means valid). Never throws — callers can pipe this through
 * their logger / status surface.
 *
 * The loader itself never calls this — it silently falls back to defaults for
 * malformed env values. This helper exists for the TUI bootstrap and the
 * verifier gate, which want to surface "MYA_WEB_PREFERRED_ENGINE=foo is not
 * a known engine" rather than silently ignore it.
 */
export function validateWebConfig(cfg: WebConfig): string[] {
  const issues: string[] = [];
  if (!isPreferredEngineName(cfg.preferredEngine)) {
    issues.push(`preferredEngine: unknown value "${cfg.preferredEngine}"`);
  }
  if (!isSearchBackendName(cfg.searchBackend)) {
    issues.push(`searchBackend: unknown value "${cfg.searchBackend}"`);
  }
  if (!isExtractBackendName(cfg.extractBackend)) {
    issues.push(`extractBackend: unknown value "${cfg.extractBackend}"`);
  }
  if (typeof cfg.allowPrivateUrls !== "boolean") {
    issues.push("allowPrivateUrls: must be a boolean");
  }
  if (typeof cfg.fallbackToFetch !== "boolean") {
    issues.push("fallbackToFetch: must be a boolean");
  }
  if (
    !Array.isArray(cfg.blocklist) ||
    !cfg.blocklist.every((p) => typeof p === "string")
  ) {
    issues.push("blocklist: must be an array of strings");
  }
  return issues;
}

/** Read the current env-var-driven config without any overrides (for tests). */
export function loadWebConfigFromEnv(): WebConfig {
  return loadWebConfig();
}