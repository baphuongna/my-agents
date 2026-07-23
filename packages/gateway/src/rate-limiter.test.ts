/**
 * RateLimiter + getRateLimiter tests — token-bucket rate limiting (§12 E2).
 *
 * Source of truth: packages/gateway/src/channel-identity.ts.
 *
 * Time is controlled via `setTimeProvider` (no real sleeps).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RateLimiter, getRateLimiter } from "./channel-identity.js";
import { setTimeProvider } from "@my-agent/core";

let clock = 1_000_000;
function setClock(ms: number) {
  clock = ms;
  setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => 0 });
}
function restore() {
  setTimeProvider({ nowWallclock: () => Date.now(), nowMonotonic: () => Date.now() });
}

describe("RateLimiter — token bucket", () => {
  beforeEach(() => setClock(1_000_000));
  afterEach(restore);

  it("a fresh bucket allows exactly `capacity` consecutive consumes", () => {
    const rl = new RateLimiter(5, 1);
    for (let i = 0; i < 5; i++) expect(rl.tryConsume()).toBe(true);
    // 6th is denied — bucket exhausted
    expect(rl.tryConsume()).toBe(false);
  });

  it("refills tokens at refillRatePerSec as wallclock advances", () => {
    const rl = new RateLimiter(3, 2); // 2 tokens/sec
    for (let i = 0; i < 3; i++) rl.tryConsume(); // drain
    expect(rl.tryConsume()).toBe(false);
    setClock(clock + 1000); // +1s → +2 tokens
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false); // only 2 refilled
  });

  it("refill never exceeds capacity", () => {
    const rl = new RateLimiter(2, 100); // very fast refill, small cap
    rl.tryConsume();
    rl.tryConsume();
    expect(rl.tryConsume()).toBe(false);
    setClock(clock + 10_000); // a lot of time, but capped at 2
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false); // capped, no 3rd
  });

  it("capacity 0 bucket always denies", () => {
    const rl = new RateLimiter(0, 5);
    expect(rl.tryConsume()).toBe(false);
  });

  it("no time elapsed → no refill between back-to-back consumes", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.tryConsume()).toBe(true);
    // same instant → 0 elapsed → still empty
    expect(rl.tryConsume()).toBe(false);
  });
});

describe("getRateLimiter — per-platform singletons", () => {
  beforeEach(() => setClock(1_000_000));
  afterEach(restore);

  it("returns a RateLimiter instance", () => {
    expect(getRateLimiter("telegram")).toBeInstanceOf(RateLimiter);
  });

  it("returns the SAME instance for repeated calls on one platform", () => {
    expect(getRateLimiter("slack")).toBe(getRateLimiter("slack"));
  });

  it("returns DIFFERENT instances for different platforms", () => {
    expect(getRateLimiter("email")).not.toBe(getRateLimiter("matrix"));
  });

  it("unknown platforms fall back to the default limit", () => {
    // default capacity is 10; verify the bucket is non-trivial (≥5 tokens)
    const rl = getRateLimiter("totally-unknown-platform-xyz");
    let allowed = 0;
    for (let i = 0; i < 5; i++) if (rl.tryConsume()) allowed++;
    expect(allowed).toBe(5);
  });
});
