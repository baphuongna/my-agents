# Hướng SS: Cost & Step Budget Gating — trần cứng, chống chạy lố

> **Nguồn gốc:** agentpatternscatalog "safety-control" — Step Budget, Cost Gating; agentic loop-bounded property
> **Coupling:** 🟢 — mya nội bộ, agents không cần biết
> **Agent-agnostic:** ✅ — áp cho bất kỳ agent
> **Code sẵn:** ⚠️ (1 phần — RateLimiter, provider taint; thiếu token/cost ledger theo task)
> **Effort:** 1 tuần

## Nguồn gốc

Định nghĩa "agentic" của agentpatternscatalog có 3 thuộc tính, thuộc tính thứ 3 là **loop-bounded**: agent chạy cho đến khi tự kết thúc, **chạm step/cost budget, hoặc bị ngắt**. Hệ thống thiếu budget → 3 lỗi kinh điển: vòng lặp vô hạn (agent lặp fix-fail), cost runaway (1 task ngốn cả ngày), và 429 (spam provider). Step Budget = trần số hành động; Cost Gating = trần token/cost theo task — cắt mềm (downgrade model) trước khi cắt cứng (kill).

## Mô tả

Mỗi task có ledger riêng: tokens (in+out), cost ước lượng (theo profile model), steps (tool calls + turns). Hết ngân sách → **graceful degrade**: đổi model rẻ hơn, giảm context (gọi MM compaction), rồi checkpoint + báo user. Khác Cache (Hướng NN — tiết kiệm khi *không* cần gọi): budget là *kiểm soát* khi đã gọi quá nhiều. Nhận định "nửa cost là overhead tất định" → budget cũng phải tính cost overhead nội bộ.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│                  BUDGET GATE (mya)                          │
│                                                            │
│  task ──► ┌───────────────────────────┐                    │
│           │ TaskBudget {              │                    │
│           │   tokensIn/tokensOut/cost │                    │
│           │   steps, deadline         │                    │
│           │ }                         │                    │
│           └───────────┬───────────────┘                    │
│                       ▼                                    │
│  ┌──────────────────────────────────────────────────┐      │
│  │ 0-60%   bình thường                               │      │
│  │ 60-85%  cảnh báo: log + giảm context (compact)    │      │
│  │ 85-100% degrade: model rẻ hơn, hạn chế tools      │      │
│  │ 100%    checkpoint → suspend → báo user / escalate│      │
│  └──────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/gateway/src/channel-identity.ts — RateLimiter(cap, rate) theo platform
// ✅ packages/ai/src/registry.ts — taint profile (quota/auth) → skip
// ✅ packages/core/src/supervised.ts — maxRestarts cap (step budget cho restart)
// ✅ packages/prompts — compaction sẵn (giảm context khi gần cạn)

// ❌ THIẾU: ledger token/cost theo TASK (không phải theo channel).
//    Event ledger (Hướng K) đã có costProjection — chỉ cần biến thành gate.
```

## Implementation

```typescript
// packages/gateway/src/budget.ts (NEW)
interface BudgetSpec {
  maxTokensIn: number;
  maxTokensOut: number;
  maxCostUsd: number;
  maxSteps: number;
  degrade: { modelTier: "high" | "mid" | "low"; compact: boolean };
}

class TaskBudget {
  private used = { tokensIn: 0, tokensOut: 0, costUsd: 0, steps: 0 };

  constructor(private spec: BudgetSpec) {}

  /** Gọi trước mỗi turn — trả về chế độ cho phép. */
  preTurn(): "normal" | "warn" | "degrade" | "stop" {
    const ratio = Math.max(
      this.used.costUsd / this.spec.maxCostUsd,
      this.used.tokensIn / this.spec.maxTokensIn,
      this.used.steps / this.spec.maxSteps,
    );
    if (ratio >= 1) return "stop";
    if (ratio >= 0.85) return "degrade";   // đổi model rẻ + compact
    if (ratio >= 0.6) return "warn";
    return "normal";
  }

  spend(tokensIn: number, tokensOut: number, costUsd: number): void {
    this.used.tokensIn += tokensIn;
    this.used.tokensOut += tokensOut;
    this.used.costUsd += costUsd;
    this.used.steps++;
  }
}

// Wire: streamWithFallback() gọi preTurn() → "stop" thì checkpoint + escalate (Hướng UU).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn cost runaway (trần cứng) | ❌ Trần sai → task bị cắt giữa chừng |
| ✅ Chặn vòng lặp vô hạn (step budget) | ❌ Cần ước lượng cost theo model profile |
| ✅ Degrade mềm trước khi cắt cứng | ❌ Overhead ledger mỗi turn (nhỏ) |
| ✅ Kết hợp MM compact khi gần cạn | |
| ✅ RateLimiter + taint sẵn | |

## Khi nào chọn

- Chạy agents tự động (cron, daemon) — cần trần bắt buộc
- Muốn ước lượng cost trước khi chạy task
- Muốn degrade thay vì fail cứng
- Đã có compaction + rate limiter + taint
