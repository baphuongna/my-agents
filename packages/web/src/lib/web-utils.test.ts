import { describe, it, expect } from "vitest";
import { formatTokenCount, formatBytes, formatDuration, timeAgo, formatTime } from "./format.js";
import { EFFORT_OPTIONS, VALID_EFFORTS, normalizeEffort } from "./reasoning-effort.js";
import { cn, themedFont, themedBody, themedChrome } from "./utils.js";

describe("[unit] web format", () => {
  it("formatTokenCount: K/M scaling", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1500)).toBe("1.5K");
    expect(formatTokenCount(1000)).toBe("1K");
    expect(formatTokenCount(2_000_000)).toBe("2M");
  });

  it("formatBytes: B/KB/MB/GB", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(2048)).toBe("2KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0MB");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("formatDuration: s/m/h/d", () => {
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3700)).toBe("1h 1m");
    expect(formatDuration(undefined)).toBe("—");
  });

  it("timeAgo: relative time", () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe("just now");
    expect(timeAgo(null)).toBe("never");
    expect(timeAgo("invalid")).toBe("never");
  });

  it("formatTime: returns string or fallback", () => {
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("2024-01-01T12:00:00Z")).toBeTypeOf("string");
  });
});

describe("[unit] web reasoning-effort", () => {
  it("EFFORT_OPTIONS has low/medium/high", () => {
    expect(EFFORT_OPTIONS.map(o => o.value)).toEqual(["low", "medium", "high"]);
  });

  it("VALID_EFFORTS contains all options", () => {
    expect(VALID_EFFORTS.has("low")).toBe(true);
    expect(VALID_EFFORTS.has("medium")).toBe(true);
    expect(VALID_EFFORTS.has("high")).toBe(true);
    expect(VALID_EFFORTS.has("ultra")).toBe(false);
  });

  it("normalizeEffort: valid → as-is", () => {
    expect(normalizeEffort("low")).toBe("low");
    expect(normalizeEffort("high")).toBe("high");
  });

  it("normalizeEffort: invalid → default medium", () => {
    expect(normalizeEffort("ultra")).toBe("medium");
    expect(normalizeEffort(42)).toBe("medium");
    expect(normalizeEffort(null)).toBe("medium");
    expect(normalizeEffort(undefined)).toBe("medium");
  });
});

describe("[unit] web utils", () => {
  it("cn merges classnames", () => {
    expect(cn("a", "b")).toContain("a");
    expect(cn("a", "b")).toContain("b");
  });

  it("cn dedupes conflicting tailwind classes", () => {
    const result = cn("p-4", "p-2");
    // tailwind-merge should keep the last (p-2)
    expect(result).not.toContain("p-4");
    expect(result).toContain("p-2");
  });

  it("themed constants are strings", () => {
    expect(themedFont).toBe("font-mono");
    expect(themedBody).toContain("font-sans");
    expect(themedChrome).toContain("uppercase");
  });
});
