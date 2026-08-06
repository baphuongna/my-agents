# Hướng NL: Model Tier Routing — routing task→model theo tier small/medium/big

> **Nguồn gốc:** pi-dynamic-workflows (tier option); "model cascade" (59); "dynamic model routing" (178); "cost-quality tradeoff" (44); "LLM gateway" (70); "inference budget arbitration" (302); "latency-budget routing" (301)
> **Coupling:** 🟢 — routing layer, không đổi core agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (model config sẵn — chưa có per-call tier routing)
> **Effort:** 2 tuần

## Nguồn gốc

**Model cascade** (59): thử model rẻ trước, fallback model đắt nếu không đủ. pi-dynamic-workflows đơn giản hóa: mỗi `agent()` call nhận `tier` option — `small` (cheap, fast: classify/list), `medium` (balanced: analyze/review), `big` (expensive, capable: synthesize/complex-reasoning). Routing map tier → provider/model cụ thể. Giống **178 dynamic-model-routing** (route theo task type) nhưng ở **tier abstraction** (agent không cần biết model name — chỉ chọn tier). Giống **302 inference-budget-arbitration** (budget → model choice). Nguyên lý: **task đơn giản → small tier (tiết kiệm), task phức tạp → big tier (chất lượng)**. Workflow author chọn tier per-call, runtime resolve.

## Mô tả

mya model tier routing: workflow `agent(prompt, { tier: 'small' })` → runtime map tier → model config (provider, model, thinking-level). Tier config trong settings: `small: { model: 'claude-haiku', thinking: 'none' }`, `medium: { model: 'claude-sonnet', thinking: 'medium' }`, `big: { model: 'claude-opus', thinking: 'high' }`. Agent không cần biết model name — chỉ chọn tier theo độ khó task. Override: `model: 'exact-name'` hoặc `agentType`. Nối 59 model-cascade + 178 dynamic-routing + 44 cost-budget.

## Kiến trúc

```
  WORKFLOW:
  ┌─────────────────────────────────────────────────────┐
  │  agent('List all route files',      { tier: 'small' }) │  ← cheap, fast
  │  agent('Audit each file for auth',  { tier: 'medium' }) │  ← balanced
  │  agent('Synthesize + verify',       { tier: 'big' })    │  ← expensive, capable
  └─────────────────────────────────────────────────────┘
        │
        ▼
  ┌─── TIER ROUTER ───────────────────────────────────┐
  │                                                    │
  │  Tier config (settings):                           │
  │  small:  { model: 'claude-haiku', thinking: 'none' }│
  │  medium: { model: 'claude-sonnet', thinking: 'med' }│
  │  big:    { model: 'claude-opus', thinking: 'high' } │
  │                                                    │
  │  Resolve: tier → model config → provider call       │
  │                                                    │
  │  Override: { model: 'gpt-4o' } → exact model       │
  │            { agentType: 'reviewer' } → type config  │
  └────────────────────────────────────────────────────┘
        │
        ▼
  RESULT: each call used the right model for its complexity
         small: 120 tok  $0.001
         medium: 500 tok  $0.015
         big:   2000 tok  $0.120
         total cost optimized (not all-big)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 59 model-cascade — fallback chain (nền — NL = tier abstraction on top)
// ✅ 178 dynamic-model-routing — route by task (nền — NL = per-call tier)
// ✅ 44 cost-budget — cost tracking (nền)
// ✅ 302 inference-budget-arbitration — budget → model (nền)
// ✅ model config — provider/model mapping (sẵn)

// ❌ THIẘU: tier abstraction (small/medium/big → model config)
// ❌ THIẾU: per-call tier option in agent() calls
// ❌ THIẾU: tier config in settings (provider/model/thinking per tier)
// ❌ THIẾU: exact-model override ({ model: 'exact-name' })
```

## Implementation

```typescript
// packages/workflows/src/tier-routing.ts (NEW)
type Tier = 'small' | 'medium' | 'big';

interface TierConfig {
  model: string;
  provider?: string;
  thinking?: 'none' | 'low' | 'medium' | 'high';
  maxTokens?: number;
}

interface AgentCallOptions {
  tier?: Tier;
  model?: string;       // exact override (bypasses tier)
  agentType?: string;   // type-based config
}

class TierRouter {
  constructor(private tierConfig: Record<Tier, TierConfig>) {
    // Default:
    // small:  { model: 'claude-haiku', thinking: 'none' }
    // medium: { model: 'claude-sonnet', thinking: 'medium' }
    // big:    { model: 'claude-opus', thinking: 'high' }
  }

  // Resolve call options → concrete model config
  resolve(options: AgentCallOptions = {}): TierConfig {
    // 1. Exact model override wins
    if (options.model) {
      return { model: options.model, thinking: 'none' };
    }

    // 2. Agent type override (e.g., 'reviewer' → always medium)
    if (options.agentType) {
      return this.resolveAgentType(options.agentType);
    }

    // 3. Tier mapping (default: medium)
    const tier = options.tier ?? 'medium';
    return this.tierConfig[tier];
  }

  // Cost estimate per tier (for budget planning)
  estimateCost(tier: Tier, estimatedTokens: number): number {
    const costPerK = { small: 0.25, medium: 3.0, big: 15.0 }; // $/1K tokens (illustrative)
    return (estimatedTokens / 1000) * costPerK[tier];
  }

  private resolveAgentType(type: string): TierConfig {
    // type → tier mapping (e.g., 'scanner' → small, 'reviewer' → medium)
    const typeTier: Record<string, Tier> = {
      scanner: 'small',
      reviewer: 'medium',
      synthesizer: 'big',
      verifier: 'medium',
    };
    const tier = typeTier[type] ?? 'medium';
    return this.tierConfig[tier];
  }
}

// Usage in workflow:
// const files = await agent('List route files', { tier: 'small' });
// const findings = await parallel(files.map(f => () => agent(`Audit ${f}`, { tier: 'medium' })));
// const result = await agent('Synthesize', { tier: 'big' });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cost-optimal (task đơn giản → small, không dùng big) | ❌ Tier misclassification (task khó → small = kém chất lượng) |
| ✅ Abstraction (agent không cần biết model name) | ❌ Config maintenance (model deprecation → tier update) |
| ✅ Per-call granularity (mỗi call chọn tier riêng) | ❌ Cross-tier inconsistency (small output ≠ big format) |
| ✅ Override flexibility (exact model when needed) | ❌ Thinking-level tuning per tier (trial & error) |

## Khác các hướng gần

| | 59 Model-Cascade | 178 Dynamic-Routing | 302 Budget-Arbitration | NL: Tier-Routing |
|---|---|---|---|---|
| Mục | Fallback chain | Route by task | Budget → model | **Tier abstraction per-call** |
| Chọn | Auto fallback | Task classifier | Budget remaining | **Workflow author chooses tier** |
| Override | ❌ | ❌ | ❌ | **exact model / agentType** |

## Khi nào chọn

- Workflow nhiều calls với độ khó khác nhau (scan ≠ synthesize)
- Muốn cost-optimal (không dùng big cho mọi call)
- Agent không cần biết model name (tier abstraction)
- Nối 375 differential-resume (re-run dùng đúng tier) + 379 keyword-triggering (workflow mode) + 59 cascade
