/**
 * camofox-client.ts — REST client for the Camofox anti-detect browser server.
 *
 * Implements the TS port of `source/hermes-agent/tools/browser_camofox.py`
 * (Phase 4 of docs/PLAN-BROWSER.md §3A/§5Phase4).
 *
 * The Camofox server exposes a REST API for managing anti-detect browser tabs:
 * create tabs, navigate, snapshot, click, type, scroll, back, press, screenshot,
 * and close sessions. This client wraps each endpoint with typed result objects
 * — **never throws**.
 *
 * Auth: `Authorization: Bearer {apiKey}` header when `apiKey` is provided (or
 * `CAMOFOX_API_KEY` env var is set). No auth header when absent.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM; never throws.
 */

import { nowWallclock } from "@my-agent/core";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the Camofox REST client. */
export interface CamofoxConfig {
  /** Base URL of the Camofox server (e.g. `http://localhost:9377`). No trailing slash. */
  baseUrl: string;
  /** Optional API key. Falls back to `CAMOFOX_API_KEY` env var. */
  apiKey?: string;
  /** Request timeout in ms. Default: 30 000. */
  timeoutMs?: number;
}

/** Per-task browser session state. */
export interface CamofoxSession {
  /** Random user ID for this session (e.g. `hermes_a1b2c3d4e5`). */
  userId: string;
  /** Camofox tab ID (`null` until a tab is created). */
  tabId: string | null;
  /** Session key used as `listItemId` (task-derived, e.g. `task_abc123`). */
  sessionKey: string;
}

/** Generic typed result — never accompanied by a throw. */
export interface CamofoxResult<T = undefined> {
  ok: boolean;
  /** Error message when `ok === false`. */
  error?: string;
  /** Response data when `ok === true`. */
  data?: T;
}

/** Navigate result data. */
export interface NavigateData {
  url: string;
  title: string;
  /** Auto-snapshot taken after navigate (if successful). */
  snapshot?: string;
  refsCount?: number;
}

/** Snapshot result data. */
export interface SnapshotData {
  snapshot: string;
  refsCount: number;
}

/** Screenshot result data. */
export interface ScreenshotData {
  /** Base64-encoded PNG screenshot. */
  base64: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the API key from config or env var. */
function resolveApiKey(config?: CamofoxConfig): string | undefined {
  if (config?.apiKey) return config.apiKey;
  const envKey = process.env.CAMOFOX_API_KEY;
  if (envKey && envKey.trim()) return envKey.trim();
  return undefined;
}

/** Build auth headers (Authorization: Bearer {key} when key is set). */
function authHeaders(apiKey: string | undefined): Record<string, string> {
  if (apiKey) return { Authorization: `Bearer ${apiKey}` };
  return {};
}

/** Create an AbortController that fires after `ms`. */
function abortAfter(ms: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller;
}

/** Generate a random hex user ID (e.g. `hermes_a1b2c3d4e5`). */
function randomUserId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `hermes_${hex}`;
}

/** Derive a session key from a task ID (e.g. `task_abc123`). */
function deriveSessionKey(taskId: string): string {
  const sanitized = taskId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 16) || "default";
  return `task_${sanitized}`;
}

/** Strip a leading `@` from a ref (e.g. `@e1` → `e1`). */
function stripRefPrefix(ref: string): string {
  return ref.startsWith("@") ? ref.slice(1) : ref;
}

// ─── Availability probe (cached per-process) ───────────────────────────────

let cachedHealthResult: boolean | null = null;
/** When the cache was populated (ms epoch). The cache is considered STALE after
 *  {@link HEALTH_CACHE_TTL_MS} so a Camofox server going down mid-process is
 *  re-detected within the TTL window (G3) — previously the cache was set once
 *  and never invalidated in production. */
let cachedHealthAt = 0;
const HEALTH_CACHE_TTL_MS = 60_000;

/**
 * Check if the Camofox server is available: `GET {baseUrl}/health` with a 5s
 * timeout. Returns `true` if HTTP 200, `false` otherwise. The result is
 * cached per-process (first call probes, subsequent calls return cached).
 *
 * Never throws — network errors and timeouts return `false`.
 *
 * @param config Config with `baseUrl`. If `baseUrl` is missing, reads `CAMOFOX_URL` env var.
 * @param forceRecheck If `true`, re-probe even if a cached result exists.
 */
export async function isCamofoxAvailable(
  config?: CamofoxConfig,
  forceRecheck = false,
): Promise<boolean> {
  if (!forceRecheck && cachedHealthResult !== null && !isHealthCacheStale()) {
    return cachedHealthResult;
  }

  const baseUrl = config?.baseUrl ?? process.env.CAMOFOX_URL;
  if (!baseUrl) {
    setHealthCache(false);
    return false;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/health`;
  const apiKey = resolveApiKey(config);

  try {
    const controller = abortAfter(5_000);
    const resp = await fetch(url, {
      method: "GET",
      headers: authHeaders(apiKey),
      signal: controller.signal,
    });
    const result = resp.status === 200;
    setHealthCache(result);
    return result;
  } catch {
    setHealthCache(false);
    return false;
  }
}

/** Set the cached health result + its timestamp. */
function setHealthCache(result: boolean): void {
  cachedHealthResult = result;
  cachedHealthAt = nowWallclock();
}

/** True if the cache is populated AND older than the TTL (should re-probe). */
function isHealthCacheStale(): boolean {
  return cachedHealthAt === 0 || nowWallclock() - cachedHealthAt > HEALTH_CACHE_TTL_MS;
}

/** Reset the cached health result (for testing). */
export function resetCamofoxHealthCache(): void {
  cachedHealthResult = null;
  cachedHealthAt = 0;
}

/**
 * Sync env-var check — does **NOT** make a network call.
 *
 * Returns `true` if `CAMOFOX_URL` (or `config.baseUrl`) is set to a non-empty
 * string. Used by `engine-resolver.isCamofoxAvailable()` to short-circuit
 * before any HTTP probe. The async `isCamofoxAvailable()` probe populates a
 * separate cache so the sync resolver stays cheap (Phase 4 §3A pattern).
 */
export function isCamofoxConfigured(config?: CamofoxConfig): boolean {
  const baseUrl = config?.baseUrl ?? process.env.CAMOFOX_URL;
  return typeof baseUrl === "string" && baseUrl.trim().length > 0;
}

/**
 * Sync accessor for the cached health result.
 *
 * Returns `true`/`false` if the async health probe has completed, or
 * `undefined` if the probe has not run yet. Used by the sync
 * `engine-resolver.isCamofoxAvailable()` to honor a previously-completed
 * health probe without re-running it.
 */
export function getCachedCamofoxHealth(): boolean | undefined {
  // TTL-aware: a stale (or empty) cache yields `undefined` so the sync resolver
  // falls to its optimistic phase AND triggers a re-probe (G3). Previously the
  // cache was returned indefinitely, so a downed server was never re-detected.
  return cachedHealthResult === null || isHealthCacheStale()
    ? undefined
    : cachedHealthResult;
}

/**
 * Fire-and-forget async probe that populates the health cache.
 *
 * Useful on app startup so the sync resolver sees a populated cache by the
 * time `resolveBrowserEngine()` is first called. Never throws — all errors
 * are absorbed into the cached result (`false`).
 *
 * Pair with `resetCamofoxHealthCache()` in tests.
 */
export function primeCamofoxHealth(config?: CamofoxConfig): void {
  // Intentionally not awaited — callers can fire-and-forget on startup.
  void isCamofoxAvailable(config);
}

/** Whether an async health probe is currently in flight (re-entrancy guard for
 *  {@link maybeProbeCamofoxHealth}). */
let healthProbeInFlight = false;

/** Fire-and-forget a health probe to (re)populate the cache, UNLESS one is
 *  already in flight. Called by the sync engine-resolver when the cache is
 *  empty/stale, so the cache actually populates + refreshes in production
 *  (making the TTL effective — G3). Uses `forceRecheck` to bypass the cache
 *  read and re-probe. */
export function maybeProbeCamofoxHealth(config?: CamofoxConfig): void {
  if (healthProbeInFlight) return;
  healthProbeInFlight = true;
  void isCamofoxAvailable(config, true)
    .catch(() => {
      /* errors absorbed into the cached false result */
    })
    .finally(() => {
      healthProbeInFlight = false;
    });
}

// ─── Session management ─────────────────────────────────────────────────────

/** Per-process session store: taskId → CamofoxSession. */
const sessions = new Map<string, CamofoxSession>();

/**
 * Create a new Camofox session for a task.
 *
 * Generates a random `userId` and task-derived `sessionKey`, then creates a
 * tab via `POST /tabs` with `{userId, listItemId: sessionKey, url: 'about:blank'}`.
 *
 * Never throws — returns a typed result.
 */
export async function createSession(
  taskId: string,
  config: CamofoxConfig,
): Promise<CamofoxResult<CamofoxSession>> {
  const apiKey = resolveApiKey(config);
  const base = config.baseUrl.replace(/\/+$/, "");
  const userId = randomUserId();
  const sessionKey = deriveSessionKey(taskId);
  const timeoutMs = config.timeoutMs ?? 30_000;

  const session: CamofoxSession = { userId, tabId: null, sessionKey };

  try {
    const controller = abortAfter(timeoutMs);
    const resp = await fetch(`${base}/tabs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      // Omit url field — the server defaults to about:blank and rejects
      // explicit "about:blank" as a blocked URL scheme.
      body: JSON.stringify({
        userId,
        listItemId: sessionKey,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `POST /tabs failed: ${resp.status} ${body.slice(0, 200)}`,
      };
    }

    const json = (await resp.json()) as { tabId?: string };
    if (!json.tabId) {
      return { ok: false, error: "POST /tabs response missing tabId" };
    }
    session.tabId = json.tabId;
  } catch (err) {
    return {
      ok: false,
      error: `createSession error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  sessions.set(taskId, session);
  return { ok: true, data: session };
}

/**
 * Get the in-memory session for a task. Returns `undefined` if not found.
 */
export function getSession(taskId: string): CamofoxSession | undefined {
  return sessions.get(taskId);
}

/**
 * Internal: create a tab (or recreate after stale-tab 404).
 * Updates the session's `tabId` in place. Returns the tabId or an error.
 */
async function ensureTab(
  session: CamofoxSession,
  url: string,
  config: CamofoxConfig,
): Promise<CamofoxResult<string>> {
  const apiKey = resolveApiKey(config);
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  try {
    const controller = abortAfter(timeoutMs);
    const resp = await fetch(`${base}/tabs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify({
        userId: session.userId,
        listItemId: session.sessionKey,
        url,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `POST /tabs failed: ${resp.status} ${body.slice(0, 200)}`,
      };
    }

    const json = (await resp.json()) as { tabId?: string };
    if (!json.tabId) {
      return { ok: false, error: "POST /tabs response missing tabId" };
    }
    session.tabId = json.tabId;
    return { ok: true, data: json.tabId };
  } catch (err) {
    return {
      ok: false,
      error: `ensureTab error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Navigate ───────────────────────────────────────────────────────────────

/**
 * Navigate the session's tab to a URL.
 *
 * `POST /tabs/{tabId}/navigate` with `{userId, url}`. If the tab was garbage
 * collected (HTTP 404), recreates the tab with the target URL and returns
 * success. After a successful navigate, auto-snapshots via `GET /tabs/{tabId}/snapshot`.
 *
 * Never throws — returns a typed result.
 */
export async function navigate(
  url: string,
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<NavigateData>> {
  const apiKey = resolveApiKey(config);
  const base = config.baseUrl.replace(/\/+$/, "");
  const navTimeoutMs = 60_000; // Navigate uses a longer timeout (per Python reference).

  if (!session.tabId) {
    // No tab yet — create one with the target URL.
    const created = await ensureTab(session, url, config);
    if (!created.ok) {
      return { ok: false, error: created.error };
    }
    // New tab is created with the URL already — no separate navigate needed.
    // Auto-snapshot.
    const snap = await snapshot(session, config);
    return {
      ok: true,
      data: {
        url,
        title: snap.ok ? "" : "",
        snapshot: snap.ok ? snap.data?.snapshot : undefined,
        refsCount: snap.ok ? snap.data?.refsCount : undefined,
      },
    };
  }

  try {
    const controller = abortAfter(navTimeoutMs);
    const resp = await fetch(`${base}/tabs/${session.tabId}/navigate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify({ userId: session.userId, url }),
      signal: controller.signal,
    });

    if (resp.status === 404) {
      // Stale-tab recovery: tab was garbage collected. Recreate with the target URL.
      session.tabId = null;
      const recreated = await ensureTab(session, url, config);
      if (!recreated.ok) {
        return { ok: false, error: `stale-tab recovery failed: ${recreated.error}` };
      }
      // New tab is created with the URL — auto-snapshot.
      const snap = await snapshot(session, config);
      return {
        ok: true,
        data: {
          url,
          title: "",
          snapshot: snap.ok ? snap.data?.snapshot : undefined,
          refsCount: snap.ok ? snap.data?.refsCount : undefined,
        },
      };
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `POST /tabs/${session.tabId}/navigate failed: ${resp.status} ${body.slice(0, 200)}`,
      };
    }

    const json = (await resp.json()) as { ok?: boolean; url?: string; title?: string };
    const navUrl = json.url ?? url;
    const navTitle = json.title ?? "";

    // Auto-snapshot after navigate.
    const snap = await snapshot(session, config);

    return {
      ok: true,
      data: {
        url: navUrl,
        title: navTitle,
        snapshot: snap.ok ? snap.data?.snapshot : undefined,
        refsCount: snap.ok ? snap.data?.refsCount : undefined,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `navigate error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

/**
 * Get the accessibility-tree snapshot for the session's tab.
 *
 * `GET /tabs/{tabId}/snapshot?userId={userId}`. Returns `{snapshot, refsCount}`.
 *
 * Never throws — returns a typed result.
 */
export async function snapshot(
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<SnapshotData>> {
  if (!session.tabId) {
    return { ok: false, error: "snapshot: no tabId in session" };
  }

  const apiKey = resolveApiKey(config);
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  try {
    const controller = abortAfter(timeoutMs);
    const resp = await fetch(
      `${base}/tabs/${session.tabId}/snapshot?userId=${encodeURIComponent(session.userId)}`,
      {
        method: "GET",
        headers: authHeaders(apiKey),
        signal: controller.signal,
      },
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `GET /tabs/${session.tabId}/snapshot failed: ${resp.status} ${body.slice(0, 200)}`,
      };
    }

    const json = (await resp.json()) as { snapshot?: string; refsCount?: number };
    if (json.snapshot === undefined) {
      return { ok: false, error: "snapshot response missing 'snapshot' field" };
    }
    return {
      ok: true,
      data: {
        snapshot: json.snapshot,
        refsCount: json.refsCount ?? 0,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `snapshot error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Action helpers (click, type, scroll, back, press) ──────────────────────

/**
 * Internal: POST to a tab action endpoint. Handles the common pattern for
 * click/type/scroll/back/press.
 */
async function postAction(
  endpoint: string,
  body: Record<string, unknown>,
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<undefined>> {
  if (!session.tabId) {
    return { ok: false, error: `${endpoint}: no tabId in session` };
  }

  const apiKey = resolveApiKey(config);
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  try {
    const controller = abortAfter(timeoutMs);
    const resp = await fetch(`${base}/tabs/${session.tabId}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const respBody = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `POST /tabs/${session.tabId}/${endpoint} failed: ${resp.status} ${respBody.slice(0, 200)}`,
      };
    }

    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: `${endpoint} error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Click an element by accessibility ref.
 *
 * `POST /tabs/{tabId}/click` with `{userId, ref}`. Strips `@` prefix from ref.
 */
export async function click(
  ref: string,
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<undefined>> {
  return postAction("click", { userId: session.userId, ref: stripRefPrefix(ref) }, session, config);
}

/**
 * Type text into an element by ref.
 *
 * `POST /tabs/{tabId}/type` with `{userId, ref, text}`. Strips `@` prefix from ref.
 */
export async function type(
  ref: string,
  text: string,
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<undefined>> {
  return postAction(
    "type",
    { userId: session.userId, ref: stripRefPrefix(ref), text },
    session,
    config,
  );
}

/**
 * Scroll the page in a direction.
 *
 * `POST /tabs/{tabId}/scroll` with `{userId, direction}`.
 */
export async function scroll(
  direction: string,
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<undefined>> {
  return postAction("scroll", { userId: session.userId, direction }, session, config);
}

/**
 * Navigate back in browser history.
 *
 * `POST /tabs/{tabId}/back` with `{userId}`.
 */
export async function back(
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<undefined>> {
  return postAction("back", { userId: session.userId }, session, config);
}

/**
 * Press a keyboard key.
 *
 * `POST /tabs/{tabId}/press` with `{userId, key}`.
 */
export async function press(
  key: string,
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<undefined>> {
  return postAction("press", { userId: session.userId, key }, session, config);
}

// ─── Screenshot ──────────────────────────────────────────────────────────────

/**
 * Take a screenshot of the session's tab.
 *
 * `GET /tabs/{tabId}/screenshot?userId={userId}` → returns base64-encoded PNG.
 *
 * Never throws — returns a typed result.
 */
export async function screenshot(
  session: CamofoxSession,
  config: CamofoxConfig,
): Promise<CamofoxResult<ScreenshotData>> {
  if (!session.tabId) {
    return { ok: false, error: "screenshot: no tabId in session" };
  }

  const apiKey = resolveApiKey(config);
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  try {
    const controller = abortAfter(timeoutMs);
    const resp = await fetch(
      `${base}/tabs/${session.tabId}/screenshot?userId=${encodeURIComponent(session.userId)}`,
      {
        method: "GET",
        headers: authHeaders(apiKey),
        signal: controller.signal,
      },
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `GET /tabs/${session.tabId}/screenshot failed: ${resp.status} ${body.slice(0, 200)}`,
      };
    }

    const buf = await resp.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { ok: true, data: { base64 } };
  } catch (err) {
    return {
      ok: false,
      error: `screenshot error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Close session ──────────────────────────────────────────────────────────

/**
 * Close a Camofox session: `DELETE /sessions/{userId}`.
 *
 * Removes the session from the in-memory store regardless of the API result.
 * Never throws — returns a typed result.
 */
export async function closeSession(
  taskId: string,
  config: CamofoxConfig,
): Promise<CamofoxResult<undefined>> {
  const session = sessions.get(taskId);
  if (!session) {
    return { ok: false, error: `closeSession: no session for taskId '${taskId}'` };
  }

  const apiKey = resolveApiKey(config);
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  try {
    const controller = abortAfter(timeoutMs);
    const resp = await fetch(`${base}/sessions/${session.userId}`, {
      method: "DELETE",
      headers: authHeaders(apiKey),
      signal: controller.signal,
    });

    // Always remove from in-memory store.
    sessions.delete(taskId);

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        ok: false,
        error: `DELETE /sessions/${session.userId} failed: ${resp.status} ${body.slice(0, 200)}`,
      };
    }

    return { ok: true, data: undefined };
  } catch (err) {
    // Always remove from in-memory store even on error.
    sessions.delete(taskId);
    return {
      ok: false,
      error: `closeSession error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}