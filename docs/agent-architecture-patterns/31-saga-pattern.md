# Hướng AE: Saga Pattern — distributed transactions cho multi-agent

> **Nguồn gốc:** Distributed Systems (Garcia-Molina & Salem, 1987)
> **Coupling:** 🟡 Saga coordinator + compensation
> **Agent-agnostic:** ✅ — bất kỳ agent có compensation
> **Effort:** 2-3 tuần

## Nguồn gốc

Saga pattern (Garcia-Molina & Salem, 1987): long-running transaction tách thành sequence các local transactions. Mỗi step có **compensation** (undo action). Nếu step fail → chạy compensations ngược lại. Không cần distributed lock — mỗi agent tự quản lý local state.

## Mô tả

Multi-agent task = Saga. Mỗi step = 1 agent action (edit file, run test, deploy). Mỗi step có compensation (revert edit, cleanup, rollback deploy). Nếu bất kỳ step fail → chạy compensation ngược từ step fail về đầu. Đảm bảo consistent state dù agents thất bại.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                    SAGA: "DEPLOY FEATURE"                    │
│                                                              │
│  Step 1: Agent A — edit source code                         │
│    Compensation: revert git commit                          │
│                                                              │
│  Step 2: Agent B — run tests                                │
│    Compensation: (none — tests are read-only)               │
│                                                              │
│  Step 3: Agent C — build bundle                             │
│    Compensation: delete dist/ output                        │
│                                                              │
│  Step 4: Agent D — deploy to staging                        │
│    Compensation: rollback staging to previous version       │
│                                                              │
│  Step 5: Agent E — run E2E tests                            │
│    Compensation: (none)                                     │
│                                                              │
│  Step 6: Agent F — deploy to production                     │
│    Compensation: rollback production                        │
│                                                              │
│  SUCCESS PATH:                                               │
│  edit → test → build → staging → e2e → prod                 │
│  ✓ ✓ ✓ ✓ ✓ ✓                                              │
│                                                              │
│  FAILURE AT STEP 5 (E2E fails):                              │
│  edit → test → build → staging → e2e(FAIL)                  │
│  ✓ ✓ ✓ ✓ ✗                                               │
│  → run compensations backward:                              │
│    rollback staging (compensate step 4)                     │
│    delete dist (compensate step 3)                          │
│    revert commit (compensate step 1)                        │
│  → system back to consistent state                          │
│                                                              │
│  KHÔNG CẦN distributed lock.                                │
│  Mỗi agent tự undo action của mình.                         │
└──────────────────────────────────────────────────────────────┘
```

## Saga coordinator

```typescript
// packages/saga/src/index.ts
interface SagaStep {
  name: string;
  action: () => Promise<void>;        // What to do
  compensate: () => Promise<void>;    // How to undo
  agent?: string;                     // Which agent runs it
}

class SagaCoordinator {
  private completed: SagaStep[] = [];

  constructor(private steps: SagaStep[]) {}

  async execute(): Promise<void> {
    try {
      for (const step of this.steps) {
        log(`[saga] executing ${step.name}`);
        await step.action();
        this.completed.push(step);
      }
      log("[saga] ALL STEPS SUCCEEDED");
    } catch (err) {
      log(`[saga] FAILED at ${this.completed.length + 1}/${this.steps.length}: ${err}`);
      await this.compensate();
      throw new Error(`Saga failed: ${err}`);
    }
  }

  private async compensate(): Promise<void> {
    // Run compensations in REVERSE order
    for (const step of [...this.completed].reverse()) {
      try {
        log(`[saga] compensating ${step.name}`);
        await step.compensate();
      } catch (err) {
        // Compensation failure — must be handled (dead letter, manual)
        log(`[saga] COMPENSATION FAILED for ${step.name}: ${err}`);
        await this.deadLetter(step, err);
      }
    }
  }

  private async deadLetter(step: SagaStep, err: unknown): Promise<void> {
    // Record for manual intervention (like DLQ in message brokers)
    // The system is NOT consistent — human must fix
    // Or retry compensation with backoff
  }
}

// Example saga: deploy feature
const deploySaga = new SagaCoordinator([
  {
    name: "edit-source",
    action: async () => spawnAgent("pi", "implement feature"),
    compensate: async () => runGit("revert HEAD"),
    agent: "pi",
  },
  {
    name: "run-tests",
    action: async () => spawnAgent("pi", "run tests"),
    compensate: async () => {},  // tests are read-only
  },
  {
    name: "deploy-staging",
    action: async () => spawnAgent("opencode", "deploy to staging"),
    compensate: async () => spawnAgent("opencode", "rollback staging"),
  },
  {
    name: "deploy-prod",
    action: async () => spawnAgent("opencode", "deploy to production"),
    compensate: async () => spawnAgent("opencode", "rollback production"),
  },
]);

await deploySaga.execute();
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Consistent state (compensations undo partial work) | ❌ Compensation must exist for every step |
| ✅ No distributed locks | ❌ Compensation itself can fail (dead letter) |
| ✅ Long-running transactions (hours OK) | ❌ No isolation (steps see partial state) |
| ✅ Fault-tolerant (failure → rollback) | ❌ Complexity (coordinator + compensation design) |
| ✅ Audit trail (completed steps log) | ❌ Irreversible actions (email sent!) |

## Khi nào chọn

- Multi-step workflows với side effects (deploy, DB changes)
- Need rollback on partial failure
- Long-running transactions (can't use distributed locks)
- Want audit trail of steps + compensations
- OK designing compensation for each step
