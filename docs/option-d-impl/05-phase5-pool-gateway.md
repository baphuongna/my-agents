# Phase 5: RuntimePool + RuntimeSessionAdapter + Gateway Integration

> Depends on: Phase 2 (SPI types), Phase 4 (PiInProcessRuntime, buildAgentEnv)
> Estimated: 4h
> Spec reference: §5.1-5.3 (interfaces + stubs), §7.1-7.5 (RuntimePool, adapter, gateway, cron)

## Objective

Replace the existing `AgentPool` with `RuntimePool` — a multi-runtime session manager that:
- Creates sessions via any registered `AgentRuntime` (pi, claude, mya-native)
- Routes session creation through `SmartRouter` when no explicit agentType given
- Enriches prompts via `PromptEnricher` (stub in Phase 5, real in Phase 7)
- Tracks costs via `CostTracker` (stub in Phase 5, real in Phase 12)
- Adapts `RuntimeSession` → gateway's `AgentSession` interface

**This is the highest-risk phase** — it rewires gateway from single-runtime to multi-runtime.

## Deliverables

| File | Purpose |
|---|---|
| `packages/print/src/runtimes/pool.ts` | RuntimePool |
| `packages/print/src/runtimes/adapter.ts` | RuntimeSessionAdapter |
| `packages/print/src/runtimes/stubs.ts` | Stub router, enricher, cost tracker |
| `packages/print/src/runtimes/pool.test.ts` | [unit] RuntimePool tests |
| `packages/print/src/runtimes/adapter.test.ts` | [unit] RuntimeSessionAdapter tests |
| `packages/cron/src/cron-agent-type.test.ts` | [unit] Cron agentType tests |
| `packages/print/src/main.ts` (MODIFY) | Construction wiring |
| `packages/gateway/src/index.ts` (MODIFY) | Switch from AgentPool to RuntimePool |

## Implementation Steps

### Step 1: IC1 — Audit ALL AgentPool methods gateway uses

Before writing RuntimePool, map every AgentPool method the gateway currently calls:

```bash
# Find all AgentPool method calls in gateway
grep -rn "pool\.\|agentPool\.\|AgentPool" packages/gateway/src/
```

| AgentPool method | Gateway usage | RuntimePool equivalent |
|---|---|---|
| `acquire(sessionId)` | WS message handler | `acquire(sessionId)` — delegates to acquireWithRuntime |
| `acquire(sessionId, agentName)` | Named agent support | `acquireWithRuntime(sessionId, {agentType})` |
| `get(sessionId)` | Session info endpoint | `get(sessionId)` — returns RuntimePoolEntry |
| `list()` | Sessions list endpoint | `list()` — returns RuntimePoolEntry[] |
| `release(sessionId)` | Delete session endpoint | `release(sessionId)` — new: checks busy |
| `createForCwd(sessionId, cwd)` | Launcher integration | `createForCwd(sessionId, cwd)` or `acquireWithRuntime(sessionId, {cwd})` |
| `sweepIdle()` | Periodic cleanup | `sweepIdle()` — internal timer |
| `size` | Status | `size` getter |

**RuntimePool must implement ALL of these.** Key differences:
- `acquire()` delegates to `acquireWithRuntime(sessionId, {agentType: "pi"})`
- `release()` gains `{force?: boolean}` option (C4 fix)
- `RuntimePoolEntry` has `idleSince` (not just `lastActivity`)
- No `agentName` — replaced by `runtimeType`

### Step 2: Create stubs (`stubs.ts`)

```typescript
// packages/print/src/runtimes/stubs.ts

import type {
  AgentRuntime, AgentEvent, SmartRouter, PromptEnricher, CostTracker,
  EnrichContext,
} from "@my-agent/core";

// D2 fix: factory captures runtimes Map (was empty Map → always threw)
export function createStubRouter(runtimes: Map<string, AgentRuntime>): SmartRouter {
  return {
    async select(input) {
      const rt = runtimes.get(input.agentOverride ?? "pi");
      if (!rt) throw new Error(`No runtime available for "${input.agentOverride ?? "pi"}"`);
      return { runtime: rt, reason: "stub default" };
    },
  };
}

export const stubEnricher: PromptEnricher = {
  async enrich(prompt: string) { return prompt; },  // Phase 7 adds memory injection
  async capture() {},  // Phase 7 adds brain recording
};

export const stubCostTracker: CostTracker = {
  record() {},  // Phase 12 adds real tracking
  getSessionCost() { return undefined; },
};
```

### Step 3: Create RuntimePool (`pool.ts`)

Full code from spec §7.1:

```typescript
// packages/print/src/runtimes/pool.ts

import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentRuntime, AgentSession, SmartRouter, PromptEnricher, CostTracker,
  StartOpts, SessionState,
} from "@my-agent/core";
import { RuntimeSessionAdapter } from "./adapter.js";
import { buildAgentEnv } from "./build-env.js";

export interface RuntimePoolEntry {
  sessionId: string;
  session: AgentSession;       // gateway interface (adapted RuntimeSession)
  runtimeType: string;
  busy: boolean;
  messageCount: number;
  lastActivity: number;
  sessionFile?: string;
  createdAt: number;
  idleSince: number;           // NEW: separate from lastActivity (for idle sweep)
}

export class RuntimePool {
  private entries = new Map<string, RuntimePoolEntry>();
  private maxSessions = parseInt(process.env.MYA_MAX_SESSIONS ?? "16", 10);
  private idleTtlMs = 3_600_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private router: SmartRouter,
    private runtimes: Map<string, AgentRuntime>,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
  ) {
    this.sweepTimer = setInterval(() => this.sweepIdle(), 60_000);
    this.sweepTimer.unref?.();
  }

  // IC1: backward-compatible acquire() — delegates to acquireWithRuntime
  async acquire(sessionId: string): Promise<AgentSession> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      existing.idleSince = Date.now();
      return existing.session;
    }
    const { session } = await this.acquireWithRuntime(sessionId, { agentType: "pi" });
    return session;
  }

  async acquireWithRuntime(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string; prompt?: string },
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      if (opts?.agentType && existing.runtimeType !== opts.agentType) {
        throw new Error(
          `Session ${sessionId} exists as ${existing.runtimeType}, cannot reassign to ${opts.agentType}`
        );
      }
      existing.lastActivity = Date.now();
      existing.idleSince = Date.now();
      return { session: existing.session, runtimeType: existing.runtimeType };
    }

    if (this.entries.size >= this.maxSessions) {
      this.sweepIdle();
      if (this.entries.size >= this.maxSessions) throw new Error("Max sessions reached");
    }

    let runtime: AgentRuntime;
    if (opts?.agentType) {
      runtime = this.runtimes.get(opts.agentType)!;
      if (!runtime?.isAvailable()) throw new Error(`Agent "${opts.agentType}" not available`);
    } else {
      const result = await this.router.select({
        prompt: opts?.prompt ?? "",
        modelOverride: opts?.model,
      });
      runtime = result.runtime;
    }

    const env = buildAgentEnv();
    const runtimeSession = await runtime.start({
      cwd: opts?.cwd ?? process.cwd(),
      agentDir: join(homedir(), ".mya", "agent"),
      sessionId,
      modelId: opts?.model,
      env,
    });

    const adapter = new RuntimeSessionAdapter(
      runtimeSession,
      this.enricher,
      this.costTracker,
      // onBusyChange callback
      (busy: boolean) => {
        const entry = this.entries.get(sessionId);
        if (entry) {
          entry.busy = busy;
          entry.lastActivity = Date.now();
          if (!busy) entry.idleSince = Date.now();
        }
      },
      // onMessage callback
      () => {
        const entry = this.entries.get(sessionId);
        if (entry) entry.messageCount++;
      },
    );

    this.entries.set(sessionId, {
      sessionId,
      session: adapter,
      runtimeType: runtime.runtimeType,
      busy: false,
      messageCount: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(),
      idleSince: Date.now(),
    });

    return { session: adapter, runtimeType: runtime.runtimeType };
  }

  get(sessionId: string): RuntimePoolEntry | undefined {
    return this.entries.get(sessionId);
  }

  list(): RuntimePoolEntry[] {
    return [...this.entries.values()];
  }

  // C4 fix: force option for stuck sessions
  release(sessionId: string, opts?: { force?: boolean }): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    if (entry.busy && !opts?.force) return false;
    void Promise.resolve(entry.session.abort()).catch(() => {});
    this.entries.delete(sessionId);
    return true;
  }

  async createForCwd(sessionId: string, cwd: string): Promise<AgentSession> {
    const { session } = await this.acquireWithRuntime(sessionId, { cwd });
    return session;
  }

  get size(): number { return this.entries.size; }

  private sweepIdle(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.busy) continue;
      if (now - entry.idleSince > this.idleTtlMs) {
        void Promise.resolve(entry.session.abort()).catch(() => {});
        this.entries.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const entry of this.entries.values()) {
      void Promise.resolve(entry.session.abort()).catch(() => {});
    }
    this.entries.clear();
  }
}
```

### Step 4: Create RuntimeSessionAdapter (`adapter.ts`)

Full code from spec §7.2 (with R8-2 fix):

```typescript
// packages/print/src/runtimes/adapter.ts

import type {
  AgentSession, RuntimeSession, PromptEnricher, CostTracker,
  SessionState, EnrichContext,
} from "@my-agent/core";

export class RuntimeSessionAdapter implements AgentSession {
  private listeners = new Set<(e: unknown) => void>();
  private textBuffer = "";
  private turnLock = Promise.resolve();

  constructor(
    private session: RuntimeSession,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
    private onBusyChange?: (busy: boolean) => void,
    private onMessage?: () => void,
  ) {
    this.session.onEvent((event) => {
      if (event.type === "text") this.textBuffer += event.delta;
      this.costTracker.record(this.session.sessionId, event);
      this.listeners.forEach(l => l(event));
    });
  }

  async prompt(text: string, _options?: unknown): Promise<void> {
    const prev = this.turnLock;
    let release!: () => void;
    this.turnLock = new Promise<void>((r) => { release = r; });
    this.onBusyChange?.(true);

    try {
      await prev;  // Serialize turns

      let enriched = text;
      try {
        const ctx: EnrichContext = {
          sessionId: this.session.sessionId,
          runtimeType: this.session.runtimeType,
          executionModel: this.session.executionModel,
        };
        enriched = await this.enricher.enrich(text, ctx);
      } catch (e) {
        console.warn(`[adapter] enrich failed: ${e}`);
      }

      this.textBuffer = "";

      try {
        await this.session.prompt(enriched);
        this.onMessage?.();
      } catch (e) {
        console.warn(`[adapter] session.prompt failed: ${e}`);
        throw e;
      }

      if (this.textBuffer) {
        try {
          // R8-2 fix: include executionModel
          const ctx: EnrichContext = {
            sessionId: this.session.sessionId,
            runtimeType: this.session.runtimeType,
            executionModel: this.session.executionModel,
          };
          await this.enricher.capture(this.textBuffer, ctx);
        } catch (e) {
          console.warn(`[adapter] capture failed: ${e}`);
        }
      }
    } finally {
      this.onBusyChange?.(false);
      release();
    }
  }

  subscribe(listener: (e: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  abort(): void {
    void this.session.dispose().catch(() => {});
  }

  get sessionFile(): string | undefined { return undefined; }

  getState(): SessionState {
    return this.session.getState();
  }

  getTextBuffer(): string { return this.textBuffer; }
}
```

### Step 5: Construction wiring in main.ts

```typescript
// packages/print/src/main.ts (inside runWebServer scope, after shared instances are created)

// 1. Create runtimes map
const runtimes = new Map<string, AgentRuntime>();
const agentDir = join(homedir(), ".mya", "agent");

// D1 fix: dreamCycle must be hoisted to shared-instances.ts
// All 3 instantiation sites updated:
//   - main.ts:610 → use shared instance
//   - agent/src/index.ts:302 → use shared instance
//   - mya-bridge.ts:348 fallback → use shared instance

const piDeps: PiRuntimeDeps = {
  agentDir,
  auditLog, secretStore, hooks, skillStore, cron,
  brain, memory, retrievalEngine, lifecycleManager, sqliteMemory,
  dreamCycle, wallet, sync, collab, packageHost,
  council, mcp, mcpConfigs, channels, roleRegistry, achievements,
};

runtimes.set("pi", new PiInProcessRuntime(piDeps));
// runtimes.set("mya-native", new MyaNativeRuntime());  // Phase 6
// runtimes.set("claude", new ClaudeRuntime());          // Phase 10

// 2. Create stubs (Phase 5). Real impls added in phases 7/8/12.
const router = createStubRouter(runtimes);
const enricher = stubEnricher;
const costTracker = stubCostTracker;

// 3. Construct pool
const pool = new RuntimePool(router, runtimes, enricher, costTracker);

// 4. Pass pool to gateway (replaces AgentPool)
// gateway now receives RuntimePool (implements AgentSession-compatible interface)
```

### Step 6: Gateway migration

```typescript
// packages/gateway/src/index.ts
// BEFORE: import { AgentPool } from "@my-agent/agent";
// AFTER:  import { RuntimePool } from "../print/src/runtimes/pool.js";

// Gateway already duck-types pool — it calls:
//   pool.acquire(sessionId) → AgentSession
//   pool.get(sessionId) → entry
//   pool.list() → entries
//   pool.release(sessionId) → boolean
//   pool.createForCwd(sessionId, cwd) → AgentSession
//   pool.size → number

// RuntimePool implements ALL of these, so gateway code needs minimal changes:
// 1. Replace AgentPool import with RuntimePool
// 2. Replace pool construction call
// 3. Update entry type references (AgentSessionEntry → RuntimePoolEntry)
// 4. release() now returns false for busy sessions — add {force:true} for admin endpoints
```

### Step 7: IC2 — Cron rewire

```typescript
// packages/cron/src/index.ts

interface CronJob {
  name: string;
  trigger: TriggerType;
  schedule: string;
  prompt: string;
  agentType?: string;     // NEW: which runtime to use (default: "pi")
  deliveryTarget?: string;
  workdir?: string;       // G3 fix: was missing
}

async function executeCronJob(pool: RuntimePool, job: CronJob, sessionId: string): Promise<void> {
  const { session } = await pool.acquireWithRuntime(sessionId, {
    agentType: job.agentType ?? "pi",
    prompt: job.prompt,
    cwd: job.workdir ?? process.cwd(),
  });
  await session.prompt(job.prompt);
}
```

## Test Plan

### `pool.test.ts` [unit]

| Case | Setup | Expected |
|---|---|---|
| get-or-create | acquire(sessionId) twice | Same session object both times |
| agentType mismatch | acquire as "pi", then as "claude" | Throws error |
| maxSessions enforcement | Fill to max, acquire one more | Throws "Max sessions reached" |
| maxSessions + sweep | Fill to max, acquire (triggers sweep) | Sweep evicts idle, new session created |
| idle sweep | Set idleTtlMs=0, wait | Entry removed |
| release busy → false | Acquire, mock busy, release | Returns false |
| release force → true | Acquire, mock busy, release({force}) | Returns true |
| idleSince > 0 after acquire | Acquire, check entry.idleSince | Number > 0 |
| createForCwd | createForCwd(id, cwd) | Session with correct cwd |
| size getter | Add/remove entries | Correct count |

### `adapter.test.ts` [unit]

| Case | Setup | Expected |
|---|---|---|
| enrich → prompt → capture | Mock session + enricher | enrich called before prompt, capture after |
| busy toggle | Subscribe to onBusyChange | true before prompt, false after |
| turnLock serialization | 2 concurrent prompts | Second waits for first |
| abort → dispose | Call abort() | session.dispose() called |
| messageCount++ | Call prompt() | onMessage callback fired |
| prompt throw → turn_end | Mock session.prompt to throw | Error propagated, busy reset |
| enrich error → raw prompt | Mock enricher.enrich to throw | Prompt still called with raw text |
| capture error → no crash | Mock enricher.capture to throw | No exception, warning logged |
| text buffer accumulation | Events with type "text" | textBuffer accumulates deltas |

### `cron-agent-type.test.ts` [unit]

| Case | Setup | Expected |
|---|---|---|
| legacy job → pi | CronJob without agentType | Uses "pi" runtime |
| explicit agentType | CronJob with agentType="claude" | Uses "claude" runtime |
| workdir field | CronJob with workdir | cwd passed to acquireWithRuntime |

## Acceptance Criteria

- [ ] IC1: RuntimePool implements ALL methods gateway currently calls on AgentPool
- [ ] RuntimePool.acquire() returns AgentSession-compatible object
- [ ] RuntimePool.release() respects busy flag unless force=true
- [ ] idleSince set on acquire, updated on busy→false transition
- [ ] sweepIdle() runs on timer, evicts idle entries past TTL
- [ ] RuntimeSessionAdapter implements AgentSession interface (prompt, subscribe, abort, sessionFile)
- [ ] adapter serializes prompts via turnLock
- [ ] adapter enriches before prompt, captures after
- [ ] adapter errors are caught and logged (never block the pipeline)
- [ ] Stubs (createStubRouter, stubEnricher, stubCostTracker) compile and pass through
- [ ] Gateway compiles with RuntimePool replacing AgentPool
- [ ] Cron jobs use agentType field (default "pi")
- [ ] IC6: no SessionMetaStore — state comes from RuntimeSession.getState()

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **IC1: gateway uses undocumented AgentPool method** | HIGH — runtime crash | Grep ALL `pool\.` calls in gateway before migration. Add missing methods to RuntimePool. |
| AgentSession interface mismatch | HIGH — compile error | RuntimeSessionAdapter explicitly implements AgentSession (prompt, subscribe, abort, sessionFile). |
| turnLock deadlock | MEDIUM — session hangs | release() in finally block. Verify with test. |
| Gateway expects agentName | LOW | RuntimePool has runtimeType instead. Update type references. |
| Existing tests break | MEDIUM | Phase 5 is additive — AgentPool still exists. Gateway migration can be gradual. |
| Pool not disposed on shutdown | MEDIUM | Call pool.dispose() in shutdown handler (Phase 13). |
| Stub router always returns pi | LOW (expected) | Phase 8 replaces with real SmartRouter. |

## Rollback

**Phase 5 is designed to be backward-compatible:**
1. AgentPool still exists and works (not deleted)
2. RuntimePool is a new file, not a replacement
3. Gateway migration is a single import change + construction call change
4. To rollback: revert gateway import from RuntimePool back to AgentPool
5. Delete: pool.ts, adapter.ts, stubs.ts, test files
6. No data migration needed (sessions are ephemeral)
