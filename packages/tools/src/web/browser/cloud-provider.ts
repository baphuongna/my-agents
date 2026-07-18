/**
 * cloud-provider.ts — Cloud browser backend providers (Browserbase + Browser Use).
 *
 * Implements the BrowserProvider interface for cloud browser backends, per
 * docs/PLAN-BROWSER.md §3A/§5Phase4 and the hermes reference implementations
 * (`browser_provider.py`, `browserbase/provider.py`, `browser_use/provider.py`).
 *
 * Two providers are implemented:
 *
 * 1. **BrowserbaseProvider** — cloud browser with stealth, proxies, keepAlive.
 *    402-fallback chain: drop keepAlive → drop proxies → give up.
 * 2. **BrowserUseProvider** — dual-auth mode (direct API key OR managed gateway).
 *    - Direct mode (default when `BROWSER_USE_API_KEY` is set alone): calls
 *      `api.browser-use.com/api/v3/browsers` with `X-Browser-Use-API-Key` header.
 *    - Managed-gateway mode (when `BROWSER_USE_GATEWAY_URL` is set): calls the
 *      gateway with `Authorization: Bearer <token>` (OAuth or fallback API key),
 *      `X-Idempotency-Key: <uuidv4-per-session>` (idempotent POST), and propagates
 *      `externalCallId` from args/env into the body so the gateway can correlate.
 *
 * Design constraints (from task packet):
 *   - **Never throw** — all errors become typed result objects.
 *   - **No external deps** — Node.js built-in `fetch()` + `node:crypto` only.
 *   - TS strict + noUncheckedIndexedAccess + ESM.
 *   - Follow existing code style in `packages/tools/src/web/`.
 *
 * The hermes Python providers raise exceptions; this TS port returns typed
 * error objects (`{ ok: false; error: string }`) instead, per the task contract.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM; never throws.
 */
import { randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Session metadata returned by `createSession()`. */
export interface CloudSessionMeta {
  /** Unique session name (format: `hermes_{taskId}_{uuid8}`). */
  sessionName: string;
  /** Provider session ID (used for close/cleanup — legacy key name). */
  bbSessionId: string;
  /** CDP websocket URL for connecting agent-browser via `--cdp`. */
  cdpUrl: string;
  /** Feature flags that were actually enabled (finalized after fallback). */
  features: Record<string, boolean>;
  /** Gateway correlation ID (managed-gateway mode only). Echoed from the
   *  `x-external-call-id` response header. Undefined in direct mode. */
  externalCallId?: string;
}

/** Typed error result — never throw, always return this on failure. */
export interface CloudProviderError {
  ok: false;
  error: string;
}

/** Typed success result wrapping CloudSessionMeta. */
export interface CloudProviderOk {
  ok: true;
  session: CloudSessionMeta;
}

export type CreateSessionResult = CloudProviderOk | CloudProviderError;

/** The BrowserProvider interface every cloud backend must implement. */
export interface BrowserProvider {
  /** Stable short identifier (lowercase, hyphens OK). */
  readonly name: string;
  /** Cheap availability check — NO network calls (env var presence only). */
  isAvailable(): boolean;
  /** Create a new cloud browser session. Never throws — returns typed result. */
  createSession(taskId: string): Promise<CreateSessionResult>;
  /** Close a session by provider ID. Returns true on success, false on failure. */
  closeSession(sessionId: string): Promise<boolean>;
  /** Best-effort teardown from atexit/signal handlers. Must NOT throw. */
  emergencyCleanup(sessionId: string): void;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Default timeout for session creation (30s, matching hermes). */
const CREATE_TIMEOUT_MS = 30_000;
/** Default timeout for close/emergency cleanup (10s / 5s). */
const CLOSE_TIMEOUT_MS = 10_000;
const EMERGENCY_TIMEOUT_MS = 5_000;

/** Maximum session timeout Browserbase allows (6 hours = 21600s). */
const BROWSERBASE_MAX_TIMEOUT = 21_600;

/** Generate a random 8-char hex suffix for session names. */
function randomHex8(): string {
  return Math.random().toString(16).slice(2, 10).padStart(8, "0").slice(0, 8);
}

/** Build a session name following the hermes convention. */
function buildSessionName(taskId: string): string {
  return `hermes_${taskId}_${randomHex8()}`;
}

/** Fetch wrapper with timeout via AbortController. Never throws — returns
 *  typed result on network error. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: true; res: Response } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return { ok: true, res };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── BrowserbaseProvider ────────────────────────────────────────────────────

/**
 * Browserbase cloud browser provider.
 *
 * API reference: https://docs.browserbase.com
 *
 * Env vars:
 *   - `BROWSERBASE_API_KEY`     (required)
 *   - `BROWSERBASE_PROJECT_ID`  (required)
 *   - `BROWSERBASE_BASE_URL`    (optional, default: `https://api.browserbase.com`)
 *   - `BROWSERBASE_PROXIES`     (optional, default: `"true"`)
 *   - `BROWSERBASE_ADVANCED_STEALTH` (optional, default: `"false"`)
 *   - `BROWSERBASE_KEEP_ALIVE`  (optional, default: `"true"`)
 *   - `BROWSERBASE_SESSION_TIMEOUT` (optional, max 21600s)
 */
export class BrowserbaseProvider implements BrowserProvider {
  readonly name = "browserbase";

  /** Resolve the API base URL (strip trailing slash). */
  private get baseUrl(): string {
    const raw = process.env.BROWSERBASE_BASE_URL ?? "https://api.browserbase.com";
    return raw.replace(/\/+$/, "");
  }

  isAvailable(): boolean {
    return (
      !!process.env.BROWSERBASE_API_KEY &&
      process.env.BROWSERBASE_API_KEY.length > 0 &&
      !!process.env.BROWSERBASE_PROJECT_ID &&
      process.env.BROWSERBASE_PROJECT_ID.length > 0
    );
  }

  async createSession(taskId: string): Promise<CreateSessionResult> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId) {
      return { ok: false, error: "BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID not set" };
    }

    // Read optional config from env vars.
    const enableProxies = (process.env.BROWSERBASE_PROXIES ?? "true") !== "false";
    const enableAdvancedStealth = process.env.BROWSERBASE_ADVANCED_STEALTH === "true";
    const enableKeepAlive = (process.env.BROWSERBASE_KEEP_ALIVE ?? "true") !== "false";

    // Parse optional session timeout (positive int, max 21600).
    let customTimeout: number | undefined;
    const rawTimeout = process.env.BROWSERBASE_SESSION_TIMEOUT;
    if (rawTimeout) {
      const parsed = parseInt(rawTimeout, 10);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed <= BROWSERBASE_MAX_TIMEOUT) {
        customTimeout = parsed;
      }
    }

    // Build initial session config incrementally.
    const sessionConfig: Record<string, unknown> = {
      projectId,
    };
    if (enableKeepAlive) sessionConfig["keepAlive"] = true;
    if (enableProxies) sessionConfig["proxies"] = true;
    if (customTimeout !== undefined) sessionConfig["timeout"] = customTimeout;
    if (enableAdvancedStealth) {
      sessionConfig["browserSettings"] = { advancedStealth: true };
    }

    // Feature flags — all false initially except basic_stealth (always true).
    let keepaliveFallback = false;
    let proxiesFallback = false;
    const features: Record<string, boolean> = {
      basic_stealth: true,
      proxies: false,
      advanced_stealth: false,
      keep_alive: false,
      custom_timeout: false,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey,
    };

    // ── Step 1: POST /v1/sessions with full config ──
    let result = await this.postSession(sessionConfig, headers);
    if (!result.ok) return result;

    // ── 402-Fallback Step 1: drop keepAlive ──
    if (result.status === 402 && enableKeepAlive && "keepAlive" in sessionConfig) {
      delete sessionConfig["keepAlive"];
      keepaliveFallback = true;
      result = await this.postSession(sessionConfig, headers);
      if (!result.ok) return result;
    }

    // ── 402-Fallback Step 2: drop proxies ──
    if (result.status === 402 && enableProxies && "proxies" in sessionConfig) {
      delete sessionConfig["proxies"];
      proxiesFallback = true;
      result = await this.postSession(sessionConfig, headers);
      if (!result.ok) return result;
    }

    // ── If still not OK after fallback chain, return error ──
    if (result.status !== 200 && result.status !== 201) {
      return {
        ok: false,
        error: `Browserbase session creation failed (HTTP ${result.status}): ${result.body}`,
      };
    }

    // Parse response: { id, connectUrl }
    const json = result.json as Record<string, unknown> | undefined;
    const sessionId = json?.["id"];
    const connectUrl = json?.["connectUrl"];
    if (typeof sessionId !== "string" || typeof connectUrl !== "string") {
      return {
        ok: false,
        error: `Browserbase response missing id or connectUrl: ${result.body}`,
      };
    }

    // Finalize feature flags.
    features["proxies"] = enableProxies && !proxiesFallback;
    features["advanced_stealth"] = enableAdvancedStealth;
    features["keep_alive"] = enableKeepAlive && !keepaliveFallback;
    features["custom_timeout"] = customTimeout !== undefined && "timeout" in sessionConfig;

    return {
      ok: true,
      session: {
        sessionName: buildSessionName(taskId),
        bbSessionId: sessionId,
        cdpUrl: connectUrl,
        features,
      },
    };
  }

  /** POST to /v1/sessions and return a structured result. */
  private async postSession(
    sessionConfig: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<
    | { ok: true; status: number; body: string; json: Record<string, unknown> | undefined }
    | { ok: false; error: string }
  > {
    const fetchResult = await fetchWithTimeout(
      `${this.baseUrl}/v1/sessions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(sessionConfig),
      },
      CREATE_TIMEOUT_MS,
    );
    if (!fetchResult.ok) {
      return { ok: false, error: `Browserbase createSession network error: ${fetchResult.error}` };
    }
    const res = fetchResult.res;
    const text = await res.text();
    let json: Record<string, unknown> | undefined;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    } catch {
      // Non-JSON body — that's OK for error responses.
    }
    return { ok: true, status: res.status, body: text, json };
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId) return false;

    const fetchResult = await fetchWithTimeout(
      `${this.baseUrl}/v1/sessions/${sessionId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BB-API-Key": apiKey,
        },
        body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
      },
      CLOSE_TIMEOUT_MS,
    );
    if (!fetchResult.ok) return false;
    // 200, 201, or 204 → success.
    return (
      fetchResult.res.status === 200 ||
      fetchResult.res.status === 201 ||
      fetchResult.res.status === 204
    );
  }

  emergencyCleanup(sessionId: string): void {
    // Best-effort — never throw. Use shorter timeout.
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId || !sessionId) return;

    // Fire-and-forget with a short timeout. Cannot be async (atexit handler).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMERGENCY_TIMEOUT_MS);
    fetch(`${this.baseUrl}/v1/sessions/${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": apiKey,
      },
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
      signal: controller.signal,
    })
      .then(() => clearTimeout(timer))
      .catch(() => clearTimeout(timer));
  }
}

// ─── BrowserUseProvider ────────────────────────────────────────────────────

/**
 * Browser Use cloud browser provider (dual-auth mode).
 *
 * API reference: https://docs.browser-use.com (direct) + hermes managed-gateway
 * (mirrors `browser_use/provider.py`).
 *
 * Env vars:
 *   **Direct mode** (existing behavior — unchanged):
 *     - `BROWSER_USE_API_KEY`            (required)
 *     - Header: `X-Browser-Use-API-Key: <key>`
 *     - Endpoint: `https://api.browser-use.com/api/v3/browsers`
 *     - Body: empty JSON `{}`
 *
 *   **Managed-gateway mode** (new — mirrors hermes `browser_use/provider.py`):
 *     - `BROWSER_USE_GATEWAY_URL`        (required for this mode, e.g.
 *                                         `https://gateway.example.com`)
 *     - `BROWSER_USE_API_KEY`  OR  `BROWSER_USE_OAUTH_TOKEN`  (token — OAuth
 *                                         preferred for managed gateways;
 *                                         API key is a fallback only when the
 *                                         gateway accepts it as a Bearer)
 *     - Header: `Authorization: Bearer <token>`  (NOT `X-Browser-Use-API-Key`,
 *                                                 which would leak the direct
 *                                                 key to the gateway)
 *     - Header: `X-Idempotency-Key: <uuidv4-per-session>` (idempotent POST
 *                                                            `browsers` create)
 *     - Endpoint: `<gateway-origin>/api/v3/browsers`
 *     - Body: `{ externalCallId?: string }`  (from `args.externalCallId` or
 *                                             env `BROWSER_USE_EXTERNAL_CALL_ID`)
 *
 * Mode selection (priority order — gateway URL is a strong intent signal):
 *   1. `BROWSER_USE_GATEWAY_URL` + `(BROWSER_USE_API_KEY` or
 *      `BROWSER_USE_OAUTH_TOKEN)`  →  managed-gateway mode.
 *   2. `BROWSER_USE_API_KEY` (no gateway)  →  direct mode.
 *   3. Neither  →  unavailable (`isAvailable()` returns `false`).
 *
 * `isAvailable()` returns true if EITHER direct is configured
 * (`BROWSER_USE_API_KEY` set alone) OR managed is configured (gateway URL +
 * at least one of API key / OAuth token).
 */
const BROWSER_USE_BASE_URL = "https://api.browser-use.com/api/v3";

/** UUIDv4 shape regex — used by tests to assert `X-Idempotency-Key` format.
 *  Exported so tests can validate the generated key without re-implementing
 *  the regex (single source of truth for "what counts as a uuidv4 here"). */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BrowserUseProvider implements BrowserProvider {
  readonly name = "browser-use";

  /** Resolve the managed-gateway base URL (strip trailing slash). Undefined if not set. */
  private get gatewayUrl(): string | undefined {
    const raw = process.env.BROWSER_USE_GATEWAY_URL?.trim();
    if (!raw) return undefined;
    return raw.replace(/\/+$/, "");
  }

  /** Read the auth token for managed-gateway mode (OAuth preferred, API key fallback). */
  private managedToken(): string | undefined {
    const oauth = process.env.BROWSER_USE_OAUTH_TOKEN?.trim();
    if (oauth) return oauth;
    return process.env.BROWSER_USE_API_KEY?.trim() || undefined;
  }

  /** True iff at least one of `BROWSER_USE_OAUTH_TOKEN` / `BROWSER_USE_API_KEY` is set. */
  private hasManagedCredentials(): boolean {
    return this.managedToken() !== undefined;
  }

  isAvailable(): boolean {
    // Direct mode: any BROWSER_USE_API_KEY (regardless of gateway — see resolveMode).
    if (this.directApiKey()) return true;
    // Managed mode: gateway URL + at least one of (API key, OAuth token).
    return this.gatewayUrl !== undefined && this.hasManagedCredentials();
  }

  /**
   * Decide between direct and managed-gateway mode for the *current* call.
   *
   * Precedence (gateway URL is a strong user intent signal):
   *   - Gateway set + any token  →  managed
   *   - API key only (no gateway)  →  direct
   *   - Otherwise  →  unavailable (returned as `{ error }`)
   */
  private resolveMode():
    | { ok: true; mode: "direct" | "managed"; baseUrl: string; apiKey: string; token: string }
    | { ok: false; error: string } {
    const apiKeyOpt = this.directApiKey();
    const gatewayOpt = this.gatewayUrl;
    const managedTokOpt = this.managedToken();

    // Branch 1: managed-gateway mode — gateway URL set + any token. Per spec,
    // the gateway exposes the same `/api/v3/browsers` path as direct mode, so
    // we append `/api/v3` to the gateway origin up front. Trailing slashes on
    // the env var are already stripped by `this.gatewayUrl`.
    if (gatewayOpt !== undefined && managedTokOpt !== undefined) {
      return {
        ok: true,
        mode: "managed",
        baseUrl: `${gatewayOpt}/api/v3`,
        // In managed mode the API key MAY also be set (used as Bearer fallback
        // by some gateways). It's optional here — only token is required.
        apiKey: apiKeyOpt ?? "",
        token: managedTokOpt,
      };
    }
    // Branch 2: direct mode — only the API key is required (no gateway).
    // `BROWSER_USE_BASE_URL` already ends with `/api/v3`.
    if (apiKeyOpt !== undefined) {
      return {
        ok: true,
        mode: "direct",
        baseUrl: BROWSER_USE_BASE_URL,
        apiKey: apiKeyOpt,
        token: managedTokOpt ?? apiKeyOpt,
      };
    }
    return {
      ok: false,
      error:
        "BROWSER_USE_API_KEY not set (and managed-gateway mode requires BROWSER_USE_GATEWAY_URL + BROWSER_USE_API_KEY or BROWSER_USE_OAUTH_TOKEN)",
    };
  }

  /** Read `BROWSER_USE_API_KEY` (trimmed; undefined if empty). */
  private directApiKey(): string | undefined {
    return process.env.BROWSER_USE_API_KEY?.trim() || undefined;
  }

  async createSession(taskId: string, externalCallId?: string): Promise<CreateSessionResult> {
    const mode = this.resolveMode();
    if (!mode.ok) return { ok: false, error: mode.error };

    const { mode: kind, baseUrl, apiKey, token } = mode;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (kind === "direct") {
      headers["X-Browser-Use-API-Key"] = apiKey;
    } else {
      // Managed-gateway mode — Bearer token (NOT X-Browser-Use-API-Key).
      headers["Authorization"] = `Bearer ${token}`;
      // Per-session idempotency: a fresh uuidv4 per POST /browsers so the
      // gateway can deduplicate retries without us tracking state locally.
      // (Hermes uses a string prefix + uuid4; we use a bare uuidv4 per spec.)
      headers["X-Idempotency-Key"] = randomUUIDv4();
    }

    // Body: empty in direct mode; managed mode may include externalCallId.
    const body: Record<string, unknown> = {};
    if (kind === "managed") {
      const extId = externalCallId ?? process.env.BROWSER_USE_EXTERNAL_CALL_ID?.trim();
      if (extId) body["externalCallId"] = extId;
    }

    const fetchResult = await fetchWithTimeout(
      `${baseUrl}/browsers`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      CREATE_TIMEOUT_MS,
    );
    if (!fetchResult.ok) {
      return { ok: false, error: `Browser Use createSession network error: ${fetchResult.error}` };
    }

    const res = fetchResult.res;
    const text = await res.text();
    if (res.status !== 200 && res.status !== 201) {
      return {
        ok: false,
        error: `Browser Use session creation failed (HTTP ${res.status}): ${text}`,
      };
    }

    let json: Record<string, unknown> | undefined;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    } catch {
      return { ok: false, error: `Browser Use response is not valid JSON: ${text}` };
    }

    const sessionId = json?.["id"];
    const cdpUrl = json?.["cdpUrl"] ?? json?.["connectUrl"];
    if (typeof sessionId !== "string") {
      return { ok: false, error: `Browser Use response missing id: ${text}` };
    }

    // Managed gateway may echo an `x-external-call-id` correlation header —
    // surface it so downstream consumers can correlate without re-reading env.
    const responseExternalId =
      kind === "managed" ? res.headers.get("x-external-call-id") : null;

    const session: CloudSessionMeta = {
      sessionName: buildSessionName(taskId),
      bbSessionId: sessionId,
      cdpUrl: typeof cdpUrl === "string" ? cdpUrl : "",
      features: { browser_use: true },
    };
    if (responseExternalId) session.externalCallId = responseExternalId;

    return {
      ok: true,
      session,
    };
  }

  async closeSession(sessionId: string): Promise<boolean> {
    if (!sessionId) return false;

    const mode = this.resolveMode();
    if (!mode.ok) return false;

    const { mode: kind, baseUrl, apiKey, token } = mode;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (kind === "direct") {
      headers["X-Browser-Use-API-Key"] = apiKey;
    } else {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const fetchResult = await fetchWithTimeout(
      `${baseUrl}/browsers/${sessionId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ action: "stop" }),
      },
      CLOSE_TIMEOUT_MS,
    );
    if (!fetchResult.ok) return false;
    return (
      fetchResult.res.status === 200 ||
      fetchResult.res.status === 201 ||
      fetchResult.res.status === 204
    );
  }

  emergencyCleanup(sessionId: string): void {
    // Best-effort — never throw. Shorter timeout.
    if (!sessionId) return;

    const mode = this.resolveMode();
    if (!mode.ok) return;

    const { mode: kind, baseUrl, apiKey, token } = mode;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (kind === "direct") {
      headers["X-Browser-Use-API-Key"] = apiKey;
    } else {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMERGENCY_TIMEOUT_MS);
    fetch(`${baseUrl}/browsers/${sessionId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ action: "stop" }),
      signal: controller.signal,
    })
      .then(() => clearTimeout(timer))
      .catch(() => clearTimeout(timer));
  }
}

/**
 * Generate a UUIDv4 string. Uses Node's built-in `crypto.randomUUID()` which
 * returns a v4 UUID. Exported for tests to assert against `UUID_V4_REGEX`.
 */
function randomUUIDv4(): string {
  return randomUUID();
}

// ─── Factory / registry ─────────────────────────────────────────────────────

/** Get all registered cloud providers (sorted by priority: browserbase first). */
export function getCloudProviders(): BrowserProvider[] {
  return [new BrowserbaseProvider(), new BrowserUseProvider()];
}

/** Check if ANY cloud provider is available (cheap env-var check, no network). */
export function isAnyCloudProviderAvailable(): boolean {
  return getCloudProviders().some((p) => p.isAvailable());
}

/** Get the first available cloud provider, or null if none available. */
export function getAvailableCloudProvider(): BrowserProvider | null {
  const providers = getCloudProviders();
  for (const p of providers) {
    if (p.isAvailable()) return p;
  }
  return null;
}