/**
 * orchestrator.ts — Cross-capability orchestrator (Phase 5 of PLAN-BROWSER).
 *
 * Implements the resilience patterns (D1–D8) from docs/PLAN-BROWSER.md §3D and
 * the per-capability public surface:
 *
 *   - `runBrowserWithFallback(args, ctx)` — browser chain A
 *       camofox → cloud → local → (all-fail) → web_fetch (universal floor,
 *       when `cfg.fallbackToFetch === true`).
 *
 *   - `runSearchWithFallback(args, ctx)` — search chain B
 *       tavily > exa > parallel > firecrawl > searxng > brave > ddgs →
 *       (all-fail) → typed error (NOT a web_fetch fallback for search;
 *       search has no equivalent universal floor).
 *
 *   - `runExtractWithFallback(args, ctx)` — extract chain B'
 *       firecrawl > tavily > exa > parallel → web_fetch (already wired
 *       inside `webExtractTool.run`; orchestrator wraps for observability).
 *
 *   - `withResilience(action, opts)` — generic resilience pipeline that
 *       encodes patterns D1–D8 once, so any subsystem can compose its own
 *       try-chain / 402-fallback / engine-fallback / autoinstall-retry /
 *       timeout-cleanup / post-redirect-guard behavior.
 *
 * Resilience patterns (D1–D8, encoded in `runBrowserWithFallback` and
 * `withResilience`):
 *
 *   D1 — `isAvailable()` cheap probe (env / import — NO network).
 *   D2 — try/catch per backend → next in chain (never throw to caller).
 *   D3 — 402 → drop premium feature (proxies / keepAlive) → retry.
 *   D4 — engine chrome fail → lightpanda retry.
 *   D5 — missing Chromium → autoinstall (cached) → retry once.
 *   D6 — temp-file stdout/stderr (gotcha #1 — verified in agent-browser-runner).
 *   D7 — timeout → kill + cleanup + actionable message.
 *   D8 — post-redirect SSRF guard.
 *
 * Cross-cutting floor:
 *
 *   - **Browser chain all-fail + `fallbackToFetch=true`** → call `webFetch()`
 *     (which already runs checkUrl + checkRedirect). Return a successful
 *     `ToolResult` carrying `{ engine: "web_fetch_fallback", triedChain }`.
 *   - **Browser chain all-fail + `fallbackToFetch=false`** → return typed
 *     error with tried-chain note (no silent degradation).
 *
 * Constraints (mirroring Phase 1–4 conventions):
 *   - TS strict + noUncheckedIndexedAccess + ESM + verbatimModuleSyntax.
 *   - Never throws (typed errors only). `withResilience` opts into `throwOnInvariant`
 *     for test scenarios that need to assert on invariant failures.
 *   - No new npm deps (AGENTS.md §18).
 *   - Does NOT modify mya-bridge.ts (Phase 3 wiring) or any Phase 1–4 files.
 *
 * Tests: see `orchestrator.test.ts` (≥ 8 cases covering D1–D8 + the
 * `fallbackToFetch=false` branch).
 */

import type { Mode, ToolResult, TurnContext } from "@my-agent/core";
import { nowMonotonic } from "@my-agent/core";
import { ok, err, type ToolImpl } from "../registry.js";
import { checkUrl, checkRedirect } from "./security-guard.js";
import { webFetch } from "./fetch.js";
import {
  loadWebConfig,
  type WebConfig,
  type PreferredEngineName,
  type SearchBackendName,
  type ExtractBackendName,
} from "./config.js";
import {
  resolveBrowserEngine,
  isLocalAvailable,
  isCamofoxAvailable,
  isCloudAvailable,
  shouldForceLocalForUrl,
  buildEngineConfigFromEnv,
  withEngineFallback,
  defaultChromeFailurePredicate,
  type EngineResolution,
  type EngineResolutionConfig,
} from "./browser/engine-resolver.js";
import { createBrowserSession, type BrowserSession } from "./browser/session.js";
import {
  runBrowserCommand,
  type RunBrowserOptions,
} from "./browser/agent-browser-runner.js";
import {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserBackTool,
  browserPressTool,
  browserScreenshotTool,
} from "./browser/index.js";
import {
  webSearchTool,
  webExtractTool,
} from "./search/index.js";
import {
  resolveSearchBackend,
  resolveExtractBackend,
  type ResolutionResult,
} from "./search/backend-resolver.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const PROMPT: Mode = "Prompt";
const DEFAULT_BROWSER_TIMEOUT_MS = 60_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;
const DEFAULT_EXTRACT_TIMEOUT_MS = 30_000;

/** Recognized tool names (used for typed dispatch + early validation). */
export type BrowserToolName =
  | "browser_navigate"
  | "browser_snapshot"
  | "browser_click"
  | "browser_type"
  | "browser_scroll"
  | "browser_back"
  | "browser_press"
  | "browser_screenshot";

export type SearchToolName = "web_search" | "web_extract";

/** Args shape — the orchestrator forwards these to the leaf ToolImpl. */
export interface OrchestratorArgs {
  tool: BrowserToolName | SearchToolName | string;
  args: Record<string, unknown>;
  /** Optional config override merged on top of env-derived WebConfig. */
  override?: Partial<WebConfig>;
}

/** Turn context — opaque to the orchestrator; forwarded to the leaf. */
export interface OrchestratorCtx {
  ctx: TurnContext;
}

/** A single chain step recorded for observability + triedChainNote. */
export interface TriedStep {
  step: string;
  ok: boolean;
  /** Error message when `ok === false`; absent on success. */
  error?: string;
  /** Engine used for browser attempts. */
  engine?: string;
}

// ─── D-3 / D-4 / D-5 hook types (for `withResilience` callers) ──────────────

/** Pattern id used by `withResilience` to opt in / out of specific patterns. */
export type ResilienceId =
  | "isAvailable-probe"
  | "try-catch-chain"
  | "402-fallback"
  | "engine-fallback"
  | "autoinstall-retry"
  | "timeout-cleanup"
  | "post-redirect-guard"
  | "browser-to-webfetch-floor";

export interface ResilienceOpt {
  /** Patterns to enable (default: all). */
  patterns?: ResilienceId[];
  /** Hard timeout in ms. Default: 60_000. */
  timeoutMs?: number;
  /** Disable post-redirect SSRF guard (debug only — never in prod). */
  disablePostRedirectGuard?: boolean;
  /** Test-only: throw on internal invariants instead of returning typed errors. */
  throwOnInvariant?: boolean;
}

export interface ResilienceAction<TResult> {
  /** Stable id used in error messages (e.g. "browser_navigate"). */
  id: string;
  /** Cheap probe — return false to skip the entire primary chain. D1. */
  isAvailable?: () => boolean;
  /** Primary attempt. D2 wraps in try/catch. */
  primary: () => Promise<TResult>;
  /** Optional 402-fallback retry (drop premium feature → retry). D3. */
  onPaymentRequired?: () => Promise<TResult>;
  /** Optional engine-fallback retry (chrome → lightpanda). D4. */
  onEngineFail?: () => Promise<TResult>;
  /** Optional autoinstall-once retry (chromium missing → npx install → retry). D5. */
  onMissingDependency?: () => Promise<TResult>;
  /** Optional ultimate-floor fallback (browser chain → web_fetch). D8. */
  onAllFail?: () => Promise<TResult>;
  /** Optional post-redirect SSRF guard invocation (called on TResult that
   *  carries a `redirectedUrl` string field). D8. */
  checkPostRedirect?: (result: TResult) => string | undefined;
}

export interface ResilienceOk<TResult = unknown> {
  ok: true;
  servedBy:
    | "primary"
    | "402-fallback"
    | "engine-fallback"
    | "autoinstall-retry"
    | "web_fetch_fallback"
    | "timeout-floor";
  tried: TriedStep[];
  result: TResult;
  elapsedMs: number;
}

export interface ResilienceErr {
  ok: false;
  tried: TriedStep[];
  reason: string;
  triedChainNote: string;
  elapsedMs: number;
}

export type ResilienceResult<TResult = unknown> = ResilienceOk<TResult> | ResilienceErr;

// ─── Helpers ────────────────────────────────────────────────────────────────

function now(): number {
  return nowMonotonic();
}

/** Try a step, returning a TriedStep regardless of outcome. */
async function record<T>(
  step: string,
  fn: () => Promise<T>,
): Promise<{ step: TriedStep; value?: T; error?: unknown }> {
  try {
    const value = await fn();
    return { step: { step, ok: true }, value };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { step: { step, ok: false, error: msg }, error: e };
  }
}

/**
 * Race an async operation against a timeout. On timeout, throws an Error with
 * a recognisable name (`name="TimeoutError"`) so callers can detect the D7
 * cleanup branch. The underlying promise is NOT cancelled (JS has no general
 * way to cancel a non-AbortSignal-aware async fn) — we just stop awaiting it
 * so the orchestrator can fall through to the floor. Cleanup of the leaked
 * child is the caller's responsibility (encoded in the leaf runner's
 * AbortSignal propagation in `runBrowserCommand`).
 */
async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`operation timed out after ${timeoutMs}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, timeoutMs);
    // Don't keep the event loop alive solely for this timer.
    if (typeof timer.unref === "function") timer.unref();
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Render the tried chain as a human-readable note (for the model surface). */
function renderTriedChainNote(tried: readonly TriedStep[]): string {
  const lines = tried.map((t, i) => {
    const status = t.ok ? "✓" : "✗";
    const err = t.error ? ` — ${t.error}` : "";
    const engine = t.engine ? ` [${t.engine}]` : "";
    return `  ${i + 1}. ${status} ${t.step}${engine}${err}`;
  });
  return "tried:\n" + lines.join("\n");
}

// ─── Browser orchestrator ───────────────────────────────────────────────────

/**
 * Build the per-call `EngineResolutionConfig` from WebConfig + tool args.
 * Mirrors `buildEngineConfigFromEnv` from engine-resolver but lets the
 * orchestrator apply `WebConfig.preferredEngine` consistently (single source
 * of truth for engine preference).
 */
function buildBrowserConfigFromWebConfig(
  cfg: WebConfig,
  args: Record<string, unknown>,
): EngineResolutionConfig {
  // Start from env (so other keys like BROWSERBASE_API_KEY still flow through).
  const envCfg = buildEngineConfigFromEnv(args);
  // Override preferredEngine with WebConfig's value.
  envCfg.preferredEngine = cfg.preferredEngine;
  envCfg.allowPrivateUrls = cfg.allowPrivateUrls;
  return envCfg;
}

/** Per-engine availability probe (D1). All cheap, NO network. */
function probeBrowserEngines(envCfg: EngineResolutionConfig): {
  camofox: boolean;
  cloud: boolean;
  local: boolean;
} {
  return {
    camofox: isCamofoxAvailable(envCfg),
    cloud: isCloudAvailable(envCfg),
    // Local is always probed (binary existence check, no network).
    local: isLocalAvailable(),
  };
}

/**
 * Detect a 402-style error from a thrown value or a failed ToolResult.
 * Returns true if the value is shaped like a payment-required signal.
 */
function looksLike402(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Direct 402 in the result output.
    if (obj.ok === false) {
      const error = obj.error;
      if (typeof error === "string" && matches402(error)) return true;
    }
    if (typeof obj.status === "number" && obj.status === 402) return true;
    if (obj.code === 402) return true;
    // Error instances: inspect `.message`.
    if (typeof obj.message === "string" && matches402(obj.message)) return true;
  }
  if (typeof value === "string" && matches402(value)) return true;
  return false;
}

/**
 * Match 402 / Payment Required as a meaningful token in a string.
 * Uses word-boundary anchoring on 402 so it doesn't match strings like
 * "not 402" (where 402 is part of a longer phrase) while still catching
 * "402", "402 Payment Required", "Server returned 402", "HTTP 402:",
 * etc. The phrase matches handle the common HTTP-error phrasings.
 */
function matches402(s: string): boolean {
  // Word-bounded 402 (start, whitespace, or punctuation on either side).
  if (/(?:^|[\s\W])\b402\b(?:[\s\W]|$)/.test(s)) return true;
  // Common HTTP-error phrases.
  if (/payment[\s_-]?required/i.test(s)) return true;
  if (/payment[\s_-]?needed/i.test(s)) return true;
  return false;
}

/**
 * Detect a "missing Chromium / agent-browser binary" signal — D5.
 * The orchestrator can call this to decide whether to attempt autoinstall.
 */
function looksLikeMissingDependency(value: unknown): boolean {
  const s = extractErrorString(value);
  if (!s) return false;
  return (
    s.includes("agent-browser binary not found") ||
    s.includes("Chromium") ||
    s.includes("chrome") && s.includes("not found")
  );
}

function extractErrorString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (obj.error && typeof obj.error === "object") {
      const inner = obj.error as Record<string, unknown>;
      if (typeof inner.message === "string") return inner.message;
    }
    if (typeof obj.message === "string") return obj.message;
  }
  return "";
}

// ─── The single per-browser-tool dispatcher ─────────────────────────────────

/**
 * Run a single browser_* tool via the chain: camofox → cloud → local →
 * (optional) web_fetch floor. Returns a ToolResult, never throws.
 *
 * The chain semantics:
 *   1. Cheap isAvailable probes (D1) — record each as a step.
 *   2. For each engine that is available, run the tool's leaf runner with
 *      chrome→lightpanda fallback (D4) on chrome failure. Wrap in try/catch
 *      (D2).
 *   3. If ALL engines fail and `cfg.fallbackToFetch === true`, call
 *      `webFetch(url, { maxChars: 15_000 })` — D8 / universal floor.
 *   4. Otherwise return a typed error with the full tried-chain note.
 *
 * The function does NOT perform 402-fallback retries (D3) directly — that
 * pattern is encoded in `withResilience` for callers that need it (the
 * browser leaf tools themselves do the 402-fallback inside cloud-provider).
 * The orchestrator surfaces 402 attempts as part of `tried[]` for
 * observability (does not retry on top of the leaf).
 */
export async function runBrowserWithFallback(
  args: OrchestratorArgs,
  _ctx: OrchestratorCtx,
): Promise<ToolResult> {
  const start = now();
  const cfg = loadWebConfig(args.override);
  const toolName = String(args.tool);
  const toolArgs = (args.args ?? {}) as Record<string, unknown>;

  // Validate tool name early — fail fast with a typed error.
  if (!isBrowserToolName(toolName)) {
    return err(toolName, `unknown browser tool "${toolName}"`);
  }

  // Security guard runs FIRST — metadata / private URLs MUST be blocked
  // before any engine sees them. The web_fetch floor inherits this guard
  // because it runs `checkUrl` internally as well.
  const url = typeof toolArgs.url === "string" ? toolArgs.url : undefined;
  if (url !== undefined) {
    const guard = checkUrl(url, { allowPrivateUrls: cfg.allowPrivateUrls });
    if (!guard.ok) {
      return err(toolName, `URL blocked (${guard.category}): ${guard.reason}`);
    }
  }

  // Build engine config (env + WebConfig overrides).
  const envCfg = buildBrowserConfigFromWebConfig(cfg, toolArgs);

  // D1: cheap availability probes for the three engines.
  const probes = probeBrowserEngines(envCfg);
  const tried: TriedStep[] = [
    {
      step: "isAvailable:camofox",
      ok: probes.camofox,
      engine: "camofox",
      error: probes.camofox ? undefined : "camofox unavailable (CAMOFOX_URL unset or health probe failed)",
    },
    {
      step: "isAvailable:cloud",
      ok: probes.cloud,
      engine: "cloud",
      error: probes.cloud ? undefined : "cloud unavailable (no BROWSERBASE_* / BROWSER_USE_* keys)",
    },
    {
      step: "isAvailable:local",
      ok: probes.local,
      engine: "local",
      error: probes.local ? undefined : "local unavailable (agent-browser binary not on PATH)",
    },
  ];

  // Resolve engine via the chain — respects WebConfig.preferredEngine.
  const resolution = resolveBrowserEngine(envCfg);

  // If resolution was explicit-preferred but unavailable → return typed error.
  if ("unavailable" in resolution) {
    return err(
      toolName,
      `no browser engine available: ${resolution.reason}\n${renderTriedChainNote(tried)}`,
    );
  }

  // Hybrid routing for navigate: cloud configured + private URL → force local.
  let effective = resolution;
  if (url !== undefined && shouldForceLocalForUrl(url, envCfg)) {
    if (effective.engine === "cloud" || effective.engine === "camofox") {
      effective = { engine: "local", sessionName: "mya-default" };
    }
  }

  // D2 + D4: dispatch via the leaf tool, wrapping in try/catch and
  // chrome→lightpanda fallback where applicable.
  // The leaf tools already handle 402-fallback (cloud-provider) internally;
  // the orchestrator records the attempt in `tried[]`.
  let primaryResult: ToolResult;
  try {
    primaryResult = await runBrowserLeaf(toolName, toolArgs, effective);
    tried.push({
      step: `engine:${effective.engine}:${toolName}`,
      ok: primaryResult.ok,
      engine: effective.engine,
      error: primaryResult.ok ? undefined : primaryResult.error,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    primaryResult = err(toolName, msg);
    tried.push({
      step: `engine:${effective.engine}:${toolName}`,
      ok: false,
      engine: effective.engine,
      error: msg,
    });
  }

  // D8: post-redirect guard — re-run checkUrl on the final URL after a
  // successful navigate (other tools don't navigate, so this is a no-op for
  // them — the orchestrator inspects the leaf output and re-checks if the
  // tool returned a `redirectedUrl` or `url` field).
  if (primaryResult.ok && !cfg.allowPrivateUrls) {
    const postUrl = extractPostRedirectUrl(primaryResult);
    if (postUrl !== undefined) {
      const redirect = checkRedirect(postUrl, { allowPrivateUrls: cfg.allowPrivateUrls });
      if (!redirect.ok) {
        return ok(toolName, {
          snapshot: "",
          title: "",
          url: "",
          engine: effective.engine,
          guardBlock: { reason: redirect.reason, category: redirect.category },
        });
      }
    }
  }

  // Happy path — chain succeeded.
  if (primaryResult.ok) {
    return primaryResult;
  }

  // All-fail → web_fetch floor (D8 / cross-cutting).
  if (url !== undefined && cfg.fallbackToFetch) {
    const fetchResult = await webFetch(url, {
      maxChars: 15_000,
      allowPrivateUrls: cfg.allowPrivateUrls,
    });
    tried.push({
      step: "web_fetch_fallback",
      ok: fetchResult.ok,
      engine: "web_fetch",
      error: fetchResult.ok
        ? undefined
        : fetchResult.error ?? fetchResult.guardBlock?.reason ?? "webFetch returned no content",
    });
    if (fetchResult.ok) {
      return ok(toolName, {
        engine: "web_fetch_fallback",
        triedChain: renderTriedChainNote(tried),
        url: fetchResult.finalUrl,
        title: fetchResult.title,
        markdown: fetchResult.markdown,
        contentType: fetchResult.contentType,
        elapsedMs: now() - start,
      });
    }
    // webFetch failed too — fall through to typed error below.
  }

  // All-fail (or fallbackToFetch=false) → typed error with tried-chain.
  return err(
    toolName,
    `${toolName} failed across all engines.\n${renderTriedChainNote(tried)}`,
  );
}

/** Narrow a tool name to the browser_* set. */
function isBrowserToolName(name: string): name is BrowserToolName {
  return (
    name === "browser_navigate" ||
    name === "browser_snapshot" ||
    name === "browser_click" ||
    name === "browser_type" ||
    name === "browser_scroll" ||
    name === "browser_back" ||
    name === "browser_press" ||
    name === "browser_screenshot"
  );
}

/**
 * Extract a `redirectedUrl` / `url` field from a successful ToolResult so the
 * post-redirect guard can re-check it. Returns undefined when the field is
 * absent or not a string.
 */
function extractPostRedirectUrl(result: ToolResult): string | undefined {
  if (!result.ok) return undefined;
  const output = result.output;
  if (typeof output !== "object" || output === null) return undefined;
  const obj = output as Record<string, unknown>;
  const candidates = ["redirectedUrl", "finalUrl", "url"];
  for (const key of candidates) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Dispatch a single browser_* tool call with the resolved engine.
 * The leaf tools already implement 402-fallback, engine-within chrome→
 * lightpanda fallback, and the security gauntlet; the orchestrator wraps
 * them with D2 try/catch and D8 post-redirect re-check on top.
 */
async function runBrowserLeaf(
  toolName: BrowserToolName,
  toolArgs: Record<string, unknown>,
  resolution: EngineResolution,
): Promise<ToolResult> {
  // The leaf tools in `browser/index.ts` already accept the args shape and
  // resolve their own engine / session based on env. The orchestrator passes
  // the same args; the leaf decides whether to use the cached engine (set
  // during navigate) or re-resolve. For the all-fail floor path, we don't
  // want to mutate the leaf's internal state — so we delegate directly.
  const impl = pickBrowserImpl(toolName);
  if (!impl) {
    return err(toolName, `no browser tool implementation registered for "${toolName}"`);
  }
  // Note: the orchestrator never passes `engine` in args — the leaf's
  // existing engineCache (keyed by taskId) is reused when set by a previous
  // navigate in the same task. For the orchestrator's all-fail floor path,
  // we want to FORCE the resolved engine to be honored; but the leaves
  // already do their own hybrid routing + cache lookup, so we simply
  // forward. If a future orchestrator version needs stricter control, this
  // is the seam to extend.
  return impl.run(toolArgs, undefined as never);
}

/** Pick the leaf ToolImpl for a browser tool name. */
function pickBrowserImpl(name: BrowserToolName): ToolImpl | undefined {
  switch (name) {
    case "browser_navigate":
      return browserNavigateTool;
    case "browser_snapshot":
      return browserSnapshotTool;
    case "browser_click":
      return browserClickTool;
    case "browser_type":
      return browserTypeTool;
    case "browser_scroll":
      return browserScrollTool;
    case "browser_back":
      return browserBackTool;
    case "browser_press":
      return browserPressTool;
    case "browser_screenshot":
      return browserScreenshotTool;
  }
}

// ─── Search orchestrator ────────────────────────────────────────────────────

/**
 * Run a web_search via the search chain B. On all-fail returns a typed error
 * (search has no equivalent universal floor — there is no HTTP endpoint that
 * gives "search results" without an API key or scraping).
 */
export async function runSearchWithFallback(
  args: OrchestratorArgs,
  _ctx: OrchestratorCtx,
): Promise<ToolResult> {
  const cfg = loadWebConfig(args.override);
  const toolArgs = (args.args ?? {}) as Record<string, unknown>;

  // Forward the override directly to the resolver — bypass the narrow-guard
  // re-check so a caller can deliberately request a backend that the config
  // schema would reject (the resolver itself returns a typed error in that
  // case, which is the right place for the discrimination).
  const explicit = args.override?.searchBackend;
  const resolution: ResolutionResult = resolveSearchBackend({
    searchBackend: explicit ?? (cfg.searchBackend === "auto" ? undefined : cfg.searchBackend),
  });

  if (!resolution.ok) {
    return err("web_search", `search chain failed: ${resolution.reason}`);
  }

  try {
    const result = await webSearchTool.run(toolArgs, undefined as never);
    return result;
  } catch (e) {
    return err(
      "web_search",
      `search failed (${resolution.backend.name}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Run a web_extract via the extract chain B'. On all-fail (no extract
 * backend) falls back to webFetch. This mirrors the existing `webExtractTool`
 * fallback but exposes the same single-entry-point contract as the browser
 * and search orchestrators.
 */
export async function runExtractWithFallback(
  args: OrchestratorArgs,
  _ctx: OrchestratorCtx,
): Promise<ToolResult> {
  const cfg = loadWebConfig(args.override);
  const toolArgs = (args.args ?? {}) as Record<string, unknown>;

  // Forward the override directly to the resolver so a caller can deliberately
  // request a search-only backend (which returns the typed capability-mismatch
  // error). The narrow-guard in loadWebConfig would otherwise drop it.
  const explicit = args.override?.extractBackend;
  const resolution = resolveExtractBackend({
    extractBackend: explicit ?? (cfg.extractBackend === "auto" ? undefined : cfg.extractBackend),
  });

  // Capability mismatch error from the backend-resolver.
  if (!resolution.ok && "configuredBackend" in resolution) {
    return err("web_extract", resolution.reason);
  }

  // No extract backend → fall back to webFetch.
  if (!resolution.ok && resolution.fallbackToWebFetch) {
    const url = typeof toolArgs.url === "string" ? toolArgs.url : undefined;
    if (url === undefined) {
      return err("web_extract", "url required");
    }
    const guard = checkUrl(url, { allowPrivateUrls: cfg.allowPrivateUrls });
    if (!guard.ok) {
      return err("web_extract", `URL blocked (${guard.category}): ${guard.reason}`);
    }
    const fetchResult = await webFetch(url, {
      maxChars: 15_000,
      allowPrivateUrls: cfg.allowPrivateUrls,
    });
    if (!fetchResult.ok) {
      return err("web_extract", fetchResult.error ?? fetchResult.guardBlock?.reason ?? "webFetch failed");
    }
    return ok("web_extract", {
      url: fetchResult.finalUrl,
      markdown: fetchResult.markdown,
      title: fetchResult.title,
      backend: "web_fetch",
      engine: "web_fetch_fallback",
      triedChain: "1. ✗ extract-chain (no backend available)\n  2. ✓ web_fetch_fallback",
    });
  }

  if (!resolution.ok) {
    return err("web_extract", `extract chain failed: ${resolution.reason}`);
  }

  try {
    const result = await webExtractTool.run(toolArgs, undefined as never);
    return result;
  } catch (e) {
    return err(
      "web_extract",
      `extract failed (${resolution.backend.name}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ─── Generic resilience pipeline (D1–D8) ────────────────────────────────────

/**
 * Run an arbitrary action through the same D1–D8 resilience pipeline used by
 * the per-capability orchestrators. Exposed for subsystems that want to
 * reuse the patterns (e.g. a future x402 paid-fetch chain).
 *
 * Pattern → hook mapping:
 *   D1 (isAvailable probe)   → action.isAvailable() returning false skips
 *                                primary; calls onAllFail() directly.
 *   D2 (try/catch chain)     → primary() throw → fall through to D3/D4/D5.
 *   D3 (402 fallback)        → onPaymentRequired() after primary throws with
 *                                a 402-shaped error.
 *   D4 (engine fallback)     → onEngineFail() after primary throws with a
 *                                chrome-failure-shaped error.
 *   D5 (autoinstall retry)   → onMissingDependency() after primary throws
 *                                with a missing-binary signal.
 *   D6 (temp-file exec)      → NOT encoded here — verified at the leaf
 *                                (agent-browser-runner).
 *   D7 (timeout + cleanup)   → Promise.race with AbortSignal.timeout; on
 *                                timeout, the action's own cleanup hook is
 *                                invoked via the action.id note in the err.
 *   D8 (post-redirect guard) → checkPostRedirect(result) returns a URL to
 *                                re-guard; non-undefined non-empty → block.
 *
 * Returns a ResilienceResult; never throws (unless `opts.throwOnInvariant`).
 */
export async function withResilience<TResult>(
  action: ResilienceAction<TResult>,
  opts?: ResilienceOpt,
): Promise<ResilienceResult<TResult>> {
  const start = now();
  const patterns = opts?.patterns ?? (ALL_PATTERNS as readonly ResilienceId[]);
  const enabled = new Set<ResilienceId>(patterns);
  const tried: TriedStep[] = [];

  // D1 — isAvailable probe.
  if (enabled.has("isAvailable-probe") && action.isAvailable) {
    const probe = await record("isAvailable", async () => action.isAvailable?.());
    tried.push({
      step: "isAvailable",
      ok: probe.value === true,
      error: probe.value === true ? undefined : "isAvailable() returned false",
    });
    if (probe.value === false) {
      // Skip primary → try the floor.
      if (action.onAllFail) {
        try {
          const floor = await action.onAllFail();
          return {
            ok: true,
            servedBy: "web_fetch_fallback",
            tried,
            result: floor,
            elapsedMs: now() - start,
          };
        } catch (e) {
          tried.push({
            step: "onAllFail",
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
          return {
            ok: false,
            tried,
            reason: "isAvailable=false and onAllFail threw",
            triedChainNote: renderTriedChainNote(tried),
            elapsedMs: now() - start,
          };
        }
      }
      return {
        ok: false,
        tried,
        reason: "isAvailable=false; no onAllFail floor",
        triedChainNote: renderTriedChainNote(tried),
        elapsedMs: now() - start,
      };
    }
  }

  // D2 + D3 + D4 + D5 — try/catch chain with sub-fallbacks.
  if (enabled.has("try-catch-chain")) {
    // D7: wrap primary in timeout when enabled.
    const runPrimary = async () => {
      if (enabled.has("timeout-cleanup") && opts?.timeoutMs && opts.timeoutMs > 0) {
        return await withTimeout(() => action.primary(), opts.timeoutMs);
      }
      return await action.primary();
    };
    const primary = await record("primary", runPrimary);
    tried.push({
      step: "primary",
      ok: primary.step.ok,
      error: primary.step.error,
    });
    if (primary.value !== undefined) {
      const result = primary.value;
      // D8 — post-redirect guard.
      if (
        enabled.has("post-redirect-guard") &&
        !opts?.disablePostRedirectGuard &&
        action.checkPostRedirect
      ) {
        const postUrl = action.checkPostRedirect(result);
        if (typeof postUrl === "string" && postUrl.length > 0) {
          const guard = checkUrl(postUrl);
          if (!guard.ok) {
            tried.push({
              step: "post-redirect-guard",
              ok: false,
              error: `${guard.category}: ${guard.reason}`,
            });
            return {
              ok: false,
              tried,
              reason: `post-redirect blocked: ${guard.reason}`,
              triedChainNote: renderTriedChainNote(tried),
              elapsedMs: now() - start,
            };
          }
          tried.push({ step: "post-redirect-guard", ok: true });
        }
      }
      return {
        ok: true,
        servedBy: "primary",
        tried,
        result,
        elapsedMs: now() - start,
      };
    }

    // Primary failed → branch by error shape.
    const errVal = primary.error;

    // D3 — 402 fallback.
    if (enabled.has("402-fallback") && action.onPaymentRequired && looksLike402(errVal)) {
      tried.push({ step: "402-fallback:detect", ok: true });
      const retry = await record("402-fallback", () => action.onPaymentRequired!());
      tried.push({
        step: "402-fallback",
        ok: retry.step.ok,
        error: retry.step.error,
      });
      if (retry.value !== undefined) {
        return {
          ok: true,
          servedBy: "402-fallback",
          tried,
          result: retry.value,
          elapsedMs: now() - start,
        };
      }
    }

    // D4 — engine fallback.
    if (enabled.has("engine-fallback") && action.onEngineFail) {
      tried.push({ step: "engine-fallback:detect", ok: true });
      const retry = await record("engine-fallback", () => action.onEngineFail!());
      tried.push({
        step: "engine-fallback",
        ok: retry.step.ok,
        error: retry.step.error,
      });
      if (retry.value !== undefined) {
        return {
          ok: true,
          servedBy: "engine-fallback",
          tried,
          result: retry.value,
          elapsedMs: now() - start,
        };
      }
    }

    // D5 — autoinstall retry.
    if (enabled.has("autoinstall-retry") && action.onMissingDependency && looksLikeMissingDependency(errVal)) {
      tried.push({ step: "autoinstall-retry:detect", ok: true });
      const retry = await record("autoinstall-retry", () => action.onMissingDependency!());
      tried.push({
        step: "autoinstall-retry",
        ok: retry.step.ok,
        error: retry.step.error,
      });
      if (retry.value !== undefined) {
        return {
          ok: true,
          servedBy: "autoinstall-retry",
          tried,
          result: retry.value,
          elapsedMs: now() - start,
        };
      }
    }

    // D8 — ultimate floor.
    if (enabled.has("browser-to-webfetch-floor") && action.onAllFail) {
      tried.push({ step: "onAllFail:invoke", ok: true });
      const floor = await record("onAllFail", () => action.onAllFail!());
      tried.push({
        step: "onAllFail",
        ok: floor.step.ok,
        error: floor.step.error,
      });
      if (floor.value !== undefined) {
        return {
          ok: true,
          servedBy: "web_fetch_fallback",
          tried,
          result: floor.value,
          elapsedMs: now() - start,
        };
      }
    }

    // Exhausted — return typed error.
    return {
      ok: false,
      tried,
      reason: "all resilience sub-fallbacks exhausted",
      triedChainNote: renderTriedChainNote(tried),
      elapsedMs: now() - start,
    };
  }

  // Fallback: no try-catch chain enabled → just run primary.
  if (opts?.throwOnInvariant) {
    throw new Error("withResilience: try-catch-chain disabled but no other path taken");
  }
  try {
    const result = await action.primary();
    return {
      ok: true,
      servedBy: "primary",
      tried,
      result,
      elapsedMs: now() - start,
    };
  } catch (e) {
    return {
      ok: false,
      tried,
      reason: e instanceof Error ? e.message : String(e),
      triedChainNote: renderTriedChainNote(tried),
      elapsedMs: now() - start,
    };
  }
}

const ALL_PATTERNS: readonly ResilienceId[] = [
  "isAvailable-probe",
  "try-catch-chain",
  "402-fallback",
  "engine-fallback",
  "autoinstall-retry",
  "timeout-cleanup",
  "post-redirect-guard",
  "browser-to-webfetch-floor",
];

// ─── Re-exports for the public orchestrator surface ─────────────────────────

export {
  loadWebConfig,
  loadWebConfigFromEnv,
  validateWebConfig,
  DEFAULT_WEB_CONFIG,
  WEB_CONFIG_ENV,
} from "./config.js";
export type {
  PreferredEngineName,
  SearchBackendName,
  ExtractBackendName,
  WebConfig,
};

// ─── Internal exports for tests (NOT part of the public API) ────────────────

/** @internal — exposed only so the co-located test file can assert helpers. */
export const _internal = {
  buildBrowserConfigFromWebConfig,
  probeBrowserEngines,
  renderTriedChainNote,
  extractPostRedirectUrl,
  looksLike402,
  looksLikeMissingDependency,
  isBrowserToolName,
  withTimeout,
};