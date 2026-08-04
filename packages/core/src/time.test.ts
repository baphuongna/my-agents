import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { nowWallclock, nowMonotonic, today, setTimeProvider, type TimeProvider } from "./time.js";

describe("[unit] core.time", () => {
  let original: TimeProvider;
  beforeEach(() => { original = { nowWallclock, nowMonotonic }; });
  afterEach(() => { setTimeProvider(original as never); }); // restore real

  it("nowWallclock returns epoch ms", () => {
    const fake = 1_700_000_000_000;
    setTimeProvider({ nowWallclock: () => fake, nowMonotonic: () => 0 });
    expect(nowWallclock()).toBe(fake);
  });

  it("nowMonotonic returns microseconds (perf.now * 1e3)", () => {
    setTimeProvider({ nowWallclock: () => 0, nowMonotonic: () => 1234.5 });
    expect(nowMonotonic()).toBe(1234.5);
  });

  it("today returns epoch-day (UTC, floored to 86400000)", () => {
    // 2024-01-01T00:00:00Z = 1704067200000 → day 19723
    setTimeProvider({ nowWallclock: () => 1_704_067_200_000, nowMonotonic: () => 0 });
    expect(today()).toBe(Math.floor(1_704_067_200_000 / 86_400_000));
  });

  it("today is day-precision (same day → same value regardless of hour)", () => {
    const midnight = 1_704_067_200_000;
    const noon = midnight + 43_200_000;
    setTimeProvider({ nowWallclock: () => midnight, nowMonotonic: () => 0 });
    const d1 = today();
    setTimeProvider({ nowWallclock: () => noon, nowMonotonic: () => 0 });
    expect(today()).toBe(d1);
  });

  it("setTimeProvider is injectable (deterministic in tests)", () => {
    let t = 100;
    setTimeProvider({ nowWallclock: () => t, nowMonotonic: () => t });
    expect(nowWallclock()).toBe(100);
    t = 200;
    expect(nowWallclock()).toBe(200);
  });
});
