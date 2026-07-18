/**
 * ddgs.ts — DuckDuckGo zero-key search backend (Phase 3 floor).
 *
 * Implements {@link WebSearchProvider} using direct HTTP to DuckDuckGo's HTML
 * endpoint (`https://html.duckduckgo.com/html/`). No API key is required — this
 * is the guaranteed-available "zero-key floor" that works even when all paid
 * backends are unconfigured.
 *
 * Capability: search-only (`supportsExtract=false`). The `extract()` method
 * is implemented for interface compliance but returns a typed "not supported"
 * error. It still applies `checkUrl()` to establish the guard pattern that all
 * other backends inherit.
 *
 * Parsing: the HTML response contains result blocks with:
 *   - `<a class="result__a" href="//duckduckgo.com/l/?uddg=ENCODED_URL">Title</a>`
 *   - `<a class="result__snippet" ...>Description</a>`
 * The actual result URL is extracted from the `uddg` query parameter.
 *
 * Security: `checkUrl()` from `../security-guard.js` is applied to every
 * extracted URL (defence-in-depth — DuckDuckGo's redirect URLs are normally
 * safe, but a compromised or spoofed endpoint could inject malicious URLs).
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
  errorResult,
} from "./provider.js";

// ── Constants ──────────────────────────────────────────────────────────────

const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Parsing helpers ────────────────────────────────────────────────────────

/**
 * Extract the actual result URL from a DuckDuckGo redirect link.
 * Redirect links look like: `//duckduckgo.com/l/?uddg=ENCODED_URL&rut=...`
 * Returns the decoded `uddg` value, or the raw href if it doesn't match the
 * redirect pattern (some results link directly to the target).
 */
function extractActualUrl(href: string): string | null {
  // DuckDuckGo redirect: //duckduckgo.com/l/?uddg=<encoded>&rut=...
  const uddgMatch = /[?&]uddg=([^&]+)/.exec(href);
  if (uddgMatch && uddgMatch[1]) {
    try {
      return decodeURIComponent(uddgMatch[1]);
    } catch {
      return uddgMatch[1]; // return raw if decode fails
    }
  }

  // Some results link directly (e.g. `https://example.com`).
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }

  // Protocol-relative: `//example.com/path`
  if (href.startsWith("//")) {
    return `https:${href}`;
  }

  return null;
}

/** Strip HTML tags and decode basic entities from a text fragment. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Parse DuckDuckGo HTML response into SearchResult[].
 * Uses regex to extract result blocks — intentionally simple, no DOM parser.
 */
function parseResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks: each starts with `<a class="result__a" ...>title</a>`
  // and is followed by `<a class="result__snippet" ...>description</a>`.
  // We match title links first, then find the nearest snippet after each.
  const titleRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = titleRe.exec(html)) !== null && results.length < maxResults) {
    const href = match[1] ?? "";
    const titleHtml = match[2] ?? "";
    const title = stripTags(titleHtml);
    if (!title) continue;

    const url = extractActualUrl(href);
    if (!url) continue;

    // Find the nearest snippet after this title link position.
    const after = html.slice(match.index + match[0].length);
    const snippetRe =
      /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
    const snippetMatch = snippetRe.exec(after);
    const description = snippetMatch && snippetMatch[1]
      ? stripTags(snippetMatch[1])
      : "";

    results.push({ title, url, description });
  }

  return results;
}

// ── Provider implementation ─────────────────────────────────────────────────

/**
 * DuckDuckGo zero-key search provider.
 *
 * Always available (no API key required). Search-only — does not support
 * extraction. Uses DuckDuckGo's HTML endpoint via global `fetch()`.
 */
export const ddgsProvider: WebSearchProvider = {
  name: "ddgs",
  supportsSearch: true,
  supportsExtract: false,

  /** Always available — DuckDuckGo HTML endpoint requires no API key. */
  isAvailable(): boolean {
    return true;
  },

  /**
   * Search DuckDuckGo's HTML endpoint. Returns results or empty array on
   * error. Never throws.
   */
  async search(
    query: string,
    opts?: SearchOptions,
  ): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!query.trim()) return [];

    try {
      // DuckDuckGo HTML endpoint accepts POST with form-encoded `q` parameter.
      const body = new URLSearchParams({
        q: query,
        ...(opts?.region ? { kl: opts.region } : {}),
      });

      const response = await fetch(DDG_HTML_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": DEFAULT_USER_AGENT,
        },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      return parseResults(html, maxResults);
    } catch {
      // Network error, timeout, parse failure — return empty results.
      return [];
    }
  },

  /**
   * Extract is not supported by ddgs (search-only backend).
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

    // ddgs is search-only — return typed "not supported" error.
    return notSupportedResult("ddgs", url);
  },
};