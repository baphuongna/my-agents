import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let realHome: string | undefined;
let dir: string;

beforeEach(() => {
  realHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "mya-cronobs-"));
  process.env.HOME = dir;
});
afterEach(() => {
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
