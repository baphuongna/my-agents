# Hướng AHY: Model-Scope-Enforcement — kiểm tra opt-in rằng model subagent nằm trong `enabledModels` allowlist từ `/scoped-models`; caller truyền model ngoài scope → hard error, frontmatter-pinned ngoài scope → warning + vẫn chạy (frontmatter authoritative); settings project ghi đè global theo deep-merge

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟡 — model governance | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có provider/model config; chưa có enabledModels scope + frontmatter authoritative) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagent3** kiểm tra opt-in rằng model subagent nằm trong **`enabledModels` allowlist** từ `/scoped-models`; caller truyền model ngoài scope → **hard error**; **frontmatter-pinned ngoài scope → warning + vẫn chạy** (frontmatter authoritative); settings **project ghi đè global theo deep-merge**. Nguyên tắc: **scope enforcement** — model phải trong allowlist; **caller vs frontmatter** — caller (runtime choice) strict, frontmatter (task-declared) authoritative (override scope với warning); **layered config** — project deep-merge global.

## Mô tả

Với mya, pattern = **model scope enforcement**: (1) mya đã có **provider/model config** (packages/ai) + model-routing; (2) AHY thêm **`enabledModels` allowlist** — config scope; (3) **caller path** (spawnSubagent with model arg) → ngoài scope = hard error; (4) **frontmatter path** (task frontmatter `model:`) → ngoài scope = warning + vẫn chạy (task author ý định, authoritative); (5) **layered config** — global `enabledModels` deep-merge project override; (6) audit log model thực dùng.

## Kiến trúc (ASCII)

```
  CONFIG: enabledModels (global) ──deep-merge──► enabledModels (project override)
    │
    ▼
  SUBAGENT spawn với model?
    │
    ├─ CALLER truyền model (runtime choice):
    │    └─ model ∈ enabledModels? ──► NO → HARD ERROR (reject spawn)
    │                                └─ YES → ok
    │
    └─ FRONTMATTER pin model (task author):
         └─ model ∈ enabledModels? ──► NO → WARNING + vẫn chạy (authoritative)
                                     └─ YES → ok (silent)
  (caller strict; frontmatter authoritative — task author override scope)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai — providers + model-routing (model config có sẵn)
// ✅ packages/core types.ts — ProviderProfile { id, model } (nền model identity)
// ✅ packages/print cli-flags.ts — model flag (caller path nền)
// ✅ packages/prompts — frontmatter parsing (nền frontmatter pin)

// ❌ THIẾU: enabledModels allowlist + scope check
// ❌ THIẾU: caller hard-error vs frontmatter warning distinction
// ❌ THIẾU: project deep-merge global config
```

## Implementation

```typescript
// packages/ai/src/enabled-models.ts (NEW)
export interface ModelScope {
  enabledModels: string[]; // allowlist
}

/** Deep-merge global + project scope (project override). */
export function mergeScope(global: ModelScope, project: Partial<ModelScope>): ModelScope {
  return { enabledModels: project.enabledModels ?? global.enabledModels };
}

export type ScopeResult = { ok: true } | { ok: false; error: string; hard: boolean };

/** Caller: strict (hard error). Frontmatter: authoritative (warning + chạy). */
export function checkModelScope(
  model: string, scope: ModelScope, source: "caller" | "frontmatter",
): ScopeResult {
  const inScope = scope.enabledModels.includes(model);
  if (inScope) return { ok: true };
  if (source === "caller") {
    return { ok: false, hard: true, error: `model "${model}" ngoài enabledModels scope — caller reject` };
  }
  // frontmatter authoritative — warning + vẫn chạy
  console.warn(`[scope] frontmatter pin model "${model}" ngoài scope — authoritative, vẫn chạy`);
  return { ok: true }; // warning only, không block
}
// spawnSubagent: const r = checkModelScope(model, scope, "caller"); if (!r.ok) throw;
// frontmatter parse: checkModelScope(fmModel, scope, "frontmatter") → warn + chạy.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Model governance — allowlist kiểm soát | ❌ Frontmatter override = lỗ hổng (authoritative) |
| ✅ Caller strict, frontmatter authoritative (linh hoạt) | ❌ Deep-merge phức tạp khi nested |
| ✅ Project override global (layered config) | ❌ Audit log cần để trace model thực dùng |
| ✅ Nối provider config sẵn | ❌ Allowlist phải maintain khi thêm model |

## Khác các hướng gần

| | AHY Model-Scope-Enforcement | AHX Graceful-Turn-Limit | AIB Bounded-Context-Inheritance |
|---|---|---|---|
| Trọng tâm | Governor model subagent | Wrap-up trước abort | Nén context truyền subagent |
| Cơ chế | enabledModels + caller/frontmatter | Soft warning + status | Extract + compaction |
| Quan hệ | Trước spawn (gating) | Khi kết thúc | Đầu vào subagent |

## Khi nào chọn

- Cần kiểm soát model subagent dùng (cost/capability governance)
- Muốn caller strict nhưng task-author linh hoạt (frontmatter)
- Config layered (project override global)
- Guard: caller hard-error, frontmatter warning+run, deep-merge, audit log, allowlist maintain
