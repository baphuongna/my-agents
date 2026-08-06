# Hướng LM: Model Retirement — khai tử model, plan migrate prompts/outputs

> **Nguồn gốc:** Software "end-of-life" (EOL) / deprecation; "API sunsetting"; semver deprecation cycle; "migration runbooks"; "strangler fig" migration; "deprecation policy" (Google)
> **Coupling:** 🟡 — chạm provider config + prompts + eval
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (178 routing + prompts + eval sẵn — thiếu deprecation timeline + migration runbook + compatibility shim)
> **Effort:** 2-3 tuần

## Nguồn gốc

EOL/deprecation (Google policy): announce → deprecation period (6-12 tháng) → sunset. API sunsetting: warn user → migration guide → shutdown. Semver: deprecated feature → warning → remove next major. **Migration runbook**: step-by-step — identify usages, update prompts, test outputs, switch, verify. Strangler fig (Ford): thay dần old bằng new (không big-bang). Deprecation cần: (1) announce + timeline, (2) migration guide (prompt changes, output diff), (3) compatibility shim (old API → new during transition), (4) hard sunset. Cốt lõi: **model sẽ bị xóa** — plan trước, migrate prompts, test output khác biệt, deadline rõ.

## Mô tả

mya model retirement: provider thông báo gpt-4o EOL → (1) **inventory** — tìm mọi prompt/tool dùng gpt-4o; (2) **diff output** — test new model, so sánh output (format, accuracy) → cập nhật prompt nếu khác; (3) **migrate** — update config + prompts (strangler fig: route dần sang new); (4) **sunset** — remove gpt-4o config, hard cutover. Nối 324 model-upgrade (upgrade trước khi retire old), 178 routing (route sang new), packages/eval (verify output diff), 326 embedding-switch (retire embed model).

## Kiến trúc

```
  PROVIDER: "gpt-4o EOL in 90 days → use gpt-4o-v2"
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  STEP 1: INVENTORY (find all gpt-4o usages)          │
  │  · prompts/ (system prompts referencing model)       │
  │  · config (provider default model)                  │
  │  · tool params (hardcoded model)                     │
  └──────────────────┬───────────────────────────────────┘
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  STEP 2: OUTPUT DIFF (eval — does new match old?)    │
  │  run same prompts on v1 vs v2:                       │
  │   · format: same? (JSON shape)                       │
  │   · accuracy: ≥ old? (eval suite)                    │
  │   · tone: acceptable diff?                           │
  │  → fix prompts if output breaks                      │
  └──────────────────┬───────────────────────────────────┘
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  STEP 3: MIGRATE (strangler fig — gradual)           │
  │  Day 1:   route 100% v1 (announce deprecation)       │
  │  Day 30:  route 50% v2 (canary — 324)                │
  │  Day 90:  route 100% v2 (SUNSET v1)                  │
  │  compat shim: v1 name → alias to v2 (grace)          │
  └──────────────────┬───────────────────────────────────┘
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  STEP 4: HARD SUNSET                                 │
  │  remove v1 config, prompts, references               │
  │  any v1 call → error "model retired, use v2"         │
  └──────────────────────────────────────────────────────┘
```

```
mya: 178 routing + prompts + eval sẵn — thiếu deprecation timeline + output-diff + compat shim
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 178 dynamic-model-routing — route (sẵn — strangler fig base)
// ✅ packages/eval — output diff testing (sẵn)
// ✅ system_prompts / prompts — model-specific prompts (sẵn)
// ✅ 324 model-upgrade-rollout — upgrade path (documented)

// ❌ THIẾU: deprecation inventory (find all model usages)
// ❌ THIẾU: output-diff comparator (v1 vs v2 format/accuracy)
// ❌ THIẾU: compatibility shim (old model name → new alias)
// ❌ THIẾU: deprecation timeline + announcement
```

## Implementation

```typescript
// packages/agent/src/retirement.ts (NEW)
interface RetirementPlan { oldModel: string; newModel: string; sunsetDate: number; }

export class ModelRetirement {
  private shims = new Map<string, string>(); // oldName → newName

  // Step 1: inventory — grep config/prompts for old model
  async inventory(oldModel: string): Promise<string[]> {
    // scan prompts/, config, tool params for references
    return []; // paths containing oldModel
  }

  // Step 2: output diff — run same prompts, compare
  async outputDiff(prompts: string[], oldModel: string, newModel: string): Promise<{ breaking: string[] }> {
    const breaking: string[] = [];
    for (const p of prompts) {
      const oldOut = await this.provider.generate(p, oldModel);
      const newOut = await this.provider.generate(p, newModel);
      if (!this.shapeMatches(oldOut, newOut)) breaking.push(p); // format broke
    }
    return { breaking };
  }

  // Step 3: compat shim — old name aliases to new (grace during transition)
  addShim(oldModel: string, newModel: string): void {
    this.shims.set(oldModel, newModel); // callers using old name still work
  }
  resolve(model: string): string {
    return this.shims.get(model) ?? model; // transparent redirect
  }

  // Step 4: hard sunset — remove shim, old calls error
  sunset(oldModel: string): void {
    this.shims.delete(oldModel); // now old name → error "retired"
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Migration có kế hoạch (runbook — no surprise) | ❌ Output diff may break prompts (rework) |
| ✅ Compat shim — grace period (strangler fig) | ❌ Timeline pressure (provider EOL deadline) |
| ✅ Inventory — không bỏ sót usage | ❌ Eval cost (diff every prompt) |
| ✅ Hard sunset — clean remove | ❌ Double maintenance during transition |

## Khác các hướng gần

| | 324 Model-Upgrade | 326 Embedding-Switch | LM: Model Retirement |
|---|---|---|---|
| Mục | Add new (canary) | Switch embed | **Remove old (EOL migrate)** |
| Hướng | New in | Re-index | **Old out + migrate** |
| Shim | ❌ | ❌ | **✅ compat alias** |

## Khi nào chọn

- Provider thông báo model EOL — phải migrate
- Cần migration runbook (inventory + diff + migrate + sunset)
- Compat shim cho transition (old name vẫn work)
- Nối 324 upgrade + 326 embedding-switch + 178 routing + packages/eval
