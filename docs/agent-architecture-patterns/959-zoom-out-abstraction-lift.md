# Hướng AJW: Zoom-Out Abstraction Lift — skill `zoom-out` chỉ gọi khi user yêu cầu, agent đi lên một lớp abstraction và vẽ map module/caller dùng glossary của project

> **Nguồn gốc:** skills (skills/engineering/zoom-out/SKILL.md) | **Coupling:** 🟢 — skill content, không đụng core | **Agent-agnostic:** ⚠️ (phụ thuộc model đọc hiểu codebase) | **Code sẵn:** ⚠️ (có codegraph + glossary; thiếu zoom-out skill body) | **Effort:** 1 tuần

## Nguồn gốc

**skills** (skills/engineering/zoom-out/SKILL.md) có skill **`zoom-out`** với **`disable-model-invocation: true`** — **chỉ gọi khi user yêu cầu** (không để model tự gọi khi thấy "có vẻ nên"): (1) **yêu cầu agent đi lên một lớp abstraction** — không đọc từng dòng, mà nhìn module ở mức cao hơn (package → layer → system); (2) **vẽ map module/caller** — ai gọi module này, module này gọi ai — bức tranh dependency thay vì chi tiết triển khai; (3) **dùng glossary của project** — tên module/khái niệm theo đúng nghĩa project định nghĩa (nối AJR ubiquitous language), hiểu codebase lạ không bị hiểu lệch.

Giá trị: (1) **đúng lúc** — zoom-out chỉ chạy khi user muốn nhìn cao (không tự ý bỏ chi tiết khi đang debug sâu); (2) **hiểu codebase lạ nhanh** — map module/caller + glossary = ngữ cảnh đủ để tiếp tục mà không đọc hết code; (3) **context tiết kiệm** — abstraction lift là dạng nén: thay vì nạp file code, nạp map; (4) **tôn trọng user intent** — disable-model-invocation đảm bảo model không lạm dụng.

## Mô tả

Với mya, pattern = **zoom-out skill + module map tooling**: (1) **skill body** — hướng dẫn agent: khi user yêu cầu "nhìn cao hơn / tổng quan", agent không đọc code chi tiết mà: bước 1 lấy module list, bước 2 vẽ caller/callee map, bước 3 chú giải bằng glossary; (2) **module map** — mya có `packages/tools/src/codegraph.ts` (code graph) + `reference-graph.ts` (reference graph) — nguồn dữ liệu cho map; thêm helper lọc theo abstraction level (package-level vs file-level); (3) **glossary join** — tên module → tra CONTEXT-MAP.md (AJR) để chú giải đúng nghĩa project; (4) **invocation gate** — skill frontmatter thêm `disable-model-invocation: true` — mya `SkillFrontmatter` chưa có field này (xem 799 Invocation Axis — cần thêm); (5) nơi gắn — `packages/skills` SkillStore load skill, codegraph cung cấp dữ liệu. Đây là pattern **intent-gated abstraction**: quyền "bỏ chi tiết" thuộc user, không thuộc model.

## Kiến trúc (ASCII)

```
  USER: "zoom out — tôi muốn hiểu module này ở mức tổng quan"
    │   (disable-model-invocation: true — chỉ chạy khi user yêu cầu)
    ▼
  ZOOM-OUT SKILL (không đọc từng dòng code)
  ├─ 1. module list (codegraph — package/file level)
  ├─ 2. MAP module/caller ──► ai gọi module này? module này gọi ai?
  │        ┌──────────┐    ┌──────────┐
  │        │ caller A │───▶│ MODULE X │───▶ callee B, C
  │        └──────────┘    └──────────┘
  └─ 3. chú giải bằng GLOSSARY (CONTEXT-MAP.md — AJR)
    │
    ▼ OUTPUT: bức tranh abstraction (map + glossary), không phải code dump
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/codegraph.ts — code graph (nền — module list)
// ✅ packages/tools/src/reference-graph.ts — reference graph (nền — caller/callee)
// ✅ packages/tools/src/symbol-extractor.ts — symbol extractor (nền — map chi tiết)
// ✅ packages/skills/src/skill.ts — Skill + frontmatter (nền — thêm disable-model-invocation)
// ✅ packages/skills/src/curator.ts — SkillStore (load skill body)

// ❌ THIẾU: zoom-out skill body (abstraction lift procedure)
// ❌ THIẾU: disable-model-invocation field trong SkillFrontmatter
// ❌ THIẾU: module map helper (lọc abstraction level + glossary chú giải)
```

## Implementation

```typescript
// packages/skills/src/zoom-out.ts (NEW)
export interface ModuleNode { name: string; level: "package" | "file"; }
export interface ModuleEdge { from: string; to: string; kind: "calls" | "imports" | "depends" }

export interface ModuleMap {
  nodes: ModuleNode[];
  edges: ModuleEdge[];
  /** Glossary chú giải — tên module → nghĩa project (nối AJR). */
  glossary: Map<string, string>;
}

/** Lọc code graph theo abstraction level — package-level thay vì file-level. */
export function liftToLevel(
  nodes: ModuleNode[],
  edges: ModuleEdge[],
  level: "package" | "file",
): ModuleMap {
  const filtered = nodes.filter((n) => n.level === level);
  const names = new Set(filtered.map((n) => n.name));
  return {
    nodes: filtered,
    edges: edges.filter((e) => names.has(e.from) && names.has(e.to)),
    glossary: new Map(),
  };
}

/** Vẽ map caller/callee cho một module — ai gọi nó, nó gọi ai. */
export function moduleNeighborhood(
  map: ModuleMap,
  moduleName: string,
): { callers: string[]; callees: string[] } {
  const callers = map.edges.filter((e) => e.to === moduleName).map((e) => e.from);
  const callees = map.edges.filter((e) => e.from === moduleName).map((e) => e.to);
  return { callers: [...new Set(callers)], callees: [...new Set(callees)] };
}

/** Chú giải bằng glossary — nối nghĩa project vào mỗi module trong map. */
export function annotateWithGlossary(map: ModuleMap, glossary: Map<string, string>): string[] {
  return map.nodes.map((n) => {
    const meaning = glossary.get(n.name.toLowerCase());
    return meaning ? `- ${n.name} (${n.level}): ${meaning}` : `- ${n.name} (${n.level})`;
  });
}

/** Zoom-out procedure — abstraction lift: map + glossary, không đọc code chi tiết. */
export function zoomOut(map: ModuleMap, target: string): { summary: string[]; neighborhood: { callers: string[]; callees: string[] } } {
  const { callers, callees } = moduleNeighborhood(map, target);
  return {
    summary: annotateWithGlossary(map, map.glossary),
    neighborhood: { callers, callees },
  };
}
// Nối skills: skill body gọi zoomOut(codegraph) — invocation gate qua disable-model-invocation
// Nối AJR: glossary từ CONTEXT-MAP.md — cùng convention
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đúng lúc — zoom-out chỉ khi user yêu cầu, không tự ý | ❌ Model vẫn có thể bỏ qua gate — cần test (AJV) |
| ✅ Hiểu codebase lạ nhanh — map + glossary thay code dump | ❌ Codegraph thiếu edge → map sai — cần dữ liệu đủ |
| ✅ Context tiết kiệm — abstraction thay vì nạp file | ❌ Abstraction quá cao mất chi tiết cần thiết |
| ✅ Tôn trọng user intent — không lạm dụng | ❌ Glossary thiếu term thì chú giải không có nghĩa |

## Khác các hướng gần

| | AJW Zoom-Out | 799 Invocation Axis | 705 Cross-File LSP |
|---|---|---|---|
| Trọng tâm | Đi lên abstraction | Trục gọi skill | Type-aware resolution |
| Cơ chế | Map module/caller | frontmatter flag | Shared type registry |
| Quan hệ | Dùng codegraph | Gate invocation | Chi tiết hơn (file-level) |

## Khi nào chọn

- Codebase lạ, lớn — user cần tổng quan nhanh trước khi đào sâu
- Muốn quyền "bỏ chi tiết" thuộc user (disable-model-invocation)
- Đã có codegraph + reference-graph — thêm skill body là rẻ
- Guard: chỉ chạy khi user yêu cầu, map theo abstraction level, glossary chú giải đúng nghĩa