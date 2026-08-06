# Hướng ABM: Cursor Pagination Grep — ffgrep có cursor pagination, exclude linh hoạt, auto-detect regex, reject wildcard-only

> **Nguồn gốc:** fff (README.md) | **Coupling:** 🟢 — thêm pagination + exclude + validate vào grep tool | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có grep tool + native grep — chưa có pagination/exclude) | **Effort:** 1-2 tuần

## Nguồn gốc

**fff** tool `ffgrep` kiểm soát chặt lượng kết quả vào context bằng bốn cơ chế: (1) **cursor pagination** — trả theo trang, dùng cursor lấy trang kế; (2) **exclude** — comma/space/array, hỗ trợ **leading `!`**; (3) **auto-detect regex** — pattern có vẻ regex thì parse như regex, không thì plain text; (4) **reject pattern wildcard-only kiểu `.*` từ đầu** — chặn pattern vô nghĩa ngay khi nhận, không chạy. Kết quả: agent không bao giờ bị grep trả 10.000 dòng vào context. Nguyên tắc: **bounded output (pagination), exclude trước khi chạy, pattern validate từ đầu**.

## Mô tả

mya cursor pagination grep: grep tool nhận thêm (1) **cursor** — trang kết quả, trả `{ hits, nextCursor }` (agent gọi tiếp, không nhận hết); (2) **exclude** — string comma/space hoặc array, `!` cho phép loại trừ/giữ lại; (3) **auto-detect regex** — pattern có meta char → regex, không → literal; (4) **reject wildcard-only** — pattern `.*`, `*`, `**` bị từ chối ngay (invalid arg). mya có packages/tools builtin.ts grepTool + packages/natives nativeGrep — ABM thêm **pagination state** + **exclude parser** + **regex auto-detect** + **wildcard-only rejection**.

## Kiến trúc

```
  ffgrep(pattern, exclude, cursor)
       │
       ▼
  VALIDATE TỪ ĐẦU
    pattern là ".*" / "*" / "**" → REJECT (không chạy)
       │
       ▼
  AUTO-DETECT REGEX
    có meta ([.*+?^$]) → regex path
    không              → literal/plain path (nhanh)
       │
       ▼
  EXCLUDE FILTER (trước khi scan)
    exclude: "test, !test/fixtures" 
      → bỏ test/, nhưng giữ test/fixtures (leading !)
       │
       ▼
  CURSOR PAGINATION
    hits[0..100]  + nextCursor=101
    → agent gọi tiếp với cursor 101 (không nhận 10.000 hits)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools builtin.ts — grepTool (nền — ABM base)
// ✅ packages/natives nativeGrep — native grep hot loop (nền — ABM engine)

// ❌ THIẾU: cursor pagination (nextCursor state giữa các lần gọi)
// ❌ THIẾU: exclude parser (comma/space/array + leading !)
// ❌ THIẾU: wildcard-only rejection (.* → invalid ngay từ đầu)
```

## Implementation

```typescript
// packages/tools/src/cursor-grep.ts (MỚI)
import { nativeGrep, type GrepHit } from "@my-agent/natives";

export interface CursorGrepArgs {
  pattern: string;
  path?: string;
  exclude?: string | string[];
  cursor?: number;
  limit?: number; // mặc định 100
}

export interface CursorGrepResult {
  hits: GrepHit[];
  nextCursor: number | null; // null = hết
  total: number;
}

const WILDCARD_ONLY = /^(\.\*|\*|\*\*|\?)$/;

/** Parse exclude: comma/space/array, leading ! = negation. */
export function parseExclude(raw: string | string[] | undefined): { drop: string[]; keep: string[] } {
  if (!raw) return { drop: [], keep: [] };
  const parts = (Array.isArray(raw) ? raw : raw.split(/[, ]+/)).filter(Boolean);
  const drop: string[] = [];
  const keep: string[] = [];
  for (const p of parts) (p.startsWith("!") ? keep : drop).push(p.replace(/^!/, ""));
  return { drop, keep };
}

/** Grep có pagination + exclude + validate. */
export function cursorGrep(args: CursorGrepArgs, cwd: string): CursorGrepResult {
  if (WILDCARD_ONLY.test(args.pattern)) {
    throw new Error(`grep: wildcard-only pattern "${args.pattern}" bị từ chối`);
  }
  const { drop, keep } = parseExclude(args.exclude);
  const isRegex = /[.*+?^$()[\]{}|\\]/.test(args.pattern); // auto-detect regex
  const all = nativeGrep(args.pattern, args.path ?? cwd, { regex: isRegex })
    .filter(h => {
      const inDrop = drop.some(d => h.path.includes(d));
      const inKeep = keep.some(k => h.path.includes(k));
      return !inDrop || inKeep; // exclude trước, leading ! giữ lại
    });
  const limit = args.limit ?? 100;
  const start = args.cursor ?? 0;
  const page = all.slice(start, start + limit);
  return {
    hits: page,
    nextCursor: start + page.length < all.length ? start + page.length : null,
    total: all.length,
  };
}
// Usage:
// const p1 = cursorGrep({ pattern: "auth", exclude: "test, !test/fixtures" }, cwd);
// if (p1.nextCursor !== null) cursorGrep({ pattern: "auth", cursor: p1.nextCursor }, cwd);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Exclude linh hoạt (comma/space/array + leading !) | ❌ Cursor state (phải giữ cursor giữa các lần gọi — dễ mất) |
| ✅ Reject wildcard-only (chặn pattern vô nghĩa từ đầu) | ❌ Auto-detect regex sai (pattern có dấu chấm nhưng là literal) |
| ✅ Total biết trước (agent ước lượng được quy mô) | ❌ Exclude path matching (includes vs glob — có thể lệch ý) |

## Khác các hướng gần

| | Grep thường (trả hết) | Truncate hard | ABM: Cursor Pagination |
|---|---|---|---|
| Lượng kết quả | vô hạn (ngập context) | cắt mù | **trang + total + nextCursor** |
| Exclude | không | không | **comma/space/array + !** |
| Pattern vô nghĩa | chạy (tốn) | chạy | **reject từ đầu** |
| Context | ngập | cắt đột ngột | **kiểm soát chủ động** |

## Khi nào chọn

- Grep hay trả hàng nghìn hits làm ngập context agent
- Muốn agent chủ động duyệt kết quả (trang này, rồi quyết định trang sau)
- Muốn chặn pattern sai từ đầu (không tốn scan vô ích)
- Nối packages/tools builtin.ts grepTool + packages/natives nativeGrep + output-compress.ts; guard cursor-stability (cursor dựa trên total cố định — index không đổi giữa 2 lần gọi), exclude-semantics (document rõ includes vs glob), và regex-detect-correct (literal pattern không bị hiểu nhầm regex); ABM = cursor pagination grep, kết hợp 740 ABL weak-match-detector (lọc hits yếu trước khi paginate) + 101 dynamic-tool-selection (grep là tool được chọn theo turn)
