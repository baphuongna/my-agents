# Hướng LH: Cost Per Step — chi phí từng bước, gán LLM/agent FinOps tối ưu

> **Nguồn gốc:** "FinOps" (Cloud FinancialOps); "LLM cost attribution"; token pricing; per-request cost tracking; "unit economics" of AI; 302 inference-budget; chargeback/showback
> **Coupling:** 🟢 — metering layer, không đổi logic
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (provider + agent-loop + 302 budget sẵn — thiếu per-step cost meter + attribution + showback)
> **Effort:** 2-3 tuần

## Nguồn gốc

FinOps (Cloud): **chargeback/showback** — gán cost cho team/feature → ai dùng bao nhiêu. LLM cost: token-based pricing (input/output khác giá) → mỗi call có cost. Per-request tracking: log cost mỗi request → aggregate. Unit economics: cost-per-task, cost-per-user, cost-per-success — biếtprofit. 302 inference-budget: cap tổng token → budget. Cốt lõi: **không chỉ cap tổng (302)** — phải **gán cost từng step** → biết step nào đắt → tối ưu (route sang model rẻ 178, cache 166, reduce prompt).

## Mô tả

mya cost per step: mỗi agent step (LLM call, tool call) → meter cost (token × price) + gán cho **task/user/agent/model**. Aggregation: cost-per-task, cost-per-step-type (LLM vs tool), cost-by-model. Showback: báo cáo "task X tốn $0.12 (LLM 80%, tool 20%)". Tối ưu: step đắt → route sang rẻ model (178), cache lặp (166), cut prompt. Nối 302 inference-budget (cap), LF (318) trace, LG (319) latency, 178 routing.

## Kiến trúc

```
  TASK (user: alice, task: "fix-bug")
   │
   ├─ Step 1: LLM generate (gpt-4o)
   │    input: 2000 tok × $0.0025/1k = $0.005
   │    output: 500 tok × $0.01/1k  = $0.005
   │    ── cost: $0.010 → tag { task, user, model: gpt-4o }
   │
   ├─ Step 2: tool.read (free)
   │    ── cost: $0
   │
   ├─ Step 3: LLM generate (gpt-4o)
   │    ── cost: $0.008 → tag { task, user, model: gpt-4o }
   │
   └─ Step 4: LLM generate (gpt-4o-mini, routed 178)
        ── cost: $0.001 → tag { model: gpt-4o-mini }

  AGGREGATION / SHOWBACK:
  ┌──────────────────────────────────────────────────┐
  │ task "fix-bug":   total $0.019                    │
  │   by model:  gpt-4o $0.018 (95%), mini $0.001    │
  │   by user:   alice $0.019                         │
  │   by stage: LLM 100%, tool 0%                     │
  │ TOP COST: Step 1+3 (gpt-4o) → route to mini (178)│
  └──────────────────────────────────────────────────┘
```

```
mya: provider + agent-loop + 302 budget sẵn — thiếu per-step meter + price table + showback
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 2-providers — LLM call (token usage returned) (sẵn)
// ✅ 302 inference-budget-arbitration — total cap (documented)
// ✅ 178 dynamic-model-routing — route affects cost (documented)
// ✅ 166 prompt-caching — cache reduces cost (documented)

// ❌ THIẾU: per-step cost meter (token × price)
// ❌ THIẾU: price table (per-model input/output rate)
// ❌ THIẾU: attribution tags (task/user/agent/model)
// ❌ THIẾU: showback aggregation (cost-per-task report)
```

## Implementation

```typescript
// packages/agent/src/cost.ts (NEW)
interface PriceRate { inputPer1k: number; outputPer1k: number; }

const PRICES: Record<string, PriceRate> = {
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01 },
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
};

interface CostEntry { taskId: string; userId: string; model: string; cost: number; step: string; }

export class CostMeter {
  private entries: CostEntry[] = [];

  meter(step: string, model: string, usage: { input: number; output: number }, tags: { taskId: string; userId: string }): number {
    const rate = PRICES[model];
    if (!rate) return 0;
    const cost = (usage.input * rate.inputPer1k + usage.output * rate.outputPer1k) / 1000;
    this.entries.push({ step, model, cost, taskId: tags.taskId, userId: tags.userId });
    return cost;
  }

  // Aggregation — group by any dimension
  byTask(): Record<string, number> { return this.groupBy((e) => e.taskId); }
  byModel(): Record<string, number> { return this.groupBy((e) => e.model); }
  byUser(): Record<string, number> { return this.groupBy((e) => e.userId); }

  private groupBy(fn: (e: CostEntry) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries) out[fn(e)] = (out[fn(e)] ?? 0) + e.cost;
    return out;
  }

  // Tối ưu hint: most expensive model → suggest route to cheaper (178)
  topCostModel(): { model: string; cost: number } | null {
    const byModel = this.byModel();
    const top = Object.entries(byModel).sort((a, b) => b[1] - a[1])[0];
    return top ? { model: top[0], cost: top[1] } : null;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết cost từng step (FinOps showback) | ❌ Price table maintenance (model pricing changes) |
| ✅ Attribution (task/user/model) → chargeback | ❌ Metering overhead (negligible) |
| ✅ Tối ưu đúng chỗ (step đắt → route/cache) | ❌ Cached steps hard to attribute (166) |
| ✅ Unit economics (cost-per-task) | ❌ Multi-currency / discount tiers complex |

## Khác các hướng gần

| | 302 Inference-Budget | LF (318) Token Trace | LH: Cost Per Step |
|---|---|---|---|
| Mục | Cap tổng | Debug token | **Gán cost từng step** |
| Aggregation | ❌ (just cap) | ❌ | **✅ task/user/model** |
| Tối ưu | Block overspend | Debug | **Route/cache (178/166)** |

## Khi nào chọn

- FinOps — cần biết chi phí per task/user (showback/chargeback)
- Tối ưu cost — tìm step đắt → route sang rẻ model (178)
- Unit economics — cost-per-success metric
- Nối 302 budget + LF (318) trace + LG (319) latency + 178 routing
