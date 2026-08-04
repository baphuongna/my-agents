import { describe, it, expect } from "vitest";
import { LifecycleGuard } from "./lifecycle-guard.js";

describe("[unit] LifecycleGuard", () => {
  it("recordFire: under limit → not disabled", () => {
    const g = new LifecycleGuard({ windowMs: 1000, maxRestarts: 5 });
    for (let i = 0; i < 5; i++) expect(g.recordFire("job1", i * 100)).toBe(false);
  });

  it("recordFire: over limit → disabled", () => {
    const g = new LifecycleGuard({ windowMs: 1000, maxRestarts: 3 });
    g.recordFire("j", 0);
    g.recordFire("j", 100);
    g.recordFire("j", 200);
    expect(g.recordFire("j", 300)).toBe(true); // 4th fire → flap
  });

  it("recordFire prunes old entries outside window", () => {
    const g = new LifecycleGuard({ windowMs: 1000, maxRestarts: 3 });
    g.recordFire("j", 0);
    g.recordFire("j", 100);
    g.recordFire("j", 200);
    // entries at t=0,100,200 → 3 fires. Next at t=2000 (outside 1000ms window from t=1000)
    expect(g.recordFire("j", 2000)).toBe(false); // pruned: only t=2000 remains
  });

  it("wouldDisable checks without recording", () => {
    const g = new LifecycleGuard({ windowMs: 1000, maxRestarts: 3 });
    g.recordFire("j", 0);
    g.recordFire("j", 100);
    g.recordFire("j", 200);
    // 3 fires recorded; one more would be 4 > 3 → would disable
    expect(g.wouldDisable("j", 250)).toBe(true);
    // verify nothing was recorded
    expect(g.recordFire("j", 250)).toBe(true); // now actually records → 4 > 3
  });

  it("clear resets a specific job", () => {
    const g = new LifecycleGuard({ windowMs: 1000, maxRestarts: 2 });
    g.recordFire("j1", 0);
    g.recordFire("j1", 100);
    g.clear("j1");
    expect(g.wouldDisable("j1", 200)).toBe(false);
  });

  it("clearAll resets everything", () => {
    const g = new LifecycleGuard({ windowMs: 1000, maxRestarts: 1 });
    g.recordFire("a", 0);
    g.recordFire("b", 0);
    g.clearAll();
    expect(g.wouldDisable("a", 100)).toBe(false);
    expect(g.wouldDisable("b", 100)).toBe(false);
  });

  it("jobs are independent", () => {
    const g = new LifecycleGuard({ windowMs: 1000, maxRestarts: 2 });
    g.recordFire("a", 0);
    g.recordFire("a", 100);
    expect(g.recordFire("b", 200)).toBe(false); // b has 1 fire, not flapping
  });

  it("defaults: 5 restarts in 60s", () => {
    const g = new LifecycleGuard(); // defaults
    for (let i = 0; i < 5; i++) g.recordFire("j", i * 1000);
    expect(g.recordFire("j", 5000)).toBe(true); // 6th in 60s → flap
  });
});
