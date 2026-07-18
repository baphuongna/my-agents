/**
 * parallel.ts — Parallel AI search + extract backend (Phase 3).
 *
 * Implements {@link WebSearchProvider} using the Parallel AI API
 * (`https://api.parallel.ai/v1beta/search` and `/v1beta/extract`).
 *
 * Capability: search + extract (`supportsSearch=true`, `supportsExtract=true`).
 *
 * Auth: `PARALLEL_API_KEY` env var. The `x-api-key` header carries the key.
 * A required `parallel-beta: search-extract-2025-10-10` header is also sent.
 *
 * `isAvailable()` = `!!env.PARALLEL_API_KEY` — cheap env-probe, NO network.
 *
 * Search: POST to `/v1beta/search` with `{objective, search_queries, mode,
 * excerpts}`. Response: `{search_id, results: [{url, title, excerpts[],
 * publish_date?}], warnings, usage}`.
 *
 * Extract: POST to `/v1beta/extract` with `{urls, excerpts, full_content}`.
 * Response: `{extract_id, results: [{url, title, excerpts[], full_content?
 * publish_date?}], errors: [{url, error_type?, http_status_code?, content?}],
 * warnings, usage}`.
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

const PARALLEL_API_BASE = "https://api.parallel.ai";
const PARALLEL_SEARCH_URL = `${PARALLEL_API_BASE}/v1beta/search`;
const PARALLEL_EXTRACT_URL = `${PARALLEL_API_BASE}/v1beta/extract`;
const PARALLEL_BETA_HEADER = "search-extract-2025-10-10";

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CHARS = 15_000;

// ── Types (internal — response shapes) ──────────────────────────────────────

interface ParallelSearchItem {
  url?: string;
  title?: string;
  excerpts?: string[];
  publish_date?: string;
}

interface ParallelSearchResponse {
  search_id?: string;
  results?: ParallelSearchItem[];
  warnings?: unknown[];
  usage?: unknown[];
}

interface ParallelExtractItem {
  url?: string;
  title?: string;
  excerpts?: string[];
  full_content?: string;
  publish_date?: string;
}

interface ParallelExtractError {
  url?: string;
  error_type?: string;
  http_status_code?: number;
  content?: string;
}

interface ParallelExtractResponse {
  extract_id?: string;
  results?: ParallelExtractItem[];
  errors?: ParallelExtractError[];
  warnings?: unknown[];
  usage?: unknown[];
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

/** Build auth headers for Parallel API requests. */
function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "parallel-beta": PARALLEL_BETA_HEADER,
  };
}

/** Safely get the API key from env. */
function getApiKey(): string | undefined {
  return process.env.PARALLEL_API_KEY;
}

// ── Provider implementation ─────────────────────────────────────────────────

/**
 * Parallel AI search + extract provider.
 *
 * Available when `PARALLEL_API_KEY` is set. Supports both search and extract.
 * Uses global `fetch()` — no SDK dependency.
 */
export const parallelProvider: WebSearchProvider = {
  name: "parallel",
  supportsSearch: true,
  supportsExtract: true,

  /** Cheap env-probe — no network call. */
  isAvailable(): boolean {
    return !!getApiKey();
  },

  /**
   * Search via Parallel AI. Returns results or empty array on error.
   * Never throws.
   */
  async search(
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const apiKey = getApiKey();
    if (!apiKey) return [];

    const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const body = JSON.stringify({
        objective: query,
        search_queries: [query],
        mode: "fast",
        max_results: maxResults,
        excerpts: {
          max_chars_per_result: 10_000,
        },
      });

      const response = await fetch(PARALLEL_SEARCH_URL, {
        method: "POST",
        headers: buildHeaders(apiKey),
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) return [];

      const payload = (await response.json()) as ParallelSearchResponse;
      const items = payload.results ?? [];
      const results: SearchResult[] = [];

      for (const item of items) {
        if (!item.url) continue;
        const excerpts = item.excerpts ?? [];
        const description = excerpts.length > 0 ? excerpts.join("\n\n") : "";
        results.push({
          title: item.title ?? item.url,
          url: item.url,
          description,
        });
        if (results.length >= maxResults) break;
      }

      return results;
    } catch {
      return [];
    }
  },

  /**
   * Extract page content via Parallel AI. Applies `checkUrl()` before
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
    if (!apiKey) {
      return errorResult(url, "Parallel API key not configured (PARALLEL_API_KEY)");
    }

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

    try {
      const body = JSON.stringify({
        urls: [url],
        excerpts: true,
        full_content: true,
      });

      const response = await fetch(PARALLEL_EXTRACT_URL, {
        method: "POST",
        headers: buildHeaders(apiKey),
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return errorResult(
          url,
          `Parallel extract API error: HTTP ${response.status}`,
        );
      }

      const payload = (await response.json()) as ParallelExtractResponse;

      // Check for per-URL errors.
      const errors = payload.errors ?? [];
      for (const err of errors) {
        if (err.url === url) {
          const errMsg = err.error_type ?? err.content ?? "extract failed";
          return errorResult(url, `Parallel extract error: ${errMsg}`);
        }
      }

      // Find the matching result.
      const results = payload.results ?? [];
      const match = results.find((r) => r.url === url);
      if (!match) {
        return errorResult(url, "Parallel extract returned no result for this URL");
      }

      // Prefer full_content, fall back to excerpts.
      const excerpts = match.excerpts ?? [];
      const excerptContent = excerpts.filter((e) => e.trim().length > 0).join("\n\n").trim();
      const fullContent = match.full_content?.trim() ?? "";
      const content = excerptContent || fullContent;

      if (!content) {
        return errorResult(url, "Parallel extract returned empty content");
      }

      return {
        markdown: truncateContent(content, maxChars),
        title: match.title ?? "",
        url,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      return errorResult(url, `Parallel extract error: ${message}`);
    }
  },
};