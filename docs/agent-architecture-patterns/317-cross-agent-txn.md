# Hướng LE: Cross-Agent Transaction — giao dịch phân tán qua agent, rollback/compensation

> **Nguồn gốc:** Distributed transactions (Gray 1981); "Saga pattern" (Garcia-Molina 1987); two-phase commit (2PC); "Compensating transactions"; outbox pattern; "Workflow as Saga" (Richardson)
> **Coupling:** 🟡 — chạm multi-agent execution + state store
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagents + tool-call sẵn — thiếu saga orchestration + compensation + 2PC)
> **Effort:** 4-6 tuần

## Nguồn gốc

Distributed transactions (Gray 1981): nhiều node tham gia 1 txn — all-commit hoặc all-abort (atomicity). 2PC: coordinator → prepare (vote) → commit/abort. **Saga** (Garcia-Molina 1987): chuỗi local txn — nếu 1 fail, chạy **compensating txn** undo các bước đã làm (không lock dài như 2PC). Compensating transaction: không "rollback" vật lý (không un-send email) mà **compensate** (send apology email). Outbox: write DB + event atomic → reliable publish. Richardson "Microservices": saga orchestration vs choreography. Cốt lõi: **multi-agent multi-step = saga** — fail 1 bước → compensate các bước đã done → consistent cuối.

## Mô tả

mya cross-agent txn: khi task cần nhiều agent (315 plan-merge), mỗi agent làm 1 bước có side-effect (edit file, send msg, commit) → cần **atomic-ish**. Saga: mỗi bước có **action + compensate**. Nếu bước N fail → chạy compensate bước N-1, N-2... (ngược) → hoàn tác. Ví dụ: A edit file → B run test → C commit. Nếu C fail → compensate B (revert test artifacts) → compensate A (revert file edit). Coordinator track state. Nối 315 plan-merge (steps), 327 interruptible (abort = trigger compensate).

## Kiến trúc

```
  SAGA COORDINATOR
     │
     ▼
  ┌──────────────────────────────────────────────────────┐
  │  Step 1: Agent A — edit file                         │
  │    action: writeFile(path, new)                      │
  │    compensate: writeFile(path, old)  ← saved backup  │
  │    STATUS: ✓ done                                    │
  ├──────────────────────────────────────────────────────┤
  │  Step 2: Agent B — run test                          │
  │    action: exec("vitest")                            │
  │    compensate: rm(testArtifacts)                     │
  │    STATUS: ✓ done                                    │
  ├──────────────────────────────────────────────────────┤
  │  Step 3: Agent C — git commit                        │
  │    action: exec("git commit")                        │
  │    compensate: exec("git reset --hard HEAD~1")       │
  │    STATUS: ✗ FAILED (conflict)                       │
  └──────────────────┬───────────────────────────────────┘
                     │ failure → COMPENSATE (reverse)
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌──────────────┐         ┌──────────────┐
  │ compensate   │         │ compensate   │
  │ Step 2       │         │ Step 1       │
  │ rm(artifacts)│         │ revert file  │
  └──────────────┘         └──────────────┘
        │                         │
        └────────────┬────────────┘
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  STATE: rolled back (consistent — no half-done)      │
  └──────────────────────────────────────────────────────┘
```

```
mya: subagents + tool-call sẵn — thiếu saga coordinator + compensate registry + state machine
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent (8-subagents) — multi-agent exec (sẵn)
// ✅ 315 plan-merge — multi-step plan (documented)
// ✅ tool-call — side-effect tools (sẵn)
// ✅ 327 interruptible-agents — abort concept (documented)

// ❌ THIẾU: saga coordinator (track steps + state)
// ❌ THIẾU: compensate registry (action + compensate per step)
// ❌ THIẾU: rollback on failure (reverse compensate)
// ❌ THIẾU: idempotent compensate (safe to re-run)
```

## Implementation

```typescript
// packages/agent/src/saga.ts (NEW)
interface SagaStep {
  agent: string;
  action: () => Promise<void>;
  compensate: () => Promise<void>;
  done: boolean;
}

export class SagaCoordinator {
  private steps: SagaStep[] = [];

  add(step: Omit<SagaStep, "done">): void {
    this.steps.push({ ...step, done: false });
  }

  async execute(): Promise<{ ok: boolean; failedAt: number | null }> {
    // Forward: run each step
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      try {
        await step.action();
        step.done = true;
      } catch (err) {
        // Failure → compensate all done steps in REVERSE
        await this.compensate(i - 1);
        return { ok: false, failedAt: i };
      }
    }
    return { ok: true, failedAt: null };
  }

  private async compensate(fromIndex: number): Promise<void> {
    for (let i = fromIndex; i >= 0; i--) {
      const step = this.steps[i];
      if (!step.done) continue;
      try {
        await step.compensate(); // idempotent — safe re-run
      } catch (compensateErr) {
        // compensate failed → log for manual intervention (poison msg)
        console.error(`compensate failed at step ${i}:`, compensateErr);
      }
      step.done = false;
    }
  }
}

// Usage
const saga = new SagaCoordinator();
saga.add({ agent: "A", action: async () => { backup = await readFile(path); await writeFile(path, newContent); }, compensate: async () => { await writeFile(path, backup); } });
saga.add({ agent: "B", action: async () => { await exec("vitest"); }, compensate: async () => { await rm(testDir); } });
saga.add({ agent: "C", action: async () => { await exec("git commit"); }, compensate: async () => { await exec("git reset --hard HEAD~1"); } });
const result = await saga.execute();
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Consistency cuối (Garcia-Molina saga) | ❌ Compensate complexity (every step needs undo) |
| ✅ Không lock dài (vs 2PC) — scalable | ❌ Compensate ≠ true rollback (semantics) |
| ✅ Partial failure handled (auto undo) | ❌ Compensate fail = poison (manual fix) |
| ✅ Audit-able (step state tracked) | ❌ Not truly atomic (window of inconsistency) |

## Khác các hướng gần

| | 315 Plan-Merge | 327 Interruptible | LE: Cross-Agent Txn |
|---|---|---|---|
| Mục | Gộp plan | Dừng giữa chừng | **Atomic-ish multi-step** |
| Fail | ❌ | Abort | **Compensate (saga rollback)** |
| State | DAG | Checkpoint | **Step registry + state machine** |

## Khi nào chọn

- Multi-step multi-agent có side-effect (edit, commit, send) — cần undo
- Partial failure phải tự động rollback (saga)
- Không thể dùng 2PC (agents độc lập, no long lock)
- Nối 315 plan-merge + 327 interruptible + 316 resource-negotiation
