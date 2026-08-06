# Hướng AJR: Ubiquitous Language Context Map — CONTEXT.md + CONTEXT-MAP.md là glossary dùng chung, skill update inline khi term được resolve, challenge term xung đột với glossary ngay lập tức

> **Nguồn gốc:** skills (skills/engineering/grill-with-docs/SKILL.md) | **Coupling:** 🟢 — glossary dùng chung, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skills store + memory; thiếu glossary resolve/conflict) | **Effort:** 2 tuần

## Nguồn gốc

**skills** (skills/engineering/grill-with-docs/SKILL.md) dùng **CONTEXT.md + CONTEXT-MAP.md** làm **glossary dùng chung** (ubiquitous language): (1) **skill update inline khi term được resolve** — agent đang làm task, gặp thuật ngữ, resolve xong thì cập nhật ngay vào glossary (không chờ cuối session); (2) **challenge term xung đột với glossary ngay lập tức** — thấy định nghĩa trong tài liệu/đối thoại lệch glossary thì hỏi ngay, không giữ im; (3) **sharpen fuzzy language** — "account" là Customer hay User? — mỗi term mơ hồ phải được ép về nghĩa chính xác; (4) **tạo file lazily chỉ khi có nội dung** — chưa có term nào thì chưa tạo CONTEXT-MAP.md (không có file rỗng).

Giá trị: (1) **một nguồn sự thật ngôn ngữ** — mọi skill/agent dùng cùng định nghĩa, không mỗi nơi hiểu một kiểu; (2) **chống misunderstanding từ gốc** — fuzzy language bị bắt ngay khi xuất hiện; (3) **chi phí thấp** — lazy creation + update inline, không thêm ceremony; (4) **không cần LLM giữa** — glossary là file markdown thuần, agent đọc/ghi trực tiếp.

## Mô tả

Với mya, pattern = **glossary dùng chung** gắn vào skill context: (1) **CONTEXT.md** — mô tả domain/project (ngữ cảnh chung, luôn đọc); **CONTEXT-MAP.md** — glossary term → định nghĩa chính xác (lazy tạo); (2) **resolve hook** — khi agent dùng/ghi thuật ngữ: tra CONTEXT-MAP.md, term chưa có → resolve từ ngữ cảnh/tài liệu rồi **update inline** (ghi thêm entry); (3) **challenge gate** — term trong input/tool output mâu thuẫn glossary → **challenge ngay** (hỏi user hoặc nêu conflict, không tự chọn nghĩa); (4) **sharpen rule** — term mơ hồ (nhiều nghĩa khả dĩ) phải được đưa về một nghĩa trong glossary trước khi dùng; (5) nơi gắn — mya có `packages/skills` (SkillStore + progressive disclosure) — skill body hướng dẫn đọc CONTEXT.md; glossary như một skill-content convention, không cần code core. Đây là pattern **shared vocabulary governance**: ngôn ngữ là tài sản dùng chung, mọi thay đổi phải qua resolve + challenge.

## Kiến trúc (ASCII)

```
  CONTEXT.md (domain context — luôn đọc)
  CONTEXT-MAP.md (glossary — lazy tạo, chỉ khi có term)
    │
    ▼ TRONG KHI LÀM TASK
  ├─ gặp term → tra glossary
  │    ├─ có định nghĩa ──► dùng đúng nghĩa
  │    ├─ chưa có ──► RESOLVE (từ ngữ cảnh/tài liệu) → UPDATE INLINE glossary
  │    └─ mơ hồ ("account" = Customer hay User?) ──► SHARPEN (ép về 1 nghĩa)
  ├─ term trong input lệch glossary ──► CHALLENGE NGAY (hỏi, không im)
  └─ term mới resolve xong ──► ghi vào CONTEXT-MAP.md (lazy — có nội dung mới tạo file)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills/src/skill.ts — Skill + SkillFrontmatter (progressive disclosure)
//   (skill body có thể hướng dẫn đọc CONTEXT.md — nền)
// ✅ packages/skills/src/curator.ts — SkillStore (load SKILL.md theo cây thư mục)
// ✅ packages/memory/src/graph.ts + learning-graph.ts — fact/backlink (nền semantic)
// ✅ packages/memory/src/conflict.ts — conflict detection (mẫu challenge)

// ❌ THIẾU: glossary convention (CONTEXT.md + CONTEXT-MAP.md) trong skill load
// ❌ THIẾU: resolve hook — update inline khi term được resolve
// ❌ THIẾU: challenge gate — term xung đột glossary phải hỏi ngay
// ❌ THIẾU: lazy file creation (chỉ tạo khi có nội dung)
```

## Implementation

```typescript
// packages/skills/src/glossary.ts (NEW)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface GlossaryEntry { term: string; definition: string; aliases: string[] }

const GLOSSARY_FILE = "CONTEXT-MAP.md";       // glossary — lazy tạo
const CONTEXT_FILE = "CONTEXT.md";            // domain context — luôn đọc

/** Đọc glossary; file chưa tồn tại → rỗng (lazy — không tạo). */
export function loadGlossary(projectDir: string): Map<string, GlossaryEntry> {
  const path = join(projectDir, GLOSSARY_FILE);
  if (!existsSync(path)) return new Map();
  const entries = new Map<string, GlossaryEntry>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|/.exec(line);   // | `term` | definition |
    if (m) {
      const entry: GlossaryEntry = { term: m[1]!, definition: m[2]!, aliases: [] };
      entries.set(entry.term.toLowerCase(), entry);
    }
  }
  return entries;
}

/** Resolve + update inline: term chưa có trong glossary → thêm ngay. */
export function resolveTerm(glossary: Map<string, GlossaryEntry>, projectDir: string, term: string, definition: string): void {
  const key = term.toLowerCase();
  if (glossary.has(key)) return;              // đã có — không duplicate
  const entry: GlossaryEntry = { term, definition, aliases: [] };
  glossary.set(key, entry);
  appendEntry(projectDir, entry);             // update inline, không chờ cuối session
}

/** Challenge gate: term trong input lệch glossary → trả conflict (agent phải hỏi). */
export function challengeTerm(glossary: Map<string, GlossaryEntry>, term: string, incoming: string): string | null {
  const entry = glossary.get(term.toLowerCase());
  if (!entry) return null;                    // chưa biết — resolve, không challenge
  return entry.definition.trim().toLowerCase() === incoming.trim().toLowerCase()
    ? null
    : `term "${term}" xung đột glossary: glossary="${entry.definition}" input="${incoming}" — hỏi user, không tự chọn`;
}

/** Lazy file creation — chỉ ghi file khi có entry đầu tiên. */
function appendEntry(projectDir: string, entry: GlossaryEntry): void {
  const path = join(projectDir, GLOSSARY_FILE);
  if (!existsSync(path)) {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path, "| Term | Definition |\n|---|---|\n", "utf8");
  }
  writeFileSync(path, `| \`${entry.term}\` | ${entry.definition} |\n`, { flag: "a" });
}
// Nối skill: skill body hướng dẫn agent loadGlossary → resolveTerm → challengeTerm
// Nối memory: term resolved có thể ghi fact vào brain (graph.ts) để tái dùng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một nguồn sự thật ngôn ngữ — mọi skill dùng chung định nghĩa | ❌ Glossary lệch thực tế nếu không ai challenge — cần gate |
| ✅ Update inline — term resolve xong ghi ngay, không mất | ❌ File markdown phát sinh — cần convention rõ |
| ✅ Challenge sớm — bắt misunderstanding từ gốc | ❌ Challenge quá nhiều gây phiền — cần threshold |
| ✅ Lazy creation — không có file rỗng vô nghĩa | ❌ Term tiếng Việt không dấu — cần normalize key |

## Khác các hướng gần

| | AJR Ubiquitous Language | 799 Invocation Axis | 835 Injection Scanner |
|---|---|---|---|
| Trọng tâm | Glossary dùng chung | Trục gọi skill | Chặn prompt injection |
| Cơ chế | CONTEXT.md + resolve/challenge | frontmatter flag | regex scanner |
| Quan hệ | Chuẩn hóa ngôn ngữ skill | Điều khiển invocation | Bảo vệ nội dung skill |

## Khi nào chọn

- Project nhiều skill/agent dùng chung domain terms — cần một nghĩa duy nhất
- Fuzzy language gây hiểu nhầm lặp lại ("account", "user", "plan"…)
- Muốn glossary tự lớn lên theo thực tế (lazy + inline update) thay vì viết trước
- Guard: challenge gate bắt xung đột ngay, lazy file, update inline — không thêm ceremony