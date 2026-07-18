/**
 * exa.ts — Exa search+extract backend (Phase 3).
 *
 * Implements {@link WebSearchProvider} using Exa's REST API via global
 * `fetch()`. No SDK package is needed — all calls are plain HTTP POST.
 *
 * Capabilities: search=true, extract=true.
 *   - `search()`  → POST `/search` with JSON body + `x-api-key` header
 *   - `extract()` → POST `/contents` with JSON body + `x-api-key` header
 *
 * Auth: `x-api-key: <EXA_API_KEY>` header.
 * `isAvailable()` = `!!process.env.EXA_API_KEY` — no network call.
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

const EXA_BASE_URL = "https://api.exa.ai";
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CHARS = 15_000;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Get the API key from env. */
function apiKey(): string | undefined {
  return process.env.EXA_API_KEY;
}

/** Truncate content to maxChars using head+tail pattern. */
function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const headLen = Math.floor(maxChars / 2);
  const tailLen = maxChars - headLen - 100;
  const head = content.slice(0, headLen);
  const tail = content.slice(content.length - tailLen);
  return `${head}\n\n[... ${content.length - headLen - tailLen} chars omitted ...]\n\n${tail}`;
}

// ── Response parsing ────────────────────────────────────────────────────────

/** Exa search API response shape (minimal). */
interface ExaSearchResponse {
  requestId?: string;
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
    highlights?: string[];
    summary?: string;
    publishedDate?: string;
    author?: string;
  }>;
  resolvedSearchType?: string;
}

/** Exa contents (extract) API response shape. */
interface ExaContentsResponse {
  results?: Array<{
    url?: string;
    title?: string;
    text?: string;
  }>;
}

/** Parse Exa search response into SearchResult[]. */
function parseSearchResults(data: ExaSearchResponse, maxResults: number): SearchResult[] {
  const rawResults = data.results ?? [];
  const results: SearchResult[] = [];

  for (const r of rawResults) {
    if (results.length >= maxResults) break;
    const title = r?.title ?? "";
    const url = r?.url ?? "";
    // Prefer text, fall back to summary, then highlights.
    const description = r?.text ?? r?.summary ?? (r?.highlights?.join(" ") ?? "");
    if (!url) continue;
    results.push({ title, url, description });
  }

  return results;
}

// ── Provider implementation ─────────────────────────────────────────────────

/**
 * Exa search+extract provider.
 *
 * Requires `EXA_API_KEY` env var. Both search and extract are supported
 * via Exa's REST API using global `fetch()`.
 */
export const exaProvider: WebSearchProvider = {
  name: "exa",
  supportsSearch: true,
  supportsExtract: true,

  /** Cheap env-probe — checks for EXA_API_KEY. No network call. */
  isAvailable(): boolean {
    return !!apiKey();
  },

  /**
   * Search via Exa's `/search` endpoint. Returns results or empty array on
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
        numResults: maxResults,
        type: "auto",
        contents: {
          summary: query,
          highlights: true,
        },
      };

      const response = await fetch(`${EXA_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });

      if (!response.ok) return [];

      const data = (await response.json()) as ExaSearchResponse;
      return parseSearchResults(data, maxResults);
    } catch {
      return [];
    }
  },

  /**
   * Extract page content via Exa's `/contents` endpoint. Applies
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
      return errorResult(url, "EXA_API_KEY not set");
    }

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

    try {
      const body = {
        ids: [url],
        text: true,
      };

      const response = await fetch(`${EXA_BASE_URL}/contents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });

      if (!response.ok) {
        return errorResult(url, `Exa extract HTTP ${response.status}`);
      }

      const data = (await response.json()) as ExaContentsResponse;

      // Find the matching result.
      const result = data.results?.find((r) => r?.url === url);
      if (!result) {
        return errorResult(url, "Exa extract returned no result for this URL");
      }

      const markdown = truncateContent(result.text ?? "", maxChars);
      const title = result.title ?? "";

      return {
        markdown,
        title,
        url,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(url, `Exa extract error: ${msg}`);
    }
  },
};