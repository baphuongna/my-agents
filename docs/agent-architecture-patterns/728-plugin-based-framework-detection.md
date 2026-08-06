# Hướng AAZ: Plugin-Based Framework Detection — 123 framework plugins phát hiện stack, rule packs declarative JSON tách policy khỏi detection

> **Nguồn gốc:** fallow (CLAUDE.md, CONTEXT.md) | **Coupling:** 🟢 — plugin registry + rule packs, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có auto-discover + skill index — chưa có framework plugin registry) | **Effort:** 2 tuần

## Nguồn gốc

**fallow** dùng **123 framework plugins** phát hiện **stack của dự án** — **framework presets** (biết Next.js, Django…) + **rule packs**. Rule packs là **declarative JSON thuần data** (vd `banned-call`/`banned-import` — cấm gọi/import nào) **không chạy project code** — an toàn, không RCE. Điểm kiến trúc: **tách policy khỏi detection logic** — detection (plugin) tìm ra framework; policy (rule pack) quyết định cấm gì; thêm framework mới = thêm plugin + rule pack, không sửa core. Nguyên tắc: **data-driven policy + plugin-based detection** — core nhỏ, khả năng mở rộng nằm ở plugin/declarative data.

## Mô tả

mya plugin-based framework detection: packages/tools auto-discover.ts (A3 AST-discovered tool registry) + packages/skills skill.ts (index) sẵn nền. AAZ thêm: (1) **framework plugin registry** — mỗi plugin `{ id, detect(files) → Framework | null }` (check lockfile, config files, dir layout); (2) **rule packs** — JSON thuần data `{ framework, rules: [{ kind: "banned-import"|"banned-call", pattern, severity }] }`, load từ disk, **không chạy code**; (3) **tách policy/detection** — plugin trả framework, rule pack quyết định rule; core không biết framework cụ thể. Nối AAY (analyzer) — rule packs feed analyzer rules.

## Kiến trúc

```
  PROJECT FILES (lockfile, config, layout)
        │
        ▼
  ┌─── FRAMEWORK PLUGINS (123) ──────────────────────┐
  │  detect(files) → Framework | null                │
  │   ├─ package.json deps → Next.js/Express…        │
  │   ├─ Cargo.toml      → Axum/Rocket…              │
  │   └─ dir layout      → Django/Rails…             │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── RULE PACKS (declarative JSON — KHÔNG chạy code)┐
  │  { framework: "next", rules: [                    │
  │      { kind: "banned-import", pattern: "…", sev } │
  │  ] }                                              │
  │  → feed analyzer (AAY) — policy tách detection    │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools auto-discover.ts — boot-time scan (nền plugin registry)
// ✅ packages/tools registry.ts — tool registry (nền plugin pattern)
// ✅ packages/tools symbol-extractor.ts — native parse (nền detect)
// ✅ packages/tools analyzer.ts (AAY) — rule pipeline (nơi feed rule packs)
// ✅ packages/skills skill.ts — index model (nền plugin index)
// ✅ packages/core canonical-json.ts — canonical (nền rule pack ổn định)

// ❌ THIẾU: framework plugin registry (detect → Framework)
// ❌ THIẾU: rule pack loader (declarative JSON — không exec)
```

## Implementation

```typescript
// packages/tools/src/framework-detect.ts (NEW)
export interface Framework { id: string; name: string; rulePackPath?: string }

/** Plugin: detect framework từ files — pure, không chạy project code. */
export type FrameworkPlugin = { id: string; detect(files: string[], read: (p: string) => string | null): Framework | null };

/** Plugin registry — thêm framework = thêm plugin, không sửa core. */
export class FrameworkRegistry {
  private readonly plugins: FrameworkPlugin[] = [];
  register(p: FrameworkPlugin): void { this.plugins.push(p); }
  /** Detect stack: plugin đầu tiên trả khớp thắng (ordered). */
  detect(files: string[], read: (p: string) => string | null): Framework | null {
    for (const p of this.plugins) {
      const fw = p.detect(files, read);
      if (fw) return fw;
    }
    return null;
  }
}

/** Plugin ví dụ: Next.js — detect từ package.json dependencies. */
export const nextPlugin: FrameworkPlugin = {
  id: "next",
  detect: (_files, read) => {
    const pkg = read("package.json");
    return pkg && /"next"\s*:/.test(pkg) ? { id: "next", name: "Next.js", rulePackPath: "rule-packs/next.json" } : null;
  },
};

/** Rule pack — declarative JSON thuần data, KHÔNG chạy project code. */
export interface RulePack {
  framework: string;
  rules: Array<{ kind: "banned-import" | "banned-call"; pattern: string; severity: "error" | "warning" }>;
}

/** Load rule pack + validate shape (không exec bất kỳ code nào). */
export function loadRulePack(path: string): RulePack {
  const raw = JSON.parse(readFileSync(path, "utf8")) as RulePack;
  if (!raw.framework || !Array.isArray(raw.rules)) throw new Error(`rule pack invalid: ${path}`);
  return raw;
}

/** Match rule lên source — match text/import, không chạy code. */
export function matchRule(rule: RulePack["rules"][number], src: string): boolean {
  if (rule.kind === "banned-import") return new RegExp(`from ["']${rule.pattern}["']|require\\(["']${rule.pattern}["']\\)`).test(src);
  return src.includes(rule.pattern);
}

/** Pipeline: detect framework → load rule pack → feed analyzer. */
export function detectAndLoadRules(registry: FrameworkRegistry, files: string[], read: (p: string) => string | null): RulePack | null {
  const fw = registry.detect(files, read);
  if (!fw?.rulePackPath || !existsSync(fw.rulePackPath)) return null;
  return loadRulePack(fw.rulePackPath);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thêm framework = thêm plugin — core không đổi | ❌ Plugin detect heuristic — project lai khó phân |
| ✅ Rule pack thuần data — an toàn (không RCE) | ❌ 123 plugins là số lượng lớn — duy trì/tin cậy |
| ✅ Policy tách detection — đổi rule không đụng code | ❌ Plugin order quan trọng (plugin đầu thắng) |
| ✅ Declarative — non-dev cũng thêm rule được | ❌ Match regex dễ false positive trên tên trùng |

## Khác các hướng gần

| | Auto-discover (tool) | AAZ: Framework Detect |
|---|---|---|
| Đối tượng | Tool exports | **Framework stack** |
| Output | ToolImpl[] | **Framework + rule pack** |
| Policy | Trong code | **Declarative JSON** |
| Mối quan hệ | Nền scan | **Bổ sung: detect + policy layer** |

## Khi nào chọn

- Nhiều dự án/stack — agent cần biết framework để chọn rule đúng
- Muốn policy (cấm gì) do data quyết định, không sửa code
- Đã có auto-discover + analyzer (AAY) — thêm plugin registry + rule packs
- Guard: rule pack validate shape (không exec), plugin order deterministic, match test phủ false positive