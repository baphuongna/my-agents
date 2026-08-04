import { describe, it, expect } from "vitest";
import { FRESHNESS_WARN_DAYS, warnFixtureFreshness } from "./tiers.js";

describe("[unit] eval freshness", () => {
  it("FRESHNESS_WARN_DAYS is 30", () => {
    expect(FRESHNESS_WARN_DAYS).toBe(30);
  });

  it("fresh fixture → no warning", () => {
    const now = Date.now();
    const w = warnFixtureFreshness([{ id: "f1", recordedAt: now }], now);
    expect(w).toEqual([]);
  });

  it("stale fixture (> 30 days) → warning", () => {
    const now = Date.now();
    const old = now - 31 * 24 * 60 * 60 * 1000;
    const w = warnFixtureFreshness([{ id: "f1", recordedAt: old }], now);
    expect(w).toHaveLength(1);
    expect(w[0]!.id).toBe("f1");
    expect(w[0]!.ageDays).toBeGreaterThanOrEqual(30);
    expect(w[0]!.message).toContain("drifted");
  });

  it("missing recordedAt → no warning (unknown age)", () => {
    const w = warnFixtureFreshness([{ id: "f1" }], Date.now());
    expect(w).toEqual([]);
  });

  it("custom maxAgeDays", () => {
    const now = Date.now();
    const old = now - 10 * 24 * 60 * 60 * 1000;
    expect(warnFixtureFreshness([{ id: "f1", recordedAt: old }], now, 5)).toHaveLength(1);
    expect(warnFixtureFreshness([{ id: "f1", recordedAt: old }], now, 15)).toEqual([]);
  });

  it("multiple fixtures — only stale ones warned", () => {
    const now = Date.now();
    const w = warnFixtureFreshness([
      { id: "fresh", recordedAt: now },
      { id: "stale", recordedAt: now - 60 * 24 * 60 * 60 * 1000 },
      { id: "unknown" },
    ], now);
    expect(w).toHaveLength(1);
    expect(w[0]!.id).toBe("stale");
  });
});
