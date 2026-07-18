/**
 * searxng.ts — SearXNG self-hosted metasearch backend (Phase 3).
 *
 * Implements {@link WebSearchProvider} using a self-hosted SearXNG instance.
 * The instance URL is provided via the `SEARXNG_URL` env var — no API key is
 * required. Optional bearer/basic auth is supported for protected instances.
 *
 * Capability: search-only (`supportsExtract=false`). The `extract()` method
 * is implemented for interface compliance but returns a typed "not supported"
 * error. It still applies `checkUrl()` to establish the guard pattern.
 *
 * API: `GET <SEARXNG_URL>/search?q=<query>&format=json` with query params.
 * Response JSON: `{results: [{title, url, content, engine, publishedDate?, score?}], suggestions: string[], unresponsive_engines: [[engine, reason]]}`.
 * Results are sorted by `score` descending and capped to `maxResults`.
 *
 * Security: `checkUrl()` from `../security-guard.js` is applied to every
 * result URL (defence-in-depth — SearXNG aggregates results from many engines
 * so result URLs come from untrusted upstream search engines).
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

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Types ──────────────────────────────────────────────────────────────────

/** SearXNG result entry from the JSON response. */
interface SearXngRawResult {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
  publishedDate?: string;
  score?: number;
}

/** SearXNG JSON response shape. */
interface SearXngResponse {
  results?: SearXngRawResult[];
  suggestions?: string[];
  unresponsive_engines?: [string, string][];
}

// ── Env helpers ────────────────────────────────────────────────────────────

/** Read SEARXNG_URL from the environment (type-safe). */
function getSearxngUrl(): string | undefined {
  const val = process.env["SEARXNG_URL"];
  return val && val.trim() ? val.trim() : undefined;
}

/** Build optional auth headers if SEARXNG_TOKEN or basic auth env vars are set. */
function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": DEFAULT_USER_AGENT,
  };

  const token = process.env["SEARXNG_TOKEN"];
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  const username = process.env["SEARXNG_BASIC_USERNAME"];
  const password = process.env["SEARXNG_BASIC_PASSWORD"];
  if (username && password) {
    const cred = Buffer.from(`${username}:${password}`).toString("base64");
    headers["Authorization"] = `Basic ${cred}`;
  }

  return headers;
}

// ── Parsing helpers ────────────────────────────────────────────────────────

/**
 * Parse a SearXNG JSON response into SearchResult[].
 * Results are sorted by `score` descending (if present) and capped.
 * Result URLs are validated via `checkUrl()` (defence-in-depth).
 */
function parseResults(
  data: SearXngResponse,
  maxResults: number,
): SearchResult[] {
  const raw = data.results ?? [];
  const results: SearchResult[] = [];

  // Sort by score descending — SearXNG assigns relevance scores.
  const sorted = [...raw].sort((a, b) => {
    const sa = typeof a.score === "number" ? a.score : 0;
    const sb = typeof b.score === "number" ? b.score : 0;
    return sb - sa;
  });

  for (const entry of sorted) {
    if (results.length >= maxResults) break;

    const title = (entry.title ?? "").trim();
    const url = (entry.url ?? "").trim();
    if (!title || !url) continue;

    // Defence-in-depth: SearXNG aggregates from many upstream engines.
    const guard = checkUrl(url);
    if (!guard.ok) continue;

    const description = (entry.content ?? "").trim();
    results.push({ title, url, description });
  }

  return results;
}

// ── Provider implementation ─────────────────────────────────────────────────

/**
 * SearXNG self-hosted metasearch provider.
 *
 * Available when `SEARXNG_URL` env var is set. Search-only — does not support
 * extraction. Uses SearXNG's JSON API via global `fetch()`.
 */
export const searxngProvider: WebSearchProvider = {
  name: "searxng",
  supportsSearch: true,
  supportsExtract: false,

  /** Available when SEARXNG_URL is set — no network call. */
  isAvailable(): boolean {
    return !!getSearxngUrl();
  },

  /**
   * Search a SearXNG instance. Returns results sorted by score, or empty
   * array on error. Never throws.
   */
  async search(
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResult[]> {
    const baseUrl = getSearxngUrl();
    if (!baseUrl) return [];

    const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!query.trim()) return [];

    try {
      const url = new URL(`${baseUrl}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("pageno", "1");

      if (opts?.region) {
        url.searchParams.set("language", opts.region);
      }

      if (opts?.safeSearch === false) {
        url.searchParams.set("safesearch", "0");
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: buildAuthHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as SearXngResponse;
      return parseResults(data, maxResults);
    } catch {
      // Network error, timeout, parse failure — return empty results.
      return [];
    }
  },

  /**
   * Extract is not supported by searxng (search-only backend).
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

    // searxng is search-only — return typed "not supported" error.
    return notSupportedResult("searxng", url);
  },
};