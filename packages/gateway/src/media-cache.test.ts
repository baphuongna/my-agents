/**
 * MediaCache tests — LRU-bounded sticker/media cache with TTL (§12 E2).
 *
 * Source of truth: packages/gateway/src/channel-identity.ts.
 *
 * Time is controlled via `setTimeProvider` (no real sleeps).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MediaCache } from "./channel-identity.js";
import { setTimeProvider } from "@my-agent/core";

let clock = 1_000_000;
function setClock(ms: number) {
  clock = ms;
  setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => 0 });
}

describe("MediaCache — store / retrieve", () => {
  beforeEach(() => setClock(1_000_000));
  afterEach(() => setTimeProvider({ nowWallclock: () => Date.now(), nowMonotonic: () => Date.now() }));

  it("get returns null for a missing key", () => {
    const c = new MediaCache();
    expect(c.get("nope")).toBeNull();
  });

  it("set then get round-trips the Buffer", () => {
    const c = new MediaCache();
    const data = Buffer.from("hello-media");
    c.set("k1", data);
    expect(c.get("k1")).toEqual(data);
  });

  it("overwriting an existing key updates the stored data", () => {
    const c = new MediaCache();
    c.set("k1", Buffer.from("a"));
    c.set("k1", Buffer.from("bb"));
    expect(c.get("k1")).toEqual(Buffer.from("bb"));
  });
});

describe("MediaCache — TTL eviction", () => {
  afterEach(() => setTimeProvider({ nowWallclock: () => Date.now(), nowMonotonic: () => Date.now() }));

  it("an entry past its TTL is evicted on read (returns null)", () => {
    setClock(0);
    const c = new MediaCache(10, 1000); // 1s TTL
    c.set("k", Buffer.from("x"));
    setClock(2000); // past TTL
    expect(c.get("k")).toBeNull();
  });

  it("an entry just within its TTL is still retrievable", () => {
    setClock(0);
    const c = new MediaCache(10, 1000);
    c.set("k", Buffer.from("x"));
    setClock(999); // still within TTL
    expect(c.get("k")).toEqual(Buffer.from("x"));
  });
});

describe("MediaCache — size limits (LRU eviction)", () => {
  beforeEach(() => setClock(1_000_000));
  afterEach(() => setTimeProvider({ nowWallclock: () => Date.now(), nowMonotonic: () => Date.now() }));

  it("evicts the oldest entry when maxEntries is exceeded", () => {
    // cap at 2 entries
    const c = new MediaCache(2, 60_000);
    c.set("first", Buffer.from("1"));
    setClock(1_000_001);
    c.set("second", Buffer.from("2"));
    setClock(1_000_002);
    c.set("third", Buffer.from("3")); // exceeds cap → oldest ("first") evicted
    expect(c.get("first")).toBeNull();
    expect(c.get("second")).toEqual(Buffer.from("2"));
    expect(c.get("third")).toEqual(Buffer.from("3"));
  });
});
