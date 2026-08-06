# Hướng YO: Companion List Pattern — pattern tách danh sách đồng hành: awesome-claude-code-subagents, awesome-openclaw-skills riêng cho từng lớp agent — mỗi danh mục một surface discovery (research.md)

> **Nguồn gốc:** awesome-agent-skills (research.md) | **Coupling:** 🟢 — tổ chức danh sách, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill store — chưa có companion list registry) | **Effort:** 1 tuần

## Nguồn gốc

**awesome-agent-skills** nhận ra: skill dành cho **một lớp agent** (Claude Code subagents) không hợp cho lớp khác (OpenClaw, Cursor rules) — syntax, môi trường, API khác nhau. Giải pháp: **companion list pattern** — tách danh sách đồng hành riêng cho từng lớp: `awesome-claude-code-subagents`, `awesome-openclaw-skills`, `awesome-cursor-rules`... Mỗi danh mục **một surface discovery** riêng — người dùng Claude Code không phải lọc skill OpenClaw khỏi danh sách chung. Danh sách chính (index) trỏ tới các companion list.

## Mô tả

mya áp dụng companion-list-pattern: skill registry chia theo **agent class** (target runtime): `claude-code`, `openclaw`, `cursor`, `generic` (agent-agnostic — chạy được mọi nơi). Mỗi class một **companion list** riêng (namespace riêng trong store); danh sách chính là index trỏ vào từng companion. Skill publish phải khai `target_runtime` — vào đúng companion list. Agent mya khi tìm skill: filter theo runtime của nó (mya là generic hoặc có adapter riêng) → chỉ thấy skill tương thích, không thấy skill lạ runtime. Discovery surface tách biệt, nhưng store vật lý vẫn chung (metadata phân loại). mya có sẵn skill.ts (frontmatter + provenance), curator (load store) — YO thêm **target_runtime field** + **companion registry**.

## Kiến trúc

```
  INDEX (danh sách chính)
    ├─ → awesome-claude-code-subagents  (target_runtime: claude-code)
    ├─ → awesome-openclaw-skills        (target_runtime: openclaw)
    ├─ → awesome-cursor-rules           (target_runtime: cursor)
    └─ → awesome-agent-agnostic         (target_runtime: generic)

  Skill publish:
    frontmatter: target_runtime: claude-code | openclaw | cursor | generic
       │
       ▼
  DISCOVERY (per surface):
    Agent mya (generic)  → chỉ thấy generic + claude-code-compat (adapter)
    User Claude Code     → chỉ thấy claude-code list
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — frontmatter (nền — YO thêm target_runtime field)
// ✅ packages/skills curator.ts — load/đánh giá skill (nền — YO route companion list)
// ✅ packages/skills index — index skill (nền — YO per-runtime index)
// ✅ packages/intercom skills/ — skill mẫu mya (nền — YO generic runtime)

// ❌ THIẾU: target_runtime field + validation
// ❌ THIẾU: companion registry (index → per-runtime list)
```

## Implementation (TS)

```typescript
// packages/skills/src/companion-lists.ts (MỚI)
export type Runtime = "claude-code" | "openclaw" | "cursor" | "generic" | "mya";

export const RUNTIMES: Runtime[] = ["claude-code", "openclaw", "cursor", "generic", "mya"];

export interface CompanionSkill {
  name: string;
  runtime: Runtime;
  compatible: Runtime[]; // runtime khác vẫn dùng được
}

export class CompanionRegistry {
  private lists = new Map<Runtime, CompanionSkill[]>();

  constructor() {
    for (const r of RUNTIMES) this.lists.set(r, []);
  }

  add(s: CompanionSkill): void {
    this.lists.get(s.runtime)?.push(s);
  }

  /** Discovery surface cho một runtime — kèm skill compatible. */
  discover(runtime: Runtime): CompanionSkill[] {
    const own = this.lists.get(runtime) ?? [];
    const compat = [...this.lists.values()]
      .flat()
      .filter((s) => s.runtime !== runtime && s.compatible.includes(runtime));
    return [...own, ...compat];
  }

  /** Index → danh sách companion (mỗi surface riêng). */
  indexMarkdown(): string {
    return RUNTIMES.map((r) => `- [awesome-${r}-skills](${r}.md) — ${this.lists.get(r)?.length ?? 0} skills`).join("\n");
  }
}

// Usage:
// const reg = new CompanionRegistry();
// reg.add({ name: "claude-code-review", runtime: "claude-code", compatible: [] });
// reg.add({ name: "mya-skill", runtime: "mya", compatible: ["generic"] });
// reg.discover("mya"); // → mya-skill + generic skills (không thấy openclaw-only)
// reg.indexMarkdown(); // → index trỏ từng companion list
```

## Được

- ✅ Mỗi lớp agent một surface — không lọc skill lạ runtime
- ✅ Store vẫn chung — metadata phân loại, không nhân bản file
- ✅ Compatible field — skill dùng được nhiều runtime khai rõ
- ✅ Index rõ — danh sách chính trỏ companion, không trộn
- ✅ Discovery nhanh — filter theo runtime trước khi duyệt

## Mất

- ❌ Compatible khai sai — skill khai compatible generic nhưng syntax không chạy
- ❌ Runtime mới — lớp agent mới xuất hiện phải thêm RUNTIMES
- ❌ Chia mảnh — quá nhiều companion list nhỏ làm index dài

## Khác các hướng gần

| | Một danh sách chung | Tag runtime | YO: Companion Lists |
|---|---|---|---|
| Surface | 1 (lọc thủ công) | 1 (filter tag) | **nhiều surface riêng** |
| Nhân bản | không | không | **không (metadata)** |
| Trải nghiệm | nhiễu | filter | **đúng lớp ngay** |

## Khi nào chọn

- Skill store phục vụ nhiều lớp agent (Claude Code, OpenClaw, mya)
- Muốn discovery surface tách biệt mà store không nhân bản
- Có skill.ts + curator sẵn — YO thêm runtime field + registry
- Nối packages/skills skill.ts (target_runtime) + curator.ts (route) + index; guard compatible-truth (compatible phải test chạy được ở runtime kia), runtime-add (thêm runtime mới phải update registry + test), và index-depth (companion quá nhiều → gom theo vendor 664 YN); YO = companion lists, kết hợp 664 YN vendor-grouped (taxonomy vendor × runtime) + 663 YM badge-curation (chất lượng trong từng list)
