# Phase 13: Shutdown + Idle Sweep + E2E

> Depends on: ALL previous phases
> Estimated: 2h
> Spec reference: §7.3-7.4 (WebSocket, Shutdown), §10 (e2e-shutdown.test.ts)

## Objective

Production-grade lifecycle management:
1. **Graceful shutdown** — drain busy sessions before exit
2. **Idle sweep** — evict sessions past TTL
3. **E2E tests** — verify the full platform works end-to-end

This is the final phase before declaring Option D complete.

## Deliverables

| File | Purpose |
|---|---|
| `packages/print/src/runtimes/shutdown.ts` | Shutdown handler |
| `packages/print/src/runtimes/e2e-shutdown.test.ts` | [system] E2E tests |
| `packages/print/src/main.ts` (MODIFY) | Wire shutdown handler |
| `packages/gateway/src/index.ts` (MODIFY) | Add /shutdown endpoint (admin only) |

## Implementation Steps

### Step 1: Shutdown handler

```typescript
// packages/print/src/runtimes/shutdown.ts

import type { RuntimePool } from "./pool.js";
import type { CostTrackerImpl } from "./cost-tracker.js";

export interface ShutdownOptions {
  /** Max time to wait for busy sessions (ms). Default: 30_000 */
  drainTimeoutMs?: number;
  /** Force-kill sessions that don't finish in time. Default: true */
  forceKill?: boolean;
}

export async function gracefulShutdown(
  pool: RuntimePool,
  costTracker: CostTrackerImpl,
  opts?: ShutdownOptions,
): Promise<{ drained: number; forced: number; evicted: number }> {
  const timeout = opts?.drainTimeoutMs ?? 30_000;
  const force = opts?.forceKill ?? true;
  const startTime = Date.now();

  const entries = pool.list();
  const busy = entries.filter(e => e.busy);
  const idle = entries.filter(e => !e.busy);

  let forced = 0;

  // 1. Evict idle sessions immediately
  for (const entry of idle) {
    pool.release(entry.sessionId, { force: true });
  }

  // 2. Wait for busy sessions to finish (with timeout)
  if (busy.length > 0) {
    console.log(`[shutdown] Waiting for ${busy.length} busy sessions (timeout: ${timeout}ms)`);

    const drainPromise = Promise.all(
      busy.map(async (entry) => {
        // Wait for busy flag to clear
        const deadline = startTime + timeout;
        while (Date.now() < deadline) {
          const current = pool.get(entry.sessionId);
          if (!current || !current.busy) return;
          await sleep(500);
        }
        // Force release if still busy
        if (force) {
          pool.release(entry.sessionId, { force: true });
          forced++;
        }
      })
    );

    await drainPromise;
  }

  // 3. Dispose pool (clears sweep timer, aborts remaining sessions)
  pool.dispose();

  // 4. Clean up cost tracker
  const aggregate = costTracker.getAggregateCost();
  console.log(
    `[shutdown] Cost: $${aggregate.totalUsd.toFixed(4)}, ` +
    `${aggregate.totalTurns} turns across ${aggregate.sessions} sessions`
  );

  return {
    drained: busy.length - forced,
    forced,
    evicted: idle.length,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Step 2: Wire shutdown signals

```typescript
// packages/print/src/main.ts

import { gracefulShutdown } from "./runtimes/shutdown.js";

let shuttingDown = false;

async function handleShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;  // Prevent double shutdown
  shuttingDown = true;

  console.log(`\n[main] ${signal} received. Shutting down gracefully...`);

  try {
    const result = await gracefulShutdown(pool, costTracker, {
      drainTimeoutMs: 30_000,
      forceKill: true,
    });
    console.log(
      `[main] Shutdown complete: ` +
      `${result.drained} drained, ${result.forced} forced, ${result.evicted} evicted`
    );
  } catch (e) {
    console.error(`[main] Shutdown error: ${e}`);
  }

  process.exit(0);
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("beforeExit", () => handleShutdown("beforeExit"));
```

### Step 3: Idle sweep integration

RuntimePool already has an internal sweep timer (from Phase 5):

```typescript
// Already in RuntimePool constructor:
this.sweepTimer = setInterval(() => this.sweepIdle(), 60_000);
this.sweepTimer.unref?.();  // Doesn't keep process alive
```

The sweep evicts sessions where `Date.now() - idleSince > idleTtlMs` (default 1 hour).

For Phase 13, ensure cost tracker is cleaned up too:

```typescript
// packages/print/src/runtimes/pool.ts — modify sweepIdle()

// R2-7 fix: keep public per F-3 fix. Do NOT add 'private'.
sweepIdle(): void {
  const now = Date.now();
  for (const [id, entry] of this.entries) {
    if (entry.busy) continue;
    if (now - entry.idleSince > this.idleTtlMs) {
      void Promise.resolve(entry.session.abort()).catch(() => {});
      this.entries.delete(id);
      // NEW: clean up cost tracker
      this.costTracker.forget?.(id);
    }
  }
}
```

### Step 4: Admin /shutdown endpoint

```typescript
// packages/gateway/src/index.ts — add to GatewayOptions:

/** Phase 13: graceful shutdown callback for POST /shutdown.
 * Gateway checks auth (hasOrigin) before calling. */
shutdownHandler?: () => Promise<void>;

// Then in handleHttp(), add route:
// POST /shutdown
if (url.pathname === "/shutdown" && req.method === "POST" && this.shutdownHandler) {
  // Auth check: browser requests need valid token (existing hasOrigin logic)
  // CLI/loopback always trusted
  setImmediate(() => this.shutdownHandler!());
  return send(200, { message: "Shutdown initiated" });
}
```

```typescript
// packages/print/src/main.ts — wire shutdown callback
import { gracefulShutdown } from "./runtimes/shutdown.js";

const gateway = new Gateway({
  // ... existing callbacks ...
  shutdownHandler: async () => {
    await gracefulShutdown(pool, costTracker);
    process.exit(0);
  },
});
```

### Step 5: E2E test

```typescript
// packages/print/src/runtimes/e2e-shutdown.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AgentRuntime } from "@my-agent/core";
import { RuntimePool } from "./pool.js";
import { createStubRouter, stubEnricher } from "./stubs.js";  // R3-7 fix: add missing imports
import { gracefulShutdown } from "./shutdown.js";
import { CostTrackerImpl } from "./cost-tracker.js";
import { PiInProcessRuntime } from "./pi-in-process.js";
// R3-7/R4-5 fix: provide minimal piDeps mock for test
const piDeps = { agentDir: "/tmp/test-agent" } as any;  // Real deps constructed in Phase 4/5 from shared instances

describe("[system] E2E shutdown", () => {
  let pool: RuntimePool;
  let costTracker: CostTrackerImpl;

  beforeAll(() => {
    const runtimes = new Map<string, AgentRuntime>();
    // Register at least pi runtime
    runtimes.set("pi", new PiInProcessRuntime(piDeps));

    const router = createStubRouter(runtimes);
    costTracker = new CostTrackerImpl();
    pool = new RuntimePool(router, runtimes, stubEnricher, costTracker);
  });

  afterAll(() => pool.dispose());

  it("graceful shutdown drains busy sessions", async () => {
    // Create a session and start a prompt
    const session = await pool.acquire("e2e-drain-test");
    const promptPromise = session.prompt("Count to 10 slowly");

    // Start shutdown while prompt is running
    const result = await gracefulShutdown(pool, costTracker, {
      drainTimeoutMs: 10_000,
      forceKill: true,
    });

    // The busy session should have been drained or forced
    expect(result.forced + result.drained).toBeGreaterThan(0);

    // Prompt should have resolved (or been aborted)
    await expect(promptPromise).resolves.toBeUndefined();
  });

  it("idle sweep evicts expired sessions", async () => {
    // Create session
    await pool.acquire("e2e-idle-test");
    expect(pool.size).toBe(1);

    // Mock time advancement or use short TTL
    // F-3 fix: use test-friendly accessor (Phase 5 makes sweepIdle public for testing)
    (pool as any).idleTtlMs = 100;  // Set short TTL for test
    await sleep(200);

    // sweepIdle is public for test access (F-3 fix)
    pool.sweepIdle();

    expect(pool.size).toBe(0);
  });

  it("force release works on busy session", async () => {
    const session = await pool.acquire("e2e-force-test");
    const promptPromise = session.prompt("Long running task...");

    // Force release while busy
    const released = pool.release("e2e-force-test", { force: true });
    expect(released).toBe(true);
    expect(pool.get("e2e-force-test")).toBeUndefined();
  });

  it("shutdown handles empty pool", async () => {
    const emptyPool = new RuntimePool(
      createStubRouter(new Map()), new Map(), stubEnricher, costTracker
    );
    const result = await gracefulShutdown(emptyPool, costTracker);
    expect(result.drained).toBe(0);
    expect(result.evicted).toBe(0);
  });

  it("double shutdown is safe", async () => {
    await gracefulShutdown(pool, costTracker);
    // Second shutdown should not throw
    await expect(gracefulShutdown(pool, costTracker)).resolves.not.toThrow();
  });
});
```

## Test Plan

### `e2e-shutdown.test.ts` [system]

| Case | Description | Expected |
|---|---|---|
| graceful drain | Busy session during shutdown | Drained or forced within timeout |
| idle sweep | Session past TTL | Evicted from pool |
| force release | Busy session force=true | Released immediately |
| empty pool | Shutdown with no sessions | No errors |
| double shutdown | Call shutdown twice | Second call is no-op |
| SIGTERM signal | Send SIGTERM to process | Graceful shutdown initiated |
| SIGINT signal | Send SIGINT (Ctrl+C) | Graceful shutdown initiated |
| cost summary logged | After shutdown | Console shows aggregate cost |

## Acceptance Criteria

- [ ] `gracefulShutdown()` drains busy sessions before disposing pool
- [ ] Idle sessions evicted immediately during shutdown
- [ ] Forced sessions killed after drain timeout
- [ ] `pool.dispose()` clears sweep timer and aborts remaining sessions
- [ ] SIGTERM and SIGINT trigger graceful shutdown
- [ ] Double shutdown is safe (no crash)
- [ ] Cost summary logged on shutdown
- [ ] Idle sweep runs every 60s (unref'd — doesn't block exit)
- [ ] Idle sweep cleans up cost tracker (forget session)
- [ ] Admin /shutdown endpoint works (requires auth)
- [ ] E2E test passes with real pi runtime

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Shutdown hangs forever | HIGH — systemd Restart=always won't trigger | drainTimeoutMs (default 30s) + forceKill=true |
| Race between sweep and shutdown | LOW | Both check busy flag; release({force}) is idempotent |
| Process exits before drain completes | MEDIUM | Shutdown handler awaits drain before process.exit |
| E2E test slow | LOW | [system] tier — skipped in fast CI, run on demand |
| systemd kills before drain | MEDIUM | Set TimeoutStopSec=60 in systemd unit (already set) |

## Rollback

- Remove shutdown signal handlers from main.ts
- Delete: shutdown.ts, e2e-shutdown.test.ts
- Pool still works (just no graceful drain on exit)
- Systemd Restart=always will restart after kill, but sessions may be lost
