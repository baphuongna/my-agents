/**
 * @my-agent/cron — cron expression parser tests (Phase 2).
 */
import { describe, it, expect } from "vitest";
import { matchesCronExpr } from "./index.js";

describe("matchesCronExpr", () => {
  // Helper: build a Date at a specific local time.
  const d = (y: number, mo: number, da: number, h: number, mi: number): Date =>
    new Date(y, mo - 1, da, h, mi);

  it("wildcard * matches any time", () => {
    expect(matchesCronExpr("* * * * *", d(2026, 7, 12, 10, 30))).toBe(true);
  });

  it("*/5 step matches every 5 minutes", () => {
    expect(matchesCronExpr("*/5 * * * *", d(2026, 7, 12, 10, 0))).toBe(true);
    expect(matchesCronExpr("*/5 * * * *", d(2026, 7, 12, 10, 5))).toBe(true);
    expect(matchesCronExpr("*/5 * * * *", d(2026, 7, 12, 10, 3))).toBe(false);
  });

  it("specific minute + hour", () => {
    expect(matchesCronExpr("30 9 * * *", d(2026, 7, 12, 9, 30))).toBe(true);
    expect(matchesCronExpr("30 9 * * *", d(2026, 7, 12, 10, 30))).toBe(false);
  });

  it("DOW names (MON)", () => {
    // 2026-07-13 is a Monday
    expect(matchesCronExpr("0 9 * * MON", d(2026, 7, 13, 9, 0))).toBe(true);
    // 2026-07-14 is a Tuesday
    expect(matchesCronExpr("0 9 * * MON", d(2026, 7, 14, 9, 0))).toBe(false);
  });

  it("DOW numeric (0 and 7 both = Sunday)", () => {
    // 2026-07-12 is a Sunday
    expect(matchesCronExpr("0 9 * * 0", d(2026, 7, 12, 9, 0))).toBe(true);
    expect(matchesCronExpr("0 9 * * 7", d(2026, 7, 12, 9, 0))).toBe(true);
  });

  it("day-of-month wildcard with ranges", () => {
    expect(matchesCronExpr("0 0 1-15 * *", d(2026, 7, 10, 0, 0))).toBe(true);
    expect(matchesCronExpr("0 0 1-15 * *", d(2026, 7, 20, 0, 0))).toBe(false);
  });

  it("comma-separated lists", () => {
    expect(matchesCronExpr("30 14 1,15 * *", d(2026, 7, 1, 14, 30))).toBe(true);
    expect(matchesCronExpr("30 14 1,15 * *", d(2026, 7, 15, 14, 30))).toBe(true);
    expect(matchesCronExpr("30 14 1,15 * *", d(2026, 7, 10, 14, 30))).toBe(false);
  });

  it("hour range on weekdays", () => {
    // 2026-07-13 is Monday
    expect(matchesCronExpr("0 9-17 * * MON-FRI", d(2026, 7, 13, 12, 0))).toBe(true);
    expect(matchesCronExpr("0 9-17 * * MON-FRI", d(2026, 7, 13, 18, 0))).toBe(false);
  });

  it("month names (JAN)", () => {
    expect(matchesCronExpr("0 0 1 JAN *", d(2026, 1, 1, 0, 0))).toBe(true);
    expect(matchesCronExpr("0 0 1 JAN *", d(2026, 7, 1, 0, 0))).toBe(false);
  });

  it("rejects invalid expressions", () => {
    expect(matchesCronExpr("* * *", d(2026, 7, 12, 0, 0))).toBe(false);
    expect(matchesCronExpr("", d(2026, 7, 12, 0, 0))).toBe(false);
  });

  it("*/0 does NOT infinite-loop (step guard)", () => {
    // This test verifies the guard — if the guard is missing, this hangs forever.
    expect(matchesCronExpr("*/0 * * * *", d(2026, 7, 12, 0, 0))).toBe(false);
  });

  it("timezone parameter shifts matching (UTC vs America/New_York)", () => {
    // 2026-07-12T14:30:00Z = 10:30 EDT (America/New_York, UTC-4 in July)
    const utc1430 = new Date("2026-07-12T14:30:00Z");
    // In UTC: hour=14, minute=30 → matches
    expect(matchesCronExpr("30 14 * * *", utc1430, "UTC")).toBe(true);
    // In New York: hour=10, minute=30 → matches
    expect(matchesCronExpr("30 10 * * *", utc1430, "America/New_York")).toBe(true);
    // Cross-check: UTC hour does NOT match in NY timezone
    expect(matchesCronExpr("30 14 * * *", utc1430, "America/New_York")).toBe(false);
  });

  it("MYA_TZ environment variable provides default timezone", () => {
    const prev = process.env["MYA_TZ"];
    try {
      process.env["MYA_TZ"] = "Asia/Tokyo";
      // 2026-07-12T01:00:00Z = 10:00 JST (Asia/Tokyo, UTC+9)
      const utcDate = new Date("2026-07-12T01:00:00Z");
      // In Tokyo timezone: hour=10, minute=0 → matches
      expect(matchesCronExpr("0 10 * * *", utcDate)).toBe(true);
      // Hour=1 is wrong for Tokyo (that's the UTC hour)
      expect(matchesCronExpr("0 1 * * *", utcDate)).toBe(false);
    } finally {
      if (prev !== undefined) process.env["MYA_TZ"] = prev;
      else delete process.env["MYA_TZ"];
    }
  });
});
