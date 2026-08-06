# Hướng YC: Throttled Repo Cache — skills/librarian cache git repo tại `~/.cache/checkouts/<host>/<org>/<repo>` với partial clone `--filter=blob:none`, refresh 300s, fast-forward khi sạch — tái dùng local copy thay clone lại (skills/librarian/SKILL.md)

> **Nguồn gốc:** agent-stuff (skills/librarian/SKILL.md) | **Coupling:** 🟡 — thêm cache layer cho tool clone repo | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có fetch + path-safety — chưa có repo cache) | **Effort:** 2-3 tuần

## Nguồn gốc

**agent-stuff** skill **librarian** quản lý thư viện repo: mỗi repo được cache tại **`~/.cache/checkouts/<host>/<org>/<repo>`** — tái dùng local copy thay vì clone lại từ đầu mỗi lần. Clone bằng **partial clone `--filter=blob:none`** (chỉ lấy tree + commit metadata, blob tải lazy khi cần) → clone nhanh, tốn ít băng thông. **Refresh 300s**: nếu cache cũ hơn 5 phút → `git fetch` làm mới. **Fast-forward khi sạch**: nếu local không có commit lạ → `git merge --ff-only` cập nhật, không tạo merge commit. Mục tiêu: agent tra cứu nhiều repo mà không tốn thời gian clone lại.

## Mô tả

mya áp dụng throttled-repo-cache: tool đọc repo (ví dụ skill library, reference repo) đi qua **librarian**: (1) resolve cache path theo host/org/repo; (2) chưa có → partial clone `--filter=blob:none` (blob lazy); (3) có nhưng cũ > 300s → `git fetch`; (4) fetch xong → `git merge --ff-only` nếu local sạch (không commit lạ); (5) dirty local → giữ nguyên + báo (không force). Đọc file trong repo → `git show`/đọc worktree với blob lazy-fetch. mya có sẵn tools/fetch.ts (tải URL), path-safety (đường dẫn an toàn), tools/web/bounded-search — YC thêm **cache layout** + **refresh policy** + **ff-only merge**.

## Kiến trúc

```
  Agent cần repo: github.com/org/repo
       │
       ▼
  ~/.cache/checkouts/github.com/org/repo
       │
       ├─ chưa có ──► partial clone --filter=blob:none (nhanh, blob lazy)
       ├─ có, cũ > 300s ──► git fetch (refresh)
       │        │
       │        ▼
       │   local sạch? ──► git merge --ff-only (cập nhật, không merge commit)
       │   dirty? ──► giữ nguyên + warn (không force)
       ▼
  Đọc file: git show <rev>:<path> (blob lazy-fetch khi cần)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools fetch.ts — tải URL (nền — YC fallback khi không git)
// ✅ packages/tools path-safety.ts — sanitize đường dẫn (nền — YC host/org/repo → path)
// ✅ packages/tools/web/bounded-search — search bị giới hạn (nền — YC query trong cache)
// ✅ packages/core time.ts — nowWallclock (nền — YC refresh 300s tính giờ)

// ❌ THIẾU: repo cache layout (~/.cache/checkouts/<host>/<org>/<repo>)
// ❌ THIẾU: partial clone + refresh policy (300s)
// ❌ THIẾU: ff-only merge + dirty handling
```

## Implementation (TS)

```typescript
// packages/tools/src/repo-cache.ts (MỚI)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const run = promisify(execFile);
const REFRESH_MS = 300_000; // 5 phút

export interface RepoRef { host: string; org: string; repo: string; }

export class RepoCache {
  private root = join(homedir(), ".cache", "checkouts");
  private path(r: RepoRef): string {
    const seg = (s: string) => s.replace(/[\/\\]/g, "_"); // sanitize segment
    return join(this.root, seg(r.host), seg(r.org), seg(r.repo));
  }
  private async ageMs(dir: string): Promise<number> {
    try { const s = await stat(dir); return Date.now() - s.mtimeMs; } catch { return Infinity; }
  }

  async ensure(r: RepoRef, remoteUrl: string): Promise<string> {
    const dir = this.path(r);
    await mkdir(dir, { recursive: true });
    if ((await ageMs(dir)) === Infinity) {
      await run("git", ["clone", "--filter=blob:none", "--no-checkout", remoteUrl, dir]); // partial clone
      return dir;
    }
    if ((await ageMs(dir)) > REFRESH_MS) {
      await run("git", ["-C", dir, "fetch", "origin"]); // refresh 300s
      try { await run("git", ["-C", dir, "merge", "--ff-only", "origin/HEAD"]); } // sạch → ff
      catch { /* dirty local → giữ nguyên, không force */ }
    }
    return dir;
  }

  async readFile(r: RepoRef, pathInRepo: string): Promise<string> {
    const dir = await this.ensure(r, `https://${r.host}/${r.org}/${r.repo}.git`);
    const { stdout } = await run("git", ["-C", dir, "show", `HEAD:${pathInRepo}`]);
    return stdout; // blob lazy-fetch tại thời điểm đọc
  }
}

// Usage:
// const cache = new RepoCache();
// const dir = await cache.ensure({ host: "github.com", org: "VoltAgent", repo: "awesome-agent-skills" }, "https://github.com/VoltAgent/awesome-agent-skills.git");
// const md = await cache.readFile({ host: "github.com", org: "VoltAgent", repo: "awesome-agent-skills" }, "README.md");
```

## Được

- ✅ Clone một lần, tái dùng mãi — không tốn thời gian clone lại
- ✅ Partial clone nhanh — blob:none giảm băng thông khởi đầu
- ✅ Refresh có nhịp — 300s cân bằng giữa cũ và fetch liên tục
- ✅ ff-only an toàn — không tạo merge commit, không force mất commit local
- ✅ Cache layout deterministic — host/org/repo → path ổn định

## Mất

- ❌ Blob lazy-fetch — đọc nhiều file lần đầu vẫn phải tải từng blob
- ❌ Dirty local — agent sửa trong cache → ff-only fail, cần xử lý thủ công
- ❌ Disk usage — cache nhiều repo lớn, cần GC theo tuổi/kích thước

## Khác các hướng gần

| | Clone mỗi lần | npm registry cache | YC: Repo Cache |
|---|---|---|---|
| Chi phí lặp | cao (clone đủ) | cao (tải lại) | **thấp (ff-only)** |
| Freshness | luôn mới | theo TTL | **300s refresh** |
| Local edit | không | không | **ff-only (dirty giữ)** |

## Khi nào chọn

- Agent thường xuyên đọc nhiều repo (skill library, reference, docs)
- Muốn tra cứu nhanh mà vẫn cập nhật (không stale vĩnh viễn)
- Có fetch + path-safety sẵn — YC thêm cache layout + git ops
- Nối packages/tools fetch.ts (fallback không git) + path-safety.ts (segment sanitize) + core/time.ts (refresh window); guard segment-sanitize (host/org/repo không path traversal — test), ff-only-strict (dirty local không force — báo lỗi), và cache-gc (repo cũ/thư mục lớn dọn theo policy); YC = repo cache, kết hợp 652 YB file-backed-todo (cùng tư tưởng file-local cache) + 663 YM badge-category-curation (librarian đọc awesome-list từ cache)
