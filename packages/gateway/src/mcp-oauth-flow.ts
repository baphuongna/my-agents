/**
 * @my-agent/gateway — Full MCP OAuth browser/callback flow (PLAN-REMAINING Item 5).
 *
 * Completes the OAuth 2.1 PKCE lifecycle that the storage layer
 * (mcp-oauth-store.ts) was built for:
 *
 *   open browser → listen on localhost callback → capture auth code →
 *   exchange for token (PKCE) → store via McpOAuthStorage.
 *
 * Then for HTTP MCP servers, build the Authorization header from the stored
 * token, refreshing it (via refresh_token) when it is about to expire.
 *
 * Every external side-effect (browser launch, loopback server, token exchange,
 * token refresh) is INJECTABLE so the flow is fully unit-testable without
 * network or a real browser.
 *
 * Source: §5 MCP OAuth 2.1 PKCE; §06.1 OAuth/PKCE; mcp-oauth-store.ts.
 */
import { spawn } from "node:child_process";
import {
  generatePkce,
  buildAuthUrl,
  exchangeCode as defaultExchangeCode,
  refreshAccessToken as defaultRefreshToken,
  verifyCallbackState,
  type LoopbackServer,
  type CallbackResult,
  type TokenResponse,
} from "@my-agent/ai";
import { nowWallclock } from "@my-agent/core";
import type { McpOAuthStorage, McpTokens } from "./mcp-oauth-store.js";

/** A loopback server surface (the subset of @my-agent/ai.LoopbackServer we use). */
export interface LoopbackServerLike {
  start(): Promise<{ port: number; redirectUri: string }>;
  waitForCallback(): Promise<CallbackResult>;
  close(): void;
}

/** Default loopback factory — uses @my-agent/ai's real LoopbackServer. */
async function defaultCreateServer(): Promise<LoopbackServerLike> {
  const { LoopbackServer } = await import("@my-agent/ai");
  return new LoopbackServer() as unknown as LoopbackServerLike;
}

/** Default browser opener — spawns the OS default browser via `open`/`xdg-open`. */
function defaultOpenBrowser(url: string): Promise<void> {
  return new Promise((resolve) => {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => {
        /* browser launch is best-effort; the URL was already logged */
      });
      child.unref();
    } catch {
      /* ignore */
    }
    resolve();
  });
}

/** Token-exchange function signature (injectable; mirrors @my-agent/ai.exchangeCode). */
export type ExchangeCodeFn = (opts: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string;
}) => Promise<TokenResponse>;

/** Token-refresh function signature (injectable; mirrors @my-agent/ai.refreshAccessToken). */
export type RefreshTokenFn = (opts: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}) => Promise<TokenResponse>;

/** Options for the full browser/callback OAuth flow. */
export interface McpOAuthFlowOptions {
  serverId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes?: string[];
  storage: McpOAuthStorage;
  /** Injectable browser opener (default: OS default browser). */
  openBrowser?: (url: string) => Promise<void>;
  /** Injectable loopback server factory (default: real LoopbackServer). */
  createServer?: () => Promise<LoopbackServerLike>;
  /** Injectable token exchanger (default: real exchangeCode — DO NOT call in tests). */
  exchangeCode?: ExchangeCodeFn;
  /** Overall flow timeout in ms (default: 5 min). */
  timeoutMs?: number;
}

/** Result of a full OAuth flow. */
export interface McpOAuthFlowResult {
  ok: boolean;
  error?: string;
  tokens?: McpTokens;
}

/** Convert an @my-agent/ai TokenResponse (snake_case) into a stored McpTokens
 *  record. Exported + pure for unit testing the mapping. */
export function tokenResponseToMcpTokens(
  resp: TokenResponse,
  now: number = nowWallclock(),
): McpTokens {
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    expiresAt: typeof resp.expires_in === "number" ? now + resp.expires_in * 1000 : null,
    tokenType: resp.token_type ?? "Bearer",
    scope: resp.scope,
  };
}

/**
 * Run the full OAuth browser/callback flow end-to-end:
 *   1. Start a localhost loopback callback server (127.0.0.1 only).
 *   2. Build the auth URL (PKCE) and open it in the browser.
 *   3. Wait for the IdP to redirect back with code+state.
 *   4. Verify the CSRF state, exchange the code for tokens.
 *   5. Store the tokens via McpOAuthStorage.
 *
 * All side-effects are injectable; pass `openBrowser`/`createServer`/`exchangeCode`
 * mocks in tests. The flow never blocks forever: it resolves within `timeoutMs`.
 */
export async function runMcpOAuthFlow(
  opts: McpOAuthFlowOptions,
): Promise<McpOAuthFlowResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const createServer = opts.createServer ?? defaultCreateServer;
  const openBrowser = opts.openBrowser ?? defaultOpenBrowser;
  const exchange = opts.exchangeCode ?? defaultExchangeCode;

  const pkce = generatePkce();
  // RFC 6749 CSRF state: a fresh opaque token per flow.
  const state = `${opts.serverId}:${nowWallclock().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;

  let server: LoopbackServerLike | null = null;
  try {
    server = await createServer();
    const { redirectUri } = await server.start();

    const authReq = buildAuthUrl({
      authEndpoint: opts.authorizationEndpoint,
      clientId: opts.clientId,
      redirectUri,
      scopes: opts.scopes ?? [],
      pkce,
      state,
    });

    // Open the browser (best-effort). Tests inject a mock that records the URL.
    await openBrowser(authReq.url);

    // Wait for the callback, with a timeout guard.
    const callback = await waitForCallbackWithTimeout(server, timeoutMs);
    if (!callback) {
      return { ok: false, error: `OAuth flow timed out after ${timeoutMs}ms` };
    }

    // CSRF: verify the returned state matches the one we sent.
    try {
      verifyCallbackState(state, callback);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    // Exchange the authorization code for tokens (PKCE verifier required).
    let tokens: TokenResponse;
    try {
      tokens = await exchange({
        tokenEndpoint: opts.tokenEndpoint,
        clientId: opts.clientId,
        code: callback.code,
        redirectUri,
        verifier: pkce.verifier,
      });
    } catch (e) {
      return { ok: false, error: `token exchange failed: ${(e as Error).message}` };
    }

    const mcpTokens = tokenResponseToMcpTokens(tokens);
    opts.storage.setTokens(opts.serverId, mcpTokens);
    return { ok: true, tokens: mcpTokens };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    server?.close();
  }
}

/** Race the callback wait against a timeout so the flow can never hang. */
async function waitForCallbackWithTimeout(
  server: LoopbackServerLike,
  timeoutMs: number,
): Promise<CallbackResult | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
    server
      .waitForCallback()
      .then((r) => {
        clearTimeout(timer);
        resolve(r);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/** Options for refreshing a stored MCP token. */
export interface McpRefreshOptions {
  serverId: string;
  tokenEndpoint: string;
  clientId: string;
  storage: McpOAuthStorage;
  /** Injectable refresher (default: real refreshAccessToken — DO NOT call in tests). */
  refreshToken?: RefreshTokenFn;
}

/**
 * Refresh a stored MCP access token using its refresh_token. Rotates the stored
 * tokens (writes the new access/refresh pair). Returns the refreshed tokens, or
 * null when there is no refresh token / the refresh failed.
 */
export async function refreshMcpToken(
  opts: McpRefreshOptions,
): Promise<McpTokens | null> {
  const refresh = opts.refreshToken ?? defaultRefreshToken;
  const current = opts.storage.getTokens(opts.serverId);
  if (!current || !current.refreshToken) return null;
  try {
    const resp = await refresh({
      tokenEndpoint: opts.tokenEndpoint,
      clientId: opts.clientId,
      refreshToken: current.refreshToken,
    });
    const updated = tokenResponseToMcpTokens(resp);
    // RFC 6749 §6: a refreshed response MAY omit refresh_token — keep the old
    // one when the IdP does not rotate it.
    if (!updated.refreshToken) updated.refreshToken = current.refreshToken;
    opts.storage.setTokens(opts.serverId, updated);
    return updated;
  } catch {
    return null;
  }
}

/** Build the `Authorization` header value for an HTTP MCP server from tokens. */
export function buildAuthHeader(tokens: McpTokens): string {
  const type = tokens.tokenType || "Bearer";
  return `${type} ${tokens.accessToken}`;
}

/**
 * Resolve valid (non-expired) tokens for an HTTP MCP server, refreshing on
 * demand when the stored token has expired (or is within the skew window).
 * Returns null when no tokens are stored and no refresh is possible.
 *
 * @param skewSeconds refresh this many seconds BEFORE the hard expiry (default 60s)
 */
export async function getValidMcpTokens(
  serverId: string,
  storage: McpOAuthStorage,
  opts: {
    tokenEndpoint: string;
    clientId: string;
    skewSeconds?: number;
    refreshToken?: RefreshTokenFn;
    now?: number;
  },
): Promise<McpTokens | null> {
  const now = opts.now ?? nowWallclock();
  const skewMs = (opts.skewSeconds ?? 60) * 1000;
  const tokens = storage.getTokens(serverId);
  if (!tokens) return null;
  // Not expired (and not within the skew window) → use as-is.
  if (tokens.expiresAt === null || now + skewMs < tokens.expiresAt) {
    return tokens;
  }
  // Expired/about-to-expire → try a refresh.
  const refreshed = await refreshMcpToken({
    serverId,
    tokenEndpoint: opts.tokenEndpoint,
    clientId: opts.clientId,
    storage,
    refreshToken: opts.refreshToken,
  });
  return refreshed ?? tokens; // fall back to the stale token if refresh fails
}
