/**
 * camofox-client tests — REST client for the Camofox anti-detect browser server.
 *
 * Tests use vi.mock to replace global fetch with a controllable mock.
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock fetch ─────────────────────────────────────────────────────────────

type MockResponse = {
  status: number;
  json?: unknown;
  text?: string;
  arrayBuffer?: ArrayBuffer;
  ok?: boolean;
};

function makeMockFetch(resp: MockResponse | (() => MockResponse)) {
  const calls: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }[] = [];

  const mockFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? String(init.body) : undefined,
    });

    const r = typeof resp === "function" ? resp() : resp;
    const status = r.status;
    const ok = r.ok ?? (status >= 200 && status < 300);

    return {
      status,
      ok,
      json: async () => r.json ?? {},
      text: async () => r.text ?? "",
      arrayBuffer: async () => r.arrayBuffer ?? new ArrayBuffer(0),
    } as Response;
  });

  return { mockFn, calls };
}

// ─── Imports (after mock setup) ─────────────────────────────────────────────

import {
  isCamofoxAvailable,
  resetCamofoxHealthCache,
  createSession,
  getSession,
  navigate,
  snapshot,
  click,
  type as typeText,
  scroll,
  back,
  press,
  screenshot,
  closeSession,
  type CamofoxConfig,
} from "./camofox-client.js";

const DEFAULT_CONFIG: CamofoxConfig = {
  baseUrl: "http://localhost:9377",
};

const AUTH_CONFIG: CamofoxConfig = {
  baseUrl: "http://localhost:9377",
  apiKey: "test-secret-key",
};

// ─── Setup / teardown ──────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;
let fetchMock: ReturnType<typeof makeMockFetch>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  resetCamofoxHealthCache();
  fetchMock = makeMockFetch({ status: 200, json: {} });
  globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetCamofoxHealthCache();
  vi.restoreAllMocks();
});

// ─── isCamofoxAvailable ─────────────────────────────────────────────────────

describe("camofox-client — isCamofoxAvailable", () => {
  it("returns true when GET /health responds 200", async () => {
    fetchMock = makeMockFetch({ status: 200, json: { vncPort: 12345 } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const result = await isCamofoxAvailable(DEFAULT_CONFIG);
    expect(result).toBe(true);
    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0]?.url).toBe("http://localhost:9377/health");
    expect(fetchMock.calls[0]?.method).toBe("GET");
  });

  it("returns false when GET /health responds non-200", async () => {
    fetchMock = makeMockFetch({ status: 503 });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const result = await isCamofoxAvailable(DEFAULT_CONFIG);
    expect(result).toBe(false);
  });

  it("returns false when fetch throws (timeout/network error)", async () => {
    const mockFn = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    globalThis.fetch = mockFn as unknown as typeof globalThis.fetch;

    const result = await isCamofoxAvailable(DEFAULT_CONFIG);
    expect(result).toBe(false);
  });

  it("returns false when baseUrl is missing and CAMOFOX_URL env is unset", async () => {
    delete process.env.CAMOFOX_URL;
    const result = await isCamofoxAvailable();
    expect(result).toBe(false);
  });

  it("uses CAMOFOX_URL env var when config.baseUrl is not provided", async () => {
    process.env.CAMOFOX_URL = "http://localhost:9999";
    fetchMock = makeMockFetch({ status: 200 });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const result = await isCamofoxAvailable();
    expect(result).toBe(true);
    expect(fetchMock.calls[0]?.url).toBe("http://localhost:9999/health");
    delete process.env.CAMOFOX_URL;
  });

  it("caches the result per-process (only one fetch on second call)", async () => {
    fetchMock = makeMockFetch({ status: 200 });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    await isCamofoxAvailable(DEFAULT_CONFIG);
    await isCamofoxAvailable(DEFAULT_CONFIG);
    expect(fetchMock.calls).toHaveLength(1);
  });

  it("re-probes when forceRecheck is true", async () => {
    fetchMock = makeMockFetch({ status: 200 });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    await isCamofoxAvailable(DEFAULT_CONFIG);
    await isCamofoxAvailable(DEFAULT_CONFIG, true);
    expect(fetchMock.calls).toHaveLength(2);
  });

  it("includes Authorization header when apiKey is set", async () => {
    fetchMock = makeMockFetch({ status: 200 });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    await isCamofoxAvailable(AUTH_CONFIG);
    expect(fetchMock.calls[0]?.headers.Authorization).toBe("Bearer test-secret-key");
  });

  it("includes Authorization header when CAMOFOX_API_KEY env var is set", async () => {
    process.env.CAMOFOX_API_KEY = "env-key-123";
    fetchMock = makeMockFetch({ status: 200 });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    await isCamofoxAvailable(DEFAULT_CONFIG);
    expect(fetchMock.calls[0]?.headers.Authorization).toBe("Bearer env-key-123");
    delete process.env.CAMOFOX_API_KEY;
  });

  it("does not include Authorization header when no apiKey", async () => {
    fetchMock = makeMockFetch({ status: 200 });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    await isCamofoxAvailable(DEFAULT_CONFIG);
    expect(fetchMock.calls[0]?.headers.Authorization).toBeUndefined();
  });
});

// ─── createSession ──────────────────────────────────────────────────────────

describe("camofox-client — createSession", () => {
  it("creates a session and tab via POST /tabs", async () => {
    fetchMock = makeMockFetch({ status: 200, json: { tabId: "tab-abc-123" } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const result = await createSession("task-001", DEFAULT_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.userId).toMatch(/^hermes_[a-f0-9]+$/);
      expect(result.data.sessionKey).toBe("task_task-001");
      expect(result.data.tabId).toBe("tab-abc-123");
    }

    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0]?.method).toBe("POST");
    expect(fetchMock.calls[0]?.url).toBe("http://localhost:9377/tabs");

    const body = JSON.parse(fetchMock.calls[0]?.body ?? "{}");
    expect(body.url).toBeUndefined(); // about:blank is omitted (server defaults)
    expect(body.listItemId).toBe("task_task-001");
  });

  it("returns error when POST /tabs fails", async () => {
    fetchMock = makeMockFetch({ status: 500, text: "server error" });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const result = await createSession("task-002", DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("500");
    }
  });

  it("returns error when response missing tabId", async () => {
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const result = await createSession("task-003", DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("tabId");
    }
  });

  it("stores session in memory (getSession retrieves it)", async () => {
    fetchMock = makeMockFetch({ status: 200, json: { tabId: "tab-xyz" } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    await createSession("task-004", DEFAULT_CONFIG);
    const session = getSession("task-004");
    expect(session).toBeDefined();
    expect(session?.tabId).toBe("tab-xyz");
  });

  it("includes auth header when apiKey is set", async () => {
    fetchMock = makeMockFetch({ status: 200, json: { tabId: "tab-auth" } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    await createSession("task-005", AUTH_CONFIG);
    expect(fetchMock.calls[0]?.headers.Authorization).toBe("Bearer test-secret-key");
  });
});

// ─── navigate ─────────────────────────────────────────────────────────────────

describe("camofox-client — navigate", () => {
  it("navigates successfully and auto-snapshots", async () => {
    // First call: POST /navigate → 200 with url + title.
    // Second call: GET /snapshot → 200 with snapshot + refsCount.
    let callIdx = 0;
    const mockFn = vi.fn(async (url: string) => {
      callIdx++;
      if (callIdx === 1) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ ok: true, url: "https://example.com", title: "Example" }),
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response;
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ snapshot: "button @e1\ntext @e2", refsCount: 2 }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response;
    });
    globalThis.fetch = mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await navigate("https://example.com", session, DEFAULT_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.url).toBe("https://example.com");
      expect(result.data.title).toBe("Example");
      expect(result.data.snapshot).toBe("button @e1\ntext @e2");
      expect(result.data.refsCount).toBe(2);
    }
  });

  it("handles 404 stale-tab by recreating tab with target URL", async () => {
    // Call 1: POST /navigate → 404 (stale tab).
    // Call 2: POST /tabs → 200 with new tabId.
    // Call 3: GET /snapshot → 200 with snapshot.
    let callIdx = 0;
    const mockFn = vi.fn(async (url: string) => {
      callIdx++;
      if (callIdx === 1) {
        return {
          status: 404,
          ok: false,
          json: async () => ({}),
          text: async () => "not found",
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response;
      }
      if (callIdx === 2) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ tabId: "tab-2-new" }),
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response;
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ snapshot: "new content @e1", refsCount: 1 }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response;
    });
    globalThis.fetch = mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1-old", sessionKey: "task_test" };
    const result = await navigate("https://example.com/page2", session, DEFAULT_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.url).toBe("https://example.com/page2");
    }
    // Tab ID should be updated to the new tab.
    expect(session.tabId).toBe("tab-2-new");
  });

  it("creates tab when session has no tabId", async () => {
    // Call 1: POST /tabs → 200 with tabId.
    // Call 2: GET /snapshot → 200 with snapshot.
    let callIdx = 0;
    const mockFn = vi.fn(async () => {
      callIdx++;
      if (callIdx === 1) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ tabId: "tab-new-from-blank" }),
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response;
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ snapshot: "page @e1", refsCount: 1 }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response;
    });
    globalThis.fetch = mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: null, sessionKey: "task_test" };
    const result = await navigate("https://example.com", session, DEFAULT_CONFIG);

    expect(result.ok).toBe(true);
    expect(session.tabId).toBe("tab-new-from-blank");
  });

  it("returns error when navigate fails with non-404 status", async () => {
    fetchMock = makeMockFetch({ status: 500, text: "internal error" });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await navigate("https://example.com", session, DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("500");
    }
  });

  it("returns error when fetch throws", async () => {
    const mockFn = vi.fn(async () => {
      throw new Error("network down");
    });
    globalThis.fetch = mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await navigate("https://example.com", session, DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("network down");
    }
  });
});

// ─── snapshot ────────────────────────────────────────────────────────────────

describe("camofox-client — snapshot", () => {
  it("returns snapshot data successfully", async () => {
    fetchMock = makeMockFetch({ status: 200, json: { snapshot: "tree @e1 @e2", refsCount: 2 } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await snapshot(session, DEFAULT_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.snapshot).toBe("tree @e1 @e2");
      expect(result.data.refsCount).toBe(2);
    }
    expect(fetchMock.calls[0]?.url).toContain("/snapshot");
    expect(fetchMock.calls[0]?.url).toContain("userId=hermes_test");
  });

  it("returns error when no tabId in session", async () => {
    const session = { userId: "hermes_test", tabId: null, sessionKey: "task_test" };
    const result = await snapshot(session, DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("tabId");
    }
  });

  it("returns error when response missing snapshot field", async () => {
    fetchMock = makeMockFetch({ status: 200, json: { refsCount: 0 } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await snapshot(session, DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("snapshot");
    }
  });
});

// ─── click ───────────────────────────────────────────────────────────────────

describe("camofox-client — click", () => {
  it("clicks an element by ref (strips @ prefix)", async () => {
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await click("@e5", session, DEFAULT_CONFIG);
    expect(result.ok).toBe(true);

    expect(fetchMock.calls[0]?.url).toBe("http://localhost:9377/tabs/tab-1/click");
    const body = JSON.parse(fetchMock.calls[0]?.body ?? "{}");
    expect(body.ref).toBe("e5"); // @ stripped
    expect(body.userId).toBe("hermes_test");
  });

  it("returns error when no tabId", async () => {
    const session = { userId: "hermes_test", tabId: null, sessionKey: "task_test" };
    const result = await click("e1", session, DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
  });
});

// ─── type ───────────────────────────────────────────────────────────────────

describe("camofox-client — type", () => {
  it("types text into an element by ref (strips @ prefix)", async () => {
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await typeText("@e3", "hello world", session, DEFAULT_CONFIG);
    expect(result.ok).toBe(true);

    const body = JSON.parse(fetchMock.calls[0]?.body ?? "{}");
    expect(body.ref).toBe("e3");
    expect(body.text).toBe("hello world");
    expect(body.userId).toBe("hermes_test");
  });

  it("returns error when no tabId", async () => {
    const session = { userId: "hermes_test", tabId: null, sessionKey: "task_test" };
    const result = await typeText("e1", "text", session, DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
  });
});

// ─── scroll ─────────────────────────────────────────────────────────────────

describe("camofox-client — scroll", () => {
  it("scrolls in the given direction", async () => {
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await scroll("down", session, DEFAULT_CONFIG);
    expect(result.ok).toBe(true);

    const body = JSON.parse(fetchMock.calls[0]?.body ?? "{}");
    expect(body.direction).toBe("down");
    expect(body.userId).toBe("hermes_test");
  });
});

// ─── back ───────────────────────────────────────────────────────────────────

describe("camofox-client — back", () => {
  it("navigates back in history", async () => {
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await back(session, DEFAULT_CONFIG);
    expect(result.ok).toBe(true);

    const body = JSON.parse(fetchMock.calls[0]?.body ?? "{}");
    expect(body.userId).toBe("hermes_test");
    expect(fetchMock.calls[0]?.url).toContain("/back");
  });
});

// ─── press ──────────────────────────────────────────────────────────────────

describe("camofox-client — press", () => {
  it("presses a keyboard key", async () => {
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await press("Enter", session, DEFAULT_CONFIG);
    expect(result.ok).toBe(true);

    const body = JSON.parse(fetchMock.calls[0]?.body ?? "{}");
    expect(body.key).toBe("Enter");
    expect(body.userId).toBe("hermes_test");
  });
});

// ─── screenshot ──────────────────────────────────────────────────────────────

describe("camofox-client — screenshot", () => {
  it("returns base64-encoded screenshot", async () => {
    const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    fetchMock = makeMockFetch({ status: 200, arrayBuffer: pngData });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await screenshot(session, DEFAULT_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      // base64 of [0x89, 0x50, 0x4e, 0x47] = "iVBORw=="
      expect(result.data.base64).toBe("iVBORw==");
    }
  });

  it("returns error when no tabId", async () => {
    const session = { userId: "hermes_test", tabId: null, sessionKey: "task_test" };
    const result = await screenshot(session, DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
  });

  it("returns error on non-200 response", async () => {
    fetchMock = makeMockFetch({ status: 500, text: "error" });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    const session = { userId: "hermes_test", tabId: "tab-1", sessionKey: "task_test" };
    const result = await screenshot(session, DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
  });
});

// ─── closeSession ──────────────────────────────────────────────────────────

describe("camofox-client — closeSession", () => {
  it("deletes the session via DELETE /sessions/{userId}", async () => {
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;

    // First create a session.
    fetchMock = makeMockFetch({ status: 200, json: { tabId: "tab-1" } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;
    await createSession("task-close-1", DEFAULT_CONFIG);

    // Now close it.
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;
    const result = await closeSession("task-close-1", DEFAULT_CONFIG);
    expect(result.ok).toBe(true);
    expect(fetchMock.calls[0]?.method).toBe("DELETE");
    expect(fetchMock.calls[0]?.url).toContain("/sessions/");
  });

  it("returns error when session not found", async () => {
    const result = await closeSession("nonexistent-task", DEFAULT_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no session");
    }
  });

  it("removes session from memory even when DELETE fails", async () => {
    // Create a session first.
    fetchMock = makeMockFetch({ status: 200, json: { tabId: "tab-x" } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;
    await createSession("task-close-2", DEFAULT_CONFIG);

    // Close fails with 500.
    fetchMock = makeMockFetch({ status: 500, text: "error" });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;
    const result = await closeSession("task-close-2", DEFAULT_CONFIG);
    expect(result.ok).toBe(false);

    // Session should still be removed from memory.
    expect(getSession("task-close-2")).toBeUndefined();
  });

  it("includes auth header when apiKey is set", async () => {
    // Create session first.
    fetchMock = makeMockFetch({ status: 200, json: { tabId: "tab-y" } });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;
    await createSession("task-close-3", AUTH_CONFIG);

    // Close with auth.
    fetchMock = makeMockFetch({ status: 200, json: {} });
    globalThis.fetch = fetchMock.mockFn as unknown as typeof globalThis.fetch;
    await closeSession("task-close-3", AUTH_CONFIG);
    expect(fetchMock.calls[0]?.headers.Authorization).toBe("Bearer test-secret-key");
  });
});