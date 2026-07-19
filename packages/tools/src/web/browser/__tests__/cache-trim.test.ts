import { describe, it, expect } from "vitest";
import { trimCache, CACHE_MAX_ENTRIES } from "../index.js";

describe("trimCache — bounded module-level caches (G4)", () => {
  it("evicts the oldest entries when the cap is exceeded", () => {
    const map = new Map<string, number>();
    for (let i = 0; i < CACHE_MAX_ENTRIES + 5; i++) {
      map.set(`k${i}`, i);
      trimCache(map);
    }
    expect(map.size).toBe(CACHE_MAX_ENTRIES);
    // The oldest 5 should be gone; the newest CACHE_MAX_ENTRIES kept.
    expect(map.has("k0")).toBe(false);
    expect(map.has("k4")).toBe(false);
    expect(map.has("k5")).toBe(true);
    expect(map.has(`k${CACHE_MAX_ENTRIES + 4}`)).toBe(true);
  });

  it("does not evict when under the cap", () => {
    const map = new Map<string, number>();
    map.set("a", 1);
    map.set("b", 2);
    trimCache(map);
    expect(map.size).toBe(2);
    expect(map.get("a")).toBe(1);
  });

  it("is a no-op on an empty map", () => {
    const map = new Map<string, number>();
    trimCache(map);
    expect(map.size).toBe(0);
  });
});
