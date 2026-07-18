/**
 * provider.ts — WebSearchProvider interface + shared types for Phase 3.
 *
 * Every search/extract backend (ddgs, tavily, exa, parallel, firecrawl,
 * searxng, brave) implements this interface. The backend-resolver walks a
 * chain of providers calling `isAvailable()` (cheap env-probe — NO network)
 * and dispatches to the first available for the requested capability.
 *
 * Design rules (docs/PLAN-BROWSER.md §3B + docs/web-lookup-architecture-deepdive.md):
 *   - `isAvailable()` MUST be a cheap env/config probe — never makes a network call.
 *   - `supportsSearch` / `supportsExtract` are static capability flags.
 *   - `search()` and `extract()` NEVER throw — errors become typed result fields.
 *   - `extract()` applies `checkUrl()` from `../security-guard.js` before any
 *     backend dispatch (even if the backend is search-only, the pattern is
 *     established here so all backends inherit the guard).
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM + verbatimModuleSyntax.
 */

// ── Shared option types ────────────────────────────────────────────────────

/** Options for `search()`. */
export interface SearchOptions {
  /** Maximum number of results to return (backend may cap this). */
  maxResults?: number;
  /** Region/locale hint (e.g. `us-en`, `uk-en`). Backends may ignore. */
  region?: string;
  /** Enable safe-search filtering. Default: true. */
  safeSearch?: boolean;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

/** Options for `extract()`. */
export interface ExtractOptions {
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum output characters before truncation. */
  maxChars?: number;
}

// ── Shared result types ────────────────────────────────────────────────────

/** A single search result. */
export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

/** Extract result — markdown content of a URL.
 *
 *  `error` and `guardBlock` are set when the extraction fails or the URL is
 *  blocked by the security guard. Callers should check these fields before
 *  consuming `markdown`. */
export interface ExtractResult {
  markdown: string;
  title: string;
  url: string;
  /** Error message if extraction failed (network error, parse error, etc). */
  error?: string;
  /** Security guard block reason (if the URL was rejected by checkUrl). */
  guardBlock?: { reason: string; category: string };
}

// ── Provider interface ─────────────────────────────────────────────────────

/**
 * A web search/extract backend. All Phase 3 backends implement this interface.
 *
 * Capability flags:
 *   - `supportsSearch` — the backend can perform web searches.
 *   - `supportsExtract` — the backend can extract page content (markdown).
 *
 * Backends that are search-only (ddgs, searxng, brave) set `supportsExtract=false`.
 * Backends that are search+extract (tavily, exa, parallel, firecrawl) set both true.
 */
export interface WebSearchProvider {
  /** Backend identifier (e.g. "ddgs", "tavily"). */
  readonly name: string;

  /**
   * Cheap availability probe — checks env vars or config ONLY.
   * MUST NOT make a network call. Returns true if this backend can be used.
   */
  isAvailable(): boolean;

  /** Whether this backend supports web search. */
  readonly supportsSearch: boolean;

  /** Whether this backend supports page extraction (content → markdown). */
  readonly supportsExtract: boolean;

  /**
   * Perform a web search. Returns zero or more results.
   * NEVER throws — on failure, returns an empty array.
   */
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Extract page content from a URL as markdown.
   * Applies `checkUrl()` from `../security-guard.js` before any dispatch.
   * NEVER throws — on failure, returns an ExtractResult with `error` or
   * `guardBlock` set and empty content fields.
   *
   * Search-only backends (supportsExtract=false) still implement this method
   * (returning a typed "not supported" error) so the resolver can uniformly
   * probe all backends for extract capability.
   */
  extract(url: string, opts?: ExtractOptions): Promise<ExtractResult>;
}

// ── Error result helpers ────────────────────────────────────────────────────

/** Build an ExtractResult for a security-guard block (never throws). */
export function guardBlockResult(
  url: string,
  reason: string,
  category: string,
): ExtractResult {
  return {
    markdown: "",
    title: "",
    url,
    guardBlock: { reason, category },
  };
}

/** Build an ExtractResult for an error (never throws). */
export function errorResult(url: string, message: string): ExtractResult {
  return {
    markdown: "",
    title: "",
    url,
    error: message,
  };
}

/** Build an ExtractResult for "not supported" (search-only backends). */
export function notSupportedResult(name: string, url: string): ExtractResult {
  return {
    markdown: "",
    title: "",
    url,
    error: `${name} does not support extraction (supportsExtract=false)`,
  };
}