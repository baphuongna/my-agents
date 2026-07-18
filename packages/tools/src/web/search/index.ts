/**
 * index.ts — web_search + web_extract ToolImpl exports + registerSearchTools adapter.
 *
 * Two tools:
 *   - `web_search`  — resolve backend → search() → return results as JSON.
 *   - `web_extract` — checkUrl() → resolve extract backend → extract() or
 *                     fallback to `webFetch()` from `../fetch.js`.
 *
 * Both tools:
 *   - `requiredMode: "Prompt"` (network = trust boundary).
 *   - Never throw — per-URL errors are returned as data, not throws.
 *   - Apply char-limit truncation (15000 chars) with head+tail + footer note.
 *
 * `registerSearchTools(pi)` mirrors `registerBrowserTools(pi)` from
 * `../browser/index.js`: adapts ToolImpl {meta, run→ToolResult} to
 * pi.registerTool {name, description, parameters, execute→{content}}.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM + verbatimModuleSyntax.
 */
import type { Mode, ToolResult } from "@my-agent/core";
import { ok, err, isRecord, type ToolImpl } from "../../registry.js";
import { checkUrl } from "../security-guard.js";
import { webFetch } from "../fetch.js";
import type { SearchResult, ExtractResult } from "./provider.js";
import {
  resolveSearchBackend,
  resolveExtractBackend,
  type ResolverConfig,
} from "./backend-resolver.js";

// ── Constants ────────────────────────────────────────────────────────────────

const PROMPT: Mode = "Prompt";
const MAX_EXTRACT_CHARS = 15_000;
const TRUNCATION_NOTE = `\n\n[... truncated at ${MAX_EXTRACT_CHARS} chars ...]`;

// ── Truncation helper (head+tail + footer note — hermes pattern) ──────────────

/**
 * Truncate content to `maxChars` using the head+tail pattern: keep the first
 * portion and the last portion, inserting a footer note in between. This
 * preserves both the beginning and end of long pages, which are usually the
 * most useful parts for agent consumption.
 */
function truncateContent(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headLen = Math.floor(maxChars * 0.7);
  const tailLen = maxChars - headLen;
  return text.slice(0, headLen) + TRUNCATION_NOTE + text.slice(-tailLen);
}

// ── web_search tool ──────────────────────────────────────────────────────────

export const webSearchTool: ToolImpl = {
  meta: {
    name: "web_search",
    args: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results (default: 10)",
        },
      },
      required: ["query"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.query !== "string") {
      return err("web_search", "query required");
    }

    const query = args.query;
    if (!query.trim()) {
      return ok("web_search", { results: [], query });
    }

    const maxResults =
      typeof args.max_results === "number" ? args.max_results : undefined;

    // Resolve backend (no network in resolution).
    const config: ResolverConfig = {};
    const resolution = resolveSearchBackend(config);
    if (!resolution.ok) {
      return err("web_search", resolution.reason);
    }

    // Search (never throws — backend returns [] on error).
    try {
      const results: SearchResult[] = await resolution.backend.search(query, {
        maxResults,
      });
      return ok("web_search", { results, query, backend: resolution.backend.name });
    } catch (e) {
      // Defensive: backends should never throw, but guard anyway.
      return err(
        "web_search",
        `search failed (${resolution.backend.name}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  },
};

// ── web_extract tool ─────────────────────────────────────────────────────────

export const webExtractTool: ToolImpl = {
  meta: {
    name: "web_extract",
    args: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to extract content from",
        },
      },
      required: ["url"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.url !== "string") {
      return err("web_extract", "url required");
    }

    const url = args.url;

    // 1. Pre-extract security guard.
    const guard = checkUrl(url);
    if (!guard.ok) {
      return ok("web_extract", {
        url,
        markdown: "",
        title: "",
        backend: "guard",
        guardBlock: { reason: guard.reason, category: guard.category },
      });
    }

    // 2. Resolve extract backend.
    const resolution = resolveExtractBackend();

    // 3. If backend available → call extract().
    if (resolution.ok) {
      try {
        const result: ExtractResult = await resolution.backend.extract(url, {
          maxChars: MAX_EXTRACT_CHARS,
        });

        // If backend returned a guard block or error, pass it through as data.
        if (result.guardBlock || result.error) {
          return ok("web_extract", {
            url: result.url || url,
            markdown: "",
            title: result.title || "",
            backend: resolution.backend.name,
            guardBlock: result.guardBlock,
            error: result.error,
          });
        }

        // Truncate if needed (backends should truncate, but enforce here too).
        const markdown = truncateContent(result.markdown, MAX_EXTRACT_CHARS);

        return ok("web_extract", {
          url: result.url || url,
          markdown,
          title: result.title || "",
          backend: resolution.backend.name,
        });
      } catch (e) {
        // Defensive: backends should never throw, but guard anyway.
        // Fall through to web_fetch fallback.
      }
    }

    // 4. Fallback to webFetch() — no extract backend OR backend threw.
    try {
      const fetchResult = await webFetch(url, {
        maxChars: MAX_EXTRACT_CHARS,
      });

      if (!fetchResult.ok) {
        return ok("web_extract", {
          url,
          markdown: "",
          title: "",
          backend: "web_fetch",
          error: fetchResult.error,
          guardBlock: fetchResult.guardBlock,
        });
      }

      // Truncate if needed (webFetch should truncate, but enforce here too).
      const markdown = truncateContent(
        fetchResult.markdown,
        MAX_EXTRACT_CHARS,
      );

      return ok("web_extract", {
        url: fetchResult.finalUrl || url,
        markdown,
        title: fetchResult.title,
        backend: "web_fetch",
      });
    } catch (e) {
      return err(
        "web_extract",
        `extraction failed (web_fetch fallback): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  },
};

// ── Exports ────────────────────────────────────────────────────────────────

export const searchTools: ToolImpl[] = [webSearchTool, webExtractTool];

// ── Host registration adapter ───────────────────────────────────────────────
// Mirrors registerBrowserTools from ../browser/index.js: adapts ToolImpl
// {meta, run→ToolResult} to pi.registerTool {name, description, parameters,
// execute→{content}.
//
// Exported so the Phase 5 orchestrator-aware host adapter (../host.ts →
// registerWebTools) can reuse the same human-readable descriptions when
// wrapping each tool's `execute` with `runSearchWithFallback` /
// `runExtractWithFallback`.

export const SEARCH_DESCRIPTIONS: Record<string, string> = {
  web_search:
    "Search the web using the best available backend (tavily > exa > parallel " +
    "> firecrawl > searxng > brave > ddgs). Returns results as JSON with title, " +
    "url, and description for each hit. No API key required — falls back to " +
    "DuckDuckGo (zero-key floor) when no paid backend is configured.",
  web_extract:
    "Extract page content from a URL as markdown. Resolves the best extract " +
    "backend (firecrawl > tavily > exa > parallel) and falls back to web_fetch " +
    "(HTTP GET → markdown) when no extract backend is available. Applies the " +
    "security guard first (blocks credentials-in-URL, cloud-metadata, and " +
    "private/internal addresses). Content is truncated to 15000 chars.",
};

/** Register all search/extract ToolImpls onto a host pi API (mya-bridge). */
export function registerSearchTools(pi: { registerTool(t: unknown): void }): void {
  for (const impl of searchTools) {
    const name = impl.meta.name;
    pi.registerTool({
      name,
      description: SEARCH_DESCRIPTIONS[name] ?? name,
      parameters: impl.meta.args,
      async execute(_id: string, params: unknown) {
        let result;
        try {
          result = await impl.run(params, undefined as never);
        } catch (e) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }
        const text = result.ok
          ? typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.output, null, 2)
          : `Error: ${result.error ?? "search tool failed"}`;
        return { content: [{ type: "text" as const, text }] };
      },
    });
  }
}