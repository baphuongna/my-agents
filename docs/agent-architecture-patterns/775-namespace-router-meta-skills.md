# Hướng ACU: Namespace Router Meta-Skills — thay flat list 86 skills (~2150 tokens) bằng 6 namespace meta-skills (~120 tokens) với routing table

> **Nguồn gốc:** get-shit-done (docs/dev/architecture.md) | **Coupling:** 🟢 — skill index layer, SkillStore không đổi | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có SkillStore index — chưa có namespace routing) | **Effort:** 1-2 tuần

## Nguồn gốc

**get-shit-done** nhận ra **flat list 86 skills chiếm ~2150 tokens** trong prompt — quá đắt mỗi turn. Giải pháp: **6 namespace meta-skills** (`gsd-workflow`, `gsd-project`, `gsd-quality`...) chỉ tốn **~120 tokens**, kèm **routing table pipe-separated keyword tags ≤60 chars**. Model chọn namespace (ít, gọn) rồi **route tới concrete sub-skill** qua keyword tags. Quan trọng: **additive** — mọi command vẫn gọi trực tiếp được (không mất khả năng cũ), namespace chỉ là lớp index tiết kiệm token. Nguyên tắc: **index 2 tầng (namespace → sub-skill) thay flat list, additive không phá command cũ**.

## Mô tả

mya namespace router meta-skills: (1) **namespace meta-skills** — nhóm 86 skill thành 6 namespace (workflow/project/quality/...), mỗi namespace 1 entry ngắn; (2) **routing table** — mỗi namespace mang `keyword tags` pipe-separated ≤60 chars để model route; (3) **2-step resolution** — model chọn namespace (trong 6) → route tới concrete sub-skill theo tags → load body (progressive disclosure vẫn giữ); (4) **additive** — sub-skill vẫn gọi trực tiếp được (SkillStore.get(name)), namespace là chỉ mục không thay thế; (5) **token saving** — 2150 → 120 tokens cho phần index. Nối skills curator.ts (SkillStore) — ACU thêm namespace layer trên index.

## Kiến trúc

```
  FLAT LIST (86 skills — ~2150 tokens) ❌
       ▼
  NAMESPACE META-SKILLS (6 — ~120 tokens) ✅
    gsd-workflow  │ keywords: plan|execute|verify|loop
    gsd-project   │ keywords: roadmap|milestone|scope
    gsd-quality   │ keywords: review|test|refactor|security
    ...
       │  model chọn namespace (ít, gọn)
       ▼
  ROUTING TABLE (tags ≤60 chars)
    keyword ──▶ concrete sub-skill
       ▼
  SUB-SKILL BODY (progressive disclosure — load khi invoke)
  ADDITIVE — command vẫn gọi trực tiếp sub-skill được
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills curator.ts — SkillStore.index() + renderIndexBlock()
//   (nền — ACU thay renderIndexBlock bằng namespace blocks)
// ✅ packages/skills skill.ts — SKILL_PROMPT_DESC_LIMIT 60 (nền — giới hạn token)
// ✅ packages/skills curator.ts — loadBody (nền — progressive disclosure giữ)
// ✅ packages/print skill-search/ — categories + indexer (nền — routing table)
// ✅ packages/core session.ts — skillSetDirty (nền — rebuild index khi thay đổi)

// ❌ THIẾU: namespace meta-skill model (6 namespace, ~120 tokens)
// ❌ THIẾU: routing table (keyword tags ≤60 chars → sub-skill)
// ❌ THIẾU: 2-step resolution (chọn namespace → route sub-skill)
```
## Implementation
```typescript
// packages/skills/src/namespace-router.ts (MỚI)
import type { SkillIndexEntry } from "./curator.js";
export interface NamespaceMetaSkill {
  name: string;                 // gsd-workflow
  keywords: string;             // "plan|execute|verify|loop" — ≤60 chars
  /** Các sub-skill thuộc namespace này. */
  members: string[];
}
/** Nhóm index entries thành namespace meta-skills. */
export function buildNamespaces(
  index: SkillIndexEntry[],
  map: Record<string, string[]>, // namespace → member skill names
  keywords: Record<string, string>,
): NamespaceMetaSkill[] {
  return Object.entries(map).map(([name, members]) => ({
    name,
    keywords: keywords[name] ?? "",
    members: members.filter((m) => index.some((e) => e.name === m)),
  }));
}
/** Render namespace index block — ~120 tokens thay vì 2150. */
export function renderNamespaceBlock(namespaces: NamespaceMetaSkill[]): string {
  const lines = ["## Skills (namespace index — invoke theo tên đầy đủ)"];
  for (const ns of namespaces) {
    // pipe-separated keywords ≤60 chars — model route theo tag.
    lines.push(`- **${ns.name}** | ${ns.keywords}`);
  }
  return lines.join("\n");
}
/** 2-step resolution: namespace (từ tags) → concrete sub-skill. */
export function routeToSkill(
  query: string,
  namespaces: NamespaceMetaSkill[],
  allSkills: SkillIndexEntry[],
): SkillIndexEntry[] {
  // Bước 1: chọn namespace — token nào khớp keywords.
  const matchedNs = namespaces.filter((ns) =>
    ns.keywords.split("|").some((k) => query.toLowerCase().includes(k.trim())),
  );
  // Bước 2: route tới sub-skill trong namespace khớp.
  const names = new Set(matchedNs.flatMap((ns) => ns.members));
  if (names.size === 0) return allSkills; // không khớp → fallback toàn bộ
  return allSkills.filter((s) => names.has(s.name));
}
/** Validate: routing table keywords ≤60 chars (contract). */
export function assertKeywordBudget(namespaces: NamespaceMetaSkill[]): string[] {
  return namespaces
    .filter((ns) => ns.keywords.length > 60)
    .map((ns) => `${ns.name}: keywords ${ns.keywords.length} chars > 60`);
}
//        routeToSkill(modelQuery, namespaces, index) → sub-skills
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Token index giảm mạnh (2150 → 120) — rẻ mỗi turn | ❌ Model phải route đúng — tags sai = chọn sai namespace |
| ✅ Additive — command gọi trực tiếp vẫn chạy | ❌ Namespace map phải cập nhật khi thêm skill |
| ✅ Progressive disclosure giữ — body load khi invoke | ❌ 2-step resolution thêm một bước suy luận |
| ✅ Keywords ≤60 chars — budget kiểm soát được | ❌ Query không khớp tag → fallback toàn bộ (tốn token) |

## Khác các hướng gần

| | Flat SkillStore index (curator.ts) | ACU: Namespace Router |
|---|---|---|
| Index | 86 entries flat (~2150 tokens) | **6 namespace (~120 tokens) + routing table** |
| Resolution | Model đọc hết rồi chọn | **2-step: namespace → sub-skill** |
| Token | Tốn | **Tiết kiệm bậc lớn** |
| Additive | — | **Command trực tiếp vẫn hoạt động** |

## Khi nào chọn

- Skill list lớn (từ vài chục trở lên) đang tốn token index mỗi turn
- Skill có thể nhóm theo namespace rõ ràng (workflow/project/quality)
- Đã có SkillStore + progressive disclosure — thêm namespace layer
- Guard: keywords ≤60 chars, additive giữ command cũ, fallback khi không khớp tag
