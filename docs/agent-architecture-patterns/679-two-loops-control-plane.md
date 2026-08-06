# Hướng ZC: Two-Loops Control Plane — tách 2 loop: symbolic orchestrator (process JS deterministic: stage, gates, budgets) và agentic harness (LLM reasoning) — "what must happen" vs "how to do it"
> **Nguồn gốc:** babysitter (docs/user-guide/features/two-loops-architecture.md) | **Coupling:** 🟡 — tách control loop khỏi agent loop trong core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (core/loop.ts runTurn + workflows runner — chưa tách 2 loop rõ ràng) | **Effort:** 2-3 tuần

## Nguồn gốc

**babysitter** tách kiến trúc thành **2 loop riêng biệt**: (1) **symbolic orchestrator** — chạy **process JS deterministic** (stage machine, gates, budgets): biết **"what must happen"** (thứ tự phase, điều kiện gate, ngân sách token) — không cần LLM, chạy lại y hệt; (2) **agentic harness** — chạy **LLM reasoning**: biết **"how to do it"** (đọc code, chọn tool, viết nội dung) — ngẫu nhiên, không deterministic. Tách 2 loop → phần điều khiển (control) **kiểm chứng được, test được, deterministic**; phần suy luận (reasoning) **linh hoạt, mở**. Không trộn: orchestrator không gọi LLM để quyết định gate; harness không quyết định process structure.

## Mô tả

mya two-loops control plane: (1) **Control loop (symbolic)**: stage machine (define → plan → act → verify), mỗi stage có gate + budget — deterministic JS, không LLM. (2) **Agent loop (agentic)**: LLM reasoning bên trong 1 stage — chọn tool, đọc file, viết code. (3) **Contract giữa 2 loop**: control gọi harness với stage context, nhận result + evidence; harness không đổi process. (4) **Gates/budgets** nằm control loop — chặn trước khi vào stage tiếp. mya có core/loop.ts (`runTurn`) + workflows/runner.ts (process JS) — ZC thêm **stage machine** + **gate evaluation** + **loop separation contract**.

## Kiến trúc

```
  ┌─── SYMBOLIC ORCHESTRATOR (deterministic, không LLM) ──┐
  │  STAGE: define → plan → act → verify                  │
  │  mỗi stage: gate? budget? evidence?                    │
  │  "what must happen" — chạy lại y hệt, test được        │
  └──────────────┬────────────────────────────────────────┘
                 │ call (stage context)
                 ▼
  ┌─── AGENTIC HARNESS (LLM reasoning) ──────────────────┐
  │  read files, chọn tool, viết nội dung                 │
  │  "how to do it" — linh hoạt, không deterministic       │
  └──────────────┬────────────────────────────────────────┘
                 │ result + evidence
                 ▼
  ┌─── GATE (control loop) ─────────────────────────────┐
  │  evidence đủ? budget còn? → next stage / block        │
  │  quyết định KHÔNG qua LLM — deterministic             │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core loop.ts — runTurn (agent loop, nền — ZC harness)
// ✅ packages/workflows runner.ts — workflow JS (nền — ZC symbolic orchestrator)
// ✅ packages/core budget.ts — createBudget (nền — ZC budget gate)
// ✅ packages/core iteration-budget.ts — createIterationBudget (nền — ZC stage budget)
// ✅ packages/core supervised.ts — supervisedTask (nền — ZC gate approval)

// ❌ THIẾU: stage machine (define/plan/act/verify)
// ❌ THIẾU: gate evaluation deterministic (không LLM)
// ❌ THIẾU: loop separation contract (harness không đổi process)
```

## Implementation

```typescript
// packages/core/src/two-loops.ts (MỚI)

type Stage = "define" | "plan" | "act" | "verify";

interface StageResult { stage: Stage; evidence: string[]; output: string }

interface Harness { run(stage: Stage, ctx: unknown): Promise<StageResult> }

interface Gate { check(result: StageResult, budget: { used: number; max: number }): { pass: boolean; reason?: string } }

class TwoLoopsOrchestrator {
  private order: Stage[] = ["define", "plan", "act", "verify"];

  constructor(private harness: Harness, private gates: Partial<Record<Stage, Gate>>) {}

  // Control loop: deterministic stage machine + gates — KHÔNG gọi LLM để quyết định
  async run(input: unknown, budget: { used: number; max: number }): Promise<StageResult[]> {
    const results: StageResult[] = [];
    for (const stage of this.order) {
      const result = await this.harness.run(stage, input);      // agentic harness (LLM bên trong)
      const gate = this.gates[stage];
      if (gate) {
        const verdict = gate.check(result, budget);             // deterministic gate
        if (!verdict.pass) {
          throw new Error(`gate blocked ${stage}: ${verdict.reason}`);  // block progression
        }
      }
      budget.used += estimateStageCost(result);                 // budget cập nhật
      results.push(result);
      input = result;                                           // stage output → stage input
    }
    return results;
  }
}

function estimateStageCost(r: StageResult): number {
  return r.output.length + r.evidence.reduce((n, e) => n + e.length, 0);
}
// Usage:
// const orchestrator = new TwoLoopsOrchestrator(agentHarness, {
//   plan: { check: (r, b) => r.evidence.length > 0 ? { pass: true } : { pass: false, reason: "no plan evidence" } },
//   verify: { check: (_r, b) => b.used <= b.max ? { pass: true } : { pass: false, reason: "budget exceeded" } },
// });
// await orchestrator.run(task, { used: 0, max: 200_000 });
// → "what must happen" deterministic; "how to do it" do LLM
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Control loop test được (deterministic) | ❌ 2 loop phải giữ contract (dễ trộn lại) |
| ✅ Gate/budget chặn deterministic (không LLM cảm tính) | ❌ Stage context truyền qua biên cần schema rõ |
| ✅ "What must happen" độc lập model (đổi LLM không vỡ) | ❌ LLM reasoning vẫn tốn token trong stage |
| ✅ Audit được (stage + gate verdict log) | ❌ Stage machine cứng nếu process không fit |

## Khác các hướng gần

| | Single loop (LLM tự quyết) | Prompt-based stages | ZC: Two Loops |
|---|---|---|---|
| Control | LLM (bất định) | Prompt (mềm) | **Symbolic deterministic** |
| Gate | Không | Prompt nhắc | **Code chặn** |
| Testability | Khó | Khó | **✅** |

## Khi nào chọn

- Process nhiều phase, cần gate/budget chặt (không tin LLM tự giữ kỷ luật)
- Muốn test phần điều khiển (stage machine) mà không cần LLM
- Cần audit process (stage + verdict) rõ ràng
- Nối packages/core loop.ts + workflows runner.ts + budget.ts + iteration-budget.ts + supervised.ts; guard contract-stability (stage ctx schema ổn định), gate-determinism (gate không gọi LLM/tool), và budget-accuracy (stage cost ước lượng đủ); ZC = two-loops control plane, kết hợp 680 ZD mandatory-stop-enforcement (gate enforce) + 682 ZF evidence-driven-completion (evidence gate)
