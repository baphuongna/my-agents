/**
 * @my-agent/gateway — Full MCP OAuth browser/callback flow tests (Item 5).
 *
 * Everything external is mocked: the browser opener records the URL it was
 * handed, the loopback callback server replays a canned code+state, and the
 * token exchange / refresh functions are injectable stubs. No network, no real
 * browser. Uses an isolated temp "home" so the real user dir is untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setTimeProvider } from "@my-agent/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpOAuthStorage, type McpTokens } from "./mcp-oauth-store.js";
import {
  runMcpOAuthFlow,
  refreshMcpToken,
  buildAuthHeader,
  getValidMcpTokens,
  tokenResponseToMcpTokens,
  type LoopbackServerLike,
} from "./mcp-oauth-flow.js";
import type { CallbackResult, TokenResponse } from "@my-agent/ai";

const realWallclock = (): number => Date.now();
const realMonotonic = (): number =>
  typeof performance !== "undefined" ? performance.now() * 1000 : Date.now();

let home: string;
let storage: McpOAuthStorage;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mcp-oauth-flow-"));
  storage = new McpOAuthStorage(home);
});

afterEach(() => {
  setTimeProvider({ nowWallclock: realWallclock, nowMonotonic: realMonotonic });
  rmSync(home, { recursive: true, force: true });
});

/** Build a mock loopback server that replays a fixed callback (after start). */
function mockServer(callback: CallbackResult): {
  server: LoopbackServerLike;
  started: { value: boolean };
} {
  const started = { value: false };
  const server: LoopbackServerLike = {
    async start() {
      started.value = true;
      return { port: 54321, redirectUri: "http://127.0.0.1:54321/callback" };
    },
    async waitForCallback() {
      return callback;
    },
    close() {
      /* no-op */
    },
  };
  return { server, started };
}

describe("[unit] tokenResponseToMcpTokens — snake_case → stored mapping", () => {
  it("maps access_token, token_type, scope and computes expiresAt from expires_in", () => {
    const resp: TokenResponse = {
      access_token: "AT",
      refresh_token: "RT",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "read write",
    };
    const t = tokenResponseToMcpTokens(resp, 1000);
    expect(t.accessToken).toBe("AT");
    expect(t.refreshToken).toBe("RT");
    expect(t.tokenType).toBe("Bearer");
    expect(t.scope).toBe("read write");
    expect(t.expiresAt).toBe(1000 + 3600 * 1000);
  });

  it("leaves expiresAt null when expires_in is absent", () => {
    const t = tokenResponseToMcpTokens({ access_token: "a", token_type: "Bearer" }, 1000);
    expect(t.expiresAt).toBeNull();
  });

  it("defaults tokenType to Bearer when missing", () => {
    const t = tokenResponseToMcpTokens({ access_token: "a" } as TokenResponse, 1000);
    expect(t.tokenType).toBe("Bearer");
  });
});

describe("[unit] buildAuthHeader — HTTP MCP Authorization header", () => {
  it("builds '<type> <accessToken>'", () => {
    const tokens: McpTokens = {
      accessToken: "abc123", tokenType: "Bearer", expiresAt: null,
    };
    expect(buildAuthHeader(tokens)).toBe("Bearer abc123");
  });

  it("uses a custom token type", () => {
    const tokens: McpTokens = { accessToken: "x", tokenType: "DPoP", expiresAt: null };
    expect(buildAuthHeader(tokens)).toBe("DPoP x");
  });

  it("falls back to Bearer when tokenType is empty", () => {
    const tokens: McpTokens = { accessToken: "x", tokenType: "", expiresAt: null };
    expect(buildAuthHeader(tokens)).toBe("Bearer x");
  });
});

describe("[unit] runMcpOAuthFlow — full browser/callback flow (mocked)", () => {
  it("opens the browser, captures the callback, exchanges the code, stores tokens", async () => {
    const callback: CallbackResult = { code: "AUTHCODE", state: "" }; // state set below
    let openedUrl = "";
    let exchangeCalledWith: Record<string, unknown> = {};
    // We need the state to match what runMcpOAuthFlow generates; capture it via
    // the openBrowser URL's query param, then set the callback state to match.
    const { server } = mockServer(callback);

    const result = await runMcpOAuthFlow({
      serverId: "svc",
      authorizationEndpoint: "https://idp/authorize",
      tokenEndpoint: "https://idp/token",
      clientId: "client-1",
      scopes: ["read"],
      storage,
      openBrowser: async (url) => {
        openedUrl = url;
        // extract the state the flow generated so the callback matches it
        const u = new URL(url);
        callback.state = u.searchParams.get("state") ?? "";
      },
      createServer: async () => server,
      exchangeCode: async (opts) => {
        exchangeCalledWith = opts;
        const resp: TokenResponse = {
          access_token: "AT-xyz",
          refresh_token: "RT-xyz",
          expires_in: 7200,
          token_type: "Bearer",
          scope: "read",
        };
        return resp;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.tokens?.accessToken).toBe("AT-xyz");
    // Browser was opened with the authorize endpoint + PKCE + the right client id.
    expect(openedUrl).toContain("https://idp/authorize");
    expect(openedUrl).toContain("client_id=client-1");
    expect(openedUrl).toContain("scope=read");
    expect(openedUrl).toContain("code_challenge=");
    expect(openedUrl).toContain("code_challenge_method=S256");
    // Exchange received the captured code + the redirect URI + the verifier.
    expect(exchangeCalledWith["code"]).toBe("AUTHCODE");
    expect(exchangeCalledWith["redirectUri"]).toBe("http://127.0.0.1:54321/callback");
    expect(typeof exchangeCalledWith["verifier"]).toBe("string");
    // Tokens persisted via the storage layer (storage roundtrip).
    const stored = storage.getTokens("svc");
    expect(stored?.accessToken).toBe("AT-xyz");
    expect(stored?.refreshToken).toBe("RT-xyz");
  });

  it("fails (state mismatch) when the callback state does not match", async () => {
    const callback: CallbackResult = { code: "c", state: "WRONG-STATE" };
    const { server } = mockServer(callback);
    const result = await runMcpOAuthFlow({
      serverId: "svc",
      authorizationEndpoint: "https://idp/authorize",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      openBrowser: async () => {},
      createServer: async () => server,
      exchangeCode: async () => ({ access_token: "a", token_type: "Bearer" }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/state mismatch/i);
    expect(storage.getTokens("svc")).toBeNull();
  });

  it("returns an error when token exchange fails (no tokens stored)", async () => {
    const callback: CallbackResult = { code: "c", state: "" };
    const { server } = mockServer(callback);
    const result = await runMcpOAuthFlow({
      serverId: "svc",
      authorizationEndpoint: "https://idp/authorize",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      openBrowser: async (url) => {
        callback.state = new URL(url).searchParams.get("state") ?? "";
      },
      createServer: async () => server,
      exchangeCode: async () => {
        throw new Error("idp rejected code");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/token exchange failed.*idp rejected code/);
    expect(storage.getTokens("svc")).toBeNull();
  });

  it("times out when the callback never arrives", async () => {
    // A server whose waitForCallback never resolves within the timeout.
    const server: LoopbackServerLike = {
      async start() {
        return { port: 1, redirectUri: "http://127.0.0.1:1/callback" };
      },
      waitForCallback() {
        // never resolves
        return new Promise<CallbackResult>(() => {});
      },
      close() {},
    };
    const result = await runMcpOAuthFlow({
      serverId: "svc",
      authorizationEndpoint: "https://idp/authorize",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      openBrowser: async () => {},
      createServer: async () => server,
      exchangeCode: async () => ({ access_token: "a", token_type: "Bearer" }),
      timeoutMs: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });

  it("closes the loopback server in all outcomes (finally)", async () => {
    let closed = false;
    const callback: CallbackResult = { code: "c", state: "" };
    const server: LoopbackServerLike = {
      async start() {
        return { port: 1, redirectUri: "http://127.0.0.1:1/callback" };
      },
      async waitForCallback() {
        return callback;
      },
      close() {
        closed = true;
      },
    };
    await runMcpOAuthFlow({
      serverId: "svc",
      authorizationEndpoint: "https://idp/authorize",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      openBrowser: async (url) => {
        callback.state = new URL(url).searchParams.get("state") ?? "";
      },
      createServer: async () => server,
      exchangeCode: async () => ({ access_token: "a", token_type: "Bearer" }),
    });
    expect(closed).toBe(true);
  });
});

describe("[unit] refreshMcpToken — refresh + storage roundtrip", () => {
  it("refreshes the access token and persists the new pair", async () => {
    storage.setTokens("svc", {
      accessToken: "old-AT",
      refreshToken: "RT",
      expiresAt: 1, // expired
      tokenType: "Bearer",
    });
    let refreshCalledWith: Record<string, unknown> = {};
    const updated = await refreshMcpToken({
      serverId: "svc",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      refreshToken: async (opts) => {
        refreshCalledWith = opts;
        return {
          access_token: "new-AT",
          refresh_token: "new-RT",
          expires_in: 3600,
          token_type: "Bearer",
        };
      },
    });
    expect(updated?.accessToken).toBe("new-AT");
    expect(updated?.refreshToken).toBe("new-RT");
    expect(refreshCalledWith["refreshToken"]).toBe("RT");
    // Persisted to storage.
    const stored = storage.getTokens("svc");
    expect(stored?.accessToken).toBe("new-AT");
    expect(stored?.refreshToken).toBe("new-RT");
  });

  it("keeps the old refresh_token when the IdP does not rotate it", async () => {
    storage.setTokens("svc", {
      accessToken: "old", refreshToken: "RT", expiresAt: 1, tokenType: "Bearer",
    });
    const updated = await refreshMcpToken({
      serverId: "svc",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      refreshToken: async () => ({ access_token: "new", token_type: "Bearer" }),
    });
    expect(updated?.refreshToken).toBe("RT");
  });

  it("returns null when there is no refresh token stored", async () => {
    storage.setTokens("svc", {
      accessToken: "a", refreshToken: undefined, expiresAt: 1, tokenType: "Bearer",
    });
    const updated = await refreshMcpToken({
      serverId: "svc",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      refreshToken: async () => ({ access_token: "x", token_type: "Bearer" }),
    });
    expect(updated).toBeNull();
  });

  it("returns null when no tokens are stored at all", async () => {
    const updated = await refreshMcpToken({
      serverId: "ghost",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      refreshToken: async () => ({ access_token: "x", token_type: "Bearer" }),
    });
    expect(updated).toBeNull();
  });

  it("returns null when the refresh call fails (keeps stale token on disk)", async () => {
    storage.setTokens("svc", {
      accessToken: "stale", refreshToken: "RT", expiresAt: 1, tokenType: "Bearer",
    });
    const updated = await refreshMcpToken({
      serverId: "svc",
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      storage,
      refreshToken: async () => {
        throw new Error("idp 400");
      },
    });
    expect(updated).toBeNull();
    // The stale token is left intact on disk.
    expect(storage.getTokens("svc")?.accessToken).toBe("stale");
  });
});

describe("[unit] getValidMcpTokens — expiry-aware resolution + refresh", () => {
  it("returns stored tokens when not expired (within skew)", async () => {
    storage.setTokens("svc", {
      accessToken: "AT", refreshToken: "RT", expiresAt: 100_000, tokenType: "Bearer",
    });
    const t = await getValidMcpTokens("svc", storage, {
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      now: 1000,
      refreshToken: async () => ({ access_token: "should-not-happen", token_type: "Bearer" }),
    });
    expect(t?.accessToken).toBe("AT");
  });

  it("refreshes when the token is within the skew window", async () => {
    storage.setTokens("svc", {
      accessToken: "AT", refreshToken: "RT", expiresAt: 10_000, tokenType: "Bearer",
    });
    let refreshCalled = false;
    const t = await getValidMcpTokens("svc", storage, {
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      now: 9_500, // within 60s skew of expiry (10_000)
      skewSeconds: 60,
      refreshToken: async () => {
        refreshCalled = true;
        return { access_token: "fresh", refresh_token: "RT2", expires_in: 3600, token_type: "Bearer" };
      },
    });
    expect(refreshCalled).toBe(true);
    expect(t?.accessToken).toBe("fresh");
  });

  it("returns null when no tokens are stored", async () => {
    const t = await getValidMcpTokens("ghost", storage, {
      tokenEndpoint: "https://idp/token", clientId: "c", now: 0,
    });
    expect(t).toBeNull();
  });

  it("returns tokens with no expiry as-is (valid forever)", async () => {
    storage.setTokens("svc", {
      accessToken: "AT", refreshToken: "RT", expiresAt: null, tokenType: "Bearer",
    });
    const t = await getValidMcpTokens("svc", storage, {
      tokenEndpoint: "https://idp/token", clientId: "c", now: 999_999_999,
    });
    expect(t?.accessToken).toBe("AT");
  });

  it("falls back to the stale token when refresh fails", async () => {
    storage.setTokens("svc", {
      accessToken: "stale", refreshToken: "RT", expiresAt: 1, tokenType: "Bearer",
    });
    const t = await getValidMcpTokens("svc", storage, {
      tokenEndpoint: "https://idp/token",
      clientId: "c",
      now: 5000,
      refreshToken: async () => {
        throw new Error("nope");
      },
    });
    expect(t?.accessToken).toBe("stale");
  });
});

describe("[smoke] mcp-oauth-flow module", () => {
  it("exports the full flow API", async () => {
    const m = await import("./mcp-oauth-flow.js");
    expect(typeof m.runMcpOAuthFlow).toBe("function");
    expect(typeof m.refreshMcpToken).toBe("function");
    expect(typeof m.buildAuthHeader).toBe("function");
    expect(typeof m.getValidMcpTokens).toBe("function");
  });
});
