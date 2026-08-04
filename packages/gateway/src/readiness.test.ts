import { describe, it, expect } from "vitest";
import { ReadinessRegistry } from "./readiness.js";

describe("[unit] readiness probes", () => {
  it("liveness always returns ok=true", () => {
    const r = new ReadinessRegistry();
    const live = r.liveness();
    expect(live.state).toBe("live");
    expect(live.ok).toBe(true);
  });

  it("readiness: not booted → 503 + Retry-After", () => {
    const r = new ReadinessRegistry();
    const ready = r.readiness();
    expect(ready.ok).toBe(false);
    expect(ready.retryAfterS).toBe(2);
    expect(ready.detail).toMatch(/booting/);
  });

  it("readiness: booted + all checks pass → ok", () => {
    const r = new ReadinessRegistry();
    r.register("db", () => true);
    r.markBooted();
    expect(r.readiness().ok).toBe(true);
  });

  it("readiness: a failing check → not ok + detail lists name", () => {
    const r = new ReadinessRegistry();
    r.register("db", () => true);
    r.register("cache", () => false);
    r.markBooted();
    const ready = r.readiness();
    expect(ready.ok).toBe(false);
    expect(ready.detail).toContain("cache");
  });

  it("readiness: a throwing check → treated as failure", () => {
    const r = new ReadinessRegistry();
    r.register("flaky", () => { throw new Error("boom"); });
    r.markBooted();
    expect(r.readiness().ok).toBe(false);
    expect(r.readiness().detail).toContain("flaky");
  });

  it("functional: not ready → propagate failure", () => {
    const r = new ReadinessRegistry();
    const f = r.functional(0);
    expect(f.ok).toBe(false);
    expect(f.state).toBe("functional");
  });

  it("functional: ready but 0 healthy turns → not ok", () => {
    const r = new ReadinessRegistry();
    r.markBooted();
    const f = r.functional(0);
    expect(f.ok).toBe(false);
    expect(f.detail).toMatch(/no healthy turn/);
  });

  it("functional: ready + ≥1 healthy turn → ok", () => {
    const r = new ReadinessRegistry();
    r.markBooted();
    expect(r.functional(1).ok).toBe(true);
    expect(r.functional(10).ok).toBe(true);
  });
});
