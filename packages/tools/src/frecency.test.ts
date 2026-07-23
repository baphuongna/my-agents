/**
 * FrecencyDB tests — frequency+recency ranking database (§11 R35 file-search).
 *
 * Source of truth: packages/tools/src/search-index.ts `FrecencyDB`.
 *
 * Time is controlled via the injectable `setTimeProvider` from core (no real
 * sleeps), so recency decay is deterministic.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FrecencyDB } from "./search-index.js";
import { setTimeProvider } from "@my-agent/core";

let clock = 1_000_000;
function freeze(c: number) {
  clock = c;
  setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => 0 });
}
function restore() {
  setTimeProvider({ nowWallclock: () => Date.now(), nowMonotonic: () => Date.now() });
}

describe("FrecencyDB — bump (frequency)", () => {
  beforeEach(() => freeze(1_000_000));
  afterEach(restore);

  it("score is 0 for a path that was never bumped", () => {
    const db = new FrecencyDB();
    expect(db.score("never.ts")).toBe(0);
  });

  it("a single bump yields a score of exactly 1 (count=1, decay=1 at age 0)", () => {
    const db = new FrecencyDB();
    db.bump("a.ts");
    expect(db.score("a.ts")).toBe(1);
  });

  it("multiple bumps accumulate the count linearly", () => {
    const db = new FrecencyDB();
    db.bump("a.ts");
    db.bump("a.ts");
    db.bump("a.ts");
    expect(db.score("a.ts")).toBe(3);
  });

  it("bump with an explicit `now` overrides the wallclock default", () => {
    const db = new FrecencyDB(1000);
    db.bump("a.ts", 5000);
    // age = clock(1e6) - 5000 → large; decay should be tiny but count=1
    const s = db.score("a.ts");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe("FrecencyDB — recency decay", () => {
  afterEach(restore);

  it("score halves after exactly one halflife (default 7d)", () => {
    const DAY = 24 * 3600 * 1000;
    const db = new FrecencyDB(7 * DAY);
    freeze(0);
    db.bump("a.ts"); // count=1, lastAt=0
    freeze(7 * DAY); // age === one halflife → decay = 0.5
    expect(db.score("a.ts")).toBeCloseTo(0.5, 6);
  });

  it("a more-recently-bumped item outscores an equally-frequent stale one", () => {
    const HALFLIFE = 1000;
    const db = new FrecencyDB(HALFLIFE);
    freeze(0);
    db.bump("stale.ts");
    db.bump("fresh.ts");
    freeze(HALFLIFE); // stale is one halflife old, fresh is brand new
    db.bump("fresh.ts"); // fresh: count=2, age=0
    expect(db.score("fresh.ts")).toBeGreaterThan(db.score("stale.ts"));
  });

  it("decay approaches zero for very old accesses", () => {
    const db = new FrecencyDB(1000);
    freeze(0);
    db.bump("old.ts");
    freeze(1_000_000); // 1000 halflives later
    expect(db.score("old.ts")).toBeCloseTo(0, 6);
  });

  it("a custom halflife decays faster than the default", () => {
    const SHORT = 10;
    const db = new FrecencyDB(SHORT);
    freeze(0);
    db.bump("a.ts");
    freeze(10); // one short halflife → 0.5
    expect(db.score("a.ts")).toBeCloseTo(0.5, 6);
  });
});

describe("FrecencyDB — snapshot", () => {
  beforeEach(() => freeze(1_000_000));
  afterEach(restore);

  it("snapshot returns a read-only map of {count, lastAt}", () => {
    const db = new FrecencyDB();
    db.bump("a.ts");
    db.bump("a.ts");
    db.bump("b.ts");
    const snap = db.snapshot();
    expect(snap.get("a.ts")).toEqual({ count: 2, lastAt: 1_000_000 });
    expect(snap.get("b.ts")).toEqual({ count: 1, lastAt: 1_000_000 });
    expect(snap.get("missing")).toBeUndefined();
  });

  it("snapshot is empty before any bumps", () => {
    expect(new FrecencyDB().snapshot().size).toBe(0);
  });
});
