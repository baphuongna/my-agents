/**
 * tavily.ts — Tavily search+extract backend (Phase 3).
 *
 * Implements {@link WebSearchProvider} using Tavily's REST API via global
 * `fetch()`. No SDK package is needed — all calls are plain HTTP POST.
 *
 * Capabilities: search=true, extract=true.
 *   - `search()`  → POST `/search` with JSON body
 *   - `extract()` → POST `/extract` with JSON body (single URL per call)
 *
 * Auth: `Authorization: Bearer <TAVILY_API_KEY>` header (oh-my-pi pattern).
 * `isAvailable()` = `!!process.env.TAVILY_API_KEY` — no network call.
 *
 * Security: `checkUrl()` from `../security-guard.js` is applied to every URL
 * before extract dispatch (defence-in-depth).
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
  guardBlockResult,
  errorResult,
} from "./provider.js";

// ── Constants ──────────────────────────────────────────────────────────────

const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CHARS = 15_000;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the Tavily base URL from env (default if unset). */
function baseUrl(): string {
  return process.env.TAVILY_BASE_URL ?? TAVILY_DEFAULT_BASE_URL;
}

/** Get the API key from env. */
function apiKey(): string | undefined {
  return process.env.TAVILY_API_KEY;
}

/** Build the Authorization header value. */
function authHeader(key: string): string {
  return `Bearer ${key}`;
}

/** Truncate content to maxChars using head+tail pattern. */
function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const headLen = Math.floor(maxChars / 2);
  const tailLen = maxChars - headLen - 100; // reserve space for truncation notice
  const head = content.slice(0, headLen);
  const tail = content.slice(content.length - tailLen);
  return `${head}\n\n[... ${content.length - headLen - tailLen} chars omitted ...]\n\n${tail}`;
}

// ── Response parsing ────────────────────────────────────────────────────────

/** Tavily search API response shape (minimal — we only read what we need). */
interface TavilySearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
  }>;
  answer?: string;
  request_id?: string;
}

/** Tavily extract API response shape. */
interface TavilyExtractResponse {
  results?: Array<{
    url?: string;
    title?: string;
    raw_content?: string;
    content?: string;
  }>;
  failed_results?: Array<{
    url?: string;
    error?: string;
  }>;
  failed_urls?: string[];
}

/** Parse Tavily search response into SearchResult[]. */
function parseSearchResults(data: TavilySearchResponse, maxResults: number): SearchResult[] {
  const rawResults = data.results ?? [];
  const results: SearchResult[] = [];

  for (const r of rawResults) {
    if (results.length >= maxResults) break;
    const title = r?.title ?? "";
    const url = r?.url ?? "";
    const description = r?.content ?? "";
    if (!url) continue;
    results.push({ title, url, description });
  }

  return results;
}

// ── Provider implementation ─────────────────────────────────────────────────

/**
 * Tavily search+extract provider.
 *
 * Requires `TAVILY_API_KEY` env var. Both search and extract are supported
 * via Tavily's REST API using global `fetch()`.
 */
export const tavilyProvider: WebSearchProvider = {
  name: "tavily",
  supportsSearch: true,
  supportsExtract: true,

  /** Cheap env-probe — checks for TAVILY_API_KEY. No network call. */
  isAvailable(): boolean {
    return !!apiKey();
  },

  /**
   * Search via Tavily's `/search` endpoint. Returns results or empty array on
   * error. Never throws.
   */
  async search(
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResult[]> {
    const key = apiKey();
    if (!key) return [];

    const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!query.trim()) return [];

    try {
      const body = {
        query,
        max_results: maxResults,
        include_raw_content: false,
        include_images: false,
        search_depth: "basic",
        include_answer: "advanced",
      };

      const response = await fetch(`${baseUrl()}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader(key),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });

      if (!response.ok) return [];

      const data = (await response.json()) as TavilySearchResponse;
      return parseSearchResults(data, maxResults);
    } catch {
      return [];
    }
  },

  /**
   * Extract page content via Tavily's `/extract` endpoint. Applies
   * `checkUrl()` before dispatch. Returns ExtractResult with markdown content.
   * Never throws.
   */
  async extract(
    url: string,
    opts?: ExtractOptions,
  ): Promise<ExtractResult> {
    // Security guard — always applied first.
    const guard = checkUrl(url);
    if (!guard.ok) {
      return guardBlockResult(url, guard.reason, guard.category);
    }

    const key = apiKey();
    if (!key) {
      return errorResult(url, "TAVILY_API_KEY not set");
    }

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

    try {
      const body = {
        urls: [url],
        include_images: false,
      };

      const response = await fetch(`${baseUrl()}/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader(key),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });

      if (!response.ok) {
        return errorResult(url, `Tavily extract HTTP ${response.status}`);
      }

      const data = (await response.json()) as TavilyExtractResponse;

      // Check for failure in the response.
      const failed = data.failed_results?.find((f) => f?.url === url);
      if (failed) {
        return errorResult(url, failed.error ?? "Tavily extract failed for this URL");
      }

      // Find the matching result.
      const result = data.results?.find((r) => r?.url === url);
      if (!result) {
        return errorResult(url, "Tavily extract returned no result for this URL");
      }

      const markdown = truncateContent(result.raw_content ?? result.content ?? "", maxChars);
      const title = result.title ?? "";

      return {
        markdown,
        title,
        url,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(url, `Tavily extract error: ${msg}`);
    }
  },
};