import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetDbForTest } from "./cron-observability.js";

let realHome: string | undefined;
let dir: string;

beforeEach(() => {
  _resetDbForTest(); // drop the cached db handle so this test's HOME/path is used
  realHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "mya-cronobs-"));
  process.env.HOME = dir;
});
afterEach(async () => {
  process.env.HOME = realHome;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("cron-observability (Phase 4A/4C)", () => {
  it("records run start + end and reads them back (durable history)", async () => {
    // re-import per test so the module-level db handle uses the temp HOME
    const mod = await import("./cron-observability.js");
    mod.recordRunStart({ runId: "r1", jobId: "j1", startedAt: 1000, status: "claimed", claimedBy: "w" });
    mod.recordRunEnd("r1", "succeeded", null, 2000);
    mod.recordRunStart({ runId: "r2", jobId: "j1", startedAt: 3000, status: "claimed" });
    mod.recordRunEnd("r2", "failed", "boom", 4000);

    const history = mod.getRunHistory("j1");
    expect(history).toHaveLength(2);
    // most-recent first
    expect(history[0]!.runId).toBe("r2");
    expect(history[0]!.status).toBe("failed");
    expect(history[0]!.error).toBe("boom");
    expect(history[1]!.status).toBe("succeeded");
  });

  it("returns [] for a job with no history (or if DB unavailable)", async () => {
    const mod = await import("./cron-observability.js");
    expect(mod.getRunHistory("none")).toEqual([]);
  });

  it("prunes to the most-recent MAX_ROWS (no unbounded growth)", async () => {
    const mod = await import("./cron-observability.js");
    for (let i = 0; i < 550; i++) {
      mod.recordRunStart({ runId: `r${i}`, jobId: "j", startedAt: i, status: "claimed" });
      mod.recordRunEnd(`r${i}`, "succeeded", null, i + 1);
    }
    const history = mod.getRunHistory("j", 1000);
    expect(history.length).toBeLessThanOrEqual(500);
    // the most-recent survived
    expect(history[0]!.runId).toBe("r549");
  });

  it("writes heartbeat files + reports their age", async () => {
    const mod = await import("./cron-observability.js");
    mod.recordHeartbeat();
    mod.recordHeartbeatSuccess();
    const ages = mod.heartbeatAge();
    expect(ages.heartbeatAgeMs).toBeTypeOf("number");
    expect(ages.heartbeatAgeMs!).toBeLessThan(2000);
    expect(ages.successAgeMs).toBeTypeOf("number");
    expect(ages.successAgeMs!).toBeLessThan(2000);
  });
});

describe("getLastOutput (Phase 5 context_from chaining)", () => {
  it("returns undefined for a job with no history", async () => {
    const mod = await import("./cron-observability.js");
    expect(mod.getLastOutput("no-such-job")).toBeUndefined();
  });

  it("returns undefined when runs have no output", async () => {
    const mod = await import("./cron-observability.js");
    mod.recordRunStart({ runId: "r1", jobId: "j", startedAt: 1000, status: "claimed" });
    mod.recordRunEnd("r1", "succeeded", null, 2000);
    expect(mod.getLastOutput("j")).toBeUndefined();
  });

  it("returns the most-recent non-empty output", async () => {
    const mod = await import("./cron-observability.js");
    mod.recordRunStart({ runId: "r1", jobId: "j", startedAt: 1000, status: "claimed" });
    mod.recordRunEnd("r1", "succeeded", null, 2000, "first output");
    mod.recordRunStart({ runId: "r2", jobId: "j", startedAt: 3000, status: "claimed" });
    mod.recordRunEnd("r2", "succeeded", null, 4000, "second output");
    expect(mod.getLastOutput("j")).toBe("second output");
  });

  it("skips runs with empty/null output and returns the latest non-empty", async () => {
    const mod = await import("./cron-observability.js");
    mod.recordRunStart({ runId: "r1", jobId: "j", startedAt: 1000, status: "claimed" });
    mod.recordRunEnd("r1", "succeeded", null, 2000, "real output");
    mod.recordRunStart({ runId: "r2", jobId: "j", startedAt: 3000, status: "claimed" });
    mod.recordRunEnd("r2", "succeeded", null, 4000, "");
    // r2 is newer but has empty output → should return r1's output
    expect(mod.getLastOutput("j")).toBe("real output");
  });

  it("isolates output per jobId", async () => {
    const mod = await import("./cron-observability.js");
    mod.recordRunStart({ runId: "a1", jobId: "jobA", startedAt: 1000, status: "claimed" });
    mod.recordRunEnd("a1", "succeeded", null, 2000, "A-output");
    mod.recordRunStart({ runId: "b1", jobId: "jobB", startedAt: 1000, status: "claimed" });
    mod.recordRunEnd("b1", "succeeded", null, 2000, "B-output");
    expect(mod.getLastOutput("jobA")).toBe("A-output");
    expect(mod.getLastOutput("jobB")).toBe("B-output");
  });
});
