/**
 * host.ts — Orchestrator-aware host registration adapters (Phase 5 of
 * docs/PLAN-BROWSER.md).
 *
 * Mirrors `registerBrowserTools` (../browser/index.ts) and
 * `registerSearchTools` (../search/index.ts), but routes each tool's
 * `execute` through the resilience orchestrator:
 *
 *   - browser_* → `runBrowserWithFallback(args, ctx)`
 *     (camofox → cloud → local → web_fetch universal floor)
 *   - web_search → `runSearchWithFallback(args, ctx)` (chain B)
 *   - web_extract → `runExtractWithFallback(args, ctx)` (chain B' + web_fetch)
 *
 * This preserves the per-tool surface (the model still calls
 * `browser_navigate`, `browser_snapshot`, …, `web_search`, `web_extract`
 * directly) but every dispatch now inherits the cross-capability fallback
 * patterns (D1–D8) and the universal `web_fetch` floor.
 *
 * The leaf-level `registerBrowserTools` / `registerSearchTools` are kept
 * for callers that need direct leaf dispatch (e.g. unit tests, future
 * per-subsystem tool exploration). Production wiring in mya-bridge.ts uses
 * `registerWebTools` + `registerFetchTools` exclusively.
 *
 * Constraints (mirroring Phase 1–4 conventions):
 *   - TS strict + noUncheckedIndexedAccess + ESM + verbatimModuleSyntax.
 *   - Never throws — every dispatch returns a typed ToolResult.
 *   - `registerWebTools` is idempotent at the host layer (calls
 *     `pi.registerTool` per name; de-duplication is the pi registry's job).
 *   - The `web_fetch` standalone tool (Phase 5 acceptance gate #7) is
 *     registered by `registerFetchTools` so the 7th TUI case can
 *     exercise it end-to-end without going through the orchestrator.
 */
import {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserBackTool,
  browserPressTool,
  browserScreenshotTool,
  browserCloseTool,
  BROWSER_DESCRIPTIONS,
} from "./browser/index.js";
import {
  webSearchTool,
  webExtractTool,
  SEARCH_DESCRIPTIONS,
} from "./search/index.js";
import { webFetchTool } from "./fetch.js";
import { ok, err, type ToolImpl } from "../registry.js";
import {
  runBrowserWithFallback,
  runSearchWithFallback,
  runExtractWithFallback,
  type BrowserToolName,
  type OrchestratorArgs,
  type OrchestratorCtx,
} from "./orchestrator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal pi host surface — duck-typed to avoid tight coupling. */
export interface MyaHostApi {
  registerTool(tool: unknown): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Tool → ToolImpl map for the 8 browser_* tools (Phase 1-2 leaf). */
const BROWSER_IMPLS: ToolImpl[] = [
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserBackTool,
  browserPressTool,
  browserScreenshotTool,
];

/** Tool → ToolImpl map for web_search + web_extract (Phase 3 leaf). */
const SEARCH_IMPLS: ToolImpl[] = [webSearchTool, webExtractTool];

/**
 * Narrow the tool name to the browser_* set. Unknown names fall through to
 * the orchestrator, which returns a typed error — we just forward.
 */
function isBrowserToolName(name: string): name is BrowserToolName {
  return BROWSER_IMPLS.some((impl) => impl.meta.name === name);
}

/**
 * Adapt a ToolResult into the `{content: [{type:'text', text}]}` envelope
 * pi's registerTool expects. Mirrors registerBrowserTools / registerSearchTools.
 */
function adaptToPi(result: { ok: boolean; output?: unknown; error?: string; callId?: string }): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  if (result.ok) {
    const text =
      typeof result.output === "string"
        ? result.output
        : (() => {
            try {
              return JSON.stringify(result.output, null, 2);
            } catch {
              return String(result.output);
            }
          })();
    return { content: [{ type: "text", text }] };
  }
  return {
    content: [
      {
        type: "text",
        text: result.error ?? `${result.callId ?? "tool"} failed`,
      },
    ],
    isError: true,
  };
}

/**
 * Build the orchestrator args from raw pi-side parameters. The orchestrator's
 * `args` field is a `Record<string, unknown>`; we cast safely (pi has already
 * JSON-Schema-validated by this point).
 */
function toOrchestratorArgs(
  tool: string,
  params: unknown,
): OrchestratorArgs {
  const args = (params ?? {}) as Record<string, unknown>;
  return { tool, args };
}

/** Build the (opaque) orchestrator ctx — pi's turn ctx is unknown to the
 *  orchestrator; we pass a stub that satisfies the duck-typed contract. */
function toOrchestratorCtx(): OrchestratorCtx {
  return { ctx: undefined as never };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register every web tool (8 browser_* + 2 web_search/web_extract) on the
 * pi host, routing each dispatch through the cross-capability orchestrator.
 *
 * Order matters only for log readability — the model-facing surface is
 * the same set of names whether registered via this adapter or the
 * leaf-level `registerBrowserTools` / `registerSearchTools`.
 *
 * Tool surface preserved:
 *   - browser_navigate, browser_snapshot, browser_click, browser_type,
 *     browser_scroll, browser_back, browser_press, browser_screenshot,
 *     browser_close
 *   - web_search, web_extract
 *
 * `browser_close` is registered here too so the model can call it through
 * the orchestrator path; its orchestrator dispatch is a thin pass-through
 * (no chain — it always succeeds locally).
 */
export function registerWebTools(pi: MyaHostApi): void {
  // ── Browser tools: route through runBrowserWithFallback ──────────────
  for (const impl of BROWSER_IMPLS) {
    const name = impl.meta.name;
    pi.registerTool({
      name,
      description:
        BROWSER_DESCRIPTIONS[name] ??
        // Fallback: rebuild a minimal description from the impl's args.
        `${name} (web tool)`,
      parameters: impl.meta.args,
      async execute(_id: string, params: unknown) {
        try {
          if (!isBrowserToolName(name)) {
            return adaptToPi(err(name, `unknown browser tool "${name}"`));
          }
          const result = await runBrowserWithFallback(
            toOrchestratorArgs(name, params),
            toOrchestratorCtx(),
          );
          return adaptToPi(result);
        } catch (e) {
          // Belt-and-suspenders — the orchestrator promises to never throw,
          // but a future bug or downstream edge case shouldn't crash the TUI.
          return adaptToPi(
            err(name, e instanceof Error ? e.message : String(e)),
          );
        }
      },
    });
  }

  // browser_close is a thin leaf — no chain fallback. Register separately so
  // the orchestrator can short-circuit (still goes through runBrowserWithFallback
  // for shape consistency; the orchestrator will resolve it as a known browser
  // tool and the leaf's `run` always succeeds).
  {
    const name = browserCloseTool.meta.name;
    pi.registerTool({
      name,
      description: BROWSER_DESCRIPTIONS[name] ?? `${name} (web tool)`,
      parameters: browserCloseTool.meta.args,
      async execute(_id: string, params: unknown) {
        try {
          const result = await runBrowserWithFallback(
            toOrchestratorArgs(name, params),
            toOrchestratorCtx(),
          );
          return adaptToPi(result);
        } catch (e) {
          return adaptToPi(
            err(name, e instanceof Error ? e.message : String(e)),
          );
        }
      },
    });
  }

  // ── Search/extract: route through runSearchWithFallback /
  //    runExtractWithFallback ──────────────────────────────────────────
  for (const impl of SEARCH_IMPLS) {
    const name = impl.meta.name;
    pi.registerTool({
      name,
      description: SEARCH_DESCRIPTIONS[name] ?? `${name} (web tool)`,
      parameters: impl.meta.args,
      async execute(_id: string, params: unknown) {
        try {
          const result =
            name === "web_search"
              ? await runSearchWithFallback(
                  toOrchestratorArgs(name, params),
                  toOrchestratorCtx(),
                )
              : await runExtractWithFallback(
                  toOrchestratorArgs(name, params),
                  toOrchestratorCtx(),
                );
          return adaptToPi(result);
        } catch (e) {
          return adaptToPi(
            err(name, e instanceof Error ? e.message : String(e)),
          );
        }
      },
    });
  }
}

/**
 * Register the standalone `web_fetch` tool — the universal HTTP→markdown
 * floor surfaced as a first-class tool the model can call directly.
 *
 * Why register it separately instead of bundling into registerWebTools?
 *   - `web_fetch` is the BROWSER all-fail FLOOR (not a browser tool).
 *     Listing it next to browser_navigate in the model surface is
 *     misleading — the model would think "fetch a page" is a browser op.
 *   - Registering it as its own category matches docs/PLAN-BROWSER.md §3C
 *     ("Universal fallback — web_fetch").
 *   - The 7th TUI case ("browser chain all-fail → web_fetch floor")
 *     proves the orchestrator-driven fallback produces the same observable
 *     `web_fetch` output as a direct call — but the direct call surface
 *     remains available for the model when it knows the page is plain
 *     HTML/JSON/text and doesn't need browser JS execution.
 */
export function registerFetchTools(pi: MyaHostApi): void {
  const name = webFetchTool.meta.name;
  pi.registerTool({
    name,
    description:
      "Universal HTTP→markdown floor. Performs an HTTP GET and returns the " +
      "response as markdown (HTML), pretty-printed JSON, or text. Applies the " +
      "shared security guard (blocks credentials-in-URL, cloud-metadata IPs, and " +
      "private/internal addresses by default; private-IP block can be lifted via " +
      "`allowPrivateUrls: true` for trusted RFC1918 targets — cloud-metadata " +
      "blocking is UNCONDITIONAL). Works even when agent-browser, Chromium, and " +
      "all API keys are absent. Use as a last resort when no other tool can " +
      "answer the question.",
    parameters: webFetchTool.meta.args,
    async execute(_id: string, params: unknown) {
      try {
        const result = await webFetchTool.run(params, undefined as never);
        return adaptToPi(result);
      } catch (e) {
        return adaptToPi(
          err(name, e instanceof Error ? e.message : String(e)),
        );
      }
    },
  });
}

// Re-export the orchestrator API so callers (mya-bridge) get a single import.
export {
  runBrowserWithFallback,
  runSearchWithFallback,
  runExtractWithFallback,
  withResilience,
  loadWebConfig,
  loadWebConfigFromEnv,
  validateWebConfig,
  DEFAULT_WEB_CONFIG,
  WEB_CONFIG_ENV,
} from "./orchestrator.js";
export type {
  BrowserToolName,
  SearchToolName,
  OrchestratorArgs,
  OrchestratorCtx,
  TriedStep,
  ResilienceId,
  ResilienceOpt,
  ResilienceAction,
  ResilienceResult,
  ResilienceOk,
  ResilienceErr,
} from "./orchestrator.js";
export type {
  WebConfig,
  PreferredEngineName,
  SearchBackendName,
  ExtractBackendName,
} from "./config.js";
export { webFetchTool } from "./fetch.js";
export { ok, err } from "../registry.js";
export type { ToolImpl } from "../registry.js";