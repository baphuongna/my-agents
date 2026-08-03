// packages/print/src/runtimes/shutdown.ts
import type { RuntimePool } from "./pool.js";
import { nowWallclock } from "@my-agent/core";
import type { CostTrackerImpl } from "./cost-tracker.js";

export interface ShutdownOptions {
  drainTimeoutMs?: number;
  forceKill?: boolean;
}

export async function gracefulShutdown(
  pool: RuntimePool,
  costTracker: CostTrackerImpl,
  opts?: ShutdownOptions,
): Promise<{ drained: number; forced: number; evicted: number }> {
  const timeout = opts?.drainTimeoutMs ?? 30_000;
  const force = opts?.forceKill ?? true;
  const startTime = nowWallclock();

  const entries = pool.list();
  const busy = entries.filter(e => e.busy);
  const idle = entries.filter(e => !e.busy);

  let forced = 0;
  let naturallyDrained = 0;

  for (const entry of idle) {
    pool.release(entry.sessionId, { force: true });
  }

  if (busy.length > 0) {
    const drainPromise = Promise.all(
      busy.map(async (entry) => {
        const deadline = startTime + timeout;
        while (nowWallclock() < deadline) {
          const current = pool.get(entry.sessionId);
          if (!current || !current.busy) { naturallyDrained++; return; }
          await new Promise<void>(r => setTimeout(r, 500));
        }
        if (force) {
          pool.release(entry.sessionId, { force: true });
          forced++;
        }
      })
    );
    await drainPromise;
  }

  pool.dispose();
  const agg = costTracker.getAggregateCost(); console.log(`[shutdown] Cost: $${agg.totalUsd.toFixed(4)}, ${agg.totalTurns} turns`);

  return { drained: naturallyDrained, forced, evicted: idle.length };
}
