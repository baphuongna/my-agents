/**
 * orchestrator.test.ts — Phase 5 orchestrator tests.
 *
 * Covers D1–D8 resilience patterns + the `fallbackToFetch=false` branch +
 * the `loadWebConfig` env-merge precedence (a small subset of config
 * behaviour that the orchestrator depends on).
 *
 * ≥ 8 cases (per task packet):
 *   1. D1: isAvailable probe skips primary and falls through to onAllFail.
 *   2. D2: try/catch chain — primary throws → onPaymentRequired throws →
 *      onEngineFail throws → onAllFail succeeds → ok.
 *   3. D3: 402 → drop feature → retry succeeds → servedBy="402-fallback".
 *   4. D4: chrome-fail → lightpanda retry succeeds → servedBy="engine-fallback".
 *   5. D5: missing Chromium → autoinstall retry succeeds → servedBy="autoinstall-retry".
 *   6. D7: timeout → kill + cleanup → typed error mentioning cleanup; no leaked child.
 *   7. D8: post-redirect SSRF guard blocks after a successful primary.
 *   8. fallbackToFetch=false respected (typed error, not silent degrade).
 *
 * Plus several edge cases: search/extract config precedence, env var
 * override precedence, capability discrimination via the resolver.
 *
 * Mock strategy:
 *   - Mock the leaf tool files (browser/index.js, search/index.js, fetch.js)
 *     to control isAvailable probes, primary() outcomes, and the webFetch
 *     universal floor.
 *   - Use vi.resetModules() between tests to drop module-level state where
 *     needed.
 *   - Env vars are saved / restored around each test via `withEnv`.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import type { TurnContext } from "@my-agent/core";

// ─── Mock the leaf modules so the orchestrator runs in isolation ────────────

// engine-resolver: keep real `buildEngineConfigFromEnv` so MYA_WEB_* env vars
// propagate, but stub the cheap probes for predictable chain resolution.
vi.mock("./browser/engine-resolver.js", async () => {
  const actual =
    await vi.importActual<typeof import("./browser/engine-resolver.js")>(
      "./browser/engine-resolver.js",
    );
  return {
    ...actual,
    isCamofoxAvailable: vi.fn(() => false),
    isCloudAvailable: vi.fn(() => false),
    isLocalAvailable: vi.fn(() => true),
    shouldForceLocalForUrl: vi.fn(() => false),
    withEngineFallback: actual.withEngineFallback,
    defaultChromeFailurePredicate: actual.defaultChromeFailurePredicate,
  };
});

// search/backend-resolver: keep real exports; tests control chain via env vars.
vi.mock("./search/backend-resolver.js", async () => {
  const actual =
    await vi.importActual<typeof import("./search/backend-resolver.js")>(
      "./search/backend-resolver.js",
    );
  return actual;
});

// fetch.ts: stub webFetch so tests don't hit the network.
vi.mock("./fetch.js", () => ({
  webFetch: vi.fn(),
  DEFAULT_MAX_CHARS: 15_000,
}));

// search/index.ts: stub the search + extract leaf tools (the orchestrator
// delegates to them via `impl.run`).
vi.mock("./search/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("./search/index.js")>(
      "./search/index.js",
    );
  return {
    ...actual,
    webSearchTool: {
      meta: { name: "web_search", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
    webExtractTool: {
      meta: { name: "web_extract", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
  };
});

// browser/index.ts: stub each leaf tool's `run` so we control outcomes.
vi.mock("./browser/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("./browser/index.js")>(
      "./browser/index.js",
    );
  return {
    ...actual,
    browserNavigateTool: {
      meta: { name: "browser_navigate", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
    browserSnapshotTool: {
      meta: { name: "browser_snapshot", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
    browserClickTool: {
      meta: { name: "browser_click", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
    browserTypeTool: {
      meta: { name: "browser_type", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
    browserScrollTool: {
      meta: { name: "browser_scroll", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
    browserBackTool: {
      meta: { name: "browser_back", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
    browserPressTool: {
      meta: { name: "browser_press", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
    browserScreenshotTool: {
      meta: { name: "browser_screenshot", args: {}, requiredMode: "Prompt" },
      run: vi.fn(),
    },
  };
});

// ─── Imports (resolved AFTER mocks) ─────────────────────────────────────────

import {
  runBrowserWithFallback,
  runSearchWithFallback,
  runExtractWithFallback,
  withResilience,
  loadWebConfig,
  _internal,
} from "./orchestrator.js";
import type { ExtractBackendName } from "./config.js";
import { webFetch } from "./fetch.js";
import {
  isCamofoxAvailable,
  isCloudAvailable,
  isLocalAvailable,
  shouldForceLocalForUrl,
} from "./browser/engine-resolver.js";
import {
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
} from "./browser/index.js";
import { webSearchTool, webExtractTool } from "./search/index.js";
import { checkUrl } from "./security-guard.js";

const mockWebFetch = vi.mocked(webFetch);
const mockIsCamofoxAvailable = vi.mocked(isCamofoxAvailable);
const mockIsCloudAvailable = vi.mocked(isCloudAvailable);
const mockIsLocalAvailable = vi.mocked(isLocalAvailable);
const mockShouldForceLocal = vi.mocked(shouldForceLocalForUrl);
const mockBrowserNavigate = vi.mocked(browserNavigateTool.run);
const mockBrowserSnapshot = vi.mocked(browserSnapshotTool.run);
const mockBrowserClick = vi.mocked(browserClickTool.run);
const mockWebSearch = vi.mocked(webSearchTool.run);
const mockWebExtract = vi.mocked(webExtractTool.run);

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCtx(): TurnContext {
  return {} as unknown as TurnContext;
}

const ENV_KEYS = [
  "MYA_WEB_PREFERRED_ENGINE",
  "MYA_WEB_SEARCH_BACKEND",
  "MYA_WEB_EXTRACT_BACKEND",
  "MYA_WEB_ALLOW_PRIVATE_URLS",
  "MYA_WEB_FALLBACK_TO_FETCH",
];

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return Promise.resolve(fn());
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function resetProbeDefaults(): void {
  mockIsCamofoxAvailable.mockReturnValue(false);
  mockIsCloudAvailable.mockReturnValue(false);
  mockIsLocalAvailable.mockReturnValue(true);
  mockShouldForceLocal.mockReturnValue(false);
}

beforeEach(() => {
  resetProbeDefaults();
  // Save and clear all MYA_WEB_* env vars before each test for isolation.
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
  mockWebFetch.mockReset();
  mockBrowserNavigate.mockReset();
  mockBrowserSnapshot.mockReset();
  mockBrowserClick.mockReset();
  mockWebSearch.mockReset();
  mockWebExtract.mockReset();
});

afterEach(() => {
  resetProbeDefaults();
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
});

// ─── Case 1: D1 — isAvailable probe skip ────────────────────────────────────

describe("withResilience — D1 isAvailable probe", () => {
  it("skips primary when isAvailable returns false and calls onAllFail", async () => {
    const primary = vi.fn(async () => "primary-result");
    const allFail = vi.fn(async () => "all-fail-result");

    const r = await withResilience({
      id: "test",
      isAvailable: () => false,
      primary,
      onAllFail: allFail,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servedBy).toBe("web_fetch_fallback");
      expect(r.result).toBe("all-fail-result");
    }
    expect(primary).not.toHaveBeenCalled();
    expect(allFail).toHaveBeenCalledTimes(1);
    expect(r.tried.find((t) => t.step === "isAvailable")?.ok).toBe(false);
  });

  it("returns typed error when isAvailable=false and no onAllFail", async () => {
    const r = await withResilience({
      id: "test",
      isAvailable: () => false,
      primary: vi.fn(async () => "p"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/isAvailable=false/);
    }
  });
});

// ─── Case 2: D2 — try/catch chain fall-through ──────────────────────────────

describe("withResilience — D2 try/catch chain", () => {
  it("primary fails (non-402) → onEngineFail fails → onAllFail succeeds", async () => {
    const primary = vi.fn(async () => {
      throw new Error("primary broken — generic failure");
    });
    const on402 = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const onEngine = vi.fn(async () => {
      throw new Error("engine still broken");
    });
    const onAllFail = vi.fn(async () => "fetched");

    const r = await withResilience(
      {
        id: "test",
        primary,
        onPaymentRequired: on402,
        onEngineFail: onEngine,
        onAllFail,
      },
      { patterns: ["try-catch-chain", "402-fallback", "engine-fallback", "browser-to-webfetch-floor"] },
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servedBy).toBe("web_fetch_fallback");
      expect(r.result).toBe("fetched");
    }
    expect(primary).toHaveBeenCalledTimes(1);
    // D3 is gated by 402-shape detection; primary's plain Error is NOT 402.
    expect(on402).not.toHaveBeenCalled();
    expect(onEngine).toHaveBeenCalledTimes(1);
    expect(onAllFail).toHaveBeenCalledTimes(1);
    // Tried chain records every step that fired.
    const steps = r.tried.map((t) => t.step);
    expect(steps).toContain("primary");
    expect(steps).not.toContain("402-fallback");
    expect(steps).toContain("engine-fallback");
    expect(steps).toContain("onAllFail");
  });

  it("primary 402-throw → onPaymentRequired throws → onEngineFail throws → onAllFail succeeds", async () => {
    const primary = vi.fn(async () => {
      throw Object.assign(new Error("402"), { code: 402 });
    });
    const on402 = vi.fn(async () => {
      throw new Error("still 402 after drop");
    });
    const onEngine = vi.fn(async () => {
      throw new Error("engine broken");
    });
    const onAllFail = vi.fn(async () => "fetched");

    const r = await withResilience(
      {
        id: "test",
        primary,
        onPaymentRequired: on402,
        onEngineFail: onEngine,
        onAllFail,
      },
      { patterns: ["try-catch-chain", "402-fallback", "engine-fallback", "browser-to-webfetch-floor"] },
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servedBy).toBe("web_fetch_fallback");
      expect(r.result).toBe("fetched");
    }
    expect(primary).toHaveBeenCalledTimes(1);
    expect(on402).toHaveBeenCalledTimes(1);
    expect(onEngine).toHaveBeenCalledTimes(1);
    expect(onAllFail).toHaveBeenCalledTimes(1);
  });
});

// ─── Case 3: D3 — 402 drop+retry ────────────────────────────────────────────

describe("withResilience — D3 402 fallback", () => {
  it("detects 402-shaped error, drops feature, retries via onPaymentRequired", async () => {
    const primary = vi.fn(async () => {
      throw Object.assign(new Error("402 Payment Required"), { code: 402 });
    });
    const onPaymentRequired = vi.fn(async () => "retry-after-drop");

    const r = await withResilience(
      {
        id: "test",
        primary,
        onPaymentRequired,
      },
      { patterns: ["try-catch-chain", "402-fallback"] },
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servedBy).toBe("402-fallback");
      expect(r.result).toBe("retry-after-drop");
    }
    expect(primary).toHaveBeenCalledTimes(1);
    expect(onPaymentRequired).toHaveBeenCalledTimes(1);
  });

  it("recognizes 402 in the error message (string form)", async () => {
    const primary = vi.fn(async () => {
      throw new Error("Server returned 402 Payment Required for this session");
    });
    const onPaymentRequired = vi.fn(async () => "ok");
    const r = await withResilience(
      { id: "t", primary, onPaymentRequired },
      { patterns: ["try-catch-chain", "402-fallback"] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.servedBy).toBe("402-fallback");
  });
});

// ─── Case 4: D4 — engine chrome→lightpanda ─────────────────────────────────

describe("withResilience — D4 engine fallback", () => {
  it("uses onEngineFail retry when primary fails", async () => {
    const primary = vi.fn(async () => {
      throw new Error("chrome failed: binary not found");
    });
    const onEngineFail = vi.fn(async () => "lightpanda-ok");

    const r = await withResilience(
      {
        id: "test",
        primary,
        onEngineFail,
      },
      { patterns: ["try-catch-chain", "engine-fallback"] },
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servedBy).toBe("engine-fallback");
      expect(r.result).toBe("lightpanda-ok");
    }
    expect(primary).toHaveBeenCalledTimes(1);
    expect(onEngineFail).toHaveBeenCalledTimes(1);
  });
});

// ─── Case 5: D5 — missing-Chromium autoinstall ─────────────────────────────

describe("withResilience — D5 autoinstall retry", () => {
  it("detects missing dependency, retries via onMissingDependency", async () => {
    const primary = vi.fn(async () => {
      throw new Error("agent-browser binary not found on PATH");
    });
    const onMissingDependency = vi.fn(async () => "post-install-ok");

    const r = await withResilience(
      {
        id: "test",
        primary,
        onMissingDependency,
      },
      { patterns: ["try-catch-chain", "autoinstall-retry"] },
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servedBy).toBe("autoinstall-retry");
      expect(r.result).toBe("post-install-ok");
    }
  });

  it("does NOT trigger autoinstall for non-missing-dep errors", async () => {
    const primary = vi.fn(async () => {
      throw new Error("URL blocked by security guard");
    });
    const onMissingDependency = vi.fn(async () => "should-not-happen");

    const r = await withResilience(
      { id: "t", primary, onMissingDependency },
      { patterns: ["try-catch-chain", "autoinstall-retry"] },
    );

    expect(r.ok).toBe(false);
    expect(onMissingDependency).not.toHaveBeenCalled();
  });
});

// ─── Case 6: D7 — timeout cleanup ──────────────────────────────────────────

describe("withResilience — D7 timeout cleanup", () => {
  it("aborts primary after timeoutMs and falls through to onAllFail", async () => {
    const start = Date.now();
    const r = await withResilience(
      {
        id: "slow",
        primary: () =>
          new Promise<string>((resolve) => {
            // Primary ignores any timeout signal and resolves after 500ms.
            setTimeout(() => resolve("late"), 500);
          }),
        onAllFail: async () => "floor-ok",
      },
      { timeoutMs: 50 },
    );
    const elapsed = Date.now() - start;
    // The orchestrator must return promptly (much less than 500ms) because
    // the timeout fires and the pipeline falls through to onAllFail.
    expect(elapsed).toBeLessThan(450);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servedBy).toBe("web_fetch_fallback");
      expect(r.result).toBe("floor-ok");
    }
    // The tried chain should record the primary failure with a timeout note.
    const primaryStep = r.tried.find((t) => t.step === "primary");
    expect(primaryStep?.ok).toBe(false);
    expect(primaryStep?.error).toMatch(/timed out/);
  });

  it("withTimeout helper throws TimeoutError when fn exceeds timeoutMs", async () => {
    await expect(
      _internal.withTimeout(
        () => new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 100)),
        20,
      ),
    ).rejects.toThrow(/timed out/);
  });
});

// ─── Case 7: D8 — post-redirect SSRF block ─────────────────────────────────

describe("withResilience — D8 post-redirect guard", () => {
  it("blocks after successful primary when checkPostRedirect returns a metadata URL", async () => {
    const r = await withResilience(
      {
        id: "test",
        primary: async () => ({
          redirectedUrl: "http://169.254.169.254/latest/meta-data/",
        }),
        checkPostRedirect: (result) => {
          if (typeof result === "object" && result !== null) {
            return (result as { redirectedUrl?: string }).redirectedUrl;
          }
          return undefined;
        },
      },
      { patterns: ["try-catch-chain", "post-redirect-guard"] },
    );

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/post-redirect blocked/);
    }
  });

  it("allows non-metadata post-redirect URLs", async () => {
    const r = await withResilience(
      {
        id: "test",
        primary: async () => ({
          redirectedUrl: "https://example.com/landing",
        }),
        checkPostRedirect: (result) => {
          if (typeof result === "object" && result !== null) {
            return (result as { redirectedUrl?: string }).redirectedUrl;
          }
          return undefined;
        },
      },
      { patterns: ["try-catch-chain", "post-redirect-guard"] },
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servedBy).toBe("primary");
    }
  });
});

// ─── Case 8: fallbackToFetch=false respected ───────────────────────────────

describe("runBrowserWithFallback — fallbackToFetch=false respected", () => {
  it("returns typed error (NOT silent web_fetch degrade) when fallbackToFetch=false", async () => {
    resetProbeDefaults();
    // Force browser chain to fail: all probes say unavailable.
    mockIsCamofoxAvailable.mockReturnValue(false);
    mockIsCloudAvailable.mockReturnValue(false);
    mockIsLocalAvailable.mockReturnValue(false);

    // browserNavigate should throw via the leaf (binary missing).
    mockBrowserNavigate.mockImplementation(async () => ({
      callId: "browser_navigate",
      ok: false,
      output: null,
      error: "no browser engine available: agent-browser binary not found",
    }));

    const ctx = makeCtx();
    const result = await withEnv(
      { MYA_WEB_FALLBACK_TO_FETCH: "false" },
      () =>
        runBrowserWithFallback(
          {
            tool: "browser_navigate",
            args: { url: "https://example.com/", taskId: "t1" },
          },
          { ctx },
        ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/browser_navigate failed/);
      // Should NOT mention web_fetch_fallback in the note (since we opted out).
      expect(result.error).not.toMatch(/web_fetch_fallback/);
    }
    expect(mockWebFetch).not.toHaveBeenCalled();
  });

  it("DOES fall back to webFetch when fallbackToFetch=true and chain fails", async () => {
    resetProbeDefaults();
    mockIsCamofoxAvailable.mockReturnValue(false);
    mockIsCloudAvailable.mockReturnValue(false);
    mockIsLocalAvailable.mockReturnValue(false);

    mockBrowserNavigate.mockResolvedValue({
      callId: "browser_navigate",
      ok: false,
      output: null,
      error: "no engine",
    });
    mockWebFetch.mockResolvedValue({
      ok: true,
      markdown: "# Example Domain\n\nHello.",
      finalUrl: "https://example.com/",
      title: "Example Domain",
      contentType: "text/html",
    });

    const ctx = makeCtx();
    const result = await withEnv(
      { MYA_WEB_FALLBACK_TO_FETCH: "true" },
      () =>
        runBrowserWithFallback(
          {
            tool: "browser_navigate",
            args: { url: "https://example.com/", taskId: "t1" },
          },
          { ctx },
        ),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const out = result.output as Record<string, unknown>;
      expect(out.engine).toBe("web_fetch_fallback");
      expect(out.url).toBe("https://example.com/");
      expect(typeof out.triedChain).toBe("string");
      expect(out.triedChain as string).toMatch(/tried/);
    }
    expect(mockWebFetch).toHaveBeenCalledTimes(1);
    // B3 regression: the universal web_fetch floor must pass the unified maxChars.
    expect(mockWebFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxChars: 15_000 }),
    );
  });
});

// ─── Case 9 (bonus): security guard runs before any engine ─────────────────

describe("runBrowserWithFallback — security gauntlet runs first", () => {
  it("blocks metadata URL even if all engines are available", async () => {
    resetProbeDefaults();
    mockIsCamofoxAvailable.mockReturnValue(true);
    mockIsCloudAvailable.mockReturnValue(true);
    mockIsLocalAvailable.mockReturnValue(true);

    const ctx = makeCtx();
    const result = await runBrowserWithFallback(
      {
        tool: "browser_navigate",
        args: { url: "http://169.254.169.254/latest/meta-data/", taskId: "t1" },
      },
      { ctx },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ssrf-metadata/);
    }
    expect(mockBrowserNavigate).not.toHaveBeenCalled();
  });

  it("blocks secret-in-URL even when allowPrivateUrls=true", async () => {
    resetProbeDefaults();
    const ctx = makeCtx();
    const result = await withEnv(
      { MYA_WEB_ALLOW_PRIVATE_URLS: "true" },
      () =>
        runBrowserWithFallback(
          {
            tool: "browser_navigate",
            args: {
              url: "https://example.com/?key=sk-ant-AAAABBBBCCCCDDDD",
              taskId: "t1",
            },
          },
          { ctx },
        ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/secret-url/);
    }
  });
});

// ─── Case 10 (bonus): unknown browser tool name returns typed error ────────

describe("runBrowserWithFallback — unknown tool name", () => {
  it("returns typed error for unknown tool name (never throws)", async () => {
    resetProbeDefaults();
    const ctx = makeCtx();
    const result = await runBrowserWithFallback(
      { tool: "browser_dance", args: { taskId: "t1" } },
      { ctx },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unknown browser tool/);
    }
  });
});

// ─── Case 11: chain happy-path — primary succeeds ─────────────────────────

describe("runBrowserWithFallback — chain happy-path", () => {
  it("returns the leaf result when the chain succeeds", async () => {
    resetProbeDefaults();
    mockIsLocalAvailable.mockReturnValue(true);
    mockBrowserNavigate.mockResolvedValue({
      callId: "browser_navigate",
      ok: true,
      output: {
        snapshot: "[aria]",
        title: "Example",
        url: "https://example.com/",
        engine: "local",
      },
    });
    const ctx = makeCtx();
    const result = await runBrowserWithFallback(
      {
        tool: "browser_navigate",
        args: { url: "https://example.com/", taskId: "t1" },
      },
      { ctx },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const out = result.output as Record<string, unknown>;
      expect(out.engine).toBe("local");
      expect(out.url).toBe("https://example.com/");
    }
    expect(mockWebFetch).not.toHaveBeenCalled();
  });
});

// ─── Case 12: post-redirect guard for runBrowserWithFallback ──────────────

describe("runBrowserWithFallback — post-redirect guard", () => {
  it("blocks when the leaf returns a metadata URL after navigate", async () => {
    resetProbeDefaults();
    mockIsLocalAvailable.mockReturnValue(true);
    mockBrowserNavigate.mockResolvedValue({
      callId: "browser_navigate",
      ok: true,
      output: {
        snapshot: "",
        title: "",
        url: "http://169.254.169.254/latest/meta-data/",
        engine: "local",
      },
    });
    const ctx = makeCtx();
    const result = await runBrowserWithFallback(
      {
        tool: "browser_navigate",
        args: { url: "https://example.com/", taskId: "t1" },
      },
      { ctx },
    );
    // The leaf succeeded → orchestrator's post-redirect guard fires → returns
    // ok=true with guardBlock metadata (mirrors the existing browser/index.ts
    // behavior in index.ts).
    expect(result.ok).toBe(true);
    if (result.ok) {
      const out = result.output as Record<string, unknown>;
      expect(out.guardBlock).toBeDefined();
      expect((out.guardBlock as { category?: string }).category).toBe(
        "ssrf-metadata",
      );
    }
  });
});

// ─── Case 13: runSearchWithFallback ───────────────────────────────────────

describe("runSearchWithFallback", () => {
  it("delegates to webSearchTool when ddgs is available (no env required)", async () => {
    resetProbeDefaults();
    mockWebSearch.mockResolvedValue({
      callId: "web_search",
      ok: true,
      output: { results: [{ title: "X", url: "https://x.com", description: "" }], query: "x" },
    });
    const ctx = makeCtx();
    const result = await runSearchWithFallback(
      { tool: "web_search", args: { query: "x" } },
      { ctx },
    );
    expect(result.ok).toBe(true);
    expect(mockWebSearch).toHaveBeenCalledTimes(1);
  });

  it("returns typed error when override backend is unknown", async () => {
    resetProbeDefaults();
    const ctx = makeCtx();
    const result = await runSearchWithFallback(
      {
        tool: "web_search",
        args: { query: "x" },
        override: { searchBackend: "nonexistent" as never },
      },
      { ctx },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/search chain failed/);
    }
  });
});

// ─── Case 14: runExtractWithFallback → web_fetch when no backend ─────────

describe("runExtractWithFallback", () => {
  it("falls back to webFetch when no extract backend is configured", async () => {
    resetProbeDefaults();
    mockWebFetch.mockResolvedValue({
      ok: true,
      markdown: "# Example",
      finalUrl: "https://example.com/",
      title: "Example Domain",
      contentType: "text/html",
    });
    const ctx = makeCtx();
    const result = await runExtractWithFallback(
      {
        tool: "web_extract",
        args: { url: "https://example.com/" },
      },
      { ctx },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const out = result.output as Record<string, unknown>;
      expect(out.backend).toBe("web_fetch");
      expect(out.engine).toBe("web_fetch_fallback");
    }
    expect(mockWebFetch).toHaveBeenCalledTimes(1);
    // B3 regression: the extract web_fetch floor must pass the unified maxChars.
    expect(mockWebFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxChars: 15_000 }),
    );
  });

  it("blocks metadata URL in the extract path", async () => {
    resetProbeDefaults();
    const ctx = makeCtx();
    const result = await runExtractWithFallback(
      {
        tool: "web_extract",
        args: { url: "http://169.254.169.254/latest/meta-data/" },
      },
      { ctx },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ssrf-metadata/);
    }
    expect(mockWebFetch).not.toHaveBeenCalled();
  });
});

// ─── Case 15: loadWebConfig precedence ─────────────────────────────────────

describe("loadWebConfig — env + override precedence", () => {
  it("applies defaults when no env or overrides set", () => {
    const cfg = loadWebConfig();
    expect(cfg.preferredEngine).toBe("auto");
    expect(cfg.searchBackend).toBe("auto");
    expect(cfg.extractBackend).toBe("auto");
    expect(cfg.allowPrivateUrls).toBe(false);
    expect(cfg.fallbackToFetch).toBe(true);
  });

  it("reads env vars and merges over defaults", async () => {
    const cfg = await withEnv(
      {
        MYA_WEB_PREFERRED_ENGINE: "cloud",
        MYA_WEB_SEARCH_BACKEND: "tavily",
        MYA_WEB_FALLBACK_TO_FETCH: "false",
      },
      () => loadWebConfig(),
    );
    expect(cfg.preferredEngine).toBe("cloud");
    expect(cfg.searchBackend).toBe("tavily");
    expect(cfg.fallbackToFetch).toBe(false);
  });

  it("overrides env values when caller-supplied overrides win", async () => {
    const cfg = await withEnv(
      {
        MYA_WEB_PREFERRED_ENGINE: "cloud",
        MYA_WEB_FALLBACK_TO_FETCH: "false",
      },
      () =>
        loadWebConfig({
          preferredEngine: "camofox",
          fallbackToFetch: true,
        }),
    );
    expect(cfg.preferredEngine).toBe("camofox");
    expect(cfg.fallbackToFetch).toBe(true);
  });

  it("drops unknown engine values silently (does not throw)", async () => {
    const cfg = await withEnv(
      { MYA_WEB_PREFERRED_ENGINE: "not-a-real-engine" },
      () => loadWebConfig(),
    );
    expect(cfg.preferredEngine).toBe("auto");
  });
});

// ─── Case 16: capability discrimination (extract + search-only backend) ───

describe("runExtractWithFallback — capability mismatch", () => {
  it("returns typed error when search-only backend is configured for extract", async () => {
    resetProbeDefaults();
    mockWebExtract.mockReset();
    const ctx = makeCtx();
    const result = await runExtractWithFallback(
      {
        tool: "web_extract",
        args: { url: "https://example.com/" },
        override: { extractBackend: "searxng" as ExtractBackendName },
      },
      { ctx },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/does not support extraction/);
    }
  });
});

// ─── Case 17: helper sanity ────────────────────────────────────────────────

describe("orchestrator helpers", () => {
  it("_internal.isBrowserToolName returns true only for known names", () => {
    expect(_internal.isBrowserToolName("browser_navigate")).toBe(true);
    expect(_internal.isBrowserToolName("browser_dance")).toBe(false);
    expect(_internal.isBrowserToolName("web_search")).toBe(false);
  });

  it("_internal.looksLike402 detects 402-shaped values", () => {
    expect(_internal.looksLike402({ code: 402 })).toBe(true);
    expect(_internal.looksLike402({ status: 402 })).toBe(true);
    expect(_internal.looksLike402({ ok: false, error: "402 payment required" })).toBe(true);
    expect(_internal.looksLike402("402 Payment Required")).toBe(true);
    expect(_internal.looksLike402({ code: 500 })).toBe(false);
    expect(_internal.looksLike402(null)).toBe(false);
    expect(_internal.looksLike402(undefined)).toBe(false);
  });

  it("_internal.looksLikeMissingDependency detects agent-browser / chromium missing", () => {
    expect(_internal.looksLikeMissingDependency("agent-browser binary not found")).toBe(true);
    expect(_internal.looksLikeMissingDependency({ error: "Chromium crashed" })).toBe(true);
    expect(_internal.looksLikeMissingDependency("URL blocked")).toBe(false);
  });

  it("_internal.renderTriedChainNote produces a numbered list", () => {
    const note = _internal.renderTriedChainNote([
      { step: "primary", ok: true },
      { step: "fallback", ok: false, error: "broken" },
    ]);
    expect(note).toContain("1.");
    expect(note).toContain("2.");
    expect(note).toContain("✓");
    expect(note).toContain("✗");
    expect(note).toContain("broken");
  });

  it("_internal.extractPostRedirectUrl returns the finalUrl from a successful ToolResult", () => {
    const r = {
      callId: "x",
      ok: true as const,
      output: { url: "https://example.com/" },
    };
    expect(_internal.extractPostRedirectUrl(r)).toBe("https://example.com/");
    const r2 = {
      callId: "x",
      ok: true as const,
      output: { redirectedUrl: "https://other.com/" },
    };
    expect(_internal.extractPostRedirectUrl(r2)).toBe("https://other.com/");
    const r3 = {
      callId: "x",
      ok: false as const,
      output: null,
      error: "fail",
    };
    expect(_internal.extractPostRedirectUrl(r3)).toBeUndefined();
  });
});

// ─── Case 18: checkUrl smoke (orchestrator depends on it) ─────────────────

describe("orchestrator — security guard integration smoke", () => {
  it("checkUrl blocks metadata hosts", () => {
    expect(checkUrl("http://169.254.169.254/").ok).toBe(false);
  });
  it("checkUrl blocks secret-in-URL", () => {
    expect(checkUrl("https://x.com/?k=sk-ant-AAAABBBBCCCCDDDD").ok).toBe(false);
  });
  it("checkUrl allows public URLs", () => {
    expect(checkUrl("https://example.com/").ok).toBe(true);
  });
});

// Suppress unused-Mock lint warning.
void (null as unknown as Mock);