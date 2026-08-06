# Hướng VN: Per-Step Model Switching — chained template: mỗi bước frontmatter chỉ định model/skill/thinking, xong tự trả về model user cấu hình

> **Nguồn gốc:** pi-boomerang (per-step model switching); "chained template each step frontmatter"; "per-step model/skill/thinking config"; "auto-revert to user-configured model after step"; "frontmatter-driven model routing in chain" | **Coupling:** 🟡 — thêm per-step frontmatter router vào chained-template runner | **Agent-agnostic:** ⚠️ (cần multi-model catalog) | **Code sẵn:** ⚠️ (catalog + skills sẵn — chưa có per-step model switch + auto-revert) | **Effort:** 3-4 tuần

## Nguồn gốc

**pi-boomerang** dùng **chained template** (workflow nhiều bước nối tiếp). Mỗi **bước** có **frontmatter** khai báo **model** (dùng model nào cho bước này), **skill** (kỹ năng gì), **thinking** (reasoning effort). Khi chạy, mỗi bước **switch sang model riêng** (vd bước code dùng coding-model, bước review dùng reasoning-model), và **sau khi xong tự trả về model user cấu hình** (default) — tránh kẹt ở model đắt/context lớn. Nguyên tắc: **mỗi bước đúng model, rồi revert** — không dùng 1 model cho mọi bước; model tạm thời cho bước, không permanent. Khác **single-model** — VN **per-step routing**; khác global model-switch — VN **transient (auto-revert)**.

## Mô tả

mya per-step model switching: (1) **Chained template**: workflow nhiều bước, mỗi bước frontmatter `{ model, skill, thinking }`. (2) **Route**: bước k switch sang model khai báo (+ skill + thinking level). (3) **Execute**: chạy bước với model đó. (4) **Auto-revert**: xong bước → trở về model user cấu hình (default), không kế thừa sang bước kế nếu bước kế không khai báo. (5) **Default fallback**: bước không có frontmatter → dùng model default. mya có catalog (multi-model) + skills — VN thêm **frontmatter parser** + **per-step router** + **auto-revert**.

## Kiến trúc

```
  CHAINED TEMPLATE:
    ---
    step: 1 (analyze)
    model: reasoning-large       ← frontmatter chỉ định
    thinking: high
    ---
    ---
    step: 2 (code)
    model: coding-fast           ← model khác bước 1
    skill: refactor
    ---
    ---
    step: 3 (test)               ← KHÔNG khai báo → default
    ---
        │
        ▼
  ┌─── PER-STEP ROUTER ───────────────────────────────────┐
  │  step 1: switch → reasoning-large (thinking high)      │
  │           execute analyze → AUTO-REVERT về default      │
  │  step 2: switch → coding-fast (skill refactor)          │
  │           execute code → AUTO-REVERT về default          │
  │  step 3: no frontmatter → DEFAULT (user-configured)     │
  │           execute test                                    │
  └───────────────────────────────────────────────────────┘
  → mỗi bước đúng model, không kẹt model đắt sau khi xong
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/catalog — multi-model (nền — VN route model)
// ✅ packages/skills — skill (nền — VN frontmatter skill)
// ✅ pi-extensible-workflows / dynamic-workflows — chained template (nền — VN = per-step switch)

// ❌ THIẾU: frontmatter parser (model/skill/thinking per step)
// ❌ THIẾU: per-step router (switch model transient)
// ❌ THIẾU: auto-revert (về default sau bước)
```

## Implementation

```typescript
// packages/agent/src/per-step-model.ts (MỚI)
type ThinkingLevel = 'low' | 'medium' | 'high';
interface StepFrontmatter { step: number; model?: string; skill?: string; thinking?: ThinkingLevel }

class PerStepModelSwitching {
  private currentModel: string;
  constructor(
    private defaultModel: string,           // user-configured
    private setModel: (m: string, t?: ThinkingLevel) => void,
    private setSkill: (s?: string) => void,
  ) {
    this.currentModel = defaultModel;
  }

  // chạy 1 bước: switch transient → execute → revert
  async runStep(step: StepFrontmatter, execute: () => Promise<void>): Promise<void> {
    const prevModel = this.currentModel;
    // switch sang model khai báo (hoặc default nếu thiếu)
    const model = step.model ?? this.defaultModel;
    this.setModel(model, step.thinking);
    this.setSkill(step.skill);
    this.currentModel = model;
    try {
      await execute();
    } finally {
      // AUTO-REVERT về default (không kế thừa model tạm)
      this.setModel(this.defaultModel);
      this.setSkill(undefined);
      this.currentModel = prevModel;
    }
  }
}

// Usage:
// for (const step of template.steps) {
//   await switcher.runStep(step.frontmatter, () => agentLoop.run(step.prompt));
// }
//   step 1 → reasoning-large (high) → revert
//   step 2 → coding-fast (refactor) → revert
//   step 3 → default → revert
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Mỗi bước đúng model (code vs reason) | ❌ N× model load (switch mỗi bước) |
| ✅ Auto-revert (không kẹt model đắt) | ❌ Frontmatter upkeep (template phức tạp) |
| ✅ Cost-aware (model đắt chỉ bước cần) | ❌ Context loss (revert có thể mất state) |
| ✅ Skill per-step (đúng kỹ năng) | ❌ Mismatch (model không hợp skill) |

## Khác các hướng gần

| | Single-model | Global model-switch | VN: Per-Step-Switching |
|---|---|---|---|
| Model | 1 cho mọi bước | User đổi toàn cục | **frontmatter per-step** |
| Revert | ❌ | Manual | **✅ auto-revert** |
| Cost | ❌ (đắt cho mọi bước) | ⚠️ | **✅ model tạm cho bước cần** |

## Khi nào chọn

- Workflow nhiều bước, mỗi bước cần model khác (code vs reason vs summarize)
- Muốn cost-aware (model đắt chỉ bước quan trọng)
- Tránh kẹt model lớn sau bước (auto-revert)
- Nối packages/catalog (multi-model) + packages/skills + pi-extensible-workflows (chained template); guard model availability (frontmatter model phải có trong catalog), revert state-safety (revert không mất context quan trọng), và frontmatter validation (schema check trước chạy); VN = per-step model switching, kết hợp pi-extensible-workflows (template chain) + 587 one-shot-auto-wrapping (transient switch, dùng xong tắt)
