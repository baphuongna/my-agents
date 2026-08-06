# Hướng ZR: Adaptive Complexity Scaling — độ sâu research/PRD/architecture scale theo complexity (small/medium/large/enterprise) — cùng workflow nhưng độ sâu tùy quy mô project
> **Nguồn gốc:** BMAD-METHOD (README.md) | **Coupling:** 🟢 — complexity tier điều khiển độ sâu phase | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (ai/model-routing tier + eval tiers — chưa có complexity-scaled depth) | **Effort:** 1-2 tuần

## Nguồn gốc

**BMAD-METHOD** dùng **cùng 1 workflow** cho mọi project nhưng **độ sâu từng phase scale theo complexity**: (1) **small** — research nhẹ, PRD ngắn, architecture tối giản; (2) **medium** — research vừa, PRD đủ, architecture có module; (3) **large** — research sâu, PRD chi tiết, architecture đầy đủ; (4) **enterprise** — research cực sâu, PRD đầy đủ acceptance criteria, architecture multi-service + risk analysis. Complexity xác định **trước** (đánh giá task/project) → workflow chạy cùng cấu trúc nhưng **budget token, số vòng research, độ chi tiết artifact** khác nhau. Nguyên tắc: **một workflow, nhiều độ sâu — scale theo complexity, không scale theo may rủi**.

## Mô tả

mya adaptive complexity scaling: (1) **Complexity tier** — small/medium/large/enterprise (đánh giá từ input: scope, risk, size). (2) **Depth config per tier** — researchRounds, prdDetail, archDepth, budget, validation mức. (3) **Phase runner dùng config** — cùng 4-phase (ZQ) nhưng depth khác nhau. (4) **Re-scale** — giữa chừng phát hiện complexity cao hơn → nâng tier. mya có ai/model-routing.ts (ModelTier small/medium/big) + eval tiers.ts + budget — ZR thêm **complexity classifier** + **per-tier depth config** + **scale hook**.

## Kiến trúc

```
  TASK ──▶ COMPLEXITY TIER (classifier)
  ┌──────────────────────────────────────────────┐
  │  small      medium      large      enterprise │
  │  ├ research:1 ├ research:2 ├ research:3 ├ research:5 │
  │  ├ prd: ngắn  ├ prd: đủ    ├ prd: chi tiết├ prd: +criteria│
  │  ├ arch: tối  ├ arch: module├ arch: đầy đủ ├ arch: multi-svc│
  │  └ budget: nhỏ└ budget: vừa└ budget: lớn └ budget: max   │
  └────────────────────┬─────────────────────────┘
                       ▼ (cùng workflow 4-phase)
  ┌── ANALYSIS ──▶ ┌── PLANNING ──▶ ┌── SOLUTIONING ──▶ ┌── IMPLEMENTATION ──┐
  │  depth theo tier (research rounds, artifact detail)   │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai model-routing.ts — ModelTier "small"|"medium"|"big" + resolveModelForPhase (nền — ZR tier)
// ✅ packages/eval tiers.ts — unit/integration/credentialed (nền — ZR depth analog)
// ✅ packages/core budget.ts — createBudget (nền — ZR budget per tier)
// ✅ packages/core iteration-budget.ts — createIterationBudget (nền — ZR loop depth)
// ✅ packages/workflows runner.ts — workflow runner (nền — ZR chạy depth config)

// ❌ THIẾU: complexity classifier (task → small/medium/large/enterprise)
// ❌ THIẾU: per-tier depth config (researchRounds/prdDetail/archDepth)
// ❌ THIẾU: scale hook (giữa chừng nâng/giảm tier)
```

## Implementation

```typescript
// packages/ai/src/complexity-scaling.ts (MỚI)

type ComplexityTier = "small" | "medium" | "large" | "enterprise";

interface DepthConfig {
  tier: ComplexityTier;
  researchRounds: number;      // số vòng research
  prdDetail: "brief" | "full" | "detailed" | "criteria";
  archDepth: "minimal" | "module" | "system" | "multi-service";
  budget: { max: number; used: number };
  validation: "light" | "standard" | "deep" | "strict";
}

const DEPTHS: Record<ComplexityTier, DepthConfig> = {
  small:      { tier: "small",      researchRounds: 1, prdDetail: "brief",     archDepth: "minimal",      budget: { max: 20_000,  used: 0 }, validation: "light" },
  medium:     { tier: "medium",     researchRounds: 2, prdDetail: "full",      archDepth: "module",       budget: { max: 60_000,  used: 0 }, validation: "standard" },
  large:      { tier: "large",      researchRounds: 3, prdDetail: "detailed",  archDepth: "system",       budget: { max: 150_000, used: 0 }, validation: "deep" },
  enterprise: { tier: "enterprise", researchRounds: 5, prdDetail: "criteria",  archDepth: "multi-service", budget: { max: 400_000, used: 0 }, validation: "strict" },
};

class AdaptiveComplexity {
  // Classifier: task meta → tier (heuristic đơn giản; có thể nối LLM)
  classify(scope: { files?: number; services?: number; risk?: string; deadline?: string }): ComplexityTier {
    if (scope.services && scope.services >= 3) return "enterprise";
    if (scope.files && scope.files >= 50) return "large";
    if (scope.files && scope.files >= 10) return "medium";
    return "small";
  }

  // Depth config cho phase runner — cùng workflow, depth khác nhau
  depthFor(tier: ComplexityTier): DepthConfig {
    return { ...DEPTHS[tier], budget: { ...DEPTHS[tier].budget } };
  }

  // Scale hook: giữa chừng phát hiện phức tạp hơn → nâng tier (không tự hạ)
  rescale(current: ComplexityTier, signal: "scope-grew" | "found-risk" | "ok"): ComplexityTier {
    const order: ComplexityTier[] = ["small", "medium", "large", "enterprise"];
    const idx = order.indexOf(current);
    if (signal !== "ok" && idx < order.length - 1) return order[idx + 1];
    return current;
  }
}
// Usage:
// const ac = new AdaptiveComplexity();
// const tier = ac.classify({ files: 60, services: 1 });   // → "large"
// const depth = ac.depthFor(tier);                        // researchRounds:3, budget:150k
// // phase runner dùng depth.researchRounds, depth.prdDetail, depth.budget
// const tier2 = ac.rescale(tier, "found-risk");           // → "enterprise"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task nhỏ không tốn công sâu (đúng độ) | ❌ Classifier sai → độ sâu sai (thiếu/hoang phí) |
| ✅ Task lớn có đủ chiều sâu (research/PRD/arch) | ❌ Tier config phải tinh chỉnh (sai số → vẫn tốn) |
| ✅ Cùng workflow (không nhiều flow rời rạc) | ❌ Re-scale giữa chừng làm lại artifact (tốn) |
| ✅ Budget scale theo tier (kiểm soát chi phí) | ❌ Enterprise tier đắt (nhiều research rounds) |

## Khác các hướng gần

| | Một depth cho mọi task | Nhiều workflow riêng | ZR: Adaptive Scaling |
|---|---|---|---|
| Depth | Cố định | Riêng biệt | **Scale theo tier** |
| Workflow | 1 | N | **1 (cấu hình depth)** |
| Budget | Cố định | Riêng | **✅ theo tier** |

## Khi nào chọn

- Project/task đa dạng quy mô (nhỏ → enterprise) mà muốn 1 workflow
- Muốn chi phí (token/budget) scale đúng theo độ phức tạp
- Muốn research/PRD/arch đủ sâu cho task lớn, không phí cho task nhỏ
- Nối packages/ai model-routing.ts + eval tiers.ts + core budget.ts + iteration-budget.ts + workflows runner.ts + core four-phase (ZQ); guard classifier-accuracy (đánh giá đúng complexity), depth-calibration (config đủ cho tier), và budget-alignment (budget khớp depth); ZR = adaptive complexity scaling, kết hợp 693 ZQ four-phase-lifecycle (cùng workflow 4 phase) + 684 ZH quality-convergence (validation depth theo tier)
