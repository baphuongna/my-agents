/**
 * index.ts — Granular browser tool actions (agent-browser engine).
 *
 * Replaces the old CDP-based `browser_action` with hermes-style granular tools
 * (docs/PLAN-BROWSER.md D4/D5). Each tool wraps the agent-browser single
 * dispatcher (LOCAL) or the Camofox REST client (CAMOFOX) and follows the
 * ToolImpl pattern from registry.ts.
 *
 * **Phase 4 wiring fix** (this file):
 *   - BUG #1: every tool reads `process.env` via `buildEngineConfigFromEnv(args)`
 *     and passes a real {@link EngineResolutionConfig} to `resolveBrowserEngine`.
 *     The bare `resolveBrowserEngine()` call has been removed from all 8 tools.
 *   - BUG #2: every tool checks `effective.engine === "camofox"` FIRST and
 *     dispatches via the Camofox REST client (navigate/snapshot/click/type/
 *     scroll/back/press/screenshot) — NEVER via runBrowserCommand (Camofox
 *     is REST, not CDP-over-WS).
 *   - BUG #3: in `browser_navigate`, when cloud is configured AND the URL is
 *     `ssrf-private`, the local sidecar is forced (cloud never sees private
 *     IPs); the security guard is then re-evaluated with `allowPrivateUrls: true`
 *     so the private URL is allowed through to the local browser. The
 *     metadata floor (`ssrf-metadata`) is UNCONDITIONAL — re-verified by tests.
 *
 * Security gauntlet order for `browser_navigate`:
 *   buildConfigFromEnv → checkUrl(url) [hybrid-aware] →
 *     resolve engine → camofox-rest OR runBrowserCommand("open") →
 *     auto-snapshot → checkRedirect(finalUrl) → return {snapshot, title, url}
 *
 * All tools:
 *   - `requiredMode: "Prompt"` (network = trust boundary).
 *   - Never throw — all errors become `err()` results.
 *   - Import checkUrl/checkRedirect from `../security-guard.js`.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM.
 */
import type { Mode, ToolResult } from "@my-agent/core";
import { ok, err, isRecord, type ToolImpl } from "../../registry.js";
import { checkUrl, checkUrlAsync, checkRedirectAsync, detectBot } from "../security-guard.js";
import {
  createBrowserSession,
  closeBrowserSession,
  type BrowserSession,
} from "./session.js";
import {
  runBrowserCommand,
  type RunBrowserOptions,
} from "./agent-browser-runner.js";
import {
  resolveBrowserEngine,
  isLocalAvailable,
  isCloudAvailable,
  shouldForceLocalForUrl,
  buildEngineConfigFromEnv,
  withEngineFallback,
  defaultChromeFailurePredicate,
  type EngineResolution,
  type EngineResolutionConfig,
} from "./engine-resolver.js";
import {
  createSession as createCamofoxSession,
  navigate as camofoxNavigate,
  snapshot as camofoxSnapshot,
  click as camofoxClick,
  type as camofoxType,
  scroll as camofoxScroll,
  back as camofoxBack,
  press as camofoxPress,
  screenshot as camofoxScreenshot,
  closeSession as closeCamofoxSession,
  type CamofoxConfig,
  type CamofoxSession,
} from "./camofox-client.js";
import { getAvailableCloudProvider, type CloudSessionMeta } from "./cloud-provider.js";
import { loadWebConfig } from "../config.js";
import { webFetch, DEFAULT_MAX_CHARS } from "../fetch.js";

/** The "feature never dies" floor: when all browser engines are unavailable
 *  (or the navigate throws at runtime), degrade to a plain HTTP fetch so the
 *  agent still gets page content (no JS, but content). Honors `web.fallback_to_fetch`
 *  (default true). Returns a ToolResult carrying `engine: "web_fetch_fallback"`. */
async function fallbackToFetchOrFail(url: string, reason: string): Promise<ToolResult> {
  const cfg = loadWebConfig();
  if (cfg.fallbackToFetch) {
    try {
      const f = await webFetch(url, { maxChars: DEFAULT_MAX_CHARS, allowPrivateUrls: cfg.allowPrivateUrls });
      if (f.ok) {
        return ok("browser_navigate", {
          engine: "web_fetch_fallback",
          degraded: true,
          url: f.finalUrl,
          title: f.title,
          snapshot: f.markdown,
          fallbackReason: reason,
        });
      }
      return err("browser_navigate", `${reason}; web_fetch fallback also failed: ${f.error ?? "unknown"}`);
    } catch (e) {
      return err("browser_navigate", `${reason}; web_fetch fallback threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return err("browser_navigate", reason);
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROMPT: Mode = "Prompt";
const RUN_TIMEOUT_MS = 60_000;

// ─── Session + engine caches (per taskId) ───────────────────────────────────

/** Module-level session cache keyed by taskId. Sessions persist across tool
 *  calls within the same task (navigate → snapshot → click share a browser). */
const sessionCache = new Map<string, BrowserSession>();

/** Module-level camofox REST session cache keyed by taskId. Lazily created on
 *  first camofox engine call (mirrors the local sessionCache pattern). */
const camofoxSessionCache = new Map<string, CamofoxSession>();

/** Module-level engine-resolution cache keyed by taskId. The first
 *  `browser_navigate` resolves the engine via the chain and stores the result
 *  here so subsequent tools (click / type / snapshot / …) use the SAME engine
 *  for the lifetime of the task. This prevents mid-task engine flips if env
 *  vars change between calls. */
const engineCache = new Map<string, EngineResolution>();

/** Persist the engine resolution for a task. Called by `browser_navigate`
 *  after the first successful resolution. */
function setEngineCache(taskId: string, resolution: EngineResolution): void {
  engineCache.set(taskId, resolution);
}

/** Build the {@link RunBrowserOptions} for a given engine resolution.
 *
 * - **local** → uses the cached per-task session (`--session` mode). The
 *   optional `engine` parameter selects chrome vs lightpanda.
 * - **cloud/camofox** → uses the resolved `cdpUrl` (`--cdp` mode, Gotcha #5:
 *   `--session` and `--cdp` are mutually exclusive — the runner would
 *   silently ignore `--cdp` if both were set).
 *
 * Cloud/camofox engines do NOT take a session (the daemon runs on the cloud
 * side; local socket dir / idle-kill env are irrelevant). Local does NOT
 * take a cdpUrl.
 */
function buildRunOptions(
  taskId: string,
  resolution: EngineResolution,
  engine?: "chrome" | "lightpanda",
): RunBrowserOptions {
  const opts: RunBrowserOptions = { timeoutMs: RUN_TIMEOUT_MS };
  if (engine) opts.engine = engine;

  if (resolution.engine === "local") {
    opts.session = getSession(taskId);
  } else if (resolution.cdpUrl) {
    // cloud or camofox — pass cdpUrl only (no session; Gotcha #5).
    opts.cdpUrl = resolution.cdpUrl;
  }
  return opts;
}

/** Module-level cloud-session cache keyed by taskId. Stores both the session
 *  metadata and the creation timestamp so the read path can enforce a TTL
 *  (Bug A fix — see ensureCloudCdpUrl). Stale entries (older than
 *  `cloudSessionTtlMs`, default 5 min) are evicted and re-created lazily. */
interface CloudSessionCacheEntry {
  meta: CloudSessionMeta;
  createdAt: number;
}
const cloudSessionCache = new Map<string, CloudSessionCacheEntry>();

/** Default cloud-session TTL: 5 minutes. A cloud browser session can become
 *  invalid (server restart, idle-kill, network partition); reusing a stale
 *  `cdpUrl` silently fails every subsequent navigation on the same taskId.
 *  Override via `EngineResolutionConfig.cloudSessionTtlMs` (or env
 *  `MYA_CLOUD_SESSION_TTL_MS`). */
const DEFAULT_CLOUD_SESSION_TTL_MS = 5 * 60 * 1000;

/** Dynamically create a cloud browser session if the resolution lacks a
 *  cdpUrl. Returns a copy of the resolution with the cdpUrl populated, or
 *  the original (unavailable) result if no provider can be reached. Stale
 *  cached entries (older than `cloudSessionTtlMs`) are evicted and the
 *  underlying provider's `createSession` is called again. */
async function ensureCloudCdpUrl(
  taskId: string,
  resolution: EngineResolution,
  envCfg?: EngineResolutionConfig,
): Promise<
  | { ok: true; resolution: EngineResolution; session: CloudSessionMeta | null }
  | { ok: false; error: string }
> {
  if (resolution.engine !== "cloud") {
    return { ok: true, resolution, session: null };
  }
  if (resolution.cdpUrl) {
    return { ok: true, resolution, session: null };
  }

  // Cache hit (with TTL check)?
  const cached = cloudSessionCache.get(taskId);
  if (cached) {
    const ttlMs = envCfg?.cloudSessionTtlMs ?? DEFAULT_CLOUD_SESSION_TTL_MS;
    const ageMs = Date.now() - cached.createdAt;
    if (ageMs < ttlMs) {
      return {
        ok: true,
        resolution: { ...resolution, cdpUrl: cached.meta.cdpUrl },
        session: cached.meta,
      };
    }
    // Stale — evict and fall through to createSession.
    cloudSessionCache.delete(taskId);
  }

  // Pick first available provider.
  const provider = getAvailableCloudProvider();
  if (!provider) {
    return { ok: false, error: "no cloud provider available" };
  }
  const result = await provider.createSession(taskId);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  cloudSessionCache.set(taskId, { meta: result.session, createdAt: Date.now() });
  return {
    ok: true,
    resolution: { ...resolution, cdpUrl: result.session.cdpUrl },
    session: result.session,
  };
}

/** Run a local-mode browser command with the chrome→lightpanda fallback.
 *
 * The first attempt uses `chrome`. If it fails with a chrome-specific error
 * (see {@link defaultChromeFailurePredicate}), retry once with `lightpanda`.
 * Returns the final result (chrome attempt or lightpanda retry).
 *
 * Cloud/camofox engines do NOT use this helper — they have their own
 * engines and don't fall back to lightpanda.
 */
async function runLocalWithFallback(
  taskId: string,
  resolution: EngineResolution,
  command: string,
  commandArgs: readonly string[],
): ReturnType<typeof runBrowserCommand> {
  return withEngineFallback(
    (engine) =>
      runBrowserCommand(command, commandArgs, buildRunOptions(taskId, resolution, engine)),
    defaultChromeFailurePredicate,
  );
}

/** Dispatch a browser command using the cached engine for the task.
 *
 * - local: chrome→lightpanda fallback via {@link runLocalWithFallback}
 * - cloud/camofox: pass cdpUrl directly via {@link buildRunOptions}
 *
 * Note: the `camofox` engine should NOT route through this helper (use the
 * dedicated camofox REST branch in each tool instead). This helper is only
 * invoked when the tool deliberately chose the runner path (cloud-cdp or
 * local-session).
 */
async function runForTask(
  taskId: string,
  resolution: EngineResolution,
  command: string,
  commandArgs: readonly string[],
): ReturnType<typeof runBrowserCommand> {
  if (resolution.engine === "local") {
    return runLocalWithFallback(taskId, resolution, command, commandArgs);
  }
  return runBrowserCommand(command, commandArgs, buildRunOptions(taskId, resolution));
}

function getSession(taskId: string): BrowserSession {
  let session = sessionCache.get(taskId);
  if (!session) {
    session = createBrowserSession({ taskId });
    sessionCache.set(taskId, session);
  }
  return session;
}

/** Get or lazily create the Camofox REST session for a task.
 *  Mirrors the local sessionCache pattern (BUG #2-a). */
async function getOrCreateCamofoxSession(
  taskId: string,
  config: CamofoxConfig,
): Promise<{ ok: true; session: CamofoxSession } | { ok: false; error: string }> {
  const existing = camofoxSessionCache.get(taskId);
  if (existing) return { ok: true, session: existing };
  const created = await createCamofoxSession(taskId, config);
  if (!created.ok || !created.data) {
    return { ok: false, error: created.error ?? "camofox createSession failed" };
  }
  camofoxSessionCache.set(taskId, created.data);
  return { ok: true, session: created.data };
}

/** Build the {@link CamofoxConfig} from the current engine resolution. */
function buildCamofoxConfig(resolution: EngineResolution, envCfg: EngineResolutionConfig): CamofoxConfig {
  return {
    baseUrl: resolution.cdpUrl ?? envCfg.camofoxUrl ?? process.env.CAMOFOX_URL ?? "http://localhost:9377",
    apiKey: envCfg.camofoxApiKey,
  };
}

/** Clear all session caches (for testing / shutdown). */
export function clearSessionCache(): void {
  for (const session of sessionCache.values()) {
    closeBrowserSession(session);
  }
  sessionCache.clear();
  engineCache.clear();
  cloudSessionCache.clear();
  // Note: camofox REST sessions are remote — close them asynchronously on
  // best-effort. We don't await; the in-memory cache is dropped regardless.
  for (const taskId of [...camofoxSessionCache.keys()]) {
    const cfg = buildCamofoxConfig(
      { engine: "camofox", cdpUrl: process.env.CAMOFOX_URL ?? "http://localhost:9377" },
      buildEngineConfigFromEnv(),
    );
    void closeCamofoxSession(taskId, cfg).catch(() => {});
  }
  camofoxSessionCache.clear();
}

// ─── Lifecycle handlers (Bug B fix) ──────────────────────────────────────────
// `clearSessionCache` exports the teardown but had no production caller.
// Wire it to process exit signals so a graceful shutdown closes remote
// Camofox sessions (otherwise they linger until the server-side idle-kill).
// Idempotency guard prevents listener multiplication on module re-import.

/** Process listeners registered by `registerLifecycleHandlers`. Held by
 *  reference so the same function instance can be removed by callers that
 *  intentionally tear them down (tests, hot-reload, etc). */
let lifecycleSigint: NodeJS.SignalsListener | null = null;
let lifecycleSigterm: NodeJS.SignalsListener | null = null;
let lifecycleBeforeExit: NodeJS.BeforeExitListener | null = null;

/** Idempotency flag — set on first call, never cleared. Re-imports of the
 *  module (HMR, dynamic `import()`, vitest hot-reload) hit this guard and
 *  skip re-registration. */
let lifecycleRegistered = false;

/** Wire `clearSessionCache` into process-level lifecycle signals. Safe to
 *  call multiple times — only the first invocation attaches listeners. */
export function registerLifecycleHandlers(): void {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;

  lifecycleSigint = () => {
    clearSessionCache();
  };
  lifecycleSigterm = () => {
    clearSessionCache();
  };
  lifecycleBeforeExit = () => {
    clearSessionCache();
  };

  process.on("SIGINT", lifecycleSigint);
  process.on("SIGTERM", lifecycleSigterm);
  process.on("beforeExit", lifecycleBeforeExit);
}

/** Remove the lifecycle listeners (test cleanup / hot-reload teardown).
 *  Idempotent — safe to call when listeners aren't registered. */
export function unregisterLifecycleHandlers(): void {
  if (lifecycleSigint) process.removeListener("SIGINT", lifecycleSigint);
  if (lifecycleSigterm) process.removeListener("SIGTERM", lifecycleSigterm);
  if (lifecycleBeforeExit) process.removeListener("beforeExit", lifecycleBeforeExit);
  lifecycleSigint = null;
  lifecycleSigterm = null;
  lifecycleBeforeExit = null;
  lifecycleRegistered = false;
}

// Register on first module load. Subsequent imports hit the guard.
registerLifecycleHandlers();

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Maximum length for a sanitized task id. */
const MAX_TASK_ID_LEN = 64;

/** Extract and sanitize taskId from tool args.
 *
 * Strips characters outside [A-Za-z0-9_.-] to prevent path traversal via
 * LLM-supplied taskId (which flows into mkdirSync/join for the socket dir).
 * Falls back to "default" if absent or empty after sanitization.
 */
function extractTaskId(args: Record<string, unknown>): string {
  if (typeof args.taskId !== "string") return "default";
  const cleaned = args.taskId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, MAX_TASK_ID_LEN);
  return cleaned.length > 0 ? cleaned : "default";
}

/** Get the effective engine for the task, computing hybrid-routing on
 *  navigate paths. `url` is used only for the cloud+private → local check. */
function resolveEffectiveEngine(
  taskId: string,
  url: string | undefined,
  args: Record<string, unknown>,
): { resolved: true; effective: EngineResolution; envCfg: EngineResolutionConfig } | { resolved: false; error: string } {
  const envCfg = buildEngineConfigFromEnv(args);

  // For navigate: run the full chain (with hybrid routing baked into the
  // resolution decision). For other tools: reuse the cached engine from
  // navigate — but if there's no cached engine, fall back to a fresh resolve
  // without hybrid routing (those tools don't navigate, so they don't need
  // the cloud+private → local branch).
  const cached = engineCache.get(taskId);
  if (cached) {
    return { resolved: true, effective: cached, envCfg };
  }

  const resolution = resolveBrowserEngine(envCfg);
  if ("unavailable" in resolution) {
    return {
      resolved: false,
      error: `no browser engine available: ${resolution.reason}`,
    };
  }

  // Hybrid routing: only meaningful when the URL is provided (navigate path).
  let effective = resolution;
  if (url !== undefined) {
    const cloudConfigured = isCloudAvailable(envCfg);
    const probeDecision = checkUrl(url);
    const urlIsPrivate =
      probeDecision.ok === false && probeDecision.category === "ssrf-private";
    if (cloudConfigured && urlIsPrivate) {
      effective = { engine: "local", sessionName: "mya-default" };
    }
  }

  return { resolved: true, effective, envCfg };
}

// ─── browser_navigate ───────────────────────────────────────────────────────

export const browserNavigateTool: ToolImpl = {
  meta: {
    name: "browser_navigate",
    args: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        taskId: { type: "string", description: "Browser session/task id (default: 'default')" },
      },
      required: ["url"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.url !== "string")
      return err("browser_navigate", "url required");

    const url = args.url;
    const taskId = extractTaskId(args);

    // 1. Build config from env (BUG #1 wiring).
    const envCfg = buildEngineConfigFromEnv(args);

    // 2. Hybrid routing decision — BEFORE the checkUrl guard.
    //    Cloud configured + private URL → force local sidecar (cloud never
    //    sees private IPs / RFC1918 hosts).
    const cloudConfigured = isCloudAvailable(envCfg);
    const urlDecision = checkUrl(url);
    const urlIsPrivate = !urlDecision.ok && urlDecision.category === "ssrf-private";
    const hybridForceLocal = cloudConfigured && urlIsPrivate;

    // 3. Pre-navigate security guard (layers 1-3-5).
    //    When hybrid forces local, allow private URLs through (the local
    //    browser is trusted to access RFC1918 / loopback). The cloud-metadata
    //    floor (ssrf-metadata) is UNCONDITIONAL — guarded by checkUrl itself
    //    which ignores the flag for metadata hosts.
    const guard = await checkUrlAsync(url, { allowPrivateUrls: hybridForceLocal });
    if (!guard.ok) {
      return err("browser_navigate", `URL blocked (${guard.category}): ${guard.reason}`);
    }

    // 4. Resolve engine via the chain (camofox → cloud → local).
    const resolution = resolveBrowserEngine(envCfg);
    if ("unavailable" in resolution) {
      return fallbackToFetchOrFail(url, `no browser engine available: ${resolution.reason}`);
    }

    // 5. Apply hybrid routing: cloud → local when hybridForceLocal.
    let effective = resolution;
    if (
      hybridForceLocal &&
      (resolution.engine === "cloud" || resolution.engine === "camofox")
    ) {
      effective = { engine: "local", sessionName: "mya-default" };
    }

    // 6. For local engine, check binary availability.
    if (effective.engine === "local" && !isLocalAvailable()) {
      return err(
        "browser_navigate",
        "agent-browser binary not found. Install: npm install agent-browser && npx agent-browser install --with-deps",
      );
    }

    // 7. Cache the effective engine for subsequent tools in the same task.
    setEngineCache(taskId, effective);

    // 8. Dispatch — CAMOFOX takes the REST branch (BUG #2); LOCAL/CLOUD use the runner.
    try {
      // ── BUG #2: Camofox REST branch — bypass runBrowserCommand entirely. ──
      if (effective.engine === "camofox") {
        const cfg = buildCamofoxConfig(effective, envCfg);
        const sessResult = await getOrCreateCamofoxSession(taskId, cfg);
        if (!sessResult.ok) {
          return err("browser_navigate", sessResult.error);
        }

        const nav = await camofoxNavigate(url, sessResult.session, cfg);
        if (!nav.ok) {
          return err("browser_navigate", nav.error ?? "camofox navigate failed");
        }

        // Post-redirect security guard (layer 4).
        const finalUrl = nav.data?.url ?? url;
        const title = nav.data?.title ?? "";
        const redirectGuard = await checkRedirectAsync(finalUrl, { allowPrivateUrls: hybridForceLocal });
        if (!redirectGuard.ok) {
          // Navigate to about:blank on camofox to scrub blocked-page state.
          const scrub = await camofoxNavigate("about:blank", sessResult.session, cfg).catch(
            () => null,
          );
          void scrub;
          return ok("browser_navigate", {
            snapshot: "",
            title: "",
            url: "",
            engine: "camofox",
            guardBlock: { reason: redirectGuard.reason, category: redirectGuard.category },
          });
        }

        const output: Record<string, unknown> = {
          snapshot: nav.data?.snapshot ?? "",
          title,
          url: finalUrl,
          engine: "camofox",
        };
        const bot = detectBot(title);
        if (bot.detected) output.botDetected = bot.patterns;
        return ok("browser_navigate", output);
      }

      // ── Cloud (CDP) / Local (session) — use runForTask via the runner. ──
      // 8a. Navigate to the URL.
      //     - local: chrome→lightpanda fallback via withEngineFallback.
      //     - cloud: ensure cdpUrl (dynamic createSession if missing), then
      //       pass cdpUrl to runBrowserCommand (--cdp mode).
      let cloudEffective = effective;
      if (effective.engine === "cloud") {
        const ensured = await ensureCloudCdpUrl(taskId, effective, envCfg);
        if (!ensured.ok) {
          return err("browser_navigate", ensured.error);
        }
        cloudEffective = ensured.resolution;
      }
      const openResult = await runForTask(taskId, cloudEffective, "open", [url]);
      if (!openResult.ok) {
        return err("browser_navigate", openResult.error ?? "navigation failed");
      }

      // 8b. Auto-snapshot (-c compact) so the model can act without a second call.
      const snapResult = await runForTask(taskId, cloudEffective, "snapshot", ["-c"]);
      const snapshot = snapResult.ok ? (snapResult.data?.snapshot ?? "") : "";

      // 8c. Post-redirect security guard (layer 4).
      const finalUrl = openResult.data?.url ?? url;
      const title = openResult.data?.title ?? "";
      const redirectGuard = await checkRedirectAsync(finalUrl, { allowPrivateUrls: hybridForceLocal });
      if (!redirectGuard.ok) {
        // For local: navigate to about:blank to prevent snapshot leaks of the
        // blocked page. Cloud servers manage their own tabs.
        if (effective.engine === "local") {
          await runLocalWithFallback(taskId, effective, "open", ["about:blank"]).catch(
            () => {},
          );
        }
        return ok("browser_navigate", {
          snapshot: "",
          title: "",
          url: "",
          engine: effective.engine,
          guardBlock: { reason: redirectGuard.reason, category: redirectGuard.category },
        });
      }

      // 8d. Bot-detection awareness (layer 6 — WARNING only, never blocks).
      const output: Record<string, unknown> = {
        snapshot,
        title,
        url: finalUrl,
        engine: cloudEffective.engine,
      };
      const bot = detectBot(title);
      if (bot.detected) {
        output.botDetected = bot.patterns;
      }
      return ok("browser_navigate", output);
    } catch (e) {
      return fallbackToFetchOrFail(url, e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── browser_snapshot ───────────────────────────────────────────────────────

export const browserSnapshotTool: ToolImpl = {
  meta: {
    name: "browser_snapshot",
    args: {
      type: "object",
      properties: {
        compact: {
          type: "boolean",
          description: "Use compact snapshot (-c). Default: true.",
        },
        taskId: { type: "string", description: "Browser session/task id" },
      },
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    const argsObj = isRecord(args) ? args : {};
    const taskId = extractTaskId(argsObj);
    const compact = argsObj.compact !== false; // default true

    try {
      const engineResult = resolveEffectiveEngine(taskId, undefined, argsObj);
      if (!engineResult.resolved) {
        return err("browser_snapshot", "no browser engine available");
      }
      const { effective, envCfg } = engineResult;

      // ── BUG #2: Camofox REST branch. ──
      if (effective.engine === "camofox") {
        const cfg = buildCamofoxConfig(effective, envCfg);
        const sessResult = await getOrCreateCamofoxSession(taskId, cfg);
        if (!sessResult.ok) return err("browser_snapshot", sessResult.error);
        const snap = await camofoxSnapshot(sessResult.session, cfg);
        if (!snap.ok) return err("browser_snapshot", snap.error ?? "camofox snapshot failed");
        return ok("browser_snapshot", {
          snapshot: snap.data?.snapshot ?? "",
          engine: "camofox",
        });
      }

      // ── Runner path (local/cloud). ──
      const result = await runForTask(taskId, effective, "snapshot", compact ? ["-c"] : []);
      if (!result.ok) {
        return err("browser_snapshot", result.error ?? "snapshot failed");
      }
      return ok("browser_snapshot", {
        snapshot: result.data?.snapshot ?? "",
      });
    } catch (e) {
      return err("browser_snapshot", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── browser_click ──────────────────────────────────────────────────────────

export const browserClickTool: ToolImpl = {
  meta: {
    name: "browser_click",
    args: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element ref from the snapshot (e.g. @e3)",
        },
        taskId: { type: "string", description: "Browser session/task id" },
      },
      required: ["ref"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.ref !== "string")
      return err("browser_click", "ref required");

    const taskId = extractTaskId(args);
    try {
      const engineResult = resolveEffectiveEngine(taskId, undefined, args);
      if (!engineResult.resolved) {
        return err("browser_click", "no browser engine available");
      }
      const { effective, envCfg } = engineResult;

      // ── BUG #2: Camofox REST branch. ──
      if (effective.engine === "camofox") {
        const cfg = buildCamofoxConfig(effective, envCfg);
        const sessResult = await getOrCreateCamofoxSession(taskId, cfg);
        if (!sessResult.ok) return err("browser_click", sessResult.error);
        const result = await camofoxClick(args.ref, sessResult.session, cfg);
        if (!result.ok) return err("browser_click", result.error ?? "camofox click failed");
        return ok("browser_click", { ref: args.ref, engine: "camofox" });
      }

      // ── Runner path. ──
      const result = await runForTask(taskId, effective, "click", [args.ref]);
      if (!result.ok) {
        return err("browser_click", result.error ?? "click failed");
      }
      return ok("browser_click", { ref: args.ref });
    } catch (e) {
      return err("browser_click", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── browser_type ───────────────────────────────────────────────────────────

export const browserTypeTool: ToolImpl = {
  meta: {
    name: "browser_type",
    args: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element ref from the snapshot (e.g. @e5)",
        },
        text: { type: "string", description: "Text to type into the element" },
        taskId: { type: "string", description: "Browser session/task id" },
      },
      required: ["ref", "text"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.ref !== "string" || typeof args.text !== "string")
      return err("browser_type", "ref + text required");

    const taskId = extractTaskId(args);
    try {
      const engineResult = resolveEffectiveEngine(taskId, undefined, args);
      if (!engineResult.resolved) {
        return err("browser_type", "no browser engine available");
      }
      const { effective, envCfg } = engineResult;

      // ── BUG #2: Camofox REST branch. ──
      if (effective.engine === "camofox") {
        const cfg = buildCamofoxConfig(effective, envCfg);
        const sessResult = await getOrCreateCamofoxSession(taskId, cfg);
        if (!sessResult.ok) return err("browser_type", sessResult.error);
        const result = await camofoxType(args.ref, args.text, sessResult.session, cfg);
        if (!result.ok) return err("browser_type", result.error ?? "camofox type failed");
        return ok("browser_type", { ref: args.ref, text: args.text, engine: "camofox" });
      }

      // ── Runner path. ──
      const result = await runForTask(taskId, effective, "type", [args.ref, args.text]);
      if (!result.ok) {
        return err("browser_type", result.error ?? "type failed");
      }
      return ok("browser_type", { ref: args.ref, text: args.text });
    } catch (e) {
      return err("browser_type", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── browser_scroll ─────────────────────────────────────────────────────────

export const browserScrollTool: ToolImpl = {
  meta: {
    name: "browser_scroll",
    args: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down"],
          description: "Scroll direction: 'up' or 'down'",
        },
        taskId: { type: "string", description: "Browser session/task id" },
      },
      required: ["direction"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (
      !isRecord(args) ||
      typeof args.direction !== "string" ||
      (args.direction !== "up" && args.direction !== "down")
    ) {
      return err("browser_scroll", "direction must be 'up' or 'down'");
    }

    const taskId = extractTaskId(args);
    try {
      const engineResult = resolveEffectiveEngine(taskId, undefined, args);
      if (!engineResult.resolved) {
        return err("browser_scroll", "no browser engine available");
      }
      const { effective, envCfg } = engineResult;

      // ── BUG #2: Camofox REST branch. ──
      if (effective.engine === "camofox") {
        const cfg = buildCamofoxConfig(effective, envCfg);
        const sessResult = await getOrCreateCamofoxSession(taskId, cfg);
        if (!sessResult.ok) return err("browser_scroll", sessResult.error);
        const result = await camofoxScroll(args.direction, sessResult.session, cfg);
        if (!result.ok) return err("browser_scroll", result.error ?? "camofox scroll failed");
        return ok("browser_scroll", { direction: args.direction, engine: "camofox" });
      }

      // ── Runner path. ──
      const result = await runForTask(taskId, effective, "scroll", [args.direction]);
      if (!result.ok) {
        return err("browser_scroll", result.error ?? "scroll failed");
      }
      return ok("browser_scroll", { direction: args.direction });
    } catch (e) {
      return err("browser_scroll", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── browser_back ───────────────────────────────────────────────────────────

export const browserBackTool: ToolImpl = {
  meta: {
    name: "browser_back",
    args: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Browser session/task id" },
      },
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    const argsObj = isRecord(args) ? args : {};
    const taskId = extractTaskId(argsObj);
    try {
      const engineResult = resolveEffectiveEngine(taskId, undefined, argsObj);
      if (!engineResult.resolved) {
        return err("browser_back", "no browser engine available");
      }
      const { effective, envCfg } = engineResult;

      // ── BUG #2: Camofox REST branch. ──
      if (effective.engine === "camofox") {
        const cfg = buildCamofoxConfig(effective, envCfg);
        const sessResult = await getOrCreateCamofoxSession(taskId, cfg);
        if (!sessResult.ok) return err("browser_back", sessResult.error);
        const result = await camofoxBack(sessResult.session, cfg);
        if (!result.ok) return err("browser_back", result.error ?? "camofox back failed");
        return ok("browser_back", { ok: true, engine: "camofox" });
      }

      // ── Runner path. ──
      const result = await runForTask(taskId, effective, "back", []);
      if (!result.ok) {
        return err("browser_back", result.error ?? "back failed");
      }
      return ok("browser_back", { ok: true });
    } catch (e) {
      return err("browser_back", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── browser_press ──────────────────────────────────────────────────────────

export const browserPressTool: ToolImpl = {
  meta: {
    name: "browser_press",
    args: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key to press (e.g. 'Enter', 'Escape', 'Tab', 'ArrowDown')",
        },
        taskId: { type: "string", description: "Browser session/task id" },
      },
      required: ["key"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.key !== "string")
      return err("browser_press", "key required");

    const taskId = extractTaskId(args);
    try {
      const engineResult = resolveEffectiveEngine(taskId, undefined, args);
      if (!engineResult.resolved) {
        return err("browser_press", "no browser engine available");
      }
      const { effective, envCfg } = engineResult;

      // ── BUG #2: Camofox REST branch. ──
      if (effective.engine === "camofox") {
        const cfg = buildCamofoxConfig(effective, envCfg);
        const sessResult = await getOrCreateCamofoxSession(taskId, cfg);
        if (!sessResult.ok) return err("browser_press", sessResult.error);
        const result = await camofoxPress(args.key, sessResult.session, cfg);
        if (!result.ok) return err("browser_press", result.error ?? "camofox press failed");
        return ok("browser_press", { key: args.key, engine: "camofox" });
      }

      // ── Runner path. ──
      const result = await runForTask(taskId, effective, "press", [args.key]);
      if (!result.ok) {
        return err("browser_press", result.error ?? "press failed");
      }
      return ok("browser_press", { key: args.key });
    } catch (e) {
      return err("browser_press", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── browser_screenshot ─────────────────────────────────────────────────────

export const browserScreenshotTool: ToolImpl = {
  meta: {
    name: "browser_screenshot",
    args: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Browser session/task id" },
      },
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    const argsObj = isRecord(args) ? args : {};
    const taskId = extractTaskId(argsObj);
    try {
      const engineResult = resolveEffectiveEngine(taskId, undefined, argsObj);
      if (!engineResult.resolved) {
        return err("browser_screenshot", "no browser engine available");
      }
      const { effective, envCfg } = engineResult;

      // ── BUG #2: Camofox REST branch. ──
      if (effective.engine === "camofox") {
        const cfg = buildCamofoxConfig(effective, envCfg);
        const sessResult = await getOrCreateCamofoxSession(taskId, cfg);
        if (!sessResult.ok) return err("browser_screenshot", sessResult.error);
        const result = await camofoxScreenshot(sessResult.session, cfg);
        if (!result.ok) return err("browser_screenshot", result.error ?? "camofox screenshot failed");
        return ok("browser_screenshot", {
          imageBase64: result.data?.base64 ?? "",
          engine: "camofox",
        });
      }

      // ── Runner path. ──
      const result = await runForTask(taskId, effective, "screenshot", []);
      if (!result.ok) {
        return err("browser_screenshot", result.error ?? "screenshot failed");
      }
      return ok("browser_screenshot", {
        imageBase64: result.data?.screenshot ?? "",
      });
    } catch (e) {
      return err("browser_screenshot", e instanceof Error ? e.message : String(e));
    }
  },
};

// ─── browser_close (Bug B fix) ─────────────────────────────────────────────────

/** Explicit close tool — invokes {@link clearSessionCache} on demand. The model
 *  can call this between tasks (e.g. before a long idle) to release remote
 *  Camofox sessions without waiting for process exit. Returns `{ok:true,
 *  closed:true}` so the model can confirm the cleanup actually ran. */
export const browserCloseTool: ToolImpl = {
  meta: {
    name: "browser_close",
    args: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Browser session/task id (default: 'default')" },
      },
    },
    requiredMode: PROMPT,
  },
  async run(_args, _ctx): Promise<ToolResult> {
    try {
      clearSessionCache();
      return ok("browser_close", { ok: true, closed: true });
    } catch (e) {
      // clearSessionCache is documented as never-throws, but if a future
      // teardown path does throw, surface a typed error instead of bubbling.
      return err(
        "browser_close",
        e instanceof Error ? e.message : String(e),
      );
    }
  },
};

// ─── Exports ────────────────────────────────────────────────────────────────

// ── browser_search (browser-driven; Camofox anti-detect bypasses bot-detection) ──
// ddgs scrape rate-limits + plain headless Chromium is bot-blocked by major engines;
// a real browser via Camofox bypasses both. Wraps: navigate engine → find input →
// type → submit → retry-snapshot (Camofox flakiness) → parse SERP. Reuses the engine
// resolver (camofox→cloud→local) + security guard via the sibling tools.

/** Tolerant ref extraction — Camofox `[eN]` AND agent-browser `[ref=N]` / `ref eN`. */
function extractRef(line: string): string | null {
  let m = line.match(/\[(?:ref=)?(e\d+)\]/);
  if (m && m[1]) return m[1];
  m = line.match(/\bref=?\s*(e?\d+)/i);
  if (m && m[1]) return m[1].startsWith("e") ? m[1] : `e${m[1]}`;
  m = line.match(/\b(e\d{1,4})\b/);
  if (m && m[1]) return m[1];
  return null;
}

const SERP_NAV_FILTER =
  /duckduckgo|duck\.ai|google|bing|settings|privacy|terms|about|images|news|videos|maps|shopping|sign|log in|log out|more results|next|previous|advert|sponsored|back to|feedback|skip to|cookie|consent|accept|search assist|search domain|continued in|people also|more at/i;

/** Find the search INPUT ref (combobox/searchbox/textbox/input/edit only — NOT links/buttons). */
function findSearchInput(snapshot: string): string | null {
  const lines = snapshot.split("\n");
  for (const line of lines) {
    if (/combobox|searchbox|textbox|\binput\b|\bedit\b/i.test(line) && /search|query|web|type/i.test(line)) {
      const r = extractRef(line);
      if (r) return r;
    }
  }
  for (const line of lines) {
    if (/combobox|searchbox|textbox/i.test(line)) {
      const r = extractRef(line);
      if (r) return r;
    }
  }
  return null;
}

/** Find a "Search" submit BUTTON ref (fallback when Enter doesn't submit, e.g. DDG combobox). */
function findSearchButton(snapshot: string): string | null {
  for (const line of snapshot.split("\n")) {
    if (/\bbutton\b/i.test(line) && /"search"/i.test(line)) {
      const r = extractRef(line);
      if (r) return r;
    }
  }
  return null;
}

/** Parse a SERP snapshot → result titles (+ URLs for Camofox `/url:` format). */
function parseSerp(snapshot: string): { title: string; url?: string }[] {
  const lines = snapshot.split("\n");
  const out: { title: string; url?: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const m = line.match(/link "([^"]{12,180})"/);
    if (!m || !m[1]) continue;
    const title = m[1];
    if (SERP_NAV_FILTER.test(title)) continue;
    let url: string | undefined;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const ul = lines[j];
      if (!ul) continue;
      const u = ul.match(/\/url:\s*(\S+)/);
      if (u && u[1]) { url = u[1]; break; }
    }
    out.push({ title, url });
  }
  const seen = new Set<string>();
  return out
    .filter((r) => {
      // drop DDG ad-redirect URLs (y.js?ad_domain=…)
      if (r.url && /ad_domain|\/y\.js|ad_provider|ad_type/i.test(r.url)) return false;
      return seen.has(r.title) ? false : (seen.add(r.title), true);
    });
}

/** Retry snapshot until non-empty — Camofox is racy on heavy SERP pages. */
async function retrySnapshotText(taskId: string, tries = 5, delayMs = 1800): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const s = await browserSnapshotTool.run({ taskId }, undefined as never);
    const snap = (((s.output as Record<string, unknown> | null) ?? {}).snapshot as string) ?? "";
    if (snap) return snap;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return "";
}

/** Browser-driven search: navigate engine → type → submit → read SERP. */
export async function browserSearch(
  query: string,
  opts?: { engineUrl?: string; taskId?: string; maxResults?: number },
): Promise<{ results: { title: string; url?: string }[]; engine: string; query: string; serpLen: number }> {
  const taskId = opts?.taskId ?? `search-${Date.now()}`;
  const engineUrl = opts?.engineUrl ?? "https://duckduckgo.com/";
  // URL-based search: navigate directly to engine?q=<query> (DDG/Bing/Google support ?q=).
  // Faster than type+submit AND works on Camofox, whose a11y tree assigns NO ref to
  // the search combobox (making ref-based type impossible). Bypasses the issue entirely.
  const sep = engineUrl.includes("?") ? "&" : "?";
  const searchUrl = `${engineUrl}${sep}q=${encodeURIComponent(query)}`;
  const nav = await browserNavigateTool.run({ url: searchUrl, taskId }, undefined as never);
  if (!nav.ok) throw new Error(`navigate failed: ${nav.error ?? "unknown"}`);
  const navOut = (nav.output as Record<string, unknown> | null) ?? {};
  const serp = (navOut.snapshot as string) ?? (await retrySnapshotText(taskId));
  const engine = (navOut.engine as string) ?? "unknown";
  const results = parseSerp(serp).slice(0, opts?.maxResults ?? 8);
  return { results, engine, query, serpLen: serp.length };
}

export const browserSearchTool: ToolImpl = {
  meta: {
    name: "browser_search",
    args: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        engineUrl: { type: "string", description: "Search engine URL (default https://duckduckgo.com/)" },
        taskId: { type: "string", description: "Browser session id (default: auto)" },
        maxResults: { type: "number", description: "Max results (default 8)" },
      },
      required: ["query"],
    },
    requiredMode: PROMPT,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.query !== "string") return err("browser_search", "query required");
    try {
      const r = await browserSearch(args.query, {
        engineUrl: typeof args.engineUrl === "string" ? args.engineUrl : undefined,
        taskId: typeof args.taskId === "string" ? args.taskId : undefined,
        maxResults: typeof args.maxResults === "number" ? args.maxResults : undefined,
      });
      return ok("browser_search", {
        results: r.results,
        engine: r.engine,
        query: r.query,
        serpLen: r.serpLen,
        via: "browser-driven (anti-detect bypasses bot-detection)",
      });
    } catch (e) {
      return err("browser_search", e instanceof Error ? e.message : String(e));
    }
  },
};

export const browserTools: ToolImpl[] = [
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserBackTool,
  browserPressTool,
  browserScreenshotTool,
  browserCloseTool,
  browserSearchTool,
];

// ── host registration adapter ────────────────────────────────────────────────
// mya-bridge's pi.registerTool expects {name,description,parameters,execute→{content}}
// while ToolImpl is {meta,run→ToolResult}. This adapter bridges the two so the
// bridge can register all browser tools in one call. (Phase 2 wiring fix.)
//
// Exported so the Phase 5 orchestrator-aware host adapter (../host.ts →
// registerWebTools) can reuse the same human-readable descriptions when
// wrapping each tool's `execute` with `runBrowserWithFallback`.
export const BROWSER_DESCRIPTIONS: Record<string, string> = {
  browser_navigate:
    "Navigate the browser to a URL via the agent-browser local engine or the Camofox " +
    "REST client (when CAMOFOX_URL is configured). Runs the Phase-1 security guard first " +
    "(blocks credentials-in-URL, cloud-metadata, and private/internal addresses unless " +
    "the hybrid routing decision forces local sidecar access). Returns the page title plus " +
    "an accessibility-tree snapshot with element refs (@e1…).",
  browser_snapshot:
    "Capture an accessibility-tree snapshot of the current page with element refs " +
    "(@e1, @e2…). Use after navigate to (re)read the page state.",
  browser_click: "Click an element by its ref (e.g. @e1).",
  browser_type: "Type text into an element identified by its ref (e.g. @e1).",
  browser_scroll: "Scroll the page. direction: up | down.",
  browser_back: "Browser back button.",
  browser_press: "Press a keyboard key (e.g. Enter, Tab, Escape).",
  browser_screenshot: "Take a screenshot of the current page.",
  browser_close:
    "Explicitly close all browser sessions and clear the session cache. Releases " +
    "remote Camofox sessions (DELETE /sessions/{userId}) and tears down local " +
    "agent-browser processes. Returns {ok:true, closed:true}. Useful between tasks " +
    "to release anti-detect session budgets before idle; process-exit signals " +
    "SIGINT/SIGTERM/beforeExit invoke the same cleanup automatically.",
  browser_search:
    "Search the web via a REAL browser (Camofox anti-detect when CAMOFOX_URL is set; " +
    "bypasses the bot-detection that blocks headless Chromium and the ddgs scrape floor). " +
    "Navigates a search engine, types the query, reads the results page, returns titles " +
    "(+ URLs). Engine resolves automatically (camofox → cloud → local). Use when " +
    "web_search (ddgs) is rate-limited/empty or results are bot-blocked.",
};

/** Register all browser ToolImpls onto a host pi API (mya-bridge). */
export function registerBrowserTools(pi: { registerTool(t: unknown): void }): void {
  for (const impl of browserTools) {
    const name = impl.meta.name;
    pi.registerTool({
      name,
      description: BROWSER_DESCRIPTIONS[name] ?? name,
      parameters: impl.meta.args,
      async execute(_id: string, params: unknown) {
        let result;
        try {
          result = await impl.run(params, undefined as never);
        } catch (e) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` },
            ],
          };
        }
        const text = result.ok
          ? typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.output, null, 2)
          : `Error: ${result.error ?? "browser tool failed"}`;
        return { content: [{ type: "text" as const, text }] };
      },
    });
  }
}
