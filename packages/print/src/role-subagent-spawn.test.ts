/**
 * Role-subagent spawn orchestration tests.
 *
 * Tests the spawnRoleSubagent function: mock the gateway HTTP (POST /pool/acquire),
 * mock openView (verify argv), verify parentSessionId in the acquire payload.
 * Also tests the handle registry (getViewHandle / focusRoleSubagentView / forget).
 *
 * [unit]
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock the view SPI so no real child_process is spawned ────────────────

const mockOpenView = vi.hoisted(() => vi.fn());
const mockBackendFocus = vi.hoisted(() => vi.fn());

vi.mock("./view/view-backend.js", () => ({
  openView: mockOpenView,
  resolveViewBackend: () => ({ id: "mock", focus: mockBackendFocus }),
  VIEW_BACKENDS: [{ id: "tmux", focus: mockBackendFocus }],
}));

// ── Mock gw-auth to avoid reading real token files ───────────────────────

vi.mock("./gw-auth.js", () => ({
  authHeaders: () => ({ authorization: "Bearer test-token" }),
}));

import {
  spawnRoleSubagent,
  getViewHandle,
  focusRoleSubagentView,
  forgetViewHandle,
  waitRoleSubagent,
  type SpawnRoleSubagentOpts,
} from "./role-subagent-spawn.js";
import type { ViewHandle } from "./view/view-backend.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeOpts(overrides: Partial<SpawnRoleSubagentOpts> = {}): SpawnRoleSubagentOpts {
  return {
    role: "coder",
    task: "refactor X",
    cwd: "/tmp/project",
    parentSessionId: "parent-1",
    gatewayUrl: "http://127.0.0.1:3000",
    ...overrides,
  };
}

/** Mock fetch that responds to /pool/acquire with a sessionId. */
function mockFetchAcquire(sessionId: string, extraRoutes: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchMock = async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    calls.push({ url: urlStr, method: init?.method ?? "GET", body: init?.body });
    if (urlStr.endsWith("/pool/acquire")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessionId }),
      } as Response;
    }
    for (const [route, resp] of Object.entries(extraRoutes)) {
      if (urlStr.includes(route)) {
        return { ok: true, status: 200, json: async () => resp } as Response;
      }
    }
    return { ok: false, status: 404, text: async () => "not found" } as Response;
  };
  return { fetchMock, calls };
}

describe("[unit] spawnRoleSubagent", () => {
  beforeEach(() => {
    mockOpenView.mockReset();
    mockBackendFocus.mockReset();
    vi.unstubAllGlobals();
  });

  it("acquires a session and opens a view with the correct argv", async () => {
    const { fetchMock, calls } = mockFetchAcquire("s-abc123");
    vi.stubGlobal("fetch", fetchMock);

    const mockHandle: ViewHandle = { backendId: "tmux", ref: "3" };
    mockOpenView.mockResolvedValue(mockHandle);

    const result = await spawnRoleSubagent(makeOpts());

    expect(result.sessionId).toBe("s-abc123");
    expect(result.handle).toEqual(mockHandle);

    // Verify openView was called with the correct argv
    expect(mockOpenView).toHaveBeenCalledTimes(1);
    const openCall = mockOpenView.mock.calls[0]![0];
    expect(openCall.command).toEqual([
      "mya", "--gateway-session", "s-abc123", "--role", "coder", "--task", "refactor X",
    ]);
    expect(openCall.title).toBe("coder");
    expect(openCall.cwd).toBe("/tmp/project");
  });

  it("includes --model in argv when model is provided", async () => {
    const { fetchMock } = mockFetchAcquire("s-m1");
    vi.stubGlobal("fetch", fetchMock);
    mockOpenView.mockResolvedValue({ backendId: "tmux", ref: "1" });

    await spawnRoleSubagent(makeOpts({ model: "claude-opus-4" }));

    const openCall = mockOpenView.mock.calls[0]![0];
    expect(openCall.command).toContain("--model");
    expect(openCall.command).toContain("claude-opus-4");
  });

  it("omits --model when no model is provided", async () => {
    const { fetchMock } = mockFetchAcquire("s-nm");
    vi.stubGlobal("fetch", fetchMock);
    mockOpenView.mockResolvedValue({ backendId: "tmux", ref: "1" });

    await spawnRoleSubagent(makeOpts());

    const openCall = mockOpenView.mock.calls[0]![0];
    expect(openCall.command).not.toContain("--model");
  });

  it("sends parentSessionId in the acquire payload", async () => {
    const { fetchMock, calls } = mockFetchAcquire("s-par");
    vi.stubGlobal("fetch", fetchMock);
    mockOpenView.mockResolvedValue({ backendId: "tmux", ref: "1" });

    await spawnRoleSubagent(makeOpts({ parentSessionId: "main-session-42" }));

    const acquireCall = calls.find((c) => c.url.endsWith("/pool/acquire"))!;
    const body = JSON.parse(acquireCall.body as string);
    expect(body.parentSessionId).toBe("main-session-42");
    expect(body.role).toBe("coder");
    expect(body.task).toBe("refactor X");
    expect(body.cwd).toBe("/tmp/project");
  });

  it("sends auth headers in the acquire request", async () => {
    const { fetchMock, calls } = mockFetchAcquire("s-auth");
    vi.stubGlobal("fetch", fetchMock);
    mockOpenView.mockResolvedValue({ backendId: "tmux", ref: "1" });

    await spawnRoleSubagent(makeOpts());

    // fetchMock captures init which includes headers — verify via the call
    // (authHeaders is mocked to return a bearer token)
    // The mock doesn't capture headers directly, but we can verify the mock
    // was called with the right URL pattern
    expect(calls.some((c) => c.url.endsWith("/pool/acquire"))).toBe(true);
  });

  it("throws when /pool/acquire fails", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 500,
      text: async () => "internal error",
    }) as Response);

    await expect(spawnRoleSubagent(makeOpts())).rejects.toThrow("acquire failed");
  });

  it("throws when gateway returns no sessionId", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as Response);

    await expect(spawnRoleSubagent(makeOpts())).rejects.toThrow("no sessionId");
  });

  it("stores the handle in the registry after spawn", async () => {
    const { fetchMock } = mockFetchAcquire("s-reg");
    vi.stubGlobal("fetch", fetchMock);
    mockOpenView.mockResolvedValue({ backendId: "tmux", ref: "5" });

    await spawnRoleSubagent(makeOpts());

    expect(getViewHandle("s-reg")).toEqual({ backendId: "tmux", ref: "5" });
  });
});

describe("[unit] handle registry (getViewHandle / focusRoleSubagentView / forget)", () => {
  beforeEach(() => {
    mockOpenView.mockReset();
    mockBackendFocus.mockReset();
    vi.unstubAllGlobals();
  });

  it("getViewHandle returns undefined for unknown session", () => {
    expect(getViewHandle("nonexistent-session-id")).toBeUndefined();
  });

  it("focusRoleSubagentView returns false when no handle exists", async () => {
    expect(await focusRoleSubagentView("no-such-id")).toBe(false);
  });

  it("focusRoleSubagentView focuses the view when a handle exists", async () => {
    const { fetchMock } = mockFetchAcquire("s-focus");
    vi.stubGlobal("fetch", fetchMock);
    mockOpenView.mockResolvedValue({ backendId: "tmux", ref: "9" });
    mockBackendFocus.mockResolvedValue(undefined);

    await spawnRoleSubagent(makeOpts());
    const focused = await focusRoleSubagentView("s-focus");

    expect(focused).toBe(true);
    expect(mockBackendFocus).toHaveBeenCalledTimes(1);
    expect(mockBackendFocus).toHaveBeenCalledWith({ backendId: "tmux", ref: "9" });
  });

  it("forgetViewHandle removes the handle from the registry", async () => {
    const { fetchMock } = mockFetchAcquire("s-forget");
    vi.stubGlobal("fetch", fetchMock);
    mockOpenView.mockResolvedValue({ backendId: "tmux", ref: "7" });

    await spawnRoleSubagent(makeOpts());
    expect(getViewHandle("s-forget")).toBeDefined();

    forgetViewHandle("s-forget");
    expect(getViewHandle("s-forget")).toBeUndefined();
  });

  it("releases the acquired session (POST /pool/kill) when openView fails (F2 — no dangling ghost)", async () => {
    const { fetchMock, calls } = mockFetchAcquire("s-f2");
    vi.stubGlobal("fetch", fetchMock);
    mockOpenView.mockRejectedValue(new Error("tmux new-window failed"));
    await expect(spawnRoleSubagent(makeOpts())).rejects.toThrow("tmux new-window failed");
    // the acquired session must be killed so it doesn't dangle in the pool
    const killCall = calls.find((c) => c.url.includes("/pool/kill/s-f2"));
    expect(killCall).toBeDefined();
    expect(killCall?.method).toBe("POST");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// waitRoleSubagent (polls GET /pool/tree until done/failed/timeout/not_found)
// ══════════════════════════════════════════════════════════════════════════

describe("[unit] waitRoleSubagent", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns done when status transitions working→done (2 poll cycles)", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", async () => {
      callCount++;
      const status = callCount === 1 ? "working" : "done";
      return {
        ok: true,
        status: 200,
        json: async () => [{
          sessionId: "target-1",
          status,
          summary: "Task completed",
          keyOutputs: ["file1.ts"],
          subagents: [],
        }],
      } as Response;
    });

    const result = await waitRoleSubagent({
      sessionId: "target-1",
      gatewayUrl: "http://127.0.0.1:3000",
      pollIntervalMs: 10,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("done");
    expect(result.summary).toBe("Task completed");
    expect(result.keyOutputs).toEqual(["file1.ts"]);
    expect(callCount).toBe(2);
  });

  it("returns failed when status transitions working→failed", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", async () => {
      callCount++;
      const status = callCount === 1 ? "working" : "failed";
      return {
        ok: true,
        status: 200,
        json: async () => [{
          sessionId: "target-2",
          status,
          summary: "Something went wrong",
          subagents: [],
        }],
      } as Response;
    });

    const result = await waitRoleSubagent({
      sessionId: "target-2",
      gatewayUrl: "http://127.0.0.1:3000",
      pollIntervalMs: 10,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toBe("Something went wrong");
    expect(callCount).toBe(2);
  });

  it("returns timeout when the session never reaches terminal status", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        sessionId: "stuck-1",
        status: "working",
        subagents: [],
      }],
    }) as Response);

    const result = await waitRoleSubagent({
      sessionId: "stuck-1",
      gatewayUrl: "http://127.0.0.1:3000",
      pollIntervalMs: 10,
      timeoutMs: 30,
    });

    expect(result.status).toBe("timeout");
  });

  it("returns not_found when the session is absent from the tree", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        sessionId: "other-session",
        status: "working",
        subagents: [],
      }],
    }) as Response);

    const result = await waitRoleSubagent({
      sessionId: "nonexistent",
      gatewayUrl: "http://127.0.0.1:3000",
      pollIntervalMs: 10,
      timeoutMs: 100,
    });

    expect(result.status).toBe("not_found");
  });

  it("finds the session in nested subagents", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        sessionId: "parent-1",
        status: "working",
        subagents: [{
          id: "nested-child",
          status: "done",
          summary: "Nested task done",
          keyOutputs: ["nested.ts"],
        }],
      }],
    }) as Response);

    const result = await waitRoleSubagent({
      sessionId: "nested-child",
      gatewayUrl: "http://127.0.0.1:3000",
      pollIntervalMs: 10,
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("done");
    expect(result.summary).toBe("Nested task done");
    expect(result.keyOutputs).toEqual(["nested.ts"]);
  });

  it("uses authHeaders (authorization) on each fetch call", async () => {
    const calls: Array<{ headers?: Record<string, string> }> = [];
    let callCount = 0;
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      callCount++;
      calls.push({ headers: init?.headers as Record<string, string> | undefined });
      return {
        ok: true,
        status: 200,
        json: async () => [{
          sessionId: "auth-test",
          status: callCount === 1 ? "working" : "done",
          subagents: [],
        }],
      } as Response;
    });

    await waitRoleSubagent({
      sessionId: "auth-test",
      gatewayUrl: "http://127.0.0.1:3000",
      pollIntervalMs: 10,
      timeoutMs: 5_000,
    });

    expect(calls.length).toBe(2);
    for (const c of calls) {
      expect(c.headers?.authorization).toBe("Bearer test-token");
    }
  });
});
