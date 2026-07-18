/**
 * firecrawl.ts — Firecrawl search + extract backend (Phase 3).
 *
 * Implements {@link WebSearchProvider} using the Firecrawl v2 API
 * (`https://api.firecrawl.dev/v2/search` and `/v2/scrape`).
 *
 * Capability: search + extract (`supportsSearch=true`, `supportsExtract=true`).
 *
 * Auth: `FIRECRAWL_API_KEY` env var (direct cloud) OR `FIRECRAWL_GATEWAY_URL`
 * env var (tool-gateway routing). `isAvailable()` checks both.
 *
 * Search: POST to `/v2/search` with `{query, limit, sources: [{type: "web"}]}`.
 * Response shape varies across SDK / direct / gateway — normalised to extract
 * `data.web[]` or top-level `results[]` or `web[]`.
 *
 * Extract: POST to `/v2/scrape` with `{url, formats: ["markdown", "html"]}`.
 * Response: `{data: {markdown, html, metadata: {title, sourceURL}}}`.
 *
 * Security: `checkUrl()` from `../security-guard.js` is applied to every URL
 * before extract dispatch. Never throws — all errors become typed result
 * fields or empty arrays.
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

const FIRECRAWL_CLOUD_BASE = "https://api.firecrawl.dev";
const FIRECRAWL_SEARCH_PATH = "/v2/search";
const FIRECRAWL_SCRAPE_PATH = "/v2/scrape";

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CHARS = 15_000;

// ── Types (internal — response shapes) ──────────────────────────────────────

interface FirecrawlWebResult {
  title?: string;
  url?: string;
  description?: string;
  markdown?: string;
}

interface FirecrawlSearchResponse {
  id?: string;
  data?: {
    web?: FirecrawlWebResult[];
    results?: FirecrawlWebResult[];
  };
  results?: FirecrawlWebResult[];
  web?: FirecrawlWebResult[];
}

interface FirecrawlScrapeResponse {
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      sourceURL?: string;
    };
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Truncate content to maxChars using head+tail strategy. */
function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const head = Math.floor(maxChars / 2);
  const tail = Math.ceil(maxChars / 2);
  return (
    content.slice(0, head) +
    `\n\n[... ${content.length - maxChars} characters omitted ...]\n\n` +
    content.slice(-tail)
  );
}

/** Resolve the Firecrawl API key from env. */
function getApiKey(): string | undefined {
  return process.env.FIRECRAWL_API_KEY;
}

/**
 * Resolve the base URL for Firecrawl API requests.
 * - If `FIRECRAWL_GATEWAY_URL` is set, use it (tool-gateway routing).
 * - If `FIRECRAWL_API_URL` is set, use it (self-hosted instance).
 * - Otherwise default to the cloud endpoint.
 */
function getBaseUrl(): string {
  const gateway = process.env.FIRECRAWL_GATEWAY_URL;
  if (gateway) return gateway.replace(/\/+$/, "");
  const apiUrl = process.env.FIRECRAWL_API_URL;
  if (apiUrl) return apiUrl.replace(/\/+$/, "");
  return FIRECRAWL_CLOUD_BASE;
}

/** Build auth headers for Firecrawl API requests. */
function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * Normalise the varying Firecrawl search response shapes into a flat
 * array of web results. The API / SDK / gateway may return:
 *   - `{data: {web: [...]}}` (v2 direct)
 *   - `{data: {results: [...]}}` (alternate shape)
 *   - `{results: [...]}` (top-level)
 *   - `{web: [...]}` (gateway compact)
 */
function extractSearchResults(payload: FirecrawlSearchResponse): FirecrawlWebResult[] {
  if (payload.data) {
    if (payload.data.web) return payload.data.web;
    if (payload.data.results) return payload.data.results;
  }
  if (payload.results) return payload.results;
  if (payload.web) return payload.web;
  return [];
}

// ── Provider implementation ─────────────────────────────────────────────────

/**
 * Firecrawl search + extract provider.
 *
 * Available when `FIRECRAWL_API_KEY`, `FIRECRAWL_API_URL`, or
 * `FIRECRAWL_GATEWAY_URL` is set. Supports both search and extract.
 * Uses global `fetch()` — no SDK dependency.
 */
export const firecrawlProvider: WebSearchProvider = {
  name: "firecrawl",
  supportsSearch: true,
  supportsExtract: true,

  /** Cheap env-probe — no network call. */
  isAvailable(): boolean {
    return !!getApiKey() || !!process.env.FIRECRAWL_GATEWAY_URL || !!process.env.FIRECRAWL_API_URL;
  },

  /**
   * Search via Firecrawl. Returns results or empty array on error.
   * Never throws.
   */
  async search(
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    // For gateway routing, API key may not be required (gateway handles auth).
    if (!apiKey && !process.env.FIRECRAWL_GATEWAY_URL) return [];

    const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const body = JSON.stringify({
        query,
        limit: maxResults,
        sources: [{ type: "web" }],
      });

      const response = await fetch(`${baseUrl}${FIRECRAWL_SEARCH_PATH}`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) return [];

      const payload = (await response.json()) as FirecrawlSearchResponse;
      const webResults = extractSearchResults(payload);
      const results: SearchResult[] = [];

      for (const item of webResults) {
        if (!item.url) continue;
        results.push({
          title: item.title ?? item.url,
          url: item.url,
          description: item.description ?? item.markdown ?? "",
        });
        if (results.length >= maxResults) break;
      }

      return results;
    } catch {
      return [];
    }
  },

  /**
   * Extract page content via Firecrawl scrape. Applies `checkUrl()` before
   * dispatch. Returns markdown content or typed error. Never throws.
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

    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    // For gateway routing, API key may not be required.
    if (!apiKey && !process.env.FIRECRAWL_GATEWAY_URL) {
      return errorResult(url, "Firecrawl API key not configured (FIRECRAWL_API_KEY)");
    }

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const body = JSON.stringify({
        url,
        formats: ["markdown", "html"],
      });

      const response = await fetch(`${baseUrl}${FIRECRAWL_SCRAPE_PATH}`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return errorResult(
          url,
          `Firecrawl scrape API error: HTTP ${response.status}`,
        );
      }

      const payload = (await response.json()) as FirecrawlScrapeResponse;
      const data = payload.data;
      if (!data) {
        return errorResult(url, "Firecrawl scrape returned no data");
      }

      // Prefer markdown, fall back to html.
      const content = data.markdown?.trim() || data.html?.trim() || "";
      if (!content) {
        return errorResult(url, "Firecrawl scrape returned empty content");
      }

      const title = data.metadata?.title ?? "";

      return {
        markdown: truncateContent(content, maxChars),
        title,
        url: data.metadata?.sourceURL ?? url,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      return errorResult(url, `Firecrawl scrape error: ${message}`);
    }
  },
};