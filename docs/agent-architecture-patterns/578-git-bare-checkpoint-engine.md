# Hướng VF: Git-Bare Checkpoint Engine — mỗi turn đóng dấu snapshot trong bare git repo (có lock), khôi phục về turn bất kỳ

> **Nguồn gốc:** oh-my-pi (checkpoint engine); "per-turn snapshot in bare git repo"; "lock/concurrency guard"; "restore workspace to any turn"; "checkpoint = bare git commit" | **Coupling:** 🟡 — thêm bare-git checkpoint layer vào turn lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (bash git + session turn sẵn — chưa có bare-repo checkpoint + lock) | **Effort:** 3-4 tuần

## Nguồn gốc

**oh-my-pi** dùng **bare git repo** làm **checkpoint engine**: mỗi **turn** hoàn tất → workspace được **snapshot** (commit) vào một **bare repo** phụ (không phải repo user). Có **lock/concurrency guard** (nhiều turn/checkpoint song song không giẫm nhau). Workspace có thể **khôi phục về bất kỳ turn nào** (checkout snapshot đó). Nguyên tắc: **mỗi turn = 1 checkpoint** — timeline đầy đủ, rollback chọn lọc. Bare repo vì không chứa working tree (chỉ objects), nhẹ + không xung đột working dir. Khác **auto-commit user repo** (lộn xộn history) — VF **bare repo riêng, tách biệt**; khác session-restore thuần — VF **snapshot cả file state**.

## Mô tả

mya git-bare checkpoint engine: (1) **Bare repo init**: khởi tạo bare repo checkpoint (vd `.mya/checkpoints.git`) tại workspace. (2) **Per-turn snapshot**: mỗi turn kết thúc → stage workspace → commit vào bare repo (message chứa turn-id + timestamp). (3) **Lock guard**: checkpoint acquire **file lock** trước khi git add/commit (chống concurrent write). (4) **Restore**: `restore(turnId)` → checkout tree của commit đó về working dir. (5) **List**: liệt kê timeline (turn → commit) để user chọn rollback. mya có bash git + session turn — VF thêm **bare-repo manager** + **lock guard** + **per-turn committer**.

## Kiến trúc

```
  WORKSPACE (code files)        BARE REPO (.mya/checkpoints.git)
        │                              │
  turn #1 done ──(acquire lock)──▶ git add + commit → commit aaa
        │                       ──(release lock)          │
  turn #2 done ──(acquire lock)──▶ git add + commit → commit bbb
        │                       ──(release lock)          │
  turn #3 done ──(acquire lock)──▶ git add + commit → commit ccc
        │                                                  │
        ▼                                                  ▼
  ┌─── RESTORE turn #2 ───────────────────────────────────┐
  │  git checkout bbb -- .  → workspace = state tại #2     │
  │  (rollback code về checkpoint turn 2)                   │
  └───────────────────────────────────────────────────────┘

  LOCK GUARD: checkpoint song song → acquire cùng file lock →
              chỉ 1 commit tại lúc (không giẫm/concurrent corrupt)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools bash — git command (nền — VF = bare git)
// ✅ session turn tracking — turn-id (nền — VF tag commit)
// ✅ 579 split-scope-restore — restore scope (relate — VF = engine)

// ❌ THIẾU: bare-repo manager (init + commit + checkout)
// ❌ THIẾU: file lock guard (chống concurrent checkpoint)
// ❌ THIẾU: per-turn committer (turn-id → commit message)
// ❌ THIẾU: timeline list + restore API
```

## Implementation

```typescript
// packages/agent/src/git-checkpoint.ts (MỚI)
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

class GitBareCheckpoint {
  private locked = false;
  constructor(
    private bare: string,        // .mya/checkpoints.git
    private workdir: string,
    private lockPath: string,
    private now: () => number,
  ) {}

  private sh(cmd: string): string {
    return execSync(cmd, { cwd: this.workdir, encoding: 'utf8' }).trim();
  }

  init(): void { if (!existsSync(this.bare)) this.sh(`git init --bare "${this.bare}"`); }

  // lock guard (cooperative)
  private acquire(): boolean { if (this.locked) return false; this.locked = true; return true; }
  private release(): void { this.locked = false; }

  // checkpoint per turn
  snapshot(turnId: string): string {
    if (!this.acquire()) throw new Error('checkpoint busy (lock held)');
    try {
      this.sh(`git --git-dir="${this.bare}" --work-tree="${this.workdir}" add -A`);
      this.sh(`git --git-dir="${this.bare}" --work-tree="${this.workdir}" ` +
        `commit -m "checkpoint turn ${turnId} @ ${this.now()}" --allow-empty`);
      return this.sh(`git --git-dir="${this.bare}" rev-parse HEAD`);
    } finally { this.release(); }
  }

  // list timeline (turn commits)
  timeline(): Array<{ commit: string; subject: string }> {
    const log = this.sh(`git --git-dir="${this.bare}" log --format='%H%x09%s'`);
    return log.split('\n').filter(Boolean).map(l => {
      const [commit, subject] = l.split('\t');
      return { commit, subject: subject! };
    });
  }

  // restore workspace to a checkpoint
  restore(commit: string): void {
    this.sh(`git --git-dir="${this.bare}" --work-tree="${this.workdir}" checkout ${commit} -- .`);
  }
}

// Usage:
// cp.init();
// const c1 = cp.snapshot('turn-1');
// ...user edits...
// cp.snapshot('turn-2');
// cp.restore(c1);  // rollback code về turn 1
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Timeline đầy đủ (mỗi turn 1 snapshot) | ❌ Storage phình (nhiều commit, objects) |
| ✅ Rollback chọn lọc (về turn bất kỳ) | ❌ Lock contention (checkpoint song song chậm) |
| ✅ Bare repo tách biệt (không lộn user history) | ❌ Binary/large-file cost (git không hợp file lớn) |
| ✅ Concurrency-safe (lock guard) | ❌ Restore xung đột working dir (uncommitted change) |

## Khác các hướng gần

| | Auto-commit user repo | Session-restore | VF: Git-Bare-Checkpoint |
|---|---|---|---|
| Đâu | User repo (lộn history) | Memory only | **Bare repo riêng** |
| Snapshot | File + history lẫn | Chỉ conversation | **Cả file state** |
| Concurrency | ❌ | ❌ | **✅ lock guard** |

## Khi nào chọn

- Cần rollback code về turn bất kỳ (undo phá code)
- Muốn timeline đầy đủ, tách biệt user repo
- Có checkpoint song song (multi-agent/parallel turn) → cần lock
- Nối packages/tools bash git + session turn + 579 split-scope-restore; guard lock correctness (không deadlock), storage (prune checkpoint cũ / gc), và restore safety (warn uncommitted change trước restore); VF = git-bare checkpoint engine, kết hợp 579 split-scope-restore (chọn scope restore) + 580 nested-repo-boundary (loại trừ repo lồng khỏi snapshot)
