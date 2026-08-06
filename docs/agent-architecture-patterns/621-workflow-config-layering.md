# Hướng WW: Workflow Config Layering — loader merge 5 lớp workflow (built-in, user pack/config, project pack/config); skillAliases remap tên skill toàn cục

> **Nguồn gốc:** rpiv-mono (config loader); "merge 5 layers", "built-in + user pack/config + project pack/config", "skillAliases remap skill name globally" | **Coupling:** 🟢 — thêm layered config merge (pure data, không runtime) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skill store + config sẵn — chưa có 5-layer merge + skillAliases) | **Effort:** 1-2 tuần

## Nguồn gốc

**rpiv-mono** nạp cấu hình workflow qua **5 lớp ưu tiên tăng dần** (lớp sau override lớp trước): (1) **Built-in** (workflow mặc định shipped cùng tool). (2) **User pack** (workflow pack cài ở user scope). (3) **User config** (config người dùng chỉnh tay). (4) **Project pack** (workflow pack ở project scope). (5) **Project config** (config chỉnh ở project). Layer merge **deep-merge** (object gộp key, array/ scalar override theo lớp sau). Ngoài ra **skillAliases** remap **tên skill toàn cục** — bảng alias (`{ "fmt": "prettier-format" }`) áp cho mọi reference trước resolve, cho phép đổi tên skill mà không sửa từng workflow. Nguyên tắc: **precedence tường minh** — project override user override built-in, alias normalize trước resolve.

## Mô tả

mya workflow config layering: loader đọc 5 lớp theo thứ tự precedence → deep-merge thành một config resolved. **skillAliases** áp global remap trước khi skill resolve. Workflow lookup đi qua resolved config (không đọc nhiều nguồn). mya có skill store + config — WW thêm **layered loader** + **deep-merge** + **skillAliases map**.

## Kiến trúc

```
  PRECEDENCE (thấp → cao, sau override trước):
  ┌─ 1. built-in        (shipped workflow mặc định)
  ├─ 2. user pack       (pack cài user scope)
  ├─ 3. user config     (~/.config, chỉnh tay)
  ├─ 4. project pack    (pack project scope)
  └─ 5. project config  (.rpiv/config, chỉnh project)
                       │
                       ▼  deep-merge (object gộp, scalar override)
  ┌─ RESOLVED CONFIG ──────────────────────────────────┐
  │  { workflows: {...}, skillAliases: {fmt→format} }    │
  └───────────────────────┬───────────────────────────┘
                          ▼  skillAliases remap global
  ┌─ RESOLVE SKILL ────────────────────────────────────┐
  │  "fmt" → alias → "prettier-format" → skill store hit │  ← remap trước resolve
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills SkillStore — skill resolve (nền — WW resolve sau alias)
// ✅ packages/core types.ts — config type (nền — WW merge config)
// ✅ packages/workflows runner.ts — workflow (nền — WW lookup resolved config)

// ❌ THIẾU: 5-layer loader (built-in → user → project precedence)
// ❌ THIẾU: deep-merge (object gộp, scalar/array override)
// ❌ THIẾU: skillAliases global remap (trước resolve)
```

## Implementation

```typescript
// packages/workflows/src/config-layering.ts (MỚI)
interface WorkflowConfig { workflows: Record<string, unknown>; skillAliases?: Record<string, string> }

// deep-merge: object gộp key, scalar/array override (sau thắng)
function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(override ?? {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object"
      ? deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>)
      : v; // scalar / array → override
  }
  return out as T;
}

// 5-layer loader (precedence tăng dần)
async function loadConfig(layers: WorkflowConfig[]): Promise<WorkflowConfig> {
  return layers.reduce((acc, layer) => deepMerge(acc, layer), {} as WorkflowConfig);
}

// skillAliases remap global trước resolve
function remapAlias(name: string, aliases?: Record<string, string>): string {
  return aliases?.[name] ?? name; // remap nếu có alias, else giữ nguyên
}

// Usage:
// const resolved = await loadConfig([builtIn, userPack, userConfig, projectPack, projectConfig]);
// const skill = store.get(remapAlias("fmt", resolved.skillAliases)); // → prettier-format
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Precedence tường minh (project override user override built-in) | ❌ Merge surprise (không biết giá trị đến từ lớp nào) |
| ✅ Deep-merge an toàn (object gộp, không mất key) | ❌ Array-merge ambiguity (override hay append?) |
| ✅ skillAliases remap (đổi tên skill không sửa workflow) | ❌ Alias chain (alias trỏ alias → recursion risk) |
| ✅ Layer tái sử dụng (pack share, config riêng) | ❌ Layer discovery cost (scan nhiều nguồn mỗi load) |

## Khác các hướng gần

| | Flat config | Env-override | WW: Layered-Merge |
|---|---|---|---|
| Precedence | 1 nguồn | env > file | **5 lớp tường minh** |
| Merge | ❌ | shallow | **✅ deep-merge** |
| Alias | ❌ | ❌ | **✅ skillAliases global** |

## Khi nào chọn

- Workflow cần override theo scope (built-in → user → project precedence)
- Muốn đổi tên skill toàn cục mà không sửa từng workflow (skillAliases)
- Nối packages/skills SkillStore + packages/core types.ts + packages/workflows runner.ts; guard merge-provenance (log lớp nào override cho debug), alias-cycle-detect (alias trỏ alias → lỗi, không recursion), và array-merge-policy (document override-vs-append rõ ràng); WW = workflow config layering, kết hợp 622 WX predicate-gate-routing (route trong resolved workflow) + 628 XD subfolder-guidance-injection (layer guidance theo scope)
