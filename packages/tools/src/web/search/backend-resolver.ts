/**
 * backend-resolver.ts — Chain B resolution for web search/extract backends.
 *
 * Walks an ordered chain of {@link WebSearchProvider}s, calling `isAvailable()`
 * (cheap env probe — NO network) and returning the first available backend
 * for the requested capability (search vs extract).
 *
 * Chain ordering (docs/PLAN-BROWSER.md §3B):
 *   - search:  tavily > exa > parallel > firecrawl > searxng > brave > ddgs > error
 *   - extract: firecrawl > tavily > exa > parallel > (fallback to web_fetch)
 *
 * Per-capability override via config:
 *   - `web.search_backend`  — force a specific backend for search
 *   - `web.extract_backend` — force a specific backend for extract
 *
 * If a search-only backend is configured for extract → typed error (no silent switch).
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM + verbatimModuleSyntax.
 */
import type { WebSearchProvider } from "./provider.js";
import { tavilyProvider } from "./tavily.js";
import { exaProvider } from "./exa.js";
import { parallelProvider } from "./parallel.js";
import { firecrawlProvider } from "./firecrawl.js";
import { searxngProvider } from "./searxng.js";
import { braveProvider } from "./brave.js";
import { ddgsProvider } from "./ddgs.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Capabilities a backend can have. */
export type Capability = "search" | "extract";

/**
 * Resolver configuration. Typically sourced from `web.search_backend` /
 * `web.extract_backend` config keys, but can be passed explicitly for tests.
 */
export interface ResolverConfig {
  /** Force a specific search backend by name (overrides the chain). */
  searchBackend?: string;
  /** Force a specific extract backend by name (overrides the chain). */
  extractBackend?: string;
}

/** Successful resolution — a backend was found. */
export interface ResolvedBackend {
  ok: true;
  backend: WebSearchProvider;
}

/**
 * Resolution failed — no backend in the chain is available for the requested
 * capability. For extract, the caller should fall back to `webFetch()`.
 */
export interface UnresolvedBackend {
  ok: false;
  /** Why resolution failed (e.g. "no available search backend"). */
  reason: string;
  /** Whether the caller should fall back to `webFetch()` (extract-only). */
  fallbackToWebFetch?: boolean;
}

/** The result of walking the chain. */
export type ResolutionResult = ResolvedBackend | UnresolvedBackend;

/**
 * Typed error returned when a search-only backend is configured for extract
 * (no silent capability switch).
 */
export interface CapabilityMismatchError {
  ok: false;
  reason: string;
  /** The configured backend name that does not support extraction. */
  configuredBackend: string;
  /** The capability that was requested but not supported. */
  requestedCapability: "extract";
}

// ── Backend chains ──────────────────────────────────────────────────────────

/**
 * Search priority chain (§3B):
 *   tavily > exa > parallel > firecrawl > searxng > brave > ddgs
 *
 * ddgs is the zero-key floor — it is always available, so this chain
 * effectively always resolves (unless explicitly overridden to an
 * unavailable backend).
 */
const SEARCH_CHAIN: readonly WebSearchProvider[] = [
  tavilyProvider,
  exaProvider,
  parallelProvider,
  firecrawlProvider,
  searxngProvider,
  braveProvider,
  ddgsProvider,
];

/**
 * Extract priority chain (§3B):
 *   firecrawl > tavily > exa > parallel
 *
 * Search-only backends (searxng, brave, ddgs) are excluded — they do not
 * support extraction. If none are available, the caller falls back to
 * `webFetch()`.
 */
const EXTRACT_CHAIN: readonly WebSearchProvider[] = [
  firecrawlProvider,
  tavilyProvider,
  exaProvider,
  parallelProvider,
];

/** Map of backend name → provider for override lookups. */
const ALL_BACKENDS: ReadonlyMap<string, WebSearchProvider> = new Map([
  ["tavily", tavilyProvider],
  ["exa", exaProvider],
  ["parallel", parallelProvider],
  ["firecrawl", firecrawlProvider],
  ["searxng", searxngProvider],
  ["brave", braveProvider],
  ["ddgs", ddgsProvider],
]);

// ── Resolution logic ────────────────────────────────────────────────────────

/**
 * Walk the chain and return the first backend that is available and supports
 * the requested capability.
 *
 * @param chain  Ordered list of providers.
 * @param cap    Required capability ("search" or "extract").
 * @returns The first available provider, or undefined if none are available.
 */
function walkChain(
  chain: readonly WebSearchProvider[],
  cap: Capability,
): WebSearchProvider | undefined {
  const capFlag = cap === "search" ? "supportsSearch" : "supportsExtract";
  for (const p of chain) {
    if (p[capFlag] && p.isAvailable()) {
      return p;
    }
  }
  return undefined;
}

/**
 * Resolve a search backend.
 *
 * Walks the search chain calling `isAvailable()` on each provider. Returns the
 * first available search-capable backend. If a `searchBackend` override is
 * configured, only that backend is checked (it must support search and be
 * available).
 *
 * Since ddgs is always available, this should always resolve unless the
 * override points to an unavailable or search-incapable backend.
 */
export function resolveSearchBackend(
  config?: ResolverConfig,
): ResolutionResult {
  // Override: force a specific backend.
  if (config?.searchBackend) {
    const name = config.searchBackend;
    const backend = ALL_BACKENDS.get(name);
    if (!backend) {
      return {
        ok: false,
        reason: `configured search_backend "${name}" is not a known backend`,
      };
    }
    if (!backend.supportsSearch) {
      return {
        ok: false,
        reason: `configured search_backend "${name}" does not support search`,
      };
    }
    if (!backend.isAvailable()) {
      return {
        ok: false,
        reason: `configured search_backend "${name}" is not available`,
      };
    }
    return { ok: true, backend };
  }

  // Walk the chain.
  const found = walkChain(SEARCH_CHAIN, "search");
  if (!found) {
    return { ok: false, reason: "no available search backend" };
  }
  return { ok: true, backend: found };
}

/**
 * Resolve an extract backend.
 *
 * Walks the extract chain calling `isAvailable()` on each provider. Returns the
 * first available extract-capable backend. If none are available, signals
 * `fallbackToWebFetch: true` so the caller can fall back to `webFetch()`.
 *
 * If an `extractBackend` override is configured, only that backend is checked.
 * If the configured backend is search-only (does not support extraction), a
 * typed `CapabilityMismatchError` is returned — NO silent switch.
 */
export function resolveExtractBackend(
  config?: ResolverConfig,
): ResolutionResult | CapabilityMismatchError {
  // Override: force a specific backend.
  if (config?.extractBackend) {
    const name = config.extractBackend;
    const backend = ALL_BACKENDS.get(name);
    if (!backend) {
      return {
        ok: false,
        reason: `configured extract_backend "${name}" is not a known backend`,
      };
    }
    // Capability discrimination — search-only backend configured for extract.
    if (!backend.supportsExtract) {
      return {
        ok: false,
        reason:
          `configured extract_backend "${name}" does not support extraction ` +
          `(supportsExtract=false). No silent fallback — please configure ` +
          `an extract-capable backend (firecrawl, tavily, exa, parallel) or ` +
          `remove the override to use the extract chain + web_fetch fallback.`,
        configuredBackend: name,
        requestedCapability: "extract",
      };
    }
    if (!backend.isAvailable()) {
      return {
        ok: false,
        reason: `configured extract_backend "${name}" is not available`,
      };
    }
    return { ok: true, backend };
  }

  // Walk the chain.
  const found = walkChain(EXTRACT_CHAIN, "extract");
  if (!found) {
    // No extract-capable backend available — signal web_fetch fallback.
    return {
      ok: false,
      reason: "no available extract backend — falling back to web_fetch",
      fallbackToWebFetch: true,
    };
  }
  return { ok: true, backend: found };
}

// ── Test helpers ────────────────────────────────────────────────────────────

/**
 * Exported for tests: the ordered search chain (read-only).
 * Not part of the public API — only used for verifying chain ordering.
 */
export const _searchChain = SEARCH_CHAIN;

/**
 * Exported for tests: the ordered extract chain (read-only).
 * Not part of the public API — only used for verifying chain ordering.
 */
export const _extractChain = EXTRACT_CHAIN;

/**
 * Exported for tests: the full backend map (read-only).
 * Not part of the public API — only used for verifying override lookups.
 */
export const _allBackends = ALL_BACKENDS;