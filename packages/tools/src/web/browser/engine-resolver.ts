/**
 * engine-resolver.ts — Browser engine chain resolution (Chain A, Phase 4 complete).
 *
 * Implements the full fallback chain from docs/PLAN-BROWSER.md §3A:
 *
 * ```
 * 1. Camofox   if CAMOFOX_URL set && GET /health ok          [anti-detect]
 * 2. Cloud     if browserbase/browser_use key set            [--cdp; stealth]
 * 3. Local     agent-browser --session (headless Chromium)   [DEFAULT]
 *   engine-within: chrome → lightpanda retry on chrome fail   (withEngineFallback)
 *   hybrid-routing: private URL + cloud configured → force local sidecar
 *                   (cloud never sees private)
 * ```
 *
 * Phase 4 scope: **all three engines are wired**. Camofox is a **two-phase
 * probe** — the sync path checks `CAMOFOX_URL` env + cached health result,
 * while a separate async `isCamofoxAvailable()` populates the cache. Cloud is
 * a sync env-var check (cheap, no network) via the `BrowserbaseProvider` and
 * `BrowserUseProvider` classes. Local is always available.
 *
 * The hybrid routing hook (`shouldForceLocalForUrl`) ensures cloud providers
 * never see private/internal URLs — those are always routed to a local
 * sidecar.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM; cheap probes only.
 */
import { checkUrl } from "../security-guard.js";
import { isBinaryLocal } from "./session.js";
import { isAnyCloudProviderAvailable, getCloudProviders } from "./cloud-provider.js";
import {
  isCamofoxConfigured,
  getCachedCamofoxHealth,
  maybeProbeCamofoxHealth,
} from "./camofox-client.js";
import type { AgentBrowserResult, BrowserEngineName } from "./agent-browser-runner.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BrowserEngine = "camofox" | "cloud" | "local";

export interface EngineResolutionConfig {
  /** Preferred engine. Default: `"auto"` (tries the chain: camofox → cloud → local). */
  preferredEngine?: BrowserEngine | "auto";
  /** Camofox base URL (`CAMOFOX_URL`). */
  camofoxUrl?: string;
  /** Camofox API key (`CAMOFOX_API_KEY`). Optional. */
  camofoxApiKey?: string;
  /** Cloud CDP URL (browserbase/browser_use session endpoint). */
  cloudCdpUrl?: string;
  /** Browserbase API key (`BROWSERBASE_API_KEY`). Optional — falls back to env. */
  browserbaseApiKey?: string;
  /** Browserbase project ID (`BROWSERBASE_PROJECT_ID`). Optional — falls back to env. */
  browserbaseProjectId?: string;
  /** Browser Use API key (`BROWSER_USE_API_KEY`). Optional — falls back to env. */
  browserUseApiKey?: string;
  /** Whether private URLs are allowed (affects hybrid routing + security guard). */
  allowPrivateUrls?: boolean;
  /** Cloud session cache TTL in milliseconds. Default 5 minutes (300_000).
   *  When a cached cloud session entry is older than this, it is treated as
   *  missing and a fresh `createSession` call is issued. Overridable via
   *  `MYA_CLOUD_SESSION_TTL_MS`. */
  cloudSessionTtlMs?: number;
}

/** A resolved engine ready to use. */
export interface EngineResolution {
  engine: BrowserEngine;
  /** Session name for local mode (`--session`). */
  sessionName?: string;
  /** CDP URL for cloud/camofox mode (`--cdp`). */
  cdpUrl?: string;
  /** Active features (stealth, anti-detect, proxies, etc). */
  features?: string[];
}

/** An engine that was tried but is not available. */
export interface EngineUnavailable {
  unavailable: true;
  engine: BrowserEngine;
  reason: string;
}

export type ResolveResult = EngineResolution | EngineUnavailable;

// ─── Availability probes (cheap, NO network on the hot path) ────────────────

/**
 * Camofox availability probe — **sync, two-phase**.
 *
 * Phase 1 (cheap): check `config.camofoxUrl` / `CAMOFOX_URL` env. If unset →
 * return `false` immediately (no network ever attempted).
 *
 * Phase 2 (cached): if a previous async health probe has populated the cache
 * (`isCamofoxAvailable()` from `camofox-client.ts`), honor its result.
 *
 * Phase 3 (fallback): if no cached result is available yet, optimistically
 * return `true` — the env var is a strong signal and the chain can safely
 * pick Camofox; if the actual REST call fails the orchestrator falls through
 * to cloud → local. Call {@link primeCamofoxHealth} on startup to populate
 * the cache before the first `resolveBrowserEngine()` call.
 *
 * Never throws — `config` is optional.
 */
export function isCamofoxAvailable(config?: EngineResolutionConfig): boolean {
  // Phase 1 — env var presence (cheap, no network). Pass `undefined` (not
  // empty string) so `isCamofoxConfigured` falls back to CAMOFOX_URL env var
  // when no config-level URL is provided.
  const probeConfig = config?.camofoxUrl !== undefined
    ? { baseUrl: config.camofoxUrl }
    : undefined;
  if (!isCamofoxConfigured(probeConfig)) return false;

  // Phase 2 — cached health result (honors async probe + TTL from camofox-client).
  const cached = getCachedCamofoxHealth();
  if (cached !== undefined) return cached;

  // Phase 3 — cache empty OR stale → optimistic THIS call, but kick off an async
  // probe (fire-and-forget, re-entrancy-guarded) to (re)populate the cache so
  // subsequent calls honor fresh health. This makes the TTL effective in
  // production (G3): a downed Camofox server is re-detected within the TTL window.
  maybeProbeCamofoxHealth(probeConfig);
  return true;
}

/**
 * Cloud availability probe — **sync env-var check, no network**.
 *
 * Returns `true` if either `BrowserbaseProvider` or `BrowserUseProvider` has
 * the credentials it needs. Both providers read from `process.env` by default;
 * passing keys via `config` overrides the env. The resolver uses this for
 * the cloud branch in the chain.
 */
export function isCloudAvailable(config?: EngineResolutionConfig): boolean {
  // Sync env-var check via the providers' isAvailable() methods. Pass any
  // config-level key overrides via a synthesized env.
  // For simplicity, we delegate to isAnyCloudProviderAvailable() which reads
  // process.env directly. Config-level overrides are forwarded by temporarily
  // setting env vars — see syncCloudEnv() helper below.
  return syncCloudEnv(config, () => isAnyCloudProviderAvailable());
}

/**
 * Browser Use availability probe (sync env-var check, no network).
 *
 * Convenience wrapper — equivalent to `new BrowserUseProvider().isAvailable()`
 * with config-aware overrides.
 */
export function isBrowserUseAvailable(config?: EngineResolutionConfig): boolean {
  return syncCloudEnv(config, () =>
    getCloudProviders().some((p) => p.name === "browser-use" && p.isAvailable()),
  );
}

/**
 * Build an {@link EngineResolutionConfig} from `process.env` plus optional
 * tool-arg overrides.
 *
 * Reads (sync env-var lookup, no network):
 *   - `CAMOFOX_URL`                → `camofoxUrl`
 *   - `CAMOFOX_API_KEY`            → `camofoxApiKey`
 *   - `BROWSERBASE_API_KEY`        → `browserbaseApiKey`
 *   - `BROWSERBASE_PROJECT_ID`     → `browserbaseProjectId`
 *   - `BROWSER_USE_API_KEY`        → `browserUseApiKey`
 *   - `MYA_BROWSER_ENGINE`         → `preferredEngine` (if no override in args)
 *
 * Optional `args.meta.preferredEngine` overrides the env-derived preference.
 * Empty/undefined env values are omitted (the resolver treats undefined as
 * "no signal"). Designed to be called on every `browser_*` tool run so the
 * resolver sees fresh config.
 *
 * Used by `index.ts` to wire config-from-env into all 8 browser_* tools
 * (Phase 4 wiring fix — BUG #1).
 */
export function buildEngineConfigFromEnv(
  args?: Record<string, unknown>,
): EngineResolutionConfig {
  const cfg: EngineResolutionConfig = {};

  const camofoxUrl = process.env.CAMOFOX_URL?.trim();
  if (camofoxUrl) cfg.camofoxUrl = camofoxUrl;

  const camofoxApiKey = process.env.CAMOFOX_API_KEY?.trim();
  if (camofoxApiKey) cfg.camofoxApiKey = camofoxApiKey;

  const bbKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (bbKey) cfg.browserbaseApiKey = bbKey;

  const bbProj = process.env.BROWSERBASE_PROJECT_ID?.trim();
  if (bbProj) cfg.browserbaseProjectId = bbProj;

  const buKey = process.env.BROWSER_USE_API_KEY?.trim();
  if (buKey) cfg.browserUseApiKey = buKey;

  // preferredEngine: args.meta > MYA_BROWSER_ENGINE env > "auto".
  const argsMeta = isRecord(args?.meta) ? args.meta : undefined;
  const metaPref = typeof argsMeta?.preferredEngine === "string"
    ? argsMeta.preferredEngine
    : undefined;
  const envPref = process.env.MYA_BROWSER_ENGINE?.trim();
  let preferred: EngineResolutionConfig["preferredEngine"];
  if (metaPref === "camofox" || metaPref === "cloud" || metaPref === "local" || metaPref === "auto") {
    preferred = metaPref;
  } else if (
    envPref === "camofox" || envPref === "cloud" || envPref === "local" || envPref === "auto"
  ) {
    preferred = envPref;
  } else {
    preferred = "auto";
  }
  cfg.preferredEngine = preferred;

  // cloudSessionTtlMs: args.meta > MYA_CLOUD_SESSION_TTL_MS env > 5 min default.
  const metaTtl = isRecord(argsMeta) && typeof argsMeta.cloudSessionTtlMs === "number"
    ? argsMeta.cloudSessionTtlMs
    : undefined;
  const envTtl = process.env.MYA_CLOUD_SESSION_TTL_MS?.trim();
  if (typeof metaTtl === "number" && Number.isFinite(metaTtl) && metaTtl >= 0) {
    cfg.cloudSessionTtlMs = metaTtl;
  } else if (envTtl) {
    const parsed = Number(envTtl);
    if (Number.isFinite(parsed) && parsed >= 0) cfg.cloudSessionTtlMs = parsed;
  }

  return cfg;
}

/** Narrow `unknown` to `Record<string, unknown>` (local helper to avoid importing isRecord). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Browserbase availability probe (sync env-var check, no network).
 */
export function isBrowserbaseAvailable(config?: EngineResolutionConfig): boolean {
  return syncCloudEnv(config, () =>
    getCloudProviders().some((p) => p.name === "browserbase" && p.isAvailable()),
  );
}

/**
 * Temporarily apply config-level cloud env overrides, run the probe, then
 * restore. Used so the resolver can honor caller-supplied keys without
 * forcing the caller to mutate `process.env`.
 *
 * **NOTE:** this is process-global mutation. The window is brief (one
 * synchronous call) and the providers themselves are synchronous, so the
 * race surface is negligible — but callers in concurrent contexts should
 * still prefer to set env vars at module init time.
 */
function syncCloudEnv<T>(config: EngineResolutionConfig | undefined, fn: () => T): T {
  const overrides: Array<[string, string | undefined]> = [];
  if (config?.browserbaseApiKey !== undefined) {
    overrides.push(["BROWSERBASE_API_KEY", config.browserbaseApiKey]);
  }
  if (config?.browserbaseProjectId !== undefined) {
    overrides.push(["BROWSERBASE_PROJECT_ID", config.browserbaseProjectId]);
  }
  if (config?.browserUseApiKey !== undefined) {
    overrides.push(["BROWSER_USE_API_KEY", config.browserUseApiKey]);
  }
  if (overrides.length === 0) return fn();

  const saved: Array<[string, string | undefined]> = [];
  for (const [k, v] of overrides) {
    saved.push([k, process.env[k]]);
    if (v === undefined || v === "") delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * Local availability probe: checks if the agent-browser binary exists
 * **locally** (NO network — does not attempt npx download).
 */
export function isLocalAvailable(): boolean {
  return isBinaryLocal();
}

// ─── Hybrid routing ────────────────────────────────────────────────────────

/**
 * Hybrid routing hook: if the URL is private/internal AND a cloud engine is
 * configured, force a local sidecar (the cloud provider never sees private
 * URLs).
 *
 * A URL is "private" if the security guard blocks it with `ssrf-private`
 * (RFC1918 / loopback / link-local). Metadata endpoints are unconditionally
 * blocked everywhere, so they do not trigger this hook — but the URL should
 * never reach the engine layer in that case anyway (security guard runs first
 * in `browser_navigate`).
 *
 * Returns `false` when no cloud engine is available, when `allowPrivateUrls`
 * is `true` (caller has explicitly opted into private URLs), or when the URL
 * is public.
 */
export function shouldForceLocalForUrl(
  url: string,
  config?: EngineResolutionConfig,
): boolean {
  // Caller explicitly opted into private URLs — no need to force local.
  if (config?.allowPrivateUrls) return false;

  // Only relevant if a cloud engine could be selected.
  if (!isCloudAvailable(config)) return false;

  // Check if the URL would be blocked by the private/internal SSRF layer.
  const decision = checkUrl(url, { allowPrivateUrls: config?.allowPrivateUrls });
  return !decision.ok && decision.category === "ssrf-private";
}

// ─── Chain resolution ───────────────────────────────────────────────────────

/**
 * Resolve the browser engine via Chain A:
 *
 * 1. **Camofox** (anti-detect) — sync env-var + cached health probe.
 * 2. **Cloud** (browserbase/browser_use) — sync env-var check.
 * 3. **Local** (agent-browser `--session`) — **DEFAULT**.
 *
 * With `"auto"` (the default), tries each in chain order and returns the first
 * available. With an explicit `preferredEngine`, tries only that engine and
 * returns `{ unavailable: true }` if it's not available.
 *
 * If `config.preferredEngine === "cloud"`, the returned `cdpUrl` comes from
 * `config.cloudCdpUrl` (the static configured URL) — the runtime
 * `BrowserProvider.createSession()` dynamic URL is fetched by the caller
 * (`index.ts`) and passed in via the next-resolution flow.
 *
 * Local is the always-available default — its binary existence is checked
 * separately by {@link isLocalAvailable} (the tool action decides whether to
 * proceed or fall back).
 */
export function resolveBrowserEngine(
  config?: EngineResolutionConfig,
): ResolveResult {
  const preferred = config?.preferredEngine ?? "auto";

  // Explicit preference: try only the requested engine.
  if (preferred !== "auto") {
    return resolveSingleEngine(preferred, config);
  }

  // Chain: camofox → cloud → local.

  // 1. Camofox (anti-detect).
  if (isCamofoxAvailable(config)) {
    return {
      engine: "camofox",
      cdpUrl: config?.camofoxUrl,
      features: ["anti-detect"],
    };
  }

  // 2. Cloud (browserbase/browser_use).
  if (isCloudAvailable(config)) {
    return {
      engine: "cloud",
      cdpUrl: config?.cloudCdpUrl,
      features: ["stealth"],
    };
  }

  // 3. Local (DEFAULT).
  return {
    engine: "local",
    sessionName: "mya-default",
  };
}

/** Resolve a single explicitly-requested engine. */
function resolveSingleEngine(
  engine: BrowserEngine,
  config?: EngineResolutionConfig,
): ResolveResult {
  switch (engine) {
    case "camofox":
      if (isCamofoxAvailable(config)) {
        return {
          engine: "camofox",
          cdpUrl: config?.camofoxUrl,
          features: ["anti-detect"],
        };
      }
      return {
        unavailable: true,
        engine: "camofox",
        reason: !isCamofoxConfigured(config?.camofoxUrl !== undefined ? { baseUrl: config.camofoxUrl } : undefined)
          ? "Camofox not configured (set CAMOFOX_URL)"
          : "Camofox health probe reported unavailable",
      };

    case "cloud":
      if (isCloudAvailable(config)) {
        return {
          engine: "cloud",
          cdpUrl: config?.cloudCdpUrl,
          features: ["stealth"],
        };
      }
      return {
        unavailable: true,
        engine: "cloud",
        reason:
          "Cloud provider not available (set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID or BROWSER_USE_API_KEY)",
      };

    case "local":
      return { engine: "local", sessionName: "mya-default" };
  }
}

// ─── Engine fallback (chrome → lightpanda) ──────────────────────────────────

/**
 * Pattern-detecting retry — given a runner that accepts an engine name, run
 * it once with `chrome`; if the result signals a chrome-specific failure
 * (binary missing, Chromium crash, sandbox error, …), retry with `lightpanda`.
 *
 * Used by `browser_navigate` (and friends) for local-mode engine fallback
 * (Phase 4 §3A "engine-within: chrome → lightpanda retry on chrome fail").
 *
 * The retry predicate is intentionally pluggable so the call site can decide
 * what counts as a retryable chrome failure (e.g. headless Chromium OOM vs.
 * a logic error in the runner that won't be fixed by switching engines).
 *
 * Never throws — `runner` errors are converted via `predicate` to a retry
 * decision; uncaught errors propagate only when the predicate returns `false`
 * (i.e. the caller has decided this is not a retryable failure).
 *
 * @param runner Async function that takes an engine name and returns an
 *               {@link AgentBrowserResult}.
 * @param isRetryable Predicate that inspects the first attempt's result and
 *                    returns `true` if lightpanda should be tried.
 * @returns The final result (chome attempt, or lightpanda retry).
 */
export async function withEngineFallback(
  runner: (engine: BrowserEngineName) => Promise<AgentBrowserResult>,
  isRetryable: (result: AgentBrowserResult) => boolean,
): Promise<AgentBrowserResult> {
  const first = await runner("chrome");
  if (!isRetryable(first)) return first;
  return runner("lightpanda");
}

/**
 * Default chrome-failure predicate used with {@link withEngineFallback}.
 *
 * Returns `true` for the common chrome-specific failure shapes:
 *
 *   - Binary not found ("agent-browser binary not found…")
 *   - Spawn failure (`exitCode === null && !timedOut`)
 *   - Timeout (`timedOut === true`)
 *   - Subprocess error string mentioning Chromium / Chrome / sandbox
 *
 * Returns `false` for logical failures that switching engines won't help
 * (e.g. URL blocked by security guard, JSON parse error, command-not-found
 * from agent-browser itself).
 */
export function defaultChromeFailurePredicate(result: AgentBrowserResult): boolean {
  if (result.ok) return false;

  // Spawn failure — exitCode null + not timed out means the binary couldn't
  // even be exec'd (missing on PATH, permission denied, …).
  if (result.exitCode === null && !result.timedOut) return true;

  // Subprocess timeout.
  if (result.timedOut) return true;

  // Binary not present.
  const err = result.error ?? "";
  if (err.includes("agent-browser binary not found")) return true;

  // Chrome-specific crash messages.
  const lower = err.toLowerCase();
  if (
    lower.includes("chrome") ||
    lower.includes("chromium") ||
    lower.includes("sandbox") ||
    lower.includes("userns")
  ) {
    return true;
  }

  return false;
}