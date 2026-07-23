/**
 * Tests for the Weibull decay + timestamp parsing module (Phase 3).
 *
 * Covers: parseTimestamp, weibullBoost, weibullDecayFactor.
 * `parseTimestamp` is not re-exported from the barrel, so we import it directly
 * from the source module. All functions are pure (no DB, no I/O).
 */
import { describe, it, expect } from "vitest";
import {
  parseTimestamp,
  weibullBoost,
  weibullDecayFactor,
  WEIBULL_PARAMS,
  DEFAULT_HALFLIFE_HOURS,
} from "./weibull.js";

describe("parseTimestamp", () => {
  it("returns null for null/undefined", () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
  });

  it("parses a valid ISO 8601 string into a Date", () => {
    const d = parseTimestamp("2024-01-15T10:30:00.000Z");
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toBe("2024-01-15T10:30:00.000Z");
  });

  it("parses a date-only string", () => {
    const d = parseTimestamp("2024-06-01");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getUTCFullYear()).toBe(2024);
  });

  it("returns a valid Date instance unchanged", () => {
    const src = new Date("2023-12-25T00:00:00.000Z");
    const d = parseTimestamp(src);
    expect(d).toBe(src); // same reference, and finite
    expect(d!.getTime()).toBe(src.getTime());
  });

  it("returns null for an Invalid Date instance", () => {
    expect(parseTimestamp(new Date(NaN))).toBeNull();
  });

  it("returns null for a non-string, non-Date input (e.g. epoch number)", () => {
    // NOTE: by design this helper only accepts string | Date | null | undefined.
    // A bare epoch *number* is rejected (typeof !== "string"). Callers that
    // store epoch millis must stringify first.
    expect(parseTimestamp(1_700_000_000_000 as unknown as string)).toBeNull();
    expect(parseTimestamp(true as unknown as string)).toBeNull();
  });

  it("returns null for an unparseable / relative string", () => {
    // new Date("not-a-date") and relative phrases ("yesterday") are Invalid Dates.
    expect(parseTimestamp("not-a-date")).toBeNull();
    expect(parseTimestamp("yesterday")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });
});

describe("weibullBoost", () => {
  it("returns 0 for a null/invalid timestamp", () => {
    expect(weibullBoost(null)).toBe(0);
    expect(weibullBoost("not-a-date")).toBe(0);
  });

  it("returns 0 when queryTime is an Invalid Date", () => {
    const past = "2020-01-01T00:00:00.000Z";
    expect(weibullBoost(past, new Date(NaN))).toBe(0);
  });

  it("returns 1.0 for a future timestamp (ageHours < 0)", () => {
    const future = "9999-01-01T00:00:00.000Z";
    expect(weibullBoost(future, new Date("2024-01-01T00:00:00.000Z"))).toBe(1.0);
  });

  it("returns 1.0 at exactly age zero (memory time === query time)", () => {
    const t = "2024-01-01T00:00:00.000Z";
    expect(weibullBoost(t, new Date(t))).toBeCloseTo(1.0, 10);
  });

  it("uses the explicit halflifeHours exponential path at the half-life point", () => {
    // halflife path: exp(-ageHours / halflifeHours). At age === halflife → exp(-1).
    const t = "2024-01-01T00:00:00.000Z";
    const q = new Date("2024-01-01T05:00:00.000Z"); // 5h later
    expect(weibullBoost(t, q, "general", 5)).toBeCloseTo(Math.exp(-1), 6);
  });

  it("returns 0 when halflifeHours <= 0", () => {
    const t = "2024-01-01T00:00:00.000Z";
    const q = new Date("2024-01-02T00:00:00.000Z");
    expect(weibullBoost(t, q, "general", 0)).toBe(0);
    expect(weibullBoost(t, q, "general", -10)).toBe(0);
  });

  it("is monotonically non-increasing as memory ages (same type)", () => {
    const q = new Date("2024-06-01T00:00:00.000Z");
    const h1 = weibullBoost("2024-05-31T00:00:00.000Z", q, "event"); // ~24h old
    const h2 = weibullBoost("2024-05-01T00:00:00.000Z", q, "event"); // ~31d old
    const h3 = weibullBoost("2023-01-01T00:00:00.000Z", q, "event"); // very old
    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
    expect(h3).toBeGreaterThanOrEqual(0);
  });

  it("falls back to DEFAULT_HALFLIFE_HOURS for an unknown memory type", () => {
    const t = "2024-01-01T00:00:00.000Z";
    const q = new Date("2024-01-08T00:00:00.000Z"); // 168h later
    // unknown type → exp(-ageHours / 168) === exp(-1)
    expect(weibullBoost(t, q, "totally-unknown-type")).toBeCloseTo(Math.exp(-1), 6);
    expect(DEFAULT_HALFLIFE_HOURS).toBe(168.0);
  });

  it("fast-decay types decay quicker than slow-decay types", () => {
    const t = "2020-01-01T00:00:00.000Z";
    const q = new Date("2024-01-01T00:00:00.000Z"); // ~4 years (~35040h) old
    const profile = weibullBoost(t, q, "profile"); // eta=8760 (1y) — slow
    const event = weibullBoost(t, q, "event"); // eta=168 (1w) — fast
    expect(profile).toBeGreaterThan(event);
  });
});

describe("weibullDecayFactor", () => {
  it("returns 1.0 for age <= 0", () => {
    expect(weibullDecayFactor(0)).toBe(1.0);
    expect(weibullDecayFactor(-5)).toBe(1.0);
  });

  it("general type at eta=168h decays to exp(-1) at 168h", () => {
    // general: k=1.0, eta=168 → exp(-(168/168)^1) = exp(-1)
    expect(weibullDecayFactor(168, "general")).toBeCloseTo(Math.exp(-1), 6);
  });

  it("is monotonically decreasing as age increases", () => {
    const a = weibullDecayFactor(50, "general");
    const b = weibullDecayFactor(100, "general");
    const c = weibullDecayFactor(10_000, "general");
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it("falls back to the default half-life for an unknown type", () => {
    // unknown type → exp(-ageHours / 168). At 168h → exp(-1).
    expect(weibullDecayFactor(168, "no-such-type")).toBeCloseTo(Math.exp(-1), 6);
  });

  it("event (eta=168) decays faster than profile (eta=8760) over a long horizon", () => {
    const age = 2000; // hours
    const eventD = weibullDecayFactor(age, "event");
    const profileD = weibullDecayFactor(age, "profile");
    expect(profileD).toBeGreaterThan(eventD);
    expect(eventD).toBeLessThan(profileD);
  });

  it("stays within [0, 1] across the configured memory types", () => {
    for (const [type] of Object.entries(WEIBULL_PARAMS)) {
      const v = weibullDecayFactor(500, type);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
