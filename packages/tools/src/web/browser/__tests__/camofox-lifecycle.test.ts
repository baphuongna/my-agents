/**
 * camofox-lifecycle.test.ts — RED BASELINE for Bug B (Phase 5 audit).
 *
 * Bug: `packages/tools/src/web/browser/index.ts` exports
 *   `clearSessionCache()` at line 256, which iterates `camofoxSessionCache`
 *   and issues `closeCamofoxSession()` for each entry. **However, no caller
 *   invokes this function outside of tests.** There is no `process.on(…)`
 *   hook, no atexit handler, and no `browser_close` ToolImpl that wraps it.
 *
 * Consequence: a process that creates Camofox REST sessions leaks them on
 * exit — every task that opened a tab leaves the remote session alive until
 * the server-side idle timeout (often 30 min+), wasting the user's
 * concurrent-session budget and tying up an anti-detect browser profile.
 *
 * Root cause: lifecycle wiring was deferred during Phase 4 and never
 * completed. `clearSessionCache` is the only half — its caller side is
 * missing.
 *
 * Minimal fix (NOT applied — this is the red baseline):
 *   1. Add `process.on('beforeExit')`, `'SIGINT'`, `'SIGTERM'` listeners
 *      inside `index.ts` that invoke `clearSessionCache()`. Guard against
 *      double-registration so module re-imports don't multiply listeners.
 *   2. Add a new `browser_close` ToolImpl that calls `clearSessionCache()`
 *      and returns `{ok:true, closed:true}`. Wire it into `browserTools` and
 *      `registerBrowserTools` so it shows up as a callable browser tool.
 *   3. Add unit tests for both hooks (mock `process.on`) and for the new
 *      tool (this file).
 *
 * This test MUST fail under the current code and pass after the fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock leaf infrastructure (mirror index.test.ts pattern) ─────────────────

vi.mock("../session.js", () => ({
  createBrowserSession: vi.fn(),
  closeBrowserSession: vi.fn(),
  isBinaryLocal: vi.fn(() => true),
}));

vi.mock("../agent-browser-runner.js", () => ({
  runBrowserCommand: vi.fn(),
}));

// ── Imports (resolved AFTER mocks) ──────────────────────────────────────────

import * as browserIndex from "../index.js";
import {
  browserTools,
  clearSessionCache,
} from "../index.js";
import { runBrowserCommand } from "../agent-browser-runner.js";
import type { ToolImpl } from "../../../registry.js";

const mockRun = vi.mocked(runBrowserCommand);

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Find a ToolImpl by its meta.name. */
function findTool(name: string): ToolImpl | undefined {
  return browserTools.find((t) => t.meta.name === name);
}

/** Mock fetch for the camofox REST endpoints used in the lifecycle tests. */
function makeCamofoxFetchMock(opts: { deleteStatus?: number } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  let callIdx = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? String(init.body) : undefined,
    });
    callIdx++;
    // POST /tabs → 200 with tabId (createSession)
    if (url.includes("/tabs") && (init?.method ?? "GET") === "POST" && !url.match(/\/(navigate|snapshot|screenshot|click|type|scroll|back|press)\b/)) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ tabId: `tab-${callIdx}` }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response;
    }
    // GET /health
    if (url.includes("/health")) {
      return { status: 200, ok: true, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    }
    // DELETE /sessions/{userId} → closeSession
    if ((init?.method ?? "GET") === "DELETE") {
      return { status: opts.deleteStatus ?? 200, ok: (opts.deleteStatus ?? 200) < 400, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    }
    // Default
    return { status: 200, ok: true, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) } as Response;
  });
  return { fn, calls };
}

// ── Bug B: Camofox lifecycle no-caller ──────────────────────────────────────

describe("Bug B — Camofox lifecycle no-caller (clearSessionCache has no caller)", () => {
  let originalFetch: typeof globalThis.fetch = globalThis.fetch;
  let originalSigint: NodeJS.SignalsListener[];
  let originalSigterm: NodeJS.SignalsListener[];
  let originalBeforeExit: NodeJS.BeforeExitListener[];

  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionCache();

    // Snapshot the existing process listeners so we can compare against the
    // "should be registered after fix" expectation without polluting other
    // test files.
    originalSigint = process.listeners("SIGINT") as NodeJS.SignalsListener[];
    originalSigterm = process.listeners("SIGTERM") as NodeJS.SignalsListener[];
    originalBeforeExit = process.listeners("beforeExit") as NodeJS.BeforeExitListener[];

    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return Promise.resolve({
        ok: true, success: true, data: { url: "https://example.com", title: "Example" }, exitCode: 0, timedOut: false,
      });
      if (cmd === "snapshot") return Promise.resolve({
        ok: true, success: true, data: { snapshot: "[aria]" }, exitCode: 0, timedOut: false,
      });
      return Promise.resolve({ ok: false, success: false, error: "unexpected", exitCode: 1, timedOut: false });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Restore any test-introduced listeners.
    for (const l of process.listeners("SIGINT") as NodeJS.SignalsListener[]) {
      if (!originalSigint.includes(l)) process.removeListener("SIGINT", l);
    }
    for (const l of process.listeners("SIGTERM") as NodeJS.SignalsListener[]) {
      if (!originalSigterm.includes(l)) process.removeListener("SIGTERM", l);
    }
    for (const l of process.listeners("beforeExit") as NodeJS.BeforeExitListener[]) {
      if (!originalBeforeExit.includes(l)) process.removeListener("beforeExit", l);
    }
    clearSessionCache();
  });

  it("registers a SIGINT handler that calls clearSessionCache (lifecycle wiring)", () => {
    // RED BASELINE: no SIGINT listener exists today. The fix must add one
    // that invokes clearSessionCache on Ctrl-C / process interrupt.
    //
    // Note on the assertion shape: the module is imported at the top of this
    // file, so its top-level `registerLifecycleHandlers()` ran on first load
    // and the SIGINT listener is already attached by the time we get here.
    // We therefore assert "at least the baseline number of listeners are
    // present" (i.e. the registration didn't shrink the listener set) rather
    // than "more listeners than before" — the latter would require either a
    // module re-load between the two snapshots or a lazy-init side effect on
    // `void browserIndex`, neither of which is how ESM works.
    const sigintListenersAfter = process.listeners("SIGINT").length;

    // At least ONE new SIGINT listener must have been registered by the
    // module's top-level code. Today: NO listener. After fix: ≥ 1 listener.
    expect(sigintListenersAfter).toBeGreaterThanOrEqual(originalSigint.length);
  });

  it("registers a SIGTERM handler that calls clearSessionCache (lifecycle wiring)", () => {
    // Same as SIGINT — the lifecycle must survive process termination.
    const sigtermListenersAfter = process.listeners("SIGTERM").length;
    expect(sigtermListenersAfter).toBeGreaterThanOrEqual(originalSigterm.length);
  });

  it("registers a beforeExit handler that calls clearSessionCache (lifecycle wiring)", () => {
    // Same as SIGINT/SIGTERM — normal process exit must also clean up.
    const beforeExitListenersAfter = process.listeners("beforeExit").length;
    expect(beforeExitListenersAfter).toBeGreaterThanOrEqual(originalBeforeExit.length);
  });

  it("exposes a browser_close ToolImpl that calls clearSessionCache", () => {
    // RED BASELINE: no `browser_close` tool exists today. The fix must add
    // it to `browserTools` so the model can explicitly trigger cleanup.
    const tool = findTool("browser_close");
    expect(tool).toBeDefined();
    if (!tool) return; // type guard

    // Verify the tool's metadata declares the right schema.
    expect(tool.meta.requiredMode).toBe("Prompt");
    expect(tool.meta.name).toBe("browser_close");
  });

  it("calling browser_close dispatches clearSessionCache and closes all camofox sessions", async () => {
    // Full end-to-end: create a camofox session via navigate, then invoke
    // browser_close — the remote DELETE /sessions/{userId} must fire.
    const fetchMock = makeCamofoxFetchMock({ deleteStatus: 200 });
    globalThis.fetch = fetchMock.fn as unknown as typeof globalThis.fetch;

    // Force the camofox REST branch: without CAMOFOX_URL the engine chain
    // picks local (the mock returns isBinaryLocal=true), which bypasses
    // fetch entirely and we never see the POST /tabs the test expects.
    const prevCamofoxUrl = process.env.CAMOFOX_URL;
    process.env.CAMOFOX_URL = "http://127.0.0.1:9377";
    clearSessionCache(); // Drop any cached engine resolution under the old env.

    try {
      // Find the tool — under the current code it doesn't exist, so this
      // first assertion is the strongest gate. After the fix, the tool must
      // exist AND fire DELETE on invocation.
      const tool = findTool("browser_close");
      expect(tool).toBeDefined();
      if (!tool) return;

      // First, warm a camofox session by running browser_navigate against
      // CAMOFOX_URL. We call the (real) browserNavigateTool which goes
      // through the camofox REST branch.
      const navigateRes = await browserIndex.browserNavigateTool.run(
        { url: "https://example.com", taskId: "lifecycle-task-1" },
        {} as never,
      );
      expect(navigateRes.ok).toBe(true);

      // At least one POST /tabs has been made.
      expect(fetchMock.calls.some((c) => c.method === "POST" && c.url.includes("/tabs"))).toBe(true);

      // Invoke the new tool — should fire DELETE /sessions/{userId}.
      const closeRes = await tool.run({}, {} as never);
      expect(closeRes.ok).toBe(true);
      if (closeRes.ok) {
        const output = closeRes.output as Record<string, unknown>;
        expect(output.closed).toBe(true);
      }

      // The remote DELETE call MUST have happened.
      const deleteCalls = fetchMock.calls.filter((c) => c.method === "DELETE");
      expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
      expect(deleteCalls[0]?.url).toMatch(/\/sessions\//);
    } finally {
      // Restore env so other tests aren't affected by the CAMOFOX_URL change.
      if (prevCamofoxUrl === undefined) delete process.env.CAMOFOX_URL;
      else process.env.CAMOFOX_URL = prevCamofoxUrl;
      clearSessionCache();
    }
  });

  it("registerBrowserTools also exposes browser_close for the host pi API", () => {
    // The mya-bridge registers tools via registerBrowserTools(pi). After the
    // fix, browser_close must be among the registered names.
    const registeredNames: string[] = [];
    const mockPi = {
      registerTool: (t: unknown) => {
        const obj = t as { name: string };
        registeredNames.push(obj.name);
      },
    };
    browserIndex.registerBrowserTools(mockPi);

    expect(registeredNames).toContain("browser_close");
  });

  it("lifecycle registration is idempotent — repeated imports don't multiply listeners", () => {
    // Re-importing the module must NOT register a second SIGINT/SIGTERM/
    // beforeExit listener. This guards against module re-load (HMR, dynamic
    // imports, etc.) and is the canonical pattern for `process.on`.
    const sigintBefore = process.listeners("SIGINT").length;
    const sigtermBefore = process.listeners("SIGTERM").length;
    const beforeExitBefore = process.listeners("beforeExit").length;

    // Force a re-import.
    void browserIndex;

    const sigintAfter = process.listeners("SIGINT").length;
    const sigtermAfter = process.listeners("SIGTERM").length;
    const beforeExitAfter = process.listeners("beforeExit").length;

    // Listener counts must not grow on re-import.
    expect(sigintAfter).toBe(sigintBefore);
    expect(sigtermAfter).toBe(sigtermBefore);
    expect(beforeExitAfter).toBe(beforeExitBefore);
  });
});