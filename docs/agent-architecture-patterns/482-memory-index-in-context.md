# Hướng RN: Memory Index In-Context — MEMORY.md là index 1 dòng/hook, mỗi fact 1 file frontmatter riêng

> **Nguồn gốc:** Leaks Claude Code (MEMORY.md index; "one line per entry under ~150 chars"; "MEMORY.md is an index, not a memory"; per-file frontmatter `name`/`description`/`type`; `[[link]]` cross-ref; "lines after 200 truncated")
> **Coupling:** 🟡 — thêm MEMORY.md index + per-fact file store vào memory pipeline (thay vì 1 file blob)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (hierarchical/slotted memory sẵn — chưa có 2-step write: fact-file + index-pointer)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**Leaks Claude Code** mô tả pattern nhớ **2 phần tách biệt**: (1) **MEMORY.md** là một **chỉ mục (index)**, *không phải* nơi chứa nội dung nhớ — mỗi dòng `<150 ký tự`, dạng `- [Title](file.md) — one-line hook`, không frontmatter; luôn load vào context nhưng **cắt sau 200 dòng** → phải giữ ngắn gọn. (2) **Mỗi fact 1 file riêng** với **frontmatter** (`name` slug, `description` 1-dòng quyết định relevance, `type` ∈ user/feedback/project/reference) + nội dung + cross-ref `[[name]]`. **Quy tắc 2-bước ghi**: bước 1 — viết fact vào file riêng (frontmatter + body); bước 2 — thêm 1 dòng pointer vào MEMORY.md. **Loại trừ**: git history, debug recipe (ở trong code), CLAUDE.md đã có — không nhớ. **Stale guard**: trước khi recommend từ memory, **verify** (file tồn tại / grep flag) vì nhớ có thể lỗi thời. Khác **165 FI hierarchical-memory** (bộ nhớ phân cấp working/episodic/semantic) — RN **flat file + index in-context**; khác **409 OS slotted-schema** (30-40 slot định sẵn) — RN **1 fact = 1 file, không giới hạn slot**.

## Mô tả

mya memory index in-context: (1) **MEMORY.md index**: luôn inject vào system context — chỉ chứa 1-dòng pointer `- [Title](file.md) — hook`, không nội dung; cắt sau N dòng (≈200). (2) **Per-fact file**: mỗi fact là file `.md` riêng với frontmatter `name`/`description`/`type` + body (rule + **Why:** + **How to apply:**). (3) **2-step write**: ghi fact → viết file riêng → thêm pointer vào index. (4) **`[[link]]` cross-ref**: link giữa fact trong body (link đến slug khác, chưa tồn tại cũng OK — đánh dấu viết sau). (5) **Dedup / update**: trước khi ghi mới, check fact cũ có thể update. (6) **Verify-before-recommend**: recommend từ memory → verify file/flag tồn tại hiện tại. mya có hierarchical/slotted memory — RN thêm **index-frontend (MEMORY.md trong context) + lazy-load fact-file** khi relevance.

## Kiến trúc

```
  SYSTEM CONTEXT (mỗi turn)
  ┌──────────────────────────────────────────────┐
  │  ...system prompt...                          │
  │  ┌─ MEMORY.md (INDEX — luôn in-context) ───┐ │
  │  │ - [User role](user_role.md) — dev ops    │ │   ← 1 dòng / <150 char
  │  │ - [Test feedback](feedback_testing.md) — vitest首选 │
  │  │ - [Project arch](project_arch.md) — napi-rs │
  │  │ ... (cắt sau 200 dòng)                   │ │
  │  └──────────────────────────────────────────┘ │
  └─────────────────────┬────────────────────────┘
                        │ lazy-load khi relevant (read file)
                        ▼
  FACT FILES (1 fact = 1 file, frontmatter + body)
  ┌─ user_role.md ──────────────────────────────┐
  │ ---                                          │
  │ name: user-role                              │
  │ description: user là dev ops, thích terse    │
  │ metadata:                                    │
  │   type: user                                 │
  │ ---                                          │
  │ User làm dev ops, giao tiếp ngắn gọn.        │
  │ **Why:** tránh giải thích thừa.              │
  │ **How to apply:** trả lời súc tích.          │
  │ Xem [[test-feedback]].                       │
  └──────────────────────────────────────────────┘

  WRITE (2 bước):  fact → file riêng → pointer vào MEMORY.md
  VERIFY:          recommend từ memory → check file/grep tồn tại hiện tại
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 165 FI hierarchical-memory — bộ nhớ phân cấp (nền — RN = flat fact-file + index)
// ✅ 409 OS slotted-memory-schema — slot định sẵn (đối chiếu — RN không giới hạn slot)
// ✅ 417 PA per-identity-memory-drift — partition theo identity (gần — RN = fact-file partition)
// ✅ memory read/write (packages/core) — memory pipeline (nền — RN = 2-step write)

// ❌ THIẾU: MEMORY.md index generator (1-dòng pointer, inject in-context, truncate 200)
// ❌ THIẾU: per-fact file store (frontmatter name/description/type + body)
// ❌ THIẾU: 2-step write (ghi fact-file + thêm pointer index, atomic)
// ❌ THIẾU: [[link]] cross-ref resolver (link slug → fact-file, hoặc đánh dấu viết sau)
// ❌ THIẾU: verify-before-recommend (check file/grep tồn tại trước recommend)
```

## Implementation

```typescript
// packages/agent/src/memory-index.ts (MỚI)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

type MemType = "user" | "feedback" | "project" | "reference";

interface FactFile {
  name: string;           // slug
  description: string;    // 1-dòng — quyết định relevance
  type: MemType;
  body: string;           // rule + Why + How to apply
  links: string[];        // [[slug]] cross-refs
}

const MAX_INDEX_LINES = 200;
const MAX_HOOK_CHARS = 150;

class MemoryIndex {
  constructor(private dir: string) {}

  // 2-step write: ghi fact-file + thêm pointer vào MEMORY.md
  writeFact(fact: FactFile): void {
    // bước 1: viết file riêng (frontmatter + body)
    const front = [
      "---",
      `name: ${fact.name}`,
      `description: ${fact.description}`,
      "metadata:",
      `  type: ${fact.type}`,
      "---",
      "",
    ].join("\n");
    writeFileSync(join(this.dir, `${fact.name}.md`), front + fact.body + "\n");

    // bước 2: thêm pointer 1-dòng vào index (nếu chưa có)
    const entries = this.readIndex();
    const hook = this.hookLine(fact);
    if (!entries.some(e => e.file === `${fact.name}.md`)) {
      entries.push({ file: `${fact.name}.md`, hook });
    }
    this.writeIndex(entries);
  }

  // index front-end: render MEMORY.md (1-dòng / entry, truncate 200 dòng)
  renderIndex(): string {
    const entries = this.readIndex().slice(0, MAX_INDEX_LINES);
    return ["# MEMORY.md", "", ...entries.map(e => e.line)].join("\n");
  }

  // lazy-load fact-file khi relevant
  loadFact(name: string): FactFile | null {
    const p = join(this.dir, `${name}.md`);
    if (!existsSync(p)) return null;
    return parseFactFile(readFileSync(p, "utf8"));   // parse frontmatter + body
  }

  // verify-before-recommend: check file/flag tồn tại hiện tại
  verifyBeforeRecommend(claim: { filePath?: string; symbol?: string }): boolean {
    if (claim.filePath && !existsSync(claim.filePath)) return false;
    if (claim.symbol) { /* grep symbol in repo — omitted */ }
    return true;
  }

  private readIndex(): { file: string; hook: string; line: string }[] {
    const p = join(this.dir, "MEMORY.md");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter(l => l.startsWith("- ["))
      .map(l => ({ file: l.match(/\((.+?)\)/)?.[1] ?? "", hook: l, line: l }));
  }

  private writeIndex(entries: { file: string; line: string }[]): void {
    const body = ["# MEMORY.md", "", ...entries.map(e => e.line)].join("\n");
    writeFileSync(join(this.dir, "MEMORY.md"), body + "\n");
  }

  private hookLine(fact: FactFile): string {
    const hook = fact.description.slice(0, MAX_HOOK_CHARS);
    return `- [${fact.name}](${fact.name}.md) — ${hook}`;
  }
}

// Usage:
// mem.writeFact({ name: "user-role", description: "user dev ops, thích terse",
//   type: "user", body: "User làm dev ops.\n**Why:** tránh thừa.\n**How to apply:** súc tích.",
//   links: ["test-feedback"] });
// const index = mem.renderIndex();              // → inject vào system context
// if (mem.verifyBeforeRecommend({ filePath: "src/x.ts" })) recommend(...);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Index trong context luôn sẵn (không cần search để biết fact nào có) | ❌ Phải giữ index ngắn (200 dòng — nhiều fact → phải gộp) |
| ✅ Lazy-load chỉ fact relevant (tiết kiệm token) | ❌ 2-step write phức tạp hơn blob đơn |
| ✅ Frontmatter description quyết định relevance rõ ràng | ❌ File per-fact = nhiều file nhỏ |
| ✅ `[[link]]` cross-ref nối fact liên quan | ❌ Stale — cần verify-before-recommend |

## Khác các hướng gần

| | 165 Hierarchical-Memory | 409 Slotted-Schema | RN: Memory-Index-In-Context |
|---|---|---|---|
| Cấu trúc | Phân cấp (working/episodic...) | 30-40 slot định sẵn | **Flat: 1 fact = 1 file + index** |
| In-context | Toàn bộ cấp working | Slot list | **Index 1-dòng (truncate 200)** |
| Load | Theo cấp | Theo slot | **Lazy-load fact-file khi relevant** |

## Khi nào chọn

- Muốn agent luôn biết fact nào tồn tại (index in-context) mà không tốn token load hết
- Fact nhiều, mỗi fact độc lập, cần relevance-based load
- Cần cross-ref giữa fact (`[[link]]`)
- Nối memory read/write (RN = index front-end + lazy fact-file) + 165 FI (đối chiếu phân cấp) + 417 PA (partition identity); guard index truncation (gộp fact khi >200 dòng) + stale guard (verify-before-recommend: check file/grep tồn tại) + 2-step write atomic (fact-file + pointer cùng thành công)
