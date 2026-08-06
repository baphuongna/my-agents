# Hướng LW: Feedback Flywheel — user feedback → improvement loop liên tục

> **Nguồn gốc:** "Data flywheel" / "virtuous cycle"; feedback loop; RLHF data collection; "learning from corrections" (112); active learning; Data-driven flywheel (Netflix, Uber); "continuous improvement loop"
> **Coupling:** 🟡 — cần feedback collector + triage pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval/correction log sẵn — chưa có feedback flywheel tự động)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Data flywheel** (Netflix, Uber): product dùng → thu data → cải thiện → product tốt hơn → nhiều user hơn → nhiều data hơn → vòng lặp tăng tốc (virtuous cycle). **RLHF**: thu human feedback (thumbs up/down, correction) → train reward model → model tốt hơn. **Active learning**: chọn mẫu khó → xin label → train → giảm error. Nguyên tắc: **mọi user interaction là data cải thiện** — feedback không vứt, mà quay lại pipeline. Nối 112 learning-from-corrections (apply correction) — LW là **flywheel tổng thể** (collect → triage → apply → measure).

## Mô tả

mya feedback flywheel: thu feedback user (correction, thumbs-down, edit, "agent sai chỗ này") → triage (classify: prompt issue? tool bug? model error?) → apply (fix prompt/tool/eval) → measure (eval lại) → deploy → thu thêm feedback → lặp. Mỗi vòng cải thiện chất lượng. mya có 112 learning-from-corrections — LW thêm **flywheel automation**: collect → triage → apply → measure → deploy thành vòng liên tục. Nối 335 (self) — LW cũng là 335.

## Kiến trúc

```
  ┌──────── FEEDBACK FLYWHEEL (virtuous cycle) ──────┐
  │                                                  │
  │  COLLECT: user correction / thumbs-down / edit   │
  │      │                                           │
  │      ▼                                           │
  │  TRIAGE: root cause                              │
  │   · prompt issue? → update prompt template       │
  │   · tool bug? → fix tool                         │
  │   · model error? → add eval case (golden trace)  │
  │   · missing context? → enhance RAG/memory        │
  │      │                                           │
  │      ▼                                           │
  │  APPLY: fix (prompt/tool/eval)                   │
  │      │                                           │
  │      ▼                                           │
  │  MEASURE: eval (299) — improvement?               │
  │   · pass-rate tăng? → deploy                     │
  │   · không? → re-triage                           │
  │      │                                           │
  │      ▼                                           │
  │  DEPLOY → user dùng phiên bản tốt hơn            │
  │      │                                           │
  │      └──────► thu thêm feedback ───────────► (lặp)│
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 112 learning-from-corrections — apply correction (nền flywheel)
// ✅ 299 regression-gates-CI — eval measure (flywheel measure step)
// ✅ 297 golden-trace-replay — trace replay (triage input)
// ✅ 118 error-analysis — root cause (triage)
// ✅ 230 HV event-sourcing — event log (collect)

// ❌ THIẾU: feedback collector (thu structured feedback từ user)
// ❌ THIẾU: auto-triage pipeline (classify root cause)
// ❌ THIẾU: flywheel orchestration (collect → triage → apply → measure)
// ❌ THIẾU: improvement metric tracking (flywheel tăng tốc?)
```

## Implementation

```typescript
// packages/feedback/src/flywheel.ts (NEW)
interface Feedback {
  id: string;
  type: 'correction' | 'thumbs-down' | 'edit' | 'report';
  traceId: string;
  userComment?: string;
  expectedOutput?: string;
  timestamp: number;
}

type RootCause = 'prompt' | 'tool-bug' | 'model-error' | 'missing-context';

class FeedbackFlywheel {
  private feedbackQueue: Feedback[] = [];

  collect(fb: Feedback): void { this.feedbackQueue.push(fb); }

  // Triage — classify root cause
  async triage(fb: Feedback): Promise<{ cause: RootCause; fix: string }[]> {
    const trace = await replayTrace(fb.traceId); // 297 — replay để xem sai chỗ nào
    const causes: { cause: RootCause; fix: string }[] = [];
    if (fb.type === 'correction' && fb.expectedOutput) {
      causes.push({ cause: 'model-error', fix: `add eval case: ${fb.traceId} → ${fb.expectedOutput}` });
    }
    if (trace.toolError) causes.push({ cause: 'tool-bug', fix: `fix tool: ${trace.toolName}` });
    if (trace.missingContext) causes.push({ cause: 'missing-context', fix: 'enhance RAG retrieval' });
    return causes;
  }

  // Flywheel step — batch process queue
  async tick(): Promise<{ applied: number; improved: boolean }> {
    const batch = this.feedbackQueue.splice(0, 50);
    let applied = 0;
    for (const fb of batch) {
      const causes = await this.triage(fb);
      for (const c of causes) {
        await this.applyFix(c); // update prompt/tool/eval
        applied++;
      }
    }
    const evalResult = await runRegressionGates(); // 299 — measure
    return { applied, improved: evalResult.passRate > this.lastPassRate };
  }

  private async applyFix(c: { cause: RootCause; fix: string }): Promise<void> { /* apply fix */ }
  private lastPassRate = 0;
}

// Cron: flywheel.tick() mỗi ngày → continuous improvement
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cải thiện liên tục (flywheel proven — Netflix/Uber) | ❌ Triage tự động khó (root cause fuzzy) |
| ✅ Mọi feedback quay lại pipeline (không vứt) | ❌ Noise — không phải feedback nào cũng hữu ích |
| ✅ Tăng tốc theo thời gian (virtuous cycle) | ❌ Phải measure liên tục (eval cost) |
| ✅ Nối 112 corrections + 299 eval → loop | ❌ False improvement (metric gaming) |

## Khác các hướng gần

| | 112 Learning from Corrections | 118 Error Analysis | LW: Feedback Flywheel |
|---|---|---|---|
| Scope | Apply 1 correction | Analyze error batch | **Full loop: collect→apply→measure** |
| Tự động | ❌ (manual) | ❌ (manual) | ✅ automation |
| Continuous | ❌ | ❌ | ✅ cron tick |
| Measure | ❌ | ❌ | ✅ eval (299) |

## Khi nào chọn

- Muốn cải thiện liên tục (mỗi user feedback giúp)
- Có volume feedback đủ (flywheel cần data để tăng tốc)
- OK invest triage automation (root cause classify)
- Kết hợp 112 corrections (apply) + 118 error-analysis (triage) + 299 eval (measure); guard against metric gaming
