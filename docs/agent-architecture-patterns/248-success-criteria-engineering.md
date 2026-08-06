# Hướng IN: Success Criteria Engineering — rubric/tiêu chí chấm

> **Nguồn gốc:** SWE-bench "task resolution criteria"; τ-bench/AgentBench rubric design; "success criteria for agentic tasks" literature; OKR/SMART goal engineering; WebArena evaluation
> **Coupling:** 🟡 — rubric định nghĩa trong eval config, ảnh hưởng judge + gate
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval tiers + structured-output 175 sẵn — thiếu rubric engine + auto-verify)
> **Effort:** 1-2 tuần

## Nguồn gốc

Success criteria engineering gốc từ benchmark design: **SWE-bench** — task "resolved" khi tất cả test pass (deterministic, verifiable). **τ-bench/AgentBench/WebArena** — rubric cho agentic task: tiêu chí rõ ràng (database state đúng? task hoàn thành? số bước tối thiểu?). Nguyên tắc cốt lõi: success criteria phải **đo được (measurable)**, **tự động kiểm chứng được (auto-verifiable)**, không mơ hồ. SMART goals (Specific, Measurable, Achievable, Relevant, Time-bound). Khác "vibes-based eval" — rubric engineering biến "agent làm tốt không?" thành **checklist runnable**. Cho mya: mỗi task có rubric → judge (246 IL) chấm theo rubric → gate (done? chưa?).

Khác **246 judge-calibration** (IL — hiệu chỉnh *thẻ chấm*) — IN thiết kế *tiêu chí chấm* (input cho judge). Khác **175 structured-output-validation** (validate schema) — IN rộng hơn: validate *kết quả task* theo rubric. Nối **190 property-based-testing** (invariant = criteria), **119 bounded-self-correction** (so sánh vs criteria → sửa), **247 differential-testing** (IM — baseline vs candidate trên cùng rubric).

## Mô tả

mya success criteria engineering: (1) **rubric definition** — mỗi task/type có rubric: checklist tiêu chí (test pass? file tạo đúng? deadline? cost < X?); (2) **auto-verify** — criteria phải runnable (test suite, file check, schema validate 175); (3) **judge integration** — cho criteria subjective → LLM-judge (246 IL) chấm theo rubric; (4) **gate** — all criteria pass → done (kanban "done" state); fail → bounded self-correction (119). mya đã có eval tiers + structured-output validation — IN thêm rubric engine + auto-verify + gate integration.

## Kiến trúc

```
  TASK: "add login feature + tests"
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  RUBRIC ENGINE (success criteria per task)     │
  │                                               │
  │  Criteria (auto-verifiable):                  │
  │   ☐ auth/login.ts exists           [file ✓]    │
  │   ☐ unit tests pass               [test ✓]    │
  │   ☐ no PII in logs (214)           [scan ✓]    │
  │   ☐ cost < $0.50                  [cost ✓]    │
  │   ☐ < 10 turns                    [count ✓]   │
  │  Criteria (judge 246 IL):                      │
  │   ☐ code quality ≥ 7/10           [judge ✓]    │
  │   ☐ follows existing patterns     [judge ✓]    │
  └──────────────────┬───────────────────────────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
       all pass           any fail
            │                 │
            ▼                 ▼
     ┌────────────┐    ┌────────────────┐
     │ DONE       │    │ SELF-CORRECT   │
     │ (kanban    │    │ (119) retry    │
     │  "done")   │    │  failed criteria│
     └────────────┘    └────────────────┘
```

```
mya: eval tiers + structured-output 175 sẵn — thiếu rubric engine + auto-verify + task gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval/src/tiers.ts — eval tiers (5 levels — criteria candidate)
// ✅ 175 structured-output-validation — schema validate (criteria tool)
// ✅ packages/eval/src/harness.ts — eval harness (run criteria check)
// ✅ 119 bounded-self-correction — retry until criteria met (gate consumer)
// ✅ 190 property-based-testing — invariant = criteria
// ✅ 246 judge-calibration (IL) — judge chấm subjective criteria

// ❌ THIẾU: rubric definition format (declarative success criteria per task)
// ❌ THIẾU: auto-verify runner (test/file/cost/scan — runnable criteria)
// ❌ THIẾU: task-done gate (all criteria pass → kanban "done")
// ❌ THIẾU: criteria library per task-type (login/deploy/refactor rubric)
```

## Implementation

```typescript
// packages/eval/src/success-criteria.ts (NEW)
interface Criterion {
  id: string;
  description: string;
  type: "auto" | "judge";              // auto-verifiable or LLM-judge (246 IL)
  verify?: () => Promise<boolean>;      // for "auto" — runnable check
  rubric?: string;                      // for "judge" — scoring rubric
  weight?: number;                      // importance weighting
}

interface Rubric {
  taskId: string;
  criteria: Criterion[];
  mustPassAll: boolean;   // true → all criteria required for "done"
}

class SuccessCriteriaEngine {
  constructor(private rubrics: Map<string, Rubric>, private judge: CalibratedJudge) {}

  async evaluate(taskId: string, artifact: TaskArtifact): Promise<{ done: boolean; results: Map<string, boolean> }> {
    const rubric = this.rubrics.get(taskId);
    if (!rubric) return { done: true, results: new Map() }; // no rubric → assume done

    const results = new Map<string, boolean>();
    for (const c of rubric.criteria) {
      const ok = c.type === "auto" ? await c.verify!() : await this.judgeScore(c, artifact) >= 7;
      results.set(c.id, ok);
    }
    const done = rubric.mustPassAll ? [...results.values()].every(Boolean) : true;
    return { done, results };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ "Done" đo được, không vibes-based (SWE-bench) | ❌ Rubric authoring (human per task-type) |
| ✅ Auto-verify — criteria runnable (test/file/cost) | ❌ Subjective criteria cần judge (246 IL — cost) |
| ✅ Gate — all pass → done (kanban state machine) | ❌ Criteria too strict → agent stuck (never done) |
| ✅ Nối self-correction 119 (retry failed criteria) | ❌ Criteria coverage (miss edge → false "done") |

## Khác các hướng gần

| | 175 Structured-Output | 190 Property-Based | IN: Success Criteria |
|---|---|---|---|
| Mục | Validate schema | Test invariant | **Xác định task hoàn thành** |
| Scope | Output shape | Function property | **Task outcome** |
| When | Each output | Property check | **Task gate** |

## Khi nào chọn

- Task cần định nghĩa "thành công" rõ ràng (không mơ hồ)
- Auto-verify possible (test pass, file exists, cost < X)
- Agent cần biết khi nào "done" → kanban state (nối 119 self-correct)
- Eval system — rubric cho judge (nối 246 IL + 247 IM)
