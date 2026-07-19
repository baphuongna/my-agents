/**
 * camofox-health-cache-ttl.test.ts — G3 regression.
 *
 * Gap: `cachedHealthResult` was set once and never invalidated in production,
 * so a Camofox server going down mid-process was not detected until restart.
 * Fix: the cache now has a TTL (60s) — after it expires, the next
 * `isCamofoxAvailable` re-probes. This test uses fake timers to verify the
 * cache is honoured within the TTL and re-probes after it expires.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isCamofoxAvailable,
  resetCamofoxHealthCache,
  getCachedCamofoxHealth,
} from "../camofox-client.js";

describe("camofox health cache TTL (G3)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetCamofoxHealthCache();
    process.env.CAMOFOX_URL = "http://localhost:9377";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.CAMOFOX_URL;
  });

  it("serves the cache within the TTL, re-probes after it expires", async () => {
    vi.useFakeTimers();
    let probeCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      probeCount++;
      return Promise.resolve({ status: 200 } as Response);
    }) as unknown as typeof fetch;

    // First call probes (cache empty).
    expect(await isCamofoxAvailable()).toBe(true);
    expect(probeCount).toBe(1);

    // 30s later — still within TTL, no re-probe.
    vi.advanceTimersByTime(30_000);
    expect(await isCamofoxAvailable()).toBe(true);
    expect(probeCount).toBe(1);

    // 31s more (total 61s) — past the 60s TTL → re-probe.
    vi.advanceTimersByTime(31_000);
    expect(await isCamofoxAvailable()).toBe(true);
    expect(probeCount).toBe(2);
  });

  it("detects a server that goes down between probes", async () => {
    vi.useFakeTimers();
    let healthy = true;
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ status: healthy ? 200 : 503 } as Response),
    ) as unknown as typeof fetch;

    expect(await isCamofoxAvailable()).toBe(true);

    // Server goes down; the stale cache would still say healthy, but the TTL
    // expiry forces a re-probe that catches the 503.
    healthy = false;
    vi.advanceTimersByTime(61_000);
    expect(await isCamofoxAvailable()).toBe(false);
  });

  it("forceRecheck bypasses the TTL cache", async () => {
    vi.useFakeTimers();
    let probeCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      probeCount++;
      return Promise.resolve({ status: 200 } as Response);
    }) as unknown as typeof fetch;

    expect(await isCamofoxAvailable()).toBe(true);
    expect(probeCount).toBe(1);

    // Immediately — within TTL — but forceRecheck re-probes anyway.
    expect(await isCamofoxAvailable(undefined, true)).toBe(true);
    expect(probeCount).toBe(2);
  });

  it("getCachedCamofoxHealth returns undefined when stale (sync-path TTL-aware)", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response) as unknown as typeof fetch;

    await isCamofoxAvailable(); // populate the cache
    expect(getCachedCamofoxHealth()).toBe(true); // fresh → cached value

    vi.advanceTimersByTime(61_000); // past the 60s TTL
    // Stale cache must NOT fool the sync resolver (production routing path).
    expect(getCachedCamofoxHealth()).toBeUndefined();
  });
});
