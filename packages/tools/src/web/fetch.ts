/**
 * web_fetch — universal HTTP→markdown floor.
 *
 * The guaranteed-available fallback that works even when agent-browser,
 * Chromium, and all API keys are absent. Performs an HTTP GET, converts the
 * response to markdown (for HTML) or returns text as-is, with the shared
 * security guard applied before and after the request.
 *
 * Flow:
 *   1. PRE-FETCH GUARD  — checkUrl(url); blocked → return guardBlock, no request.
 *   2. HTTP GET         — global fetch(), redirect:'follow', AbortSignal timeout.
 *   3. POST-REDIRECT    — checkRedirect(response.url); blocked → guardBlock, no body.
 *   4. CONTENT TYPE     — html→markdown | json→pretty | text→asis | other→raw+note.
 *   5. BOT DETECTION    — detectBot(title); warn but still return content.
 *   6. TRUNCATION       — markdown > maxChars → slice + note.
 *
 * Never throws — all errors become { ok:false, error }.
 *
 * Source: docs/PLAN-BROWSER.md §3C (universal fallback) + §5 Phase 1;
 *         docs/web-lookup-architecture-deepdive.md (Security gauntlet).
 */
import {
  checkUrlAsync,
  checkRedirectAsync,
  detectBot,
  type SecurityGuardOptions,
} from "./security-guard.js";
import type { Mode, ToolResult } from "@my-agent/core";
import { ok, err, isRecord, type ToolImpl } from "../registry.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WebFetchResult {
  ok: boolean;
  markdown: string;
  finalUrl: string;
  title: string;
  contentType: string;
  botDetected?: { patterns: string[] };
  error?: string;
  guardBlock?: { reason: string; category: string };
}

export interface WebFetchOptions extends SecurityGuardOptions {
  /** Request timeout in milliseconds (default 15 000). */
  timeoutMs?: number;
  /** Maximum output characters before truncation (default 50 000). */
  maxChars?: number;
  /** Custom headers (User-Agent, Accept, etc). */
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_CHARS = 15_000;
const DEFAULT_USER_AGENT = "mya-web-fetch/1.0";

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Decode common HTML entities (named + numeric decimal + numeric hex).
 * Called once, at the end of the conversion pipeline, to avoid double-decode.
 */
function decodeEntities(text: string): string {
  let out = text;
  // Named entities — longest first so &amp;lt; doesn't partially decode.
  out = out.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (match) => {
    const lower = match.toLowerCase();
    return NAMED_ENTITIES[lower] ?? match;
  });
  // Numeric decimal: &#39; &#8217;
  out = out.replace(/&#(\d+);/g, (_m, code: string) => {
    const cp = Number(code);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
  // Numeric hex: &#x27; &#x2019;
  out = out.replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => {
    const cp = parseInt(code, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
  return out;
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

function extractTitle(html: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m && m[1] ? decodeEntities(m[1].trim()) : "";
}

// ---------------------------------------------------------------------------
// HTML → Markdown (minimal regex-based converter, no external deps)
// ---------------------------------------------------------------------------

/**
 * Minimal HTML→Markdown converter — good enough for agent consumption.
 * Intentionally simple: strips noise tags, converts common structural tags,
 * decodes entities, collapses whitespace. No CSS selector engine, no DOM.
 */
function htmlToMarkdown(html: string): string {
  let out = html;

  // 1. Remove noise tags entirely (with their content).
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<nav\b[\s\S]*?<\/nav>/gi, "");
  out = out.replace(/<footer\b[\s\S]*?<\/footer>/gi, "");
  out = out.replace(/<header\b[\s\S]*?<\/header>/gi, "");

  // 2. Remove <head> block (metadata, not visible content).
  out = out.replace(/<head\b[\s\S]*?<\/head>/gi, "");

  // 3. <pre> → fenced code block (strip inner <code> wrapper if present).
  out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, content: string) => {
    const cleaned = content.replace(/<\/?code\b[^>]*>/gi, "");
    return "\n```\n" + cleaned.trim() + "\n```\n";
  });

  // 4. Headings <h1>–<h6> → #-prefixed lines.
  out = out.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, level: string, content: string) =>
      "\n" + "#".repeat(Number(level)) + " " + content.trim() + "\n",
  );

  // 5. Links <a href="...">text</a> → [text](url).
  out = out.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (_m, attrs: string, text: string) => {
      const hrefMatch = /href=["']([^"']*)["']/i.exec(attrs);
      const href = hrefMatch && hrefMatch[1] ? hrefMatch[1] : "#";
      const linkText = text.trim();
      return linkText ? `[${linkText}](${href})` : "";
    },
  );

  // 6. <strong>/<b> → **bold**.
  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");

  // 7. <em>/<i> → *italic*.
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");

  // 8. <blockquote> → > prefixed lines.
  out = out.replace(
    /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_m, content: string) =>
      "\n" +
      content
        .trim()
        .split("\n")
        .map((l: string) => "> " + l)
        .join("\n") +
      "\n",
  );

  // 9. <li> → "- item'.
  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

  // 10. <br> → newline.
  out = out.replace(/<br\s*\/?>/gi, "\n");

  // 11. <hr> → horizontal rule.
  out = out.replace(/<hr\s*\/?>/gi, "\n---\n");

  // 12. <p> → paragraph spacing (open tag → double newline; close → remove).
  out = out.replace(/<p\b[^>]*>/gi, "\n\n");
  out = out.replace(/<\/p>/gi, "");

  // 13. <code> (inline, not inside pre) → `code`.
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // 14. Strip all remaining HTML tags.
  out = out.replace(/<[^>]+>/g, "");

  // 15. Decode HTML entities (once, after all tag processing).
  out = decodeEntities(out);

  // 16. Collapse whitespace: runs of spaces/tabs → single space,
  //     trim leading/trailing spaces around newlines, max 2 consecutive newlines.
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/ *\n */g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

// ---------------------------------------------------------------------------
// Content-type helpers
// ---------------------------------------------------------------------------

/** Extract the main media type from a Content-Type header value. */
function mainContentType(header: string | null): string {
  if (!header) return "";
  const semi = header.indexOf(";");
  const raw = semi >= 0 ? header.slice(0, semi) : header;
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and return its content as markdown (HTML) or text.
 * Security guard is applied before the request and after redirects.
 * Never throws — errors are returned as { ok:false, error }.
 */
export async function webFetch(
  url: string,
  opts?: WebFetchOptions,
): Promise<WebFetchResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

  // Build headers — set default User-Agent if none provided (case-insensitive).
  const headers: Record<string, string> = { ...opts?.headers };
  const hasUA = Object.keys(headers).some(
    (k) => k.toLowerCase() === "user-agent",
  );
  if (!hasUA) {
    headers["User-Agent"] = DEFAULT_USER_AGENT;
  }

  // Guard options forwarded to security-guard.
  const guardOpts: SecurityGuardOptions = {
    allowPrivateUrls: opts?.allowPrivateUrls,
    blocklist: opts?.blocklist,
  };

  // ── 1. PRE-FETCH GUARD ──────────────────────────────────────────────
  const preCheck = await checkUrlAsync(url, guardOpts);
  if (!preCheck.ok) {
    return {
      ok: false,
      markdown: "",
      finalUrl: url,
      title: "",
      contentType: "",
      guardBlock: { reason: preCheck.reason, category: preCheck.category },
    };
  }

  // ── 2. HTTP GET ─────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" ||
        err.name === "AbortError" ||
        /timeout|abort/i.test(err.message));
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      markdown: "",
      finalUrl: url,
      title: "",
      contentType: "",
      error: isTimeout ? `request timed out after ${timeoutMs}ms` : msg,
    };
  }

  // ── 3. POST-REDIRECT GUARD ──────────────────────────────────────────
  const finalUrl = response.url || url;
  const postCheck = await checkRedirectAsync(finalUrl, guardOpts);
  if (!postCheck.ok) {
    return {
      ok: false,
      markdown: "",
      finalUrl,
      title: "",
      contentType: "",
      guardBlock: { reason: postCheck.reason, category: postCheck.category },
    };
  }

  // ── 4. READ BODY + CONTENT TYPE ─────────────────────────────────────
  const contentType = mainContentType(response.headers.get("content-type"));

  let body: string;
  try {
    body = await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      markdown: "",
      finalUrl,
      title: "",
      contentType,
      error: msg,
    };
  }

  // ── 5. CONVERT BY CONTENT TYPE ──────────────────────────────────────
  let markdown = "";
  let title = "";

  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    title = extractTitle(body);
    markdown = htmlToMarkdown(body);
  } else if (contentType === "application/json") {
    try {
      const parsed: unknown = JSON.parse(body);
      markdown =
        typeof parsed === "string"
          ? parsed
          : JSON.stringify(parsed, null, 2);
    } catch {
      markdown = body; // not valid JSON — return raw
    }
  } else if (contentType === "text/plain" || contentType.startsWith("text/")) {
    markdown = body;
  } else {
    markdown =
      body + `\n\n[... unsupported content type: ${contentType} — returned raw ...]`;
  }

  // ── 6. BOT DETECTION ────────────────────────────────────────────────
  const bot = detectBot(title);

  // ── 7. TRUNCATION ───────────────────────────────────────────────────
  if (markdown.length > maxChars) {
    const original = markdown.length;
    markdown =
      markdown.slice(0, maxChars) +
      `\n\n[... truncated at ${maxChars} chars; original was ${original} chars ...]`;
  }

  // ── 8. RESULT ───────────────────────────────────────────────────────
  const result: WebFetchResult = {
    ok: true,
    markdown,
    finalUrl,
    title,
    contentType,
  };
  if (bot.detected) {
    result.botDetected = { patterns: bot.patterns };
  }
  return result;
}

// ---------------------------------------------------------------------------
// webFetchTool — ToolImpl adapter for pi/mya-bridge registration
// ---------------------------------------------------------------------------

const PROMPT: Mode = "Prompt";
const DEFAULT_WEB_FETCH_TIMEOUT_MS = 15_000;

/**
 * The `web_fetch` ToolImpl. Exposes the HTTP→markdown floor as a
 * first-class tool the model can invoke directly (in addition to the
 * orchestrator's automatic fallback when the browser chain all-fails).
 *
 * - Runs the same `checkUrl` → `fetch()` → `checkRedirect` gauntlet as
 *   {@link webFetch}, so the model surface and the orchestrator floor share
 *   one security path.
 * - Surfaces guardBlock / error as data on the ToolResult, never throws.
 * - `requiredMode: "Prompt"` (network = trust boundary, matching every
 *   other web tool in this module).
 *
 * The 7th TUI case in `scripts/tui-browser-check.mjs` (browser chain
 * all-fail → web_fetch floor) exercises this exact tool via the
 * orchestrator; the standalone registration also lets the model bypass the
 * browser chain when it already knows the page is plain HTML/JSON/text.
 */
export const webFetchTool: ToolImpl = {
  meta: {
    name: "web_fetch",
    args: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch (http/https). Security guard blocks credentials-in-URL, cloud-metadata, and private/internal addresses.",
        },
        timeoutMs: {
          type: "number",
          description: "Request timeout in milliseconds (default 15000).",
        },
        maxChars: {
          type: "number",
          description: "Maximum output characters before truncation (default 15000).",
        },
        allowPrivateUrls: {
          type: "boolean",
          description: "Allow RFC1918 / loopback / link-local hosts (UNCONDITIONALLY ignored for cloud-metadata IPs). Default: false.",
        },
      },
      required: ["url"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.url !== "string") {
      return err("web_fetch", "url required");
    }
    const timeoutMs =
      typeof args.timeoutMs === "number" && args.timeoutMs > 0
        ? args.timeoutMs
        : DEFAULT_WEB_FETCH_TIMEOUT_MS;
    const maxChars =
      typeof args.maxChars === "number" && args.maxChars > 0
        ? args.maxChars
        : DEFAULT_MAX_CHARS;
    const allowPrivateUrls = args.allowPrivateUrls === true;

    const result = await webFetch(args.url, {
      timeoutMs,
      maxChars,
      allowPrivateUrls,
    });

    if (!result.ok) {
      // Security block or fetch error — surface as data, not throw.
      return ok("web_fetch", {
        url: result.finalUrl,
        markdown: "",
        title: "",
        contentType: result.contentType,
        ok: false,
        error: result.error,
        guardBlock: result.guardBlock,
      });
    }
    return ok("web_fetch", {
      url: result.finalUrl,
      markdown: result.markdown,
      title: result.title,
      contentType: result.contentType,
      botDetected: result.botDetected,
    });
  },
};
