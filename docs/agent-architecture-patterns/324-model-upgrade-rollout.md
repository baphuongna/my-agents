# Hướng LL: Model Upgrade Rollout — nâng cấp model an toàn, canary, regression eval

> **Nguồn gốc:** "Canary deployment"; "shadow deployment"; "A/B testing"; regression testing; "model evaluation harness"; "progressive delivery"; blue-green deploy; champion/challenger
> **Coupling:** 🟡 — chạm provider routing + eval harness
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (178 routing + eval + provider sẵn — thiếu canary/shadow + regression gate + champion-challenger)
> **Effort:** 3-4 tuần

## Nguồn gốc

Canary deployment: release mới cho **small % traffic** trước → monitor → tăng dần nếu OK (progressive delivery). Shadow deployment: route traffic đến model mới **không trả kết quả** (so sánh vs prod暗中) — zero user risk. A/B test: chia traffic → so metric. Champion/challenger: prod = champion, new = challenger → so sánh → nếu challenger tốt hơn → promote. Regression testing: eval suite (300 test cases) chạy trên model mới → phải pass threshold mới promote. Blue-green: 2 env, switch instant + rollback nhanh. Cốt lõi: **đừng big-bang** — canary + eval gate + auto-rollback.

## Mô tả

mya model upgrade: gpt-4o → gpt-4o-v2. (1) **regression gate** — chạy eval suite (packages/eval) trên v2 → phải pass threshold (accuracy ≥ 95%, format valid 100%); (2) **shadow** — route copy của traffic đến v2 (silent, so sánh vs prod); (3) **canary** — 5% traffic thật đến v2 → monitor error/latency/satisfaction; (4) **promote** — tăng dần 5→25→100% nếu OK, **rollback** nếu regress. Nối 178 dynamic-routing (route %), packages/eval (regression), 325 model-retirement (đối ứng), LF (318) trace (monitor canary).

## Kiến trúc

```
  UPGRADE: gpt-4o (champion) → gpt-4o-v2 (challenger)
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  STEP 1: REGRESSION GATE (eval suite — offline)      │
  │  run 300 test cases on v2:                           │
  │   · accuracy: 96% ✓ (≥95%)                           │
  │   · format valid: 100% ✓                             │
  │   · regression: 2 cases worse (acceptable)            │
  │  → PASS → proceed; FAIL → block (don't ship)         │
  └──────────────────┬───────────────────────────────────┘
                     │ pass
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  STEP 2: SHADOW (silent — zero user risk)            │
  │  prod traffic → v1 (answer user)                     │
  │              → v2 (silent, compare vs v1)            │
  │  metric: agreement rate v1↔v2                        │
  └──────────────────┬───────────────────────────────────┘
                     │ agreement > 90%
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  STEP 3: CANARY (progressive delivery)               │
  │  5% → v2   monitor: error, latency, satisfaction     │
  │  ↓ OK                                                 │
  │  25% → v2                                             │
  │  ↓ OK                                                 │
  │  100% → v2  (PROMOTED — new champion)                │
  │                                                       │
  │  ✗ REGRESS at any step → ROLLBACK to 100% v1         │
  └──────────────────────────────────────────────────────┘
```

```
mya: 178 routing + eval + provider sẵn — thiếu canary % control + shadow comparator + auto-rollback
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 178 dynamic-model-routing — route by rule (sẵn — extend to %)
// ✅ packages/eval — eval harness (sẵn — regression gate)
// ✅ 2-providers — multiple models (sẵn)
// ✅ LF (318) token-trace — monitor canary (documented)

// ❌ THIẾU: canary % control (route 5/25/100% by weight)
// ❌ THIẾU: shadow comparator (silent v2 vs v1 agreement)
// ❌ THIẾU: regression gate (auto eval before promote)
// ❌ THIẾU: auto-rollback (metric drop → revert to v1)
```

## Implementation

```typescript
// packages/agent/src/upgrade.ts (NEW)
interface UpgradePlan { challenger: string; champion: string; evalThreshold: number; canarySteps: number[]; }

export class ModelUpgrader {
  private rolloutPct = 0; // % traffic to challenger
  constructor(private evalSuite: EvalSuite, private router: ModelRouter) {}

  // Step 1: regression gate (offline — must pass before any live traffic)
  async regressionGate(plan: UpgradePlan): Promise<boolean> {
    const results = await this.evalSuite.run(plan.challenger);
    const passed = results.accuracy >= plan.evalThreshold;
    if (!passed) console.warn(`regression gate FAILED: ${results.accuracy}% < ${plan.evalThreshold}%`);
    return passed;
  }

  // Step 3: canary — set % and monitor
  async canary(pct: number): Promise<void> {
    this.rolloutPct = pct;
    this.router.setWeight(this.champion, 100 - pct);
    this.router.setWeight(this.challenger, pct);
  }

  // Monitor — if metric drops below threshold → rollback
  checkHealth(metrics: { errorRate: number; latencyP99: number; satisfaction: number }, baseline: typeof metrics): boolean {
    const healthy = metrics.errorRate <= baseline.errorRate * 1.5
      && metrics.latencyP99 <= baseline.latencyP99 * 2
      && metrics.satisfaction >= baseline.satisfaction * 0.9;
    if (!healthy) {
      this.rollback(); // instant revert to 100% champion
      return false;
    }
    return true;
  }

  rollback(): void {
    this.rolloutPct = 0;
    this.router.setWeight(this.champion, 100);
    this.router.setWeight(this.challenger, 0);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Safe upgrade — no big-bang (canary) | ❌ Complexity (weight router + monitor) |
| ✅ Regression gate — block bad model (eval) | ❌ Shadow doubles cost (v1+v2) |
| ✅ Auto-rollback (instant revert) | ❌ Canary slow (progressive takes time) |
| ✅ Champion/challenger data-driven | ❌ Eval suite maintenance (must stay current) |

## Khác các hướng gần

| | 178 Dynamic-Routing | 325 Model-Retirement | LL: Model Upgrade |
|---|---|---|---|
| Mục | Route per-query | Plan ra model cũ | **Upgrade an toàn (canary)** |
| Rủi ro | Low | Migration | **Medium → gate + canary** |
| Rollback | N/A | N/A | **✅ auto-rollback** |

## Khi nào chọn

- Upgrade model (v1→v2) — cần safe progressive delivery
- Có eval suite (packages/eval) — regression gate
- Risk-averse (prod agent — không được regress)
- Nối 178 routing + packages/eval + 325 retirement + LF (318) trace
