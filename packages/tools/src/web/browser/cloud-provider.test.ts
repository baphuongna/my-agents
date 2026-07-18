/**
 * cloud-provider tests — BrowserbaseProvider + BrowserUseProvider.
 *
 * Tests cover:
 *   - isAvailable (env present/absent)
 *   - createSession success
 *   - Browserbase 402-fallback sequence (drop keepAlive → drop proxies)
 *   - closeSession
 *   - emergencyCleanup (never throws)
 *
 * All fetch calls are mocked — no real network.
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  BrowserbaseProvider,
  BrowserUseProvider,
  isAnyCloudProviderAvailable,
  getAvailableCloudProvider,
  UUID_V4_REGEX,
} from "./cloud-provider.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Type for our fetch mock — allows inspecting call history. */
type FetchMock = ReturnType<typeof vi.fn> & {
  mockCalls: Array<{ url: string; init: RequestInit }>;
};

/** Create a JSON Response object for mocking. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Set env vars on process.env and return a cleanup function. */
function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

// ─── BrowserbaseProvider ───────────────────────────────────────────────────

describe("BrowserbaseProvider — isAvailable", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSERBASE_API_KEY: undefined,
      BROWSERBASE_PROJECT_ID: undefined,
    });
  });

  afterEach(() => cleanup());

  it("returns false when both env vars are absent", () => {
    const provider = new BrowserbaseProvider();
    expect(provider.isAvailable()).toBe(false);
  });

  it("returns false when only API key is set", () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: undefined,
    });
    const provider = new BrowserbaseProvider();
    expect(provider.isAvailable()).toBe(false);
  });

  it("returns false when only project ID is set", () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: undefined,
      BROWSERBASE_PROJECT_ID: "proj-456",
    });
    const provider = new BrowserbaseProvider();
    expect(provider.isAvailable()).toBe(false);
  });

  it("returns true when both env vars are set", () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: "proj-456",
    });
    const provider = new BrowserbaseProvider();
    expect(provider.isAvailable()).toBe(true);
  });
});

describe("BrowserbaseProvider — createSession success", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: "proj-456",
      BROWSERBASE_BASE_URL: "https://api.browserbase.com",
      BROWSERBASE_PROXIES: "true",
      BROWSERBASE_ADVANCED_STEALTH: "false",
      BROWSERBASE_KEEP_ALIVE: "true",
      BROWSERBASE_SESSION_TIMEOUT: undefined,
    });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a session and returns CloudSessionMeta", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "sess_abc123", connectUrl: "wss://connect.example.com" }),
    );

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-001");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.bbSessionId).toBe("sess_abc123");
      expect(result.session.cdpUrl).toBe("wss://connect.example.com");
      expect(result.session.sessionName).toMatch(/^hermes_task-001_[0-9a-f]{8}$/);
      // basic_stealth is always true; keep_alive and proxies should be true
      // (no 402 fallback occurred).
      expect(result.session.features["basic_stealth"]).toBe(true);
      expect(result.session.features["keep_alive"]).toBe(true);
      expect(result.session.features["proxies"]).toBe(true);
      expect(result.session.features["advanced_stealth"]).toBe(false);
      expect(result.session.features["custom_timeout"]).toBe(false);
    }

    // Verify the request was correct.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.browserbase.com/v1/sessions");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["projectId"]).toBe("proj-456");
    expect(body["keepAlive"]).toBe(true);
    expect(body["proxies"]).toBe(true);
    // advancedStealth is false → no browserSettings.
    expect(body["browserSettings"]).toBeUndefined();
    // No timeout env var → no timeout field.
    expect(body["timeout"]).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers["X-BB-API-Key"]).toBe("bb-key-123");
  });

  it("includes browserSettings when advanced stealth is enabled", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: "proj-456",
      BROWSERBASE_ADVANCED_STEALTH: "true",
      BROWSERBASE_KEEP_ALIVE: "true",
      BROWSERBASE_PROXIES: "true",
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "sess_stealth", connectUrl: "wss://stealth.example.com" }),
    );

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-stealth");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.features["advanced_stealth"]).toBe(true);
    }

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body["browserSettings"]).toEqual({ advancedStealth: true });
  });

  it("includes timeout when BROWSERBASE_SESSION_TIMEOUT is valid", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: "proj-456",
      BROWSERBASE_SESSION_TIMEOUT: "600",
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "sess_to", connectUrl: "wss://to.example.com" }),
    );

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-to");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.features["custom_timeout"]).toBe(true);
    }
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body["timeout"]).toBe(600);
  });

  it("returns error when API key is not set", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: undefined,
      BROWSERBASE_PROJECT_ID: "proj-456",
    });

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-nokey");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("BROWSERBASE_API_KEY");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns error on non-200 response (non-402)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: "Internal server error" }),
    );

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-500");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("500");
    }
  });

  it("returns error when response is missing id or connectUrl", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "sess_x" }));

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-missing");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("connectUrl");
    }
  });

  it("returns error on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-net");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("network error");
    }
  });
});

// ─── Browserbase 402-Fallback ───────────────────────────────────────────────

describe("BrowserbaseProvider — 402-fallback sequence", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: "proj-456",
      BROWSERBASE_KEEP_ALIVE: "true",
      BROWSERBASE_PROXIES: "true",
      BROWSERBASE_ADVANCED_STEALTH: "false",
      BROWSERBASE_SESSION_TIMEOUT: undefined,
    });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("drops keepAlive on first 402, then succeeds", async () => {
    // Call 1: 402 (keepAlive present) → drop keepAlive → retry.
    // Call 2: 200 (success without keepAlive).
    fetchMock
      .mockResolvedValueOnce(jsonResponse(402, { error: "Payment Required" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { id: "sess_402a", connectUrl: "wss://fallback.example.com" }),
      );

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-402-keepalive");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.bbSessionId).toBe("sess_402a");
      // keep_alive should be false (fallback occurred).
      expect(result.session.features["keep_alive"]).toBe(false);
      // proxies should still be true (not yet dropped).
      expect(result.session.features["proxies"]).toBe(true);
    }

    // Verify two calls were made.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call: should have keepAlive.
    const body1 = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body1["keepAlive"]).toBe(true);
    expect(body1["proxies"]).toBe(true);

    // Second call: keepAlive should be removed, proxies still present.
    const body2 = JSON.parse(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body2["keepAlive"]).toBeUndefined();
    expect(body2["proxies"]).toBe(true);
  });

  it("drops keepAlive then proxies on consecutive 402s, then succeeds", async () => {
    // Call 1: 402 (full config) → drop keepAlive.
    // Call 2: 402 (no keepAlive) → drop proxies.
    // Call 3: 200 (bare config: projectId only).
    fetchMock
      .mockResolvedValueOnce(jsonResponse(402, { error: "Payment Required" }))
      .mockResolvedValueOnce(jsonResponse(402, { error: "Payment Required" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { id: "sess_402b", connectUrl: "wss://bare.example.com" }),
      );

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-402-both");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.bbSessionId).toBe("sess_402b");
      expect(result.session.features["keep_alive"]).toBe(false);
      expect(result.session.features["proxies"]).toBe(false);
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Third call: neither keepAlive nor proxies.
    const body3 = JSON.parse(
      (fetchMock.mock.calls[2]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body3["keepAlive"]).toBeUndefined();
    expect(body3["proxies"]).toBeUndefined();
    expect(body3["projectId"]).toBe("proj-456");
  });

  it("returns error when 402 persists after both fallbacks", async () => {
    // All three calls return 402.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(402, { error: "Payment Required" }))
      .mockResolvedValueOnce(jsonResponse(402, { error: "Payment Required" }))
      .mockResolvedValueOnce(jsonResponse(402, { error: "Still no funds" }));

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-402-fail");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("402");
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not attempt keepAlive fallback when keepAlive is already disabled", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: "proj-456",
      BROWSERBASE_KEEP_ALIVE: "false",
      BROWSERBASE_PROXIES: "true",
    });

    // Call 1: 402 → should skip keepAlive fallback (already disabled) → drop proxies.
    // Call 2: 200.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(402, { error: "Payment Required" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { id: "sess_noka", connectUrl: "wss://noka.example.com" }),
      );

    const provider = new BrowserbaseProvider();
    const result = await provider.createSession("task-noka");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // keep_alive was never enabled, so it stays false.
      expect(result.session.features["keep_alive"]).toBe(false);
      // proxies were dropped via fallback.
      expect(result.session.features["proxies"]).toBe(false);
    }
    // Only 2 calls: first 402 (no keepAlive in config), second 200 (no proxies).
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call should NOT have keepAlive (disabled from start).
    const body1 = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body1["keepAlive"]).toBeUndefined();
    expect(body1["proxies"]).toBe(true);
  });
});

// ─── Browserbase closeSession + emergencyCleanup ───────────────────────────

describe("BrowserbaseProvider — closeSession", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: "proj-456",
    });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns true on HTTP 200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const provider = new BrowserbaseProvider();
    const result = await provider.closeSession("sess_close1");

    expect(result).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.browserbase.com/v1/sessions/sess_close1");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["projectId"]).toBe("proj-456");
    expect(body["status"]).toBe("REQUEST_RELEASE");
  });

  it("returns true on HTTP 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const provider = new BrowserbaseProvider();
    const result = await provider.closeSession("sess_204");
    expect(result).toBe(true);
  });

  it("returns false on HTTP 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "Not found" }));

    const provider = new BrowserbaseProvider();
    const result = await provider.closeSession("sess_404");
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const provider = new BrowserbaseProvider();
    const result = await provider.closeSession("sess_net");
    expect(result).toBe(false);
  });

  it("returns false when API key is not set", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: undefined,
      BROWSERBASE_PROJECT_ID: "proj-456",
    });

    const provider = new BrowserbaseProvider();
    const result = await provider.closeSession("sess_nokey");
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BrowserbaseProvider — emergencyCleanup", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key-123",
      BROWSERBASE_PROJECT_ID: "proj-456",
    });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires a fetch and does not throw", () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const provider = new BrowserbaseProvider();
    // emergencyCleanup is synchronous (fire-and-forget) — should not throw.
    expect(() => provider.emergencyCleanup("sess_emerg")).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not throw when fetch rejects", () => {
    fetchMock.mockRejectedValueOnce(new Error("Network down"));

    const provider = new BrowserbaseProvider();
    expect(() => provider.emergencyCleanup("sess_emerg_fail")).not.toThrow();
  });

  it("does nothing when API key is not set", () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: undefined,
      BROWSERBASE_PROJECT_ID: undefined,
    });

    const provider = new BrowserbaseProvider();
    expect(() => provider.emergencyCleanup("sess_no_creds")).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when sessionId is empty", () => {
    const provider = new BrowserbaseProvider();
    expect(() => provider.emergencyCleanup("")).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── BrowserUseProvider ─────────────────────────────────────────────────────

describe("BrowserUseProvider — isAvailable", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setEnv({ BROWSER_USE_API_KEY: undefined });
  });

  afterEach(() => cleanup());

  it("returns false when env var is absent", () => {
    const provider = new BrowserUseProvider();
    expect(provider.isAvailable()).toBe(false);
  });

  it("returns true when env var is set", () => {
    cleanup();
    cleanup = setEnv({ BROWSER_USE_API_KEY: "bu-key-789" });
    const provider = new BrowserUseProvider();
    expect(provider.isAvailable()).toBe(true);
  });
});

describe("BrowserUseProvider — createSession success", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({ BROWSER_USE_API_KEY: "bu-key-789" });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a session and returns CloudSessionMeta with cdpUrl", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_xyz", cdpUrl: "ws://cdp.example.com" }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-bu1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.bbSessionId).toBe("browser_xyz");
      expect(result.session.cdpUrl).toBe("ws://cdp.example.com");
      expect(result.session.sessionName).toMatch(/^hermes_task-bu1_[0-9a-f]{8}$/);
      expect(result.session.features["browser_use"]).toBe(true);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.browser-use.com/api/v3/browsers");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Browser-Use-API-Key"]).toBe("bu-key-789");
    // Direct mode: empty JSON body.
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual([]);
  });

  it("falls back to connectUrl when cdpUrl is absent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_fb", connectUrl: "ws://connect.example.com" }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-bu2");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.cdpUrl).toBe("ws://connect.example.com");
    }
  });

  it("returns empty cdpUrl when neither cdpUrl nor connectUrl is present", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "browser_nourl" }));

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-bu3");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.cdpUrl).toBe("");
    }
  });

  it("returns error when API key is not set", async () => {
    cleanup();
    cleanup = setEnv({ BROWSER_USE_API_KEY: undefined });

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-nobu");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("BROWSER_USE_API_KEY");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns error on non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: "Forbidden" }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-403");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("403");
    }
  });

  it("returns error when response is missing id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { cdpUrl: "ws://no-id.example.com" }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-noid");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("id");
    }
  });

  it("returns error on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-bu-net");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("network error");
    }
  });
});

describe("BrowserUseProvider — closeSession", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({ BROWSER_USE_API_KEY: "bu-key-789" });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns true on HTTP 200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_close1");

    expect(result).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.browser-use.com/api/v3/browsers/browser_close1");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["action"]).toBe("stop");
  });

  it("returns true on HTTP 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_204");
    expect(result).toBe(true);
  });

  it("returns false on HTTP 500", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "Server error" }));

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_500");
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_net");
    expect(result).toBe(false);
  });

  it("returns false when API key is not set", async () => {
    cleanup();
    cleanup = setEnv({ BROWSER_USE_API_KEY: undefined });

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_nokey");
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BrowserUseProvider — emergencyCleanup", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({ BROWSER_USE_API_KEY: "bu-key-789" });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires a fetch and does not throw", () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const provider = new BrowserUseProvider();
    expect(() => provider.emergencyCleanup("browser_emerg")).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.browser-use.com/api/v3/browsers/browser_emerg");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
  });

  it("does not throw when fetch rejects", () => {
    fetchMock.mockRejectedValueOnce(new Error("Network down"));

    const provider = new BrowserUseProvider();
    expect(() => provider.emergencyCleanup("browser_emerg_fail")).not.toThrow();
  });

  it("does nothing when API key is not set", () => {
    cleanup();
    cleanup = setEnv({ BROWSER_USE_API_KEY: undefined });

    const provider = new BrowserUseProvider();
    expect(() => provider.emergencyCleanup("browser_no_creds")).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when sessionId is empty", () => {
    const provider = new BrowserUseProvider();
    expect(() => provider.emergencyCleanup("")).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── BrowserUseProvider — managed-gateway mode (dual-auth) ──────────────────

/**
 * Phase 4 wiring fix (bug #4): Browser Use managed-gateway dual-auth.
 *
 * Mirrors hermes `browser_use/provider.py`:
 *   - Direct mode: `BROWSER_USE_API_KEY` set alone → `X-Browser-Use-API-Key`
 *     header, POST to `api.browser-use.com/api/v3/browsers`.
 *   - Managed-gateway mode: `BROWSER_USE_GATEWAY_URL` set + token (OAuth or
 *     API key fallback) → `Authorization: Bearer <token>` + per-session
 *     `X-Idempotency-Key` (uuidv4) + `externalCallId` in body.
 *
 * The "fallback" preservation test ensures that setting `BROWSER_USE_API_KEY`
 * WITHOUT a gateway URL keeps the existing direct-mode behavior (the regression
 * guard for backwards compatibility).
 */
describe("BrowserUseProvider — managed-gateway isAvailable", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: undefined,
      BROWSER_USE_OAUTH_TOKEN: undefined,
      BROWSER_USE_EXTERNAL_CALL_ID: undefined,
    });
  });

  afterEach(() => cleanup());

  it("returns true in direct mode (API key alone, no gateway)", () => {
    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: "bu-key",
      BROWSER_USE_GATEWAY_URL: undefined,
      BROWSER_USE_OAUTH_TOKEN: undefined,
    });
    expect(new BrowserUseProvider().isAvailable()).toBe(true);
  });

  it("returns true in managed mode (gateway + OAuth token, no API key)", () => {
    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: "oauth-tok-xyz",
    });
    expect(new BrowserUseProvider().isAvailable()).toBe(true);
  });

  it("returns true in managed mode (gateway + API key fallback as Bearer)", () => {
    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: "bu-key",
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: undefined,
    });
    expect(new BrowserUseProvider().isAvailable()).toBe(true);
  });

  it("returns false when only gateway URL is set (no token)", () => {
    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: undefined,
    });
    expect(new BrowserUseProvider().isAvailable()).toBe(false);
  });

  it("returns false when nothing is configured", () => {
    expect(new BrowserUseProvider().isAvailable()).toBe(false);
  });
});

describe("BrowserUseProvider — managed-gateway createSession", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: "oauth-tok-abc123",
      BROWSER_USE_EXTERNAL_CALL_ID: undefined,
    });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("routes to <gateway>/api/v3/browsers with Authorization: Bearer and X-Idempotency-Key (uuidv4)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { id: "browser_mg1", cdpUrl: "ws://mg1.example.com" }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-mg");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.bbSessionId).toBe("browser_mg1");
      expect(result.session.cdpUrl).toBe("ws://mg1.example.com");
      expect(result.session.features["browser_use"]).toBe(true);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = call?.[0];
    const init = call?.[1] as RequestInit;

    // Endpoint: gateway (NOT api.browser-use.com).
    expect(url).toBe("https://gateway.example.com/api/v3/browsers");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    // Critical: managed mode uses Authorization: Bearer, NOT
    // X-Browser-Use-API-Key (which would leak the direct-mode key to the
    // gateway and be rejected).
    expect(headers["Authorization"]).toBe("Bearer oauth-tok-abc123");
    expect(headers["X-Browser-Use-API-Key"]).toBeUndefined();
    // Per-session idempotency key — uuidv4 shape.
    expect(headers["X-Idempotency-Key"]).toMatch(UUID_V4_REGEX);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("propagates externalCallId from args into the request body when supplied", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_mg_ext1", cdpUrl: "ws://mg.example.com" }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-mg", "caller-12345");

    expect(result.ok).toBe(true);

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body["externalCallId"]).toBe("caller-12345");
  });

  it("falls back to BROWSER_USE_EXTERNAL_CALL_ID env when args.externalCallId is omitted", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_mg_ext2", cdpUrl: "ws://mg.example.com" }),
    );

    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: "oauth-tok-env",
      BROWSER_USE_EXTERNAL_CALL_ID: "env-caller-9",
    });

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-mg-env");

    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body["externalCallId"]).toBe("env-caller-9");
  });

  it("prefers args.externalCallId over env when both are supplied", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_mg_ext3", cdpUrl: "ws://mg.example.com" }),
    );

    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: "oauth-tok-pref",
      BROWSER_USE_EXTERNAL_CALL_ID: "env-caller-pref",
    });

    const provider = new BrowserUseProvider();
    await provider.createSession("task-mg-pref", "args-caller-pref");

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body["externalCallId"]).toBe("args-caller-pref");
  });

  it("omits externalCallId field entirely when neither args nor env is set", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_mg_noext", cdpUrl: "ws://mg.example.com" }),
    );

    const provider = new BrowserUseProvider();
    await provider.createSession("task-mg-noext");

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("externalCallId");
  });

  it("falls back to API key as Bearer when gateway is set but OAuth token is absent", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: "bu-fallback-key",
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: undefined,
      BROWSER_USE_EXTERNAL_CALL_ID: undefined,
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_mg_apikey", cdpUrl: "ws://mg.example.com" }),
    );

    const provider = new BrowserUseProvider();
    await provider.createSession("task-mg-apikey");

    const call = fetchMock.mock.calls[0];
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer bu-fallback-key");
    // Crucially: NO X-Browser-Use-API-Key header in managed mode.
    expect(headers["X-Browser-Use-API-Key"]).toBeUndefined();
  });

  it("returns error when gateway URL is set but no token is present", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: undefined,
      BROWSER_USE_EXTERNAL_CALL_ID: undefined,
    });

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-mg-notok");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("BROWSER_USE_API_KEY");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the gateway's x-external-call-id response header in CloudSessionMeta", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "browser_mg_echo" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-external-call-id": "gw-correlation-99",
        },
      }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-mg-echo", "my-call-id");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.externalCallId).toBe("gw-correlation-99");
    }
  });

  it("returns error on managed-mode 4xx without token leak", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: "Forbidden" }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-mg-403");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("403");
      // Token must NEVER appear in error strings.
      expect(result.error).not.toContain("oauth-tok-abc123");
    }
  });

  it("returns error on managed-mode network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-mg-net");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("network error");
    }
  });
});

describe("BrowserUseProvider — managed-gateway closeSession + emergencyCleanup", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: "oauth-close-tok",
    });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closeSession PATCHes the gateway URL with Authorization: Bearer", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_mg_close");

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    // Critical: routed to gateway, NOT api.browser-use.com.
    expect(call?.[0]).toBe("https://gateway.example.com/api/v3/browsers/browser_mg_close");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer oauth-close-tok");
    expect(headers["X-Browser-Use-API-Key"]).toBeUndefined();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["action"]).toBe("stop");
  });

  it("closeSession returns false on HTTP 500 from gateway", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "Server error" }));

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_mg_500");
    expect(result).toBe(false);
  });

  it("closeSession returns false on gateway network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_mg_net");
    expect(result).toBe(false);
  });

  it("emergencyCleanup fires a fetch to the gateway URL with Bearer auth", () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const provider = new BrowserUseProvider();
    expect(() => provider.emergencyCleanup("browser_mg_emerg")).not.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    // Critical: routed to gateway, NOT api.browser-use.com.
    expect(call?.[0]).toBe("https://gateway.example.com/api/v3/browsers/browser_mg_emerg");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer oauth-close-tok");
    expect(headers["X-Browser-Use-API-Key"]).toBeUndefined();
  });

  it("emergencyCleanup does not throw on gateway network failure", () => {
    fetchMock.mockRejectedValueOnce(new Error("Network down"));

    const provider = new BrowserUseProvider();
    expect(() => provider.emergencyCleanup("browser_mg_emerg_fail")).not.toThrow();
  });

  it("closeSession returns false when gateway URL is set but no token is present", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com",
      BROWSER_USE_OAUTH_TOKEN: undefined,
    });

    const provider = new BrowserUseProvider();
    const result = await provider.closeSession("browser_mg_nocreds");
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BrowserUseProvider — fallback preserves direct-mode behavior", () => {
  let cleanup: () => void;
  let fetchMock: FetchMock;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSER_USE_API_KEY: "bu-fallback-key",
      BROWSER_USE_GATEWAY_URL: undefined,
      BROWSER_USE_OAUTH_TOKEN: undefined,
    });
    fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("direct mode is preserved when API key is set and gateway is NOT set", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_fb", cdpUrl: "ws://fb.example.com" }),
    );

    const provider = new BrowserUseProvider();
    const result = await provider.createSession("task-fallback");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];

    // Critical: still hits api.browser-use.com (NOT gateway).
    expect(call?.[0]).toBe("https://api.browser-use.com/api/v3/browsers");
    const init = call?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Browser-Use-API-Key"]).toBe("bu-fallback-key");
    expect(headers["Authorization"]).toBeUndefined();
    // No idempotency key in direct mode.
    expect(headers["X-Idempotency-Key"]).toBeUndefined();
    // Empty body in direct mode.
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual([]);
  });

  it("trailing slashes on BROWSER_USE_GATEWAY_URL are normalized away", async () => {
    cleanup();
    cleanup = setEnv({
      BROWSER_USE_API_KEY: undefined,
      BROWSER_USE_GATEWAY_URL: "https://gateway.example.com///",
      BROWSER_USE_OAUTH_TOKEN: "oauth-slash",
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: "browser_slash", cdpUrl: "ws://slash.example.com" }),
    );

    const provider = new BrowserUseProvider();
    await provider.createSession("task-slash");

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://gateway.example.com/api/v3/browsers");
  });
});

// ─── Factory / registry helpers ─────────────────────────────────────────────

describe("cloud-provider — factory helpers", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setEnv({
      BROWSERBASE_API_KEY: undefined,
      BROWSERBASE_PROJECT_ID: undefined,
      BROWSER_USE_API_KEY: undefined,
    });
  });

  afterEach(() => cleanup());

  it("isAnyCloudProviderAvailable returns false when no providers configured", () => {
    expect(isAnyCloudProviderAvailable()).toBe(false);
  });

  it("isAnyCloudProviderAvailable returns true when browserbase is configured", () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key",
      BROWSERBASE_PROJECT_ID: "proj",
    });
    expect(isAnyCloudProviderAvailable()).toBe(true);
  });

  it("isAnyCloudProviderAvailable returns true when browser-use is configured", () => {
    cleanup();
    cleanup = setEnv({ BROWSER_USE_API_KEY: "bu-key" });
    expect(isAnyCloudProviderAvailable()).toBe(true);
  });

  it("getAvailableCloudProvider returns browserbase when both configured (priority)", () => {
    cleanup();
    cleanup = setEnv({
      BROWSERBASE_API_KEY: "bb-key",
      BROWSERBASE_PROJECT_ID: "proj",
      BROWSER_USE_API_KEY: "bu-key",
    });
    const provider = getAvailableCloudProvider();
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("browserbase");
  });

  it("getAvailableCloudProvider returns null when none configured", () => {
    expect(getAvailableCloudProvider()).toBeNull();
  });
});