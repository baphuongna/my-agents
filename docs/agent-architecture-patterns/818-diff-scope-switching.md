# Hướng AEL: Diff Scope Switching — một UI review thống nhất cho `git diff`, `last commit`, `all files`

> **Nguồn gốc:** pi-diff-review | **Coupling:** 🟢 — chọn nguồn diff, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn git diff reducers; thiếu scope model + markers) | **Effort:** 1 tuần

## Nguồn gốc

**pi-diff-review** (src/git.ts): review window cho phép **chuyển giữa 3 scope**: (1) `git diff` (working tree), (2) `last commit` (HEAD~1..HEAD), (3) `all files` — với **git status markers** phân biệt **changed/untracked**. Một UI thống nhất cho nhiều chế độ so sánh: user không phải thoát window chạy lệnh git khác — chỉ bấm đổi scope, window re-render danh sách file + diff theo nguồn mới.

Giá trị: (1) **thống nhất UX** — một cửa sổ, nhiều chế độ, cùng cách xem/comment (nối AEK); (2) **markers rõ** — untracked file không có diff gốc, phải đánh dấu khác changed (không thể hiện "old" cho file mới); (3) **mỗi scope có ngữ nghĩa review khác nhau** — diff đang sửa dở vs commit vừa xong vs toàn bộ thay đổi.

## Mô tả

Với mya, pattern = **scope model + diff provider** trong review pipeline: (1) **ScopeModel** — `"git-diff" | "last-commit" | "all-files"` + cách map sang lệnh git tương ứng; (2) **provider** — mỗi scope trả về `FileMeta[]` (path + status: changed/untracked/deleted) và diff content theo yêu cầu (nối AEJ lazy loading); (3) **status markers** — untracked/deleted render khác changed trong sidebar (untracked không có "old" side); (4) **swap scope** — đổi nguồn, invalidate cache content cũ (nối AEJ cache), giữ UI. mya đã có nền: `output-compress.ts` có git diff/status/log reducers (parse output git) — tái dùng parser, thêm layer scope. Đây là pattern **single-surface multi-source**: người dùng học một UI, dùng được nhiều chế độ.

## Kiến trúc (ASCII)

```
  REVIEW WINDOW (AEI) — toolbar scope
  ├─ "git diff"    ──► git diff (working tree)      [changed/untracked]
  ├─ "last commit" ──► git diff HEAD~1 HEAD         [changed]
  └─ "all files"   ──► git status --porcelain       [changed/untracked/deleted]
          │
          ▼ SCOPE PROVIDER (git.ts)
  FileMeta[] { path, status } — metadata eager (AEJ)
          │
          ▼ SWAP SCOPE
  ──► invalidate content cache (AEJ) ──► re-render sidebar
  ──► untracked/deleted render khác (không có old side)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/output-compress.ts — git diff/status/log reducers
//   (parse git output — nền provider)
// ✅ packages/print/src/bg-runner.ts — host process chạy git commands
// ✅ packages/rpc — transport (window ↔ host)
// ✅ packages/web — sidebar/list UI (render FileMeta)

// ❌ THIẾU: ScopeModel + map lệnh git cho 3 scope
// ❌ THIẾU: status markers (untracked/deleted ≠ changed)
// ❌ THIẾU: swap scope + invalidate cache content
```

## Implementation

```typescript
// packages/print/src/diff-scope.ts (NEW)
export type DiffScope = "git-diff" | "last-commit" | "all-files";
export type FileStatus = "changed" | "untracked" | "deleted";

export interface DiffScopeProvider {
  scope: DiffScope;
  listFiles(): Promise<Array<{ path: string; status: FileStatus }>>;
  diffFor(path: string): Promise<{ oldText: string; newText: string }>;
}

const GIT_ARGS: Record<DiffScope, string[]> = {
  "git-diff": ["diff", "--no-color", "--"],            // working tree
  "last-commit": ["diff", "--no-color", "HEAD~1", "HEAD", "--"],
  "all-files": [],                                     // status --porcelain
};

export function swapScope(provider: DiffScopeProvider, next: DiffScope, cache: LazyFileLoader): void {
  cache.invalidate();                       // content cũ hết hiệu lực (AEJ)
  provider.scope = next;                    // đổi nguồn diff
  // sidebar re-render: FileMeta[] mới + status markers
  // untracked/deleted: render khác — không có old side trong Monaco
}
// Nối AEJ: listFiles() eager (metadata) — diffFor() lazy (content)
// Nối AEI: window dùng chung 1 UI cho cả 3 scope
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một UI, nhiều chế độ — học một lần | ❌ "all-files" có untracked — diff content phức tạp hơn |
| ✅ Markers phân biệt changed/untracked/deleted | ❌ Swap scope phải invalidate cache — lag nhẹ |
| ✅ Mỗi scope đúng ngữ nghĩa review | ❌ Map lệnh git phải theo version git |
| ✅ Tái dùng output-compress parser | ❌ Deleted file không có newText — cần xử lý edge |

## Khác các hướng gần

| | AEL Scope Switching | AEJ Lazy Loading | AEI Review Window |
|---|---|---|---|
| Trọng tâm | Nguồn diff đa chế độ | Tải content on-demand | UI review |
| Cơ chế | 3 scope git + markers | request-file + cache | RPC + Monaco |
| Quan hệ | Đổi nguồn của AEJ | Loader trong window | Vỏ ngoài dùng AEL |

## Khi nào chọn

- Review thường xuyên ở nhiều chế độ (đang sửa / vừa commit / tổng)
- Đã có output-compress git parser + AEI window — thêm scope model
- Muốn UI thống nhất thay vì nhiều lệnh git rời rạc
- Cần phân biệt untracked/deleted rõ ràng trong review