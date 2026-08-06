# Hướng QC: Resumable Approval Pipeline — pipeline typed dừng tại cổng phê duyệt, resume nguyên state

> **Nguồn gốc:** OpenClaw (resumable approval pipeline); "typed pipeline with human-in-the-loop gates"; "pause-resume state machine"; "checkpoint-and-resume workflow"; "approval-gate pattern"
> **Coupling:** 🟡 — cần typed pipeline engine + checkpoint serialization
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool execution + permission-prompt sẵn — chưa có typed pipeline + checkpoint/resume)
> **Effort:** 3-4 tuần

## Nguồn gốc

**OpenClaw** mô hình hóa task agent là **typed pipeline**: mỗi stage có typed input/output, chạy tuần tự. Tại **approval gate** (stage cần human confirm), pipeline **pause** → serialize toàn bộ state → chờ. Khi approval đến → **resume** với state nguyên vẹn, tiếp tục stage kế tiếp. Giống **checkpoint-and-resume** (workflow engine: Temporal, Airflow) và **human-in-the-loop gate** (HITL pattern). Nguyên tắc: **pipeline = state machine có thể pause/resume tại bất kỳ gate nào**. Typed (type-safe input/output mỗi stage) → không mất state khi resume. Khác **95 tool-call-recovery** (retry failed) — QC là **pause for human**; khác **124 dynamic-permissions** (per-tool auth) — QC là **pipeline-level gate**.

## Mô tả

mya resumable approval pipeline: task → **typed pipeline** (stage1 → gate1 → stage2 → gate2 → ...). Mỗi stage: typed input → process → typed output. **Gate**: checkpoint dừng, serialize pipeline state (stage outputs, pending gate, context), notify human. Human approve/reject → **resume**: deserialize state, tiếp tục từ gate (nếu approve) hoặc rollback (nếu reject). State persisted → survive crash/restart. Nối 95 tool-call-recovery + 124 dynamic-permissions + 398 test-gated-convergence.

## Kiến trúc

```
  TASK: "refactor auth module + deploy"
        │
        ▼
  ┌─── TYPED PIPELINE ──────────────────────────────────────┐
  │                                                          │
  │  Stage 1: Analyze  (in: repo → out: Analysis)            │
  │     ↓                                                    │
  │  Stage 2: Plan     (in: Analysis → out: Plan)            │
  │     ↓                                                    │
  │  ═══ GATE 1: APPROVE PLAN? ═══ ← PAUSE + serialize      │
  │     │                      │                             │
  │     │ approve              │ reject                      │
  │     ↓                      ↓                             │
  │  Stage 3: Execute  (in: Plan → out: Changes)    rollback │
  │     ↓                                                    │
  │  Stage 4: Test     (in: Changes → out: TestResult)       │
  │     ↓                                                    │
  │  ═══ GATE 2: APPROVE DEPLOY? ═══ ← PAUSE + serialize    │
  │     │                      │                             │
  │     │ approve              │ reject                      │
  │     ↓                      ↓                             │
  │  Stage 5: Deploy   (in: TestResult → out: DeployResult)  │
  │                                                          │
  │  CHECKPOINT at each gate: { stageOutputs, pendingGate }  │
  │  → persisted to disk → survive crash/restart             │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool execution — tool dispatch (nền — QC = pipeline of tools)
// ✅ 124 dynamic-permissions — per-tool auth (nền — QC = pipeline-level gate)
// ✅ 95 tool-call-recovery — retry failed (relate — QC = pause for human)
// ✅ 398 test-gated-convergence — test gate (relate — QC = generic gate)
// ✅ session store — state persistence (nền — QC = checkpoint source)

// ❌ THIẾU: typed pipeline engine (stage input/output type-safe)
// ❌ THIẾU: checkpoint serialization (pipeline state → disk)
// ❌ THIẾU: resume protocol (deserialize → continue from gate)
// ❌ THIẾU: approval gate lifecycle (pause → notify → approve/reject → resume/rollback)
```

## Implementation

```typescript
// packages/agent/src/approval-pipeline.ts (NEW)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

type Stage<I, O> = (input: I, ctx: PipelineCtx) => Promise<O>;
type Gate<I> = { id: string; prompt: (input: I) => string; approve: (input: I) => boolean };

interface PipelineCtx { checkpointPath: string; sessionId: string; }

interface Checkpoint {
  pipelineId: string;
  stageOutputs: Record<string, unknown>;
  pendingGate: string | null;
  createdAt: number;
}

class ApprovalPipeline {
  private stages = new Map<string, { fn: Stage<unknown, unknown>; inputType: string }>();
  private gates = new Map<string, Gate<unknown>>();

  register<I, O>(name: string, fn: Stage<I, O>): void {
    this.stages.set(name, { fn: fn as Stage<unknown, unknown>, inputType: name });
  }
  registerGate<I>(gate: Gate<I>): void {
    this.gates.set(gate.id, gate as Gate<unknown>);
  }

  async run(stageNames: string[], gateIds: string[], initialInput: unknown, ctx: PipelineCtx): Promise<unknown> {
    let input = this.tryResume(ctx) ?? initialInput;
    for (const name of stageNames) {
      const stage = this.stages.get(name)!;
      const output = await stage.fn(input, ctx);
      input = output;
      // Check if a gate follows this stage
      const gateId = gateIds.find((g) => g.startsWith(name));
      if (gateId) {
        const gate = this.gates.get(gateId)!;
        const cp: Checkpoint = {
          pipelineId: ctx.sessionId, stageOutputs: { [name]: output },
          pendingGate: gateId, createdAt: Date.now(),
        };
        this.checkpoint(ctx, cp);
        // PAUSE — wait for human approval
        const approved = await this.waitForApproval(gateId, ctx);
        if (!approved) throw new Error(`Gate ${gateId} rejected → rollback`);
        input = output; // resume with same output
      }
    }
    return input;
  }

  private checkpoint(ctx: PipelineCtx, cp: Checkpoint): void {
    writeFileSync(ctx.checkpointPath, JSON.stringify(cp));
  }
  private tryResume(ctx: PipelineCtx): unknown | null {
    if (!existsSync(ctx.checkpointPath)) return null;
    const cp = JSON.parse(readFileSync(ctx.checkpointPath, 'utf-8')) as Checkpoint;
    return cp.stageOutputs[Object.keys(cp.stageOutputs).pop()!] ?? null;
  }
  private async waitForApproval(_gateId: string, _ctx: PipelineCtx): Promise<boolean> { return true; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Pause/resume tại gate (human-in-the-loop không mất state) | ❌ Pipeline engine complexity (typed stages, checkpoint) |
| ✅ Crash-safe (checkpoint persisted → survive restart) | ❌ Latency (pause chờ human approval) |
| ✅ Typed (type-safe input/output mỗi stage) | ❌ State migration (schema thay đổi → checkpoint cũ hỏng) |
| ✅ Auditable (mỗi gate có record approve/reject) | ❌ Rollback complexity (reject → undo stage effects) |

## Khác các hướng gần

| | 95 Tool-Call-Recovery | 124 Dynamic-Permissions | 398 Test-Gated | QC: Approval-Pipeline |
|---|---|---|---|---|
| Trọng tâm | Retry failed | Per-tool auth | Test gate | **Pipeline gate + resume** |
| Khi | Tool fail | Every tool call | Convergence check | **Stage boundary** |
| Pause | ❌ (retry) | ❌ (prompt) | ❌ (gate) | **✅ (serialize + resume)** |

## Khi nào chọn

- Task cần human approval giữa chừng (approve plan → execute → approve deploy)
- Cần crash-safe (pipeline survive restart)
- Typed pipeline (type-safe stage input/output)
- Muốn auditable gate (record approve/reject)
- Nối 95 tool-call-recovery + 124 dynamic-permissions + 398 test-gated-convergence
