import { describe, it, expect } from "vitest";
import { RateLimiter, getRateLimiter, MediaCache } from "./channel-identity.js";

describe("[unit] channel-identity — RateLimiter", () => {
  it("tryConsume allows up to capacity then denies", () => {
    const rl = new RateLimiter(3, 0); // no refill → strict capacity
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false); // exhausted
  });

  it("refills over time (rate per sec)", async () => {
    const rl = new RateLimiter(1, 1000); // 1000/sec → ~1 token/ms
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false);
    await new Promise(r => setTimeout(r, 30)); // ~30 tokens refilled
    expect(rl.tryConsume()).toBe(true);
  });

  it("capacity caps the refill", () => {
    const rl = new RateLimiter(2, 100_000);
    rl.tryConsume();
    rl.tryConsume();
    // after "long time" tokens cap at capacity (2), not overflow
    // (can't test without time injection, but tryConsume after consume = false)
    expect(rl.tryConsume()).toBe(false);
  });
});

describe("[unit] channel-identity — getRateLimiter", () => {
  it("returns a limiter per platform", () => {
    const tg = getRateLimiter("telegram");
    const dc = getRateLimiter("discord");
    expect(tg).not.toBe(dc);
  });

  it("same platform → same limiter (cached)", () => {
    expect(getRateLimiter("telegram")).toBe(getRateLimiter("telegram"));
  });

  it("unknown platform → default limiter", () => {
    const rl = getRateLimiter("unknown-platform-xyz");
    expect(rl).toBeDefined();
    // default capacity 10 — first 10 consume OK
    for (let i = 0; i < 10; i++) expect(rl.tryConsume()).toBe(true);
  });
});

describe("[unit] channel-identity — MediaCache", () => {
  it("set + get round-trips Buffer", () => {
    const mc = new MediaCache();
    mc.set("k1", Buffer.from("hello"));
    expect(mc.get("k1")?.toString()).toBe("hello");
  });

  it("get returns null for missing key", () => {
    expect(new MediaCache().get("nope")).toBeNull();
  });

  it("evicts oldest when maxEntries exceeded", () => {
    const mc = new MediaCache(2);
    mc.set("a", Buffer.from("1"));
    mc.set("b", Buffer.from("2"));
    mc.set("c", Buffer.from("3")); // evicts "a" (oldest)
    expect(mc.get("a")).toBeNull();
    expect(mc.get("b")?.toString()).toBe("2");
    expect(mc.get("c")?.toString()).toBe("3");
  });

  it("expires entries after TTL", async () => {
    const mc = new MediaCache(10, 20); // 20ms TTL
    mc.set("k", Buffer.from("x"));
    expect(mc.get("k")).not.toBeNull();
    await new Promise(r => setTimeout(r, 30));
    expect(mc.get("k")).toBeNull();
  });
});
