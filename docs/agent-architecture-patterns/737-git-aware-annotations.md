# Hướng ABI: Git-Aware Annotations — file modified/untracked/staged được gắn tag git trong kết quả tìm kiếm để agent ưu tiên

> **Nguồn gốc:** fff (README.md) | **Coupling:** 🟢 — thêm git status worker vào search index | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có search-index — chưa có git status tag) | **Effort:** 1 tuần

## Nguồn gốc

**fff** gắn **git-aware annotations**: file **modified / untracked / staged** được tag trạng thái git trong **kết quả tìm kiếm** — `git_status` field trên mỗi item (fff có hẳn `git_status_worker.rs` chạy nền cập nhật status). Mục đích: **agent biết file nào đang được thay đổi tích cực** (đang sửa dở, vừa thêm, đã stage) để **ưu tiên với tới** — khi agent cần hiểu "trạng thái hiện tại của dự án", các file modified/untracked/staged là nguồn thông tin quan trọng nhất (chúng là thay đổi gần nhất, chưa commit). Nguyên tắc: **git status là annotation bên cạnh kết quả, agent dùng nó để ưu tiên, không phải tự chạy git status mỗi lần**.

## Mô tả

mya git-aware annotations: mỗi file trong search index được gắn **git status** (modified / untracked / staged / committed) — worker nền chạy `git status` (hoặc parse `.git/index`) cập nhật định kỳ. Kết quả tìm kiếm trả về kèm **tag git** trên từng file; agent có thể lọc/ưu tiên: muốn biết thay đổi đang làm dở → lọc `git:modified`; muốn review trước commit → `git:staged`; muốn file mới → `git:untracked`. mya có packages/tools search-index.ts (index + frecency) — ABI thêm **git status worker** + **tag trong result** + **filter theo git state**.

## Kiến trúc

```
  GIT STATUS WORKER (nền, định kỳ)
  ┌──────────────────────────────────────────┐
  │  git status --porcelain → parse          │
  │    M src/a.ts      → modified            │
  │    ?? src/new.ts   → untracked           │
  │    A  src/b.ts     → staged              │
  │  → cập nhật git_status map (path → state) │
  └──────────────────────┬───────────────────┘
                         ▼
  SEARCH INDEX (path → { frecency, git_status })
                         │
                         ▼
  RESULT "auth" →
    [1] src/auth.ts       (modified)   ← ưu tiên (đang sửa dở)
    [2] src/new-oauth.ts  (untracked)  ← mới thêm
    [3] src/legacy.ts     (committed)  ← cũ, ít ưu tiên
  → agent biết file nào đang thay đổi tích cực
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools search-index.ts — SearchIndex + frecency + bigram (nền — ABI index)
// ✅ packages/tools find.ts — find tool (nền — ABI result enrichment)
// ✅ packages/tools builtin.ts — grep tool (nền — ABI tag vào grep hits)
// ✅ packages/print launcher.ts — git status usage trong UI (liên quan — ABI data source)

// ❌ THIẾU: git status worker (định kỳ parse git status → map)
// ❌ THIẾU: git_status field trong search result
// ❌ THIẾU: filter/lọc theo git state (modified/untracked/staged)
```

## Implementation

```typescript
// packages/tools/src/git-annotations.ts (MỚI)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type GitState = "modified" | "untracked" | "staged" | "committed";

/** Chạy git status --porcelain, parse thành map path → state. */
export async function gitStatusMap(cwd: string): Promise<Map<string, GitState>> {
  const map = new Map<string, GitState>();
  try {
    const { stdout } = await execFileP("git", ["status", "--porcelain"], { cwd, timeout: 5000 });
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const xy = line.slice(0, 2);
      const path = line.slice(3).trim();
      if (xy === "??") map.set(path, "untracked");
      else if (xy.includes("A") || xy.includes("M") && xy[1] === " ") map.set(path, "staged");
      else if (xy[0] === " " && (xy[1] === "M" || xy[1] === "D")) map.set(path, "modified");
      else if (xy[0] !== " " && xy[0] !== "?") map.set(path, "staged");
    }
  } catch { /* không có git repo → mọi file committed */ }
  return map;
}

export interface GitAnnotatedHit { path: string; git: GitState }

/** Gắn git status vào hits; agent ưu tiên modified/untracked/staged. */
export function annotateGit(hits: string[], status: Map<string, GitState>): GitAnnotatedHit[] {
  return hits.map(path => ({
    path,
    git: status.get(path) ?? "committed",
  }));
}

/** Lọc theo git state: agent muốn "file đang sửa" → modified/untracked/staged. */
export function filterByGit(hits: GitAnnotatedHit[], wanted: GitState[]): GitAnnotatedHit[] {
  const set = new Set(wanted);
  return hits.filter(h => set.has(h.git));
}
// Usage:
// const status = await gitStatusMap(cwd);
// const hits = annotateGit(searchResults, status);
// const active = filterByGit(hits, ["modified", "untracked", "staged"]);
// → agent thấy ngay file đang thay đổi tích cực
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent ưu tiên đúng (file đang sửa là thông tin mới nhất) | ❌ Git dependency (repo không git → mọi file committed) |
| ✅ Không chạy git mỗi lần (worker nền cập nhật map) | ❌ Status stale (git status chạy định kỳ → lệch giữa các lần) |
| ✅ Filter rõ (modified/untracked/staged — agent chọn được) | ❌ Porcelain parse fragile (rename/conflict status phức tạp) |
| ✅ Zero LLM cost (git status thuần, không model) | ❌ Submodule/large repo chậm (git status trên repo khổng lồ) |

## Khác các hướng gần

| | Không git tag | Chạy git status trong prompt | ABI: Git-Aware Annotation |
|---|---|---|---|
| Chi phí | 0 | tốn tool call mỗi lần | **worker nền 1 lần** |
| Ưu tiên | không | agent tự đọc | **tag sẵn, lọc được** |
| Độ tươi | — | mới | **định kỳ (có thể stale nhẹ)** |

## Khi nào chọn

- Agent hay cần biết "dự án đang ở trạng thái nào" (file đang sửa, mới thêm, staged)
- Muốn ưu tiên file hoạt động tích cực mà không tốn tool call mỗi lần
- Đã có search-index (packages/tools) — chỉ thêm worker + tag
- Nối packages/tools search-index.ts + find.ts + packages/print launcher.ts; guard status-freshness (worker chạy định kỳ + trigger sau mutation), porcelain-parse-robust (xử lý rename/conflict), và repo-boundary (không git → tất cả committed, không crash); ABI = git-aware annotations, kết hợp 739 ABK background-watcher-index (worker nền cập nhật index real-time) + 745 ABQ process-registry-safety-net (dọn worker khi shutdown)
