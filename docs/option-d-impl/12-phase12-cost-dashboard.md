# Phase 12: CostTracker + Dashboard + Snapshot

> Depends on: Phase 5 (RuntimePool + adapter), Phase 4 (AgentEvent stream)
> Estimated: 3h
> Spec reference: §5.1 (CostTracker interface), §6.3, §7.2 (adapter calls costTracker.record)

## Objective

Replace the Phase 5 `stubCostTracker` with a real implementation that:
1. Records token usage from every `AgentEvent` across all runtimes
2. Aggregates per-session cost (USD)
3. Exposes session snapshots via gateway REST endpoint
4. Feeds cost data to the dashboard

## Deliverables

| File | Purpose |
|---|---|
| `packages/print/src/runtimes/cost-tracker.ts` | CostTracker implementation |
| (No separate snapshot.ts file needed — route via poolSnapshot callback) | — |
| `packages/gateway/src/index.ts` (MODIFY) | Add `poolSnapshot` callback to GatewayOptions + route in handleHttp |
| `packages/gateway/src/gateway-snapshot.test.ts` | [unit] snapshot tests |
| `packages/print/src/main.ts` (MODIFY) | Replace stubCostTracker with real CostTracker |

## Implementation Steps

### Step 1: Implement CostTracker

```typescript
// packages/print/src/runtimes/cost-tracker.ts

import type { AgentEvent, CostTracker } from "@my-agent/core";

interface SessionCost {
  totalUsd: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  events: number;
  startedAt: number;
  lastActivity: number;
}

// Per-runtime cost rates (USD per million tokens)
const COST_RATES: Record<string, { input: number; output: number }> = {
  pi: { input: 3, output: 15 },       // Claude Sonnet default
  claude: { input: 3, output: 15 },
  "mya-native": { input: 3, output: 15 },
};

export class CostTrackerImpl implements CostTracker {
  private sessions = new Map<string, SessionCost>();

  record(sessionId: string, event: AgentEvent): void {
    let cost = this.sessions.get(sessionId);
    if (!cost) {
      cost = {
        totalUsd: 0, turns: 0, tokensIn: 0, tokensOut: 0,
        events: 0, startedAt: nowWallclock()  // R5-7 fix: use core.time helper (AGENTS.md §18), lastActivity: nowWallclock(),
      };
      this.sessions.set(sessionId, cost);
    }

    cost.events++;
    cost.lastActivity = nowWallclock();

    if (event.type === "turn_end") {
      cost.turns++;
      cost.tokensIn += event.tokensIn;
      cost.tokensOut += event.tokensOut;

      // Calculate cost using default rate
      // (Phase 12 enhancement: lookup runtime-specific rate)
      // R5-3 fix: use event.costUsd if provided, otherwise look up by runtime type
      const rate = COST_RATES[(event as any).runtimeType] ?? COST_RATES["pi"];
      if (event.costUsd !== undefined && event.costUsd > 0) {
        cost.totalUsd += event.costUsd;
      } else {
      cost.totalUsd +=
        (event.tokensIn / 1_000_000) * rate.input +
        (event.tokensOut / 1_000_000) * rate.output;
    }
  }

  getSessionCost(sessionId: string): { totalUsd: number; turns: number } | undefined {
    const cost = this.sessions.get(sessionId);
    if (!cost) return undefined;
    return { totalUsd: cost.totalUsd, turns: cost.turns };
  }

  getFullCost(sessionId: string): SessionCost | undefined {
    return this.sessions.get(sessionId);
  }

  // Aggregate across all sessions
  getAggregateCost(): { totalUsd: number; totalTurns: number; sessions: number } {
    let totalUsd = 0;
    let totalTurns = 0;
    for (const cost of this.sessions.values()) {
      totalUsd += cost.totalUsd;
      totalTurns += cost.turns;
    }
    return { totalUsd, totalTurns, sessions: this.sessions.size };
  }

  // Clean up old sessions (called by idle sweep)
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // R5-11 fix: dead snapshot() method removed. Use getSnapshot() instead.
  // Snapshot assembly for REST API — called from main.ts via poolSnapshot callback
}
```

### Step 2: Add snapshot callback to GatewayOptions

> **R3-1 fix:** Gateway uses raw `http.createServer`, NOT Express.
> No `app.get()`, no middleware. Routes are added as callbacks in `GatewayOptions`.

```typescript
// packages/gateway/src/index.ts — add to GatewayOptions interface:

/** Phase 12: snapshot a session's state + text + cost.
 * Returns undefined if session not found (gateway sends 404). */
poolSnapshot?: (sessionId: string) => unknown;

// Then in handleHttp(), add route matching:
// GET /pool/sessions/:id/snapshot
const snapshotMatch = url.pathname.match(/^\/pool\/sessions\/([^/]+)\/snapshot$/);
if (snapshotMatch && req.method === "GET" && this.poolSnapshot) {
  const sessionId = snapshotMatch[1]!;
  const result = this.poolSnapshot(sessionId);
  if (!result) return send(404, { error: "Session not found" });
  return send(200, result);
}
```

```typescript
// packages/print/src/runtimes/cost-tracker.ts — add getSnapshot method

getSnapshot(sessionId: string, pool: RuntimePool): unknown | undefined {
  const entry = pool.get(sessionId);
  if (!entry) return undefined;

  const cost = this.sessions.get(sessionId);
  const state = (entry.session as any).getState?.();
  const text = (entry.session as any).getTextBuffer?.() ?? "";

  return {
    sessionId,
    runtimeType: entry.runtimeType,
    busy: entry.busy,
    messageCount: entry.messageCount,
    createdAt: entry.createdAt,
    lastActivity: entry.lastActivity,
    state,
    text,
    cost: cost ?? {
      totalUsd: 0, turns: 0, tokensIn: 0,
      tokensOut: 0, events: 0,
      startedAt: entry.createdAt, lastActivity: entry.lastActivity,
    },
  };
}
```

### Step 3: Wire into main.ts

```typescript
// packages/print/src/main.ts
// BEFORE (Phase 5): const costTracker = stubCostTracker;
// AFTER (Phase 12):
import { CostTrackerImpl } from "./runtimes/cost-tracker.js";

const costTracker = new CostTrackerImpl();
const pool = new RuntimePool(router, runtimes, enricher, costTracker);

// R3-1 fix: add snapshot callback to gateway options (NOT Express route)
const gateway = new Gateway({
  // ... existing callbacks ...
  poolSnapshot: (sessionId: string) => costTracker.getSnapshot(sessionId, pool),
});
```

### Step 4: Dashboard cost widget

The web dashboard already renders session events. Add a cost summary component:

```tsx
// packages/web/src/components/CostSummary.tsx
function CostSummary({ sessionId }: { sessionId: string }) {
  const snapshot = useSnapshot(sessionId);  // GET /pool/sessions/:id/snapshot

  return (
    <div className="cost-summary">
      <span>Turns: {snapshot.cost.turns}</span>
      <span>Tokens: {snapshot.cost.tokensIn + snapshot.cost.tokensOut}</span>
      <span>Cost: ${snapshot.cost.totalUsd.toFixed(4)}</span>
    </div>
  );
}
```

## Test Plan

### `gateway-snapshot.test.ts` [unit]

| Case | Setup | Expected |
|---|---|---|
| snapshot returns session data | Create session, send prompt | 200 with cost + state + text |
| snapshot 404 for unknown session | GET /pool/sessions/nonexistent/snapshot | 404 |
| snapshot includes cost | Send 2 prompts | cost.turns === 2, totalUsd > 0 |
| snapshot includes text buffer | Send prompt with text events | text field non-empty |
| snapshot includes runtimeType | Create pi session | runtimeType === "pi" |
| aggregate cost across sessions | Create 2 sessions, send prompts | Sum of both |

## Acceptance Criteria

- [ ] CostTrackerImpl.record() accumulates tokens from turn_end events
- [ ] CostTrackerImpl.getSessionCost() returns {totalUsd, turns}
- [ ] CostTrackerImpl.getFullCost() returns detailed cost breakdown
- [ ] GET /pool/sessions/:id/snapshot returns 200 with cost + state + text
- [ ] GET /pool/sessions/:id/snapshot returns 404 for unknown session
- [ ] Cost rates configurable per runtime (COST_RATES map)
- [ ] Dashboard renders cost summary
- [ ] Aggregate cost endpoint (if added) sums across all sessions
- [ ] stubCostTracker replaced with CostTrackerImpl in main.ts

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cost rates change | LOW — wrong cost numbers | COST_RATES is a const map, easily updated. Consider loading from models.json. |
| turn_end tokensIn=0 for broker injection | LOW | R8-1 fix documents this. Broker turns report 0 tokens. |
| Memory leak from old sessions | MEDIUM | CostTracker.forget() called by idle sweep (Phase 13). |
| Snapshot exposes sensitive text | MEDIUM | Gateway auth required for snapshot endpoint (existing hasOrigin check). |

## Rollback

- Revert main.ts: change `new CostTrackerImpl()` back to `stubCostTracker`
- Delete: cost-tracker.ts, snapshot.ts, gateway-snapshot.test.ts
- Gateway works fine without snapshot route (just returns 404)
