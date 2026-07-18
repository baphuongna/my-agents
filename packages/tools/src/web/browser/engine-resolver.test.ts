/**
 * engine-resolver tests — Chain A complete: camofox / cloud / local.
 *
 * Tests the real availability probes with mocked fetch (camofox) and env vars
 * (cloud). Local is mocked via session.isBinaryLocal.
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks (hoisted) ────────────────────────────────────────────────

vi.mock("./session.js", () => ({
  isBinaryLocal: vi.fn(() => true),
}));

// Mock camofox-client.js so we can control the async probe cache from sync tests.
vi.mock("./camofox-client.js", async () => {
  const actual = await vi.importActual<typeof import("./camofox-client.js")>(
    "./camofox-client.js",
  );
  return {
    ...actual,
    isCamofoxConfigured: vi.fn(actual.isCamofoxConfigured),
    getCachedCamofoxHealth: vi.fn(actual.getCachedCamofoxHealth),
    // Keep the async isCamofoxAvailable real (not used in sync tests).
    isCamofoxAvailable: actual.isCamofoxAvailable,
    resetCamofoxHealthCache: actual.resetCamofoxHealthCache,
  };
});

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { isBinaryLocal } from "./session.js";
import {
  isCamofoxConfigured,
  getCachedCamofoxHealth,
  resetCamofoxHealthCache,
} from "./camofox-client.js";
import {
  resolveBrowserEngine,
  isCamofoxAvailable,
  isCloudAvailable,
  isLocalAvailable,
  shouldForceLocalForUrl,
  isBrowserbaseAvailable,
  isBrowserUseAvailable,
  withEngineFallback,
  defaultChromeFailurePredicate,
} from "./engine-resolver.js";
import type { AgentBrowserResult } from "./agent-browser-runner.js";

const mockIsBinaryLocal = vi.mocked(isBinaryLocal);
const mockIsCamofoxConfigured = vi.mocked(isCamofoxConfigured);
const mockGetCachedCamofoxHealth = vi.mocked(getCachedCamofoxHealth);

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Save and restore process.env around a block. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── Setup / teardown ─────────────────────────────────────────────────────

beforeEach(() => {
  mockIsBinaryLocal.mockReturnValue(true);
  // Default: camofox unconfigured (env not set) → sync probe returns false.
  mockIsCamofoxConfigured.mockImplementation(
    (cfg) => typeof cfg?.baseUrl === "string" && cfg.baseUrl.trim().length > 0,
  );
  // Default: no cached health → sync probe falls through to optimistic.
  mockGetCachedCamofoxHealth.mockReturnValue(undefined);
  resetCamofoxHealthCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clean env vars set by individual tests.
  delete process.env.BROWSERBASE_API_KEY;
  delete process.env.BROWSERBASE_PROJECT_ID;
  delete process.env.BROWSER_USE_API_KEY;
  delete process.env.CAMOFOX_URL;
});

// ─── isCamofoxAvailable — sync two-phase probe ────────────────────────────

describe("engine-resolver — isCamofoxAvailable", () => {
  it("returns false when CAMOFOX_URL is unset (no config)", () => {
    mockIsCamofoxConfigured.mockReturnValue(false);
    expect(isCamofoxAvailable()).toBe(false);
  });

  it("returns false when CAMOFOX_URL is unset (config overrides)", () => {
    mockIsCamofoxConfigured.mockReturnValue(false);
    expect(isCamofoxAvailable({ camofoxUrl: undefined })).toBe(false);
  });

  it("returns false when cached health is false (server down)", () => {
    mockIsCamofoxConfigured.mockReturnValue(true);
    mockGetCachedCamofoxHealth.mockReturnValue(false);
    expect(isCamofoxAvailable({ camofoxUrl: "http://localhost:9377" })).toBe(false);
  });

  it("returns true when cached health is true (server up)", () => {
    mockIsCamofoxConfigured.mockReturnValue(true);
    mockGetCachedCamofoxHealth.mockReturnValue(true);
    expect(isCamofoxAvailable({ camofoxUrl: "http://localhost:9377" })).toBe(true);
  });

  it("returns true optimistically when env is set but no cache yet", () => {
    mockIsCamofoxConfigured.mockReturnValue(true);
    mockGetCachedCamofoxHealth.mockReturnValue(undefined);
    // Optimistic fallback: env-var present → trust the signal.
    expect(isCamofoxAvailable({ camofoxUrl: "http://localhost:9377" })).toBe(true);
  });

  it("passes config.camofoxUrl through to isCamofoxConfigured", () => {
    mockIsCamofoxConfigured.mockClear();
    isCamofoxAvailable({ camofoxUrl: "http://my-camofox:9377" });
    expect(mockIsCamofoxConfigured).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://my-camofox:9377" }),
    );
  });
});

// ─── isCloudAvailable — sync env-var probe ────────────────────────────────

describe("engine-resolver — isCloudAvailable", () => {
  it("returns false when no cloud env vars are set", () => {
    expect(isCloudAvailable()).toBe(false);
  });

  it("returns true when BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID are set", () => {
    withEnv(
      {
        BROWSERBASE_API_KEY: "bb-key-123",
        BROWSERBASE_PROJECT_ID: "proj-456",
      },
      () => {
        expect(isCloudAvailable()).toBe(true);
      },
    );
  });

  it("returns true when only BROWSER_USE_API_KEY is set", () => {
    withEnv({ BROWSER_USE_API_KEY: "bu-key-789" }, () => {
      expect(isCloudAvailable()).toBe(true);
    });
  });

  it("returns true when BOTH providers are configured", () => {
    withEnv(
      {
        BROWSERBASE_API_KEY: "bb-key",
        BROWSERBASE_PROJECT_ID: "proj",
        BROWSER_USE_API_KEY: "bu-key",
      },
      () => {
        expect(isCloudAvailable()).toBe(true);
        expect(isBrowserbaseAvailable()).toBe(true);
        expect(isBrowserUseAvailable()).toBe(true);
      },
    );
  });

  it("returns false when BROWSERBASE_API_KEY is set but project ID is missing", () => {
    withEnv(
      {
        BROWSERBASE_API_KEY: "bb-key",
        BROWSERBASE_PROJECT_ID: undefined,
      },
      () => {
        expect(isCloudAvailable()).toBe(false);
      },
    );
  });

  it("honors config-level browserbaseApiKey override", () => {
    withEnv({ BROWSERBASE_API_KEY: undefined, BROWSERBASE_PROJECT_ID: undefined }, () => {
      expect(
        isCloudAvailable({
          browserbaseApiKey: "override-key",
          browserbaseProjectId: "override-proj",
        }),
      ).toBe(true);
      // Env should be restored after the call.
      expect(process.env.BROWSERBASE_API_KEY).toBeUndefined();
      expect(process.env.BROWSERBASE_PROJECT_ID).toBeUndefined();
    });
  });

  it("honors config-level browserUseApiKey override", () => {
    withEnv({ BROWSER_USE_API_KEY: undefined }, () => {
      expect(isCloudAvailable({ browserUseApiKey: "override-bu" })).toBe(true);
      expect(process.env.BROWSER_USE_API_KEY).toBeUndefined();
    });
  });

  it("clears config override that is empty string (treat as undefined)", () => {
    withEnv({ BROWSERBASE_API_KEY: undefined, BROWSERBASE_PROJECT_ID: undefined }, () => {
      // Empty-string overrides → not set; should not flip probe to true.
      expect(
        isCloudAvailable({
          browserbaseApiKey: "",
          browserbaseProjectId: "",
        }),
      ).toBe(false);
    });
  });
});

// ─── isLocalAvailable ─────────────────────────────────────────────────────

describe("engine-resolver — isLocalAvailable", () => {
  it("returns true when binary is local", () => {
    mockIsBinaryLocal.mockReturnValue(true);
    expect(isLocalAvailable()).toBe(true);
  });

  it("returns false when binary is absent", () => {
    mockIsBinaryLocal.mockReturnValue(false);
    expect(isLocalAvailable()).toBe(false);
  });
});

// ─── resolveBrowserEngine — chain A complete ──────────────────────────────

describe("engine-resolver — resolveBrowserEngine chain", () => {
  beforeEach(() => {
    mockIsBinaryLocal.mockReturnValue(true);
  });

  it("returns local by default (no camofox, no cloud configured)", () => {
    const result = resolveBrowserEngine();
    expect("unavailable" in result).toBe(false);
    if (!("unavailable" in result)) {
      expect(result.engine).toBe("local");
      expect(result.sessionName).toBe("mya-default");
    }
  });

  it("returns local with explicit auto preference (no providers configured)", () => {
    const result = resolveBrowserEngine({ preferredEngine: "auto" });
    expect("unavailable" in result).toBe(false);
    if (!("unavailable" in result)) {
      expect(result.engine).toBe("local");
    }
  });

  it("returns camofox when CAMOFOX_URL set + health ok", () => {
    mockIsCamofoxConfigured.mockReturnValue(true);
    mockGetCachedCamofoxHealth.mockReturnValue(true);
    const result = resolveBrowserEngine({
      preferredEngine: "auto",
      camofoxUrl: "http://localhost:9377",
    });
    expect("unavailable" in result).toBe(false);
    if (!("unavailable" in result)) {
      expect(result.engine).toBe("camofox");
      expect(result.cdpUrl).toBe("http://localhost:9377");
      expect(result.features).toContain("anti-detect");
    }
  });

  it("returns cloud when camofox absent but cloud configured (auto)", () => {
    withEnv(
      { BROWSERBASE_API_KEY: "bb-key", BROWSERBASE_PROJECT_ID: "proj" },
      () => {
        mockIsCamofoxConfigured.mockReturnValue(false);
        const result = resolveBrowserEngine({
          preferredEngine: "auto",
          cloudCdpUrl: "ws://browserbase.example/session",
        });
        expect("unavailable" in result).toBe(false);
        if (!("unavailable" in result)) {
          expect(result.engine).toBe("cloud");
          expect(result.cdpUrl).toBe("ws://browserbase.example/session");
          expect(result.features).toContain("stealth");
        }
      },
    );
  });

  it("returns camofox (preferred over cloud) when both configured", () => {
    withEnv(
      { BROWSERBASE_API_KEY: "bb-key", BROWSERBASE_PROJECT_ID: "proj" },
      () => {
        mockIsCamofoxConfigured.mockReturnValue(true);
        mockGetCachedCamofoxHealth.mockReturnValue(true);
        const result = resolveBrowserEngine({
          preferredEngine: "auto",
          camofoxUrl: "http://localhost:9377",
          cloudCdpUrl: "ws://cloud.example/session",
        });
        expect("unavailable" in result).toBe(false);
        if (!("unavailable" in result)) {
          expect(result.engine).toBe("camofox");
        }
      },
    );
  });

  it("returns camofox for explicit preference when available", () => {
    mockIsCamofoxConfigured.mockReturnValue(true);
    mockGetCachedCamofoxHealth.mockReturnValue(true);
    const result = resolveBrowserEngine({
      preferredEngine: "camofox",
      camofoxUrl: "http://localhost:9377",
    });
    expect("unavailable" in result).toBe(false);
    if (!("unavailable" in result)) {
      expect(result.engine).toBe("camofox");
      expect(result.cdpUrl).toBe("http://localhost:9377");
    }
  });

  it("returns unavailable for explicit camofox preference when unconfigured", () => {
    mockIsCamofoxConfigured.mockReturnValue(false);
    const result = resolveBrowserEngine({ preferredEngine: "camofox" });
    expect("unavailable" in result).toBe(true);
    if ("unavailable" in result) {
      expect(result.engine).toBe("camofox");
      expect(result.reason).toContain("CAMOFOX_URL");
    }
  });

  it("returns unavailable for explicit camofox preference when health probe failed", () => {
    mockIsCamofoxConfigured.mockReturnValue(true);
    mockGetCachedCamofoxHealth.mockReturnValue(false);
    const result = resolveBrowserEngine({
      preferredEngine: "camofox",
      camofoxUrl: "http://localhost:9377",
    });
    expect("unavailable" in result).toBe(true);
    if ("unavailable" in result) {
      expect(result.engine).toBe("camofox");
      expect(result.reason).toContain("health probe");
    }
  });

  it("returns cloud for explicit preference when configured", () => {
    withEnv(
      { BROWSERBASE_API_KEY: "bb-key", BROWSERBASE_PROJECT_ID: "proj" },
      () => {
        const result = resolveBrowserEngine({
          preferredEngine: "cloud",
          cloudCdpUrl: "ws://browserbase.example/session",
        });
        expect("unavailable" in result).toBe(false);
        if (!("unavailable" in result)) {
          expect(result.engine).toBe("cloud");
          expect(result.cdpUrl).toBe("ws://browserbase.example/session");
        }
      },
    );
  });

  it("returns unavailable for explicit cloud preference when unconfigured", () => {
    const result = resolveBrowserEngine({ preferredEngine: "cloud" });
    expect("unavailable" in result).toBe(true);
    if ("unavailable" in result) {
      expect(result.engine).toBe("cloud");
      expect(result.reason).toMatch(/BROWSERBASE|BROWSER_USE/);
    }
  });

  it("returns local for explicit local preference", () => {
    const result = resolveBrowserEngine({ preferredEngine: "local" });
    expect("unavailable" in result).toBe(false);
    if (!("unavailable" in result)) {
      expect(result.engine).toBe("local");
      expect(result.sessionName).toBe("mya-default");
    }
  });
});

// ─── shouldForceLocalForUrl ───────────────────────────────────────────────

describe("engine-resolver — shouldForceLocalForUrl (hybrid routing)", () => {
  it("returns false when cloud is unavailable", () => {
    expect(shouldForceLocalForUrl("http://10.0.0.1/")).toBe(false);
    expect(shouldForceLocalForUrl("http://192.168.1.1/")).toBe(false);
    expect(shouldForceLocalForUrl("https://example.com/")).toBe(false);
  });

  it("returns false for public URLs even when cloud is configured", () => {
    withEnv(
      { BROWSERBASE_API_KEY: "bb", BROWSERBASE_PROJECT_ID: "proj" },
      () => {
        expect(shouldForceLocalForUrl("https://example.com/")).toBe(false);
        expect(shouldForceLocalForUrl("https://8.8.8.8/")).toBe(false);
      },
    );
  });

  it("returns true for RFC1918 URLs when cloud is configured", () => {
    withEnv(
      { BROWSERBASE_API_KEY: "bb", BROWSERBASE_PROJECT_ID: "proj" },
      () => {
        expect(shouldForceLocalForUrl("http://10.0.0.1/")).toBe(true);
        expect(shouldForceLocalForUrl("http://192.168.1.1/")).toBe(true);
        expect(shouldForceLocalForUrl("http://172.16.0.1/")).toBe(true);
      },
    );
  });

  it("returns true for loopback URLs when cloud is configured", () => {
    withEnv(
      { BROWSERBASE_API_KEY: "bb", BROWSERBASE_PROJECT_ID: "proj" },
      () => {
        expect(shouldForceLocalForUrl("http://127.0.0.1/")).toBe(true);
        expect(shouldForceLocalForUrl("http://127.0.0.1:8080/")).toBe(true);
      },
    );
  });

  it("returns false when allowPrivateUrls is true even with cloud configured", () => {
    withEnv(
      { BROWSERBASE_API_KEY: "bb", BROWSERBASE_PROJECT_ID: "proj" },
      () => {
        expect(
          shouldForceLocalForUrl("http://10.0.0.1/", { allowPrivateUrls: true }),
        ).toBe(false);
      },
    );
  });

  it("returns false for ssrf-metadata (unconditional block — handled upstream)", () => {
    withEnv(
      { BROWSERBASE_API_KEY: "bb", BROWSERBASE_PROJECT_ID: "proj" },
      () => {
        // Metadata URLs are blocked unconditionally by checkUrl; they don't
        // reach the engine layer. shouldForceLocalForUrl only matches
        // ssrf-private (the routed-to-local sidecar case).
        expect(shouldForceLocalForUrl("http://169.254.169.254/")).toBe(false);
      },
    );
  });

  it("honors config-level cloud override", () => {
    withEnv({ BROWSERBASE_API_KEY: undefined, BROWSERBASE_PROJECT_ID: undefined }, () => {
      expect(
        shouldForceLocalForUrl("http://10.0.0.1/", {
          browserbaseApiKey: "k",
          browserbaseProjectId: "p",
        }),
      ).toBe(true);
      // Env restored.
      expect(process.env.BROWSERBASE_API_KEY).toBeUndefined();
    });
  });
});

// ─── withEngineFallback (chrome → lightpanda) ─────────────────────────────

describe("engine-resolver — withEngineFallback", () => {
  it("returns first result when predicate returns false", async () => {
    const runner = vi.fn(async (engine: string) => ({
      ok: true as const,
      success: true as const,
      exitCode: 0,
      timedOut: false,
      data: { engine },
    }));
    const result = await withEngineFallback(runner, () => false);
    expect(result.ok).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toBe("chrome");
  });

  it("retries with lightpanda when predicate returns true", async () => {
    const runner = vi.fn(async (engine: string) => ({
      ok: false as const,
      success: false as const,
      error: `failed for ${engine}`,
      exitCode: 1,
      timedOut: false,
    }));
    const result = await withEngineFallback(runner, () => true);
    expect(result.ok).toBe(false);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[0]).toBe("chrome");
    expect(runner.mock.calls[1]?.[0]).toBe("lightpanda");
    // Result is the lightpanda attempt.
    expect(result.error).toContain("lightpanda");
  });

  it("passes first attempt's result to predicate", async () => {
    const first: AgentBrowserResult = {
      ok: false,
      success: false,
      error: "boom",
      exitCode: null,
      timedOut: false,
    };
    const second: AgentBrowserResult = {
      ok: true,
      success: true,
      exitCode: 0,
      timedOut: false,
    };
    const runner = vi
      .fn<(engine: "chrome" | "lightpanda") => Promise<AgentBrowserResult>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const predicate = vi.fn((r: AgentBrowserResult) => r === first);
    const result = await withEngineFallback(runner, predicate);
    expect(result.ok).toBe(true);
    expect(predicate).toHaveBeenCalledWith(first);
  });
});

// ─── defaultChromeFailurePredicate ────────────────────────────────────────

describe("engine-resolver — defaultChromeFailurePredicate", () => {
  const baseFail = {
    ok: false as const,
    success: false as const,
    exitCode: 1,
    timedOut: false,
  };

  it("returns false for a successful result", () => {
    expect(
      defaultChromeFailurePredicate({
        ok: true,
        success: true,
        exitCode: 0,
        timedOut: false,
      }),
    ).toBe(false);
  });

  it("returns true for spawn failure (exitCode null + not timed out)", () => {
    expect(
      defaultChromeFailurePredicate({
        ...baseFail,
        exitCode: null,
        timedOut: false,
        error: "spawn ENOENT",
      }),
    ).toBe(true);
  });

  it("returns true for subprocess timeout", () => {
    expect(
      defaultChromeFailurePredicate({
        ...baseFail,
        timedOut: true,
        error: "timed out after 60000ms",
      }),
    ).toBe(true);
  });

  it("returns true when binary missing message", () => {
    expect(
      defaultChromeFailurePredicate({
        ...baseFail,
        error: "agent-browser binary not found and npx unavailable",
      }),
    ).toBe(true);
  });

  it("returns true for chromium-specific error", () => {
    expect(
      defaultChromeFailurePredicate({
        ...baseFail,
        error: "Chromium failed to start: sandbox restriction",
      }),
    ).toBe(true);
  });

  it("returns true for userns error", () => {
    expect(
      defaultChromeFailurePredicate({
        ...baseFail,
        error: "Failed to setup unprivileged userns",
      }),
    ).toBe(true);
  });

  it("returns false for logical failures (e.g. JSON parse error)", () => {
    expect(
      defaultChromeFailurePredicate({
        ...baseFail,
        exitCode: 0,
        error: "failed to parse agent-browser JSON output: …",
      }),
    ).toBe(false);
  });

  it("returns false for url-blocked type failures", () => {
    expect(
      defaultChromeFailurePredicate({
        ...baseFail,
        error: "command 'open' failed: 404 not found",
      }),
    ).toBe(false);
  });
});