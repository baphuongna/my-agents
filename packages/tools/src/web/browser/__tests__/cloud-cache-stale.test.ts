/**
 * cloud-cache-stale.test.ts — RED BASELINE for Bug A (Phase 5 audit).
 *
 * Bug: `packages/tools/src/web/browser/index.ts` declares
 *   `cloudSessionCache = new Map<string, CloudSessionMeta>()` at line 132,
 *   populated unconditionally in `ensureCloudCdpUrl` at line 170 with no TTL
 *   and no revalidation on read (line 152 reads bare `cloudSessionCache.get`).
 *   If a cloud browser session becomes invalid (server restart, idle-kill,
 *   network partition, ...), every subsequent navigation on the same taskId
 *   reuses the stale `cdpUrl` forever.
 *
 * Root cause: no `createdAt` timestamp; no `cloudSessionTtlMs` knob; the read
 * path returns the cached entry as long as it exists, regardless of age.
 *
 * Minimal fix (NOT applied — this is the red baseline):
 *   1. Store `{meta, createdAt: number}` instead of bare `CloudSessionMeta`.
 *   2. Apply a default TTL (5 min) configurable via
 *      `EngineResolutionConfig.cloudSessionTtlMs`.
 *   3. Treat entries older than TTL as missing in `ensureCloudCdpUrl`
 *      (delete + fall through to `provider.createSession()`).
 *   4. Add a unit test using `vi.useFakeTimers()` (this file).
 *
 * This test MUST fail under the current code and pass after the fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TurnContext } from "@my-agent/core";

// ── Mock leaf infrastructure (mirror index.test.ts pattern) ─────────────────

vi.mock("../session.js", () => ({
  createBrowserSession: vi.fn(),
  closeBrowserSession: vi.fn(),
  isBinaryLocal: vi.fn(() => true),
}));

vi.mock("../agent-browser-runner.js", () => ({
  runBrowserCommand: vi.fn(),
}));

// Spy on the cloud provider module so we can control which provider is
// returned by `getAvailableCloudProvider`. We keep the real
// `BrowserbaseProvider` / `BrowserUseProvider` classes intact — only the
// factory is swapped.
vi.mock("../cloud-provider.js", async () => {
  const actual = await vi.importActual<typeof import("../cloud-provider.js")>(
    "../cloud-provider.js",
  );
  return {
    ...actual,
    getAvailableCloudProvider: vi.fn(),
  };
});

// ── Imports (resolved AFTER mocks) ──────────────────────────────────────────

import { browserNavigateTool, clearSessionCache } from "../index.js";
import { runBrowserCommand } from "../agent-browser-runner.js";
import { getAvailableCloudProvider } from "../cloud-provider.js";
import type { BrowserProvider, CloudSessionMeta } from "../cloud-provider.js";

const mockRun = vi.mocked(runBrowserCommand);
const mockGetAvailableCloudProvider = vi.mocked(getAvailableCloudProvider);

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(): TurnContext {
  return {} as unknown as TurnContext;
}

function openResult(url: string, title = ""): ReturnType<typeof mockRun> {
  return Promise.resolve({
    ok: true,
    success: true,
    data: { url, title },
    exitCode: 0,
    timedOut: false,
  });
}

function snapshotResult(snapshot = "[aria tree]"): ReturnType<typeof mockRun> {
  return Promise.resolve({
    ok: true,
    success: true,
    data: { snapshot },
    exitCode: 0,
    timedOut: false,
  });
}

/** Build a mock BrowserProvider that returns a fixed CloudSessionMeta on
 *  createSession. Lets the test observe call counts and distinguish
 *  "reused cached session" from "fresh session". */
function makeMockProvider(
  name: string,
  sessionId: string,
  cdpUrl: string,
): BrowserProvider {
  return {
    name,
    isAvailable: () => true,
    createSession: vi.fn(async (taskId: string) => ({
      ok: true as const,
      session: {
        sessionName: `hermes_${taskId}_${sessionId}`,
        bbSessionId: sessionId,
        cdpUrl,
        features: { test: true },
      } satisfies CloudSessionMeta,
    })),
    closeSession: vi.fn(async () => true),
    emergencyCleanup: vi.fn(),
  };
}

/** Env var save/restore helper that holds the env across async boundaries.
 *  Unlike a try/finally in a sync function (which would restore BEFORE the
 *  async body resumes), this returns a cleanup function that the caller
 *  invokes AFTER awaiting the test body. */
function setCloudEnv(): () => void {
  const saved: Record<string, string | undefined> = {
    BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
    BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
    BROWSER_USE_API_KEY: process.env.BROWSER_USE_API_KEY,
    CAMOFOX_URL: process.env.CAMOFOX_URL,
  };
  process.env.BROWSERBASE_API_KEY = "bb-test-key";
  process.env.BROWSERBASE_PROJECT_ID = "proj-test";
  delete process.env.BROWSER_USE_API_KEY;
  delete process.env.CAMOFOX_URL;
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

// ── Bug A: cloud CDP cache stale (TTL violation) ────────────────────────────

describe("Bug A — cloud CDP cache stale (no TTL on cloudSessionCache)", () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionCache();
    restoreEnv = setCloudEnv();

    mockRun.mockImplementation((cmd: string) => {
      if (cmd === "open") return openResult("https://example.com", "Example");
      if (cmd === "snapshot") return snapshotResult("[aria]");
      return Promise.resolve({
        ok: false,
        success: false,
        error: "unexpected",
        exitCode: 1,
        timedOut: false,
      });
    });
  });

  afterEach(() => {
    restoreEnv();
    vi.useRealTimers();
  });

  it("does NOT return a stale CloudSessionMeta from cloudSessionCache after the TTL elapses", async () => {
    // RED BASELINE: under the current code, the cache has no TTL, so the
    // stale cdpUrl from the FIRST createSession() call is reused on the
    // SECOND navigation, regardless of elapsed time. The fix must:
    //   - store `{meta, createdAt}` instead of bare `CloudSessionMeta`
    //   - treat entries older than the TTL (default 5 min, configurable via
    //     `EngineResolutionConfig.cloudSessionTtlMs`) as missing
    //   - delete the stale entry and call `provider.createSession()` again.
    vi.useFakeTimers();

    // Provider A returns session A on its FIRST createSession call (this
    // populates the module-level cloudSessionCache).
    const providerA = makeMockProvider(
      "mock-cloud-a",
      "session-aaa-stale",
      "wss://stale-cdp.example.com/session-aaa-stale",
    );
    mockGetAvailableCloudProvider.mockReturnValue(providerA);

    // Provider B (DIFFERENT cdpUrl) is swapped in AFTER the cache is warm.
    // If the bug is unfixed, navigation #2 reuses the stale cdpUrl and we
    // never see providerB.createSession() being called.
    const providerB = makeMockProvider(
      "mock-cloud-b",
      "session-bbb-fresh",
      "wss://fresh-cdp.example.com/session-bbb-fresh",
    );

    // ── First navigation: warms the cache with provider A's session. ──
    const first = await browserNavigateTool.run(
      { url: "https://example.com", taskId: "stale-task-1" },
      makeCtx(),
    );
    expect(first.ok).toBe(true);

    // Sanity: the runner saw provider A's cdpUrl.
    const openCallsAfterFirst = mockRun.mock.calls.filter((c) => c[0] === "open");
    expect(openCallsAfterFirst).toHaveLength(1);
    const firstOpts = openCallsAfterFirst[0]?.[2] as { cdpUrl?: string };
    expect(firstOpts.cdpUrl).toBe("wss://stale-cdp.example.com/session-aaa-stale");
    expect(providerA.createSession).toHaveBeenCalledTimes(1);

    // ── Swap providers + advance time past the TTL. ──
    mockGetAvailableCloudProvider.mockReturnValue(providerB);
    // Advance 6 minutes (TTL should default to 5 min; 6 leaves a margin).
    vi.advanceTimersByTime(6 * 60 * 1000);

    // ── Second navigation: must NOT return the stale cdpUrl. ──
    const second = await browserNavigateTool.run(
      { url: "https://example.com", taskId: "stale-task-1" },
      makeCtx(),
    );
    expect(second.ok).toBe(true);

    // The LAST open call must use provider B's cdpUrl.
    const openCallsAfterSecond = mockRun.mock.calls.filter((c) => c[0] === "open");
    expect(openCallsAfterSecond.length).toBeGreaterThanOrEqual(2);
    const lastOpts = openCallsAfterSecond[openCallsAfterSecond.length - 1]?.[2] as {
      cdpUrl?: string;
    };

    // ── THE CRITICAL ASSERTION ──
    // The stale cdpUrl must NOT flow through to runBrowserCommand.
    expect(lastOpts.cdpUrl).not.toBe("wss://stale-cdp.example.com/session-aaa-stale");
    // The fresh cdpUrl (from provider B) MUST flow through.
    expect(lastOpts.cdpUrl).toBe("wss://fresh-cdp.example.com/session-bbb-fresh");
    // Provider B was actually invoked (cache miss forced a new createSession).
    expect(providerB.createSession).toHaveBeenCalledTimes(1);
  });

  it("does NOT return a stale cdpUrl even when the elapsed time is well past the TTL", async () => {
    // Stronger variant: advance time by 1 hour. The fix must still treat
    // the entry as stale regardless of how far past TTL the clock moves.
    vi.useFakeTimers();

    const providerA = makeMockProvider(
      "mock-cloud-a",
      "session-aaa",
      "wss://a.example.com",
    );
    const providerB = makeMockProvider(
      "mock-cloud-b",
      "session-bbb",
      "wss://b.example.com",
    );

    // Warm cache with A.
    mockGetAvailableCloudProvider.mockReturnValue(providerA);
    const first = await browserNavigateTool.run(
      { url: "https://example.com", taskId: "stale-task-2" },
      makeCtx(),
    );
    expect(first.ok).toBe(true);

    // Swap to B, advance 1 hour.
    mockGetAvailableCloudProvider.mockReturnValue(providerB);
    vi.advanceTimersByTime(60 * 60 * 1000);

    const second = await browserNavigateTool.run(
      { url: "https://example.com", taskId: "stale-task-2" },
      makeCtx(),
    );
    expect(second.ok).toBe(true);

    const openCalls = mockRun.mock.calls.filter((c) => c[0] === "open");
    const lastOpts = openCalls[openCalls.length - 1]?.[2] as { cdpUrl?: string };

    expect(lastOpts.cdpUrl).not.toBe("wss://a.example.com");
    expect(lastOpts.cdpUrl).toBe("wss://b.example.com");
    expect(providerB.createSession).toHaveBeenCalledTimes(1);
  });

  it("reuses a fresh cache entry within the TTL window (regression guard)", async () => {
    // Regression guard for the fix: WITHIN the TTL, the cache SHOULD be
    // reused (no second createSession call). The fix must not over-correct
    // and invalidate the cache on every read.
    vi.useFakeTimers();

    const providerA = makeMockProvider(
      "mock-cloud-a",
      "session-aaa",
      "wss://a.example.com",
    );

    mockGetAvailableCloudProvider.mockReturnValue(providerA);

    // First navigate: warm cache.
    const first = await browserNavigateTool.run(
      { url: "https://example.com", taskId: "stale-task-3" },
      makeCtx(),
    );
    expect(first.ok).toBe(true);

    // Advance 1 second (well within any reasonable TTL).
    vi.advanceTimersByTime(1_000);

    // Second navigate: cache MUST be reused.
    const second = await browserNavigateTool.run(
      { url: "https://example.com", taskId: "stale-task-3" },
      makeCtx(),
    );
    expect(second.ok).toBe(true);

    // Provider A's createSession should still have been called only ONCE.
    expect(providerA.createSession).toHaveBeenCalledTimes(1);
  });
});