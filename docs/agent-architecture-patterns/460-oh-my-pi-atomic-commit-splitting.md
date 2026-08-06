# Hướng QR: Atomic Commit Splitting — tách thay đổi không liên quan thành commit nhỏ dependency-order

> **Nguồn gốc:** oh-my-pi (pi-coding-agent); "atomic commit splitting"; "unrelated changes → separate commits"; "dependency-ordered commits"; "one logical change per commit"; "staged hunks"
> **Coupling:** 🟢 — thêm commit-splitter layer trước git commit (analyze diff → group → order)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (bash git + edit sẵn — chưa có diff-hunk grouping + dependency ordering)
> **Effort:** 2-3 tuần

## Nguồn gốc

**oh-my-pi** đề xuất **atomic commit splitting**: khi agent sửa nhiều thứ (bug + refactor + format), không gộp vào 1 commit khổng lồ — **tách thành commit nhỏ**, mỗi commit **một thay đổi logic duy nhất**, xếp theo **dependency order** (commit A phải trước B nếu B phụ thuộc A). Agent **analyze diff** (hunk-level), **group** hunks liên quan, **order** theo dependency (build/types trước, feature sau, test cuối), rồi commit từng nhóm. Nguyên tắc: **commit = reviewable unit** — dễ revert, dễ review, lịch sử sạch. Khác **batch-edit** (gộp sửa) — QR là **tách ngược ra**; khác commit thuần (`git commit -am`) — QR **hiểu mối quan hệ giữa hunks**.

## Mô tả

mya atomic commit splitting: (1) **Diff analysis**: lấy `git diff` (working tree), chia thành **hunks** (vùng thay đổi rời rạc). (2) **Classify**: mỗi hunk → thay đổi loại gì (fix / feat / refactor / format / test / docs). (3) **Group**: gộp hunks cùng logic (ví dụ: fix parser + test cho fix đó = 1 commit). (4) **Order**: topological sort theo dependency (types/interface trước impl, impl trước caller, fix trước feature dùng fix, build/CI trước runtime). (5) **Commit tuần tự**: `git add` chọn hunk (patch-mode) → commit message ngữ nghĩa → lặp. mya có `bash` (git) + `edit` — QR thêm **diff-hunk classifier** + **dependency graph** + **patch-mode stager** (`git add -p`).

## Kiến trúc

```
  WORKING TREE (agent sửa nhiều cùng lúc):
  src/parser.rs  + fix null-token bug
  src/parser.rs  + rename: parse() → parse_token()
  src/lexer.rs   + add EOF handling
  src/lexer.rs   + format (rustfmt)
  tests/parser.test.ts + test cho null-token
  Cargo.toml     + bump dependency
        │
        ▼
  ┌─── DIFF HUNK CLASSIFIER ───────────────────────────┐
  │  hunk(parser.rs:140)   → FIX    (null-token)        │
  │  hunk(parser.rs:20)    → REFACTOR (rename)          │
  │  hunk(lexer.rs:88)     → FEAT   (EOF handling)      │
  │  hunk(lexer.rs:1-30)   → FORMAT (rustfmt, cosmetic) │
  │  hunk(parser.test.ts)  → TEST   (cho null-token)    │
  │  hunk(Cargo.toml)      → CHORE  (bump dep)          │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── GROUP + DEPENDENCY ORDER ────────────────────────┐
  │  commit 1: CHORE (bump dep)      ← base, trước nhất  │
  │  commit 2: FIX + TEST (null-token) ← test kèm fix     │
  │  commit 3: FEAT (EOF handling)   ← phụ thuộc fix      │
  │  commit 4: REFACTOR (rename)     ← api change, sau    │
  │  commit 5: FORMAT (rustfmt)      ← cosmetic, cuối     │
  └───────────────────────┬─────────────────────────────┘
                          │ (patch-mode stage từng nhóm)
                          ▼
  ┌─── SEQUENTIAL COMMIT ───────────────────────────────┐
  │  git add -p (select hunk) → git commit -m "chore:..." │
  │  git add -p (select hunk) → git commit -m "fix:..."   │
  │  ... 5 commits, mỗi cái 1 logic unit, reviewable       │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ bash — git diff/add/commit (nền — QR điều khiển)
// ✅ edit — text changes (nền — QR phân tích hunk)
// ✅ 460 QQ conflict-resolve (nền — QR commit sau khi resolve)

// ❌ THIẾU: diff-hunk classifier (hunk → fix/feat/refactor/format/test/docs)
// ❌ THIẾU: hunk grouping (cùng logic = 1 commit, vd fix + test cho fix)
// ❌ THIẾU: dependency orderer (topological: types → impl → caller)
// ❌ THIẾU: patch-mode stager (git add -p chọn hunk, không whole-file)
```

## Implementation

```typescript
// packages/agent/src/commit-split.ts (MỚI)
type ChangeType = 'fix' | 'feat' | 'refactor' | 'format' | 'test' | 'docs' | 'chore';

interface Hunk { file: string; startLine: number; type: ChangeType; content: string }

async function getHunks(runGit: (args: string[]) => Promise<string>): Promise<Hunk[]> {
  const diff = await runGit(['diff']);
  return parseHunks(diff); // parse @@ -a,b +c,d @@ per file, classify by content
}

function groupHunks(hunks: Hunk[]): Hunk[][] {
  const groups: Hunk[][] = [];
  // fix hunk + test hunk cùng file-area → 1 group
  // format-only hunks → 1 group riêng
  return groups; // mỗi group = 1 commit logic
}

function orderGroups(groups: Hunk[][]): Hunk[][] {
  // topological: chore(bump dep) → fix → feat(depends fix) → refactor(api) → format
  const order: Record<ChangeType, number> =
    { chore: 0, fix: 1, feat: 2, refactor: 3, test: 4, docs: 5, format: 6 };
  return [...groups].sort((a, b) => order[a[0]!.type] - order[b[0]!.type]);
}

async function commitGroup(group: Hunk[], msg: string, runGit: (a: string[]) => Promise<void>): Promise<void> {
  for (const h of group) {
    await runGit(['add', '-p', h.file]); // patch-mode: select only this hunk
  }
  await runGit(['commit', '-m', msg]);
}

// Usage:
// const hunks = await getHunks(git);                       // classify diff
// const groups = orderGroups(groupHunks(hunks));           // dep-order
// for (const g of groups) {
//   await commitGroup(g, typeToMsg(g[0]!.type, g), git);   // "fix(parser): null-token"
// }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lịch sử sạch (mỗi commit 1 logic unit, dễ review) | ❌ Phân loại hunk sai (format trộn refactor) |
| ✅ Dễ revert (revert 1 commit không đụng logic khác) | ❌ Chậm (5 commits thay vì 1) |
| ✅ Dependency order (build luôn pass giữa các commit) | ❌ Hunks cùng file đan xen khó tách (add -p phức tạp) |
| ✅ Reviewable (reviewer xem từng unit) | ❌ Agent phải hiểu "liên quan" (semantic grouping) |

## Khác các hướng gần

| | Batch-Edit | 460 QQ Conflict | QR: Commit-Split |
|---|---|---|---|
| Cái gì | Gộp sửa nhiều chỗ | Giải merge-conflict | **Tách diff thành commit nhỏ** |
| Đơn vị | 1 edit call | Conflict marker | **Hunk logic** |
| Hướng | Gộp | Resolve | **Tách (ngược)** |

## Khi nào chọn

- Agent sửa nhiều loại cùng lúc (fix + refactor + format)
- Muốn lịch sử sạch (reviewable, revertable)
- Có nhiều file hunks rời rạc (add -p khả thi)
- Nối bash (git diff/add -p/commit) + edit (nguồn hunk); dependency order quan trọng — chore/types trước, format cuối; guard hunk đan xen (cùng file, khó add -p) + semantic grouping cần LLM hiểu "liên quan"
