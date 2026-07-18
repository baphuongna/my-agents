/**
 * brave.ts — Brave Search API backend (Phase 3).
 *
 * Implements {@link WebSearchProvider} using the Brave Search API.
 * The API key is provided via the `BRAVE_API_KEY` env var. Search-only —
 * Brave does not support page extraction.
 *
 * Capability: search-only (`supportsExtract=false`). The `extract()` method
 * is implemented for interface compliance but returns a typed "not supported"
 * error. It still applies `checkUrl()` to establish the guard pattern.
 *
 * API: `GET https://api.search.brave.com/res/v1/web/search?q=<query>&count=<n>`
 * Headers: `X-Subscription-Token: <key>`, `Accept: application/json`.
 * Response JSON: `{web: {results: [{title, url, description, age, extra_snippets: string[]}]}}`.
 *
 * Security: `checkUrl()` from `../security-guard.js` is applied to every
 * result URL (defence-in-depth).
 *
 * Never throws — all errors become empty results or typed error results.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM + verbatimModuleSyntax.
 */
import { checkUrl } from "../security-guard.js";
import {
  type WebSearchProvider,
  type SearchResult,
  type SearchOptions,
  type ExtractOptions,
  type ExtractResult,
  notSupportedResult,
  guardBlockResult,
} from "./provider.js";

// ── Constants ──────────────────────────────────────────────────────────────

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_MAX_RESULTS = 10;
const MAX_API_COUNT = 20; // Brave API caps `count` at 20.
const DEFAULT_TIMEOUT_MS = 15_000;

// ── Types ──────────────────────────────────────────────────────────────────

/** Brave search result entry from the JSON response. */
interface BraveRawResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  extra_snippets?: string[];
}

/** Brave search JSON response shape. */
interface BraveSearchResponse {
  web?: {
    results?: BraveRawResult[];
  };
  query?: {
    original?: string;
  };
}

// ── Env helpers ────────────────────────────────────────────────────────────

/** Read BRAVE_API_KEY from the environment (type-safe). */
function getBraveApiKey(): string | undefined {
  const val = process.env["BRAVE_API_KEY"];
  return val && val.trim() ? val.trim() : undefined;
}

// ── Parsing helpers ────────────────────────────────────────────────────────

/**
 * Parse a Brave Search JSON response into SearchResult[].
 * Result URLs are validated via `checkUrl()` (defence-in-depth).
 */
function parseResults(
  data: BraveSearchResponse,
  maxResults: number,
): SearchResult[] {
  const raw = data.web?.results ?? [];
  const results: SearchResult[] = [];

  for (const entry of raw) {
    if (results.length >= maxResults) break;

    const title = (entry.title ?? "").trim();
    const url = (entry.url ?? "").trim();
    if (!title || !url) continue;

    // Defence-in-depth: validate the result URL.
    const guard = checkUrl(url);
    if (!guard.ok) continue;

    // Prefer description; fall back to first extra_snippet.
    let description = (entry.description ?? "").trim();
    if (!description && entry.extra_snippets && entry.extra_snippets.length > 0) {
      description = (entry.extra_snippets[0] ?? "").trim();
    }

    results.push({ title, url, description });
  }

  return results;
}

// ── Provider implementation ─────────────────────────────────────────────────

/**
 * Brave Search API provider.
 *
 * Available when `BRAVE_API_KEY` env var is set. Search-only — does not support
 * extraction. Uses Brave's REST API via global `fetch()`.
 */
export const braveProvider: WebSearchProvider = {
  name: "brave",
  supportsSearch: true,
  supportsExtract: false,

  /** Available when BRAVE_API_KEY is set — no network call. */
  isAvailable(): boolean {
    return !!getBraveApiKey();
  },

  /**
   * Search using the Brave Search API. Returns results or empty array on
   * error. Never throws.
   */
  async search(
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResult[]> {
    const apiKey = getBraveApiKey();
    if (!apiKey) return [];

    const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
    const count = Math.min(maxResults, MAX_API_COUNT);
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!query.trim()) return [];

    try {
      const url = new URL(BRAVE_SEARCH_ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));
      url.searchParams.set("extra_snippets", "true");

      if (opts?.safeSearch === false) {
        url.searchParams.set("safesearch", "off");
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as BraveSearchResponse;
      return parseResults(data, maxResults);
    } catch {
      // Network error, timeout, parse failure — return empty results.
      return [];
    }
  },

  /**
   * Extract is not supported by brave (search-only backend).
   * Still applies `checkUrl()` to establish the guard pattern for all
   * backends. Returns a typed "not supported" error, or a guardBlock result
   * if the URL is blocked by the security guard. Never throws.
   */
  async extract(
    url: string,
    _opts?: ExtractOptions,
  ): Promise<ExtractResult> {
    // Apply security guard first — establishes the pattern for all backends.
    const guard = checkUrl(url);
    if (!guard.ok) {
      return guardBlockResult(url, guard.reason, guard.category);
    }

    // brave is search-only — return typed "not supported" error.
    return notSupportedResult("brave", url);
  },
};