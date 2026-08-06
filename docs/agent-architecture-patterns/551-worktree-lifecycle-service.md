# Hướng UE: Worktree Lifecycle Service — báo conflict prediction, stale days, cleanup plan cho multi-worktree agents

> **Nguồn gốc:** ECC `worktree-lifecycle.js` (git worktree management, conflict prediction, stale detection, cleanup planning); "agents working in parallel worktrees", "predict merge conflicts", "detect stale worktrees", "cleanup plan" | **Coupling:** 🟡 — thêm worktree-lifecycle service vào collab/sync | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (git ops + sync sẵn — chưa có worktree tracking + conflict prediction + stale + cleanup) | **Effort:** 3-4 tuần

## Nguồn gốc

**ECC** `worktree-lifecycle.js` phục vụ **multi-agent song song**: nhiều agent làm việc trên **git worktree** riêng (mỗi agent 1 worktree branch độc lập). Khi nhiều worktree chạy song song, vấn đề: (1) **Conflict prediction** — agent A và B cùng edit file → predict sẽ conflict khi merge. (2) **Stale detection** — worktree không hoạt động N ngày → stale (bỏ hoang, chi phí disk). (3) **Cleanup plan** — worktree stale hoặc đã merge → cleanup (delete worktree + branch). Service dựng **báo cáo lifecycle**: mỗi worktree có status (active/stale/merged), conflict-risk (file overlap với worktree khác), cleanup recommendation. Nguyên tắc: **worktree không mồ côi** — track, predict conflict, dọn stale.

## Mô tả

mya worktree lifecycle service: (1) **Worktree registry**: track mỗi worktree (path, branch, last-active, owner-agent). (2) **Conflict prediction**: so edit-set (file đã sửa) giữa worktree → predict overlap → conflict-risk. (3) **Stale detection**: last-active + N ngày → stale. (4) **Cleanup plan**: stale/merged → recommend delete (worktree + branch). mya có git ops + collab — UE thêm **worktree-registry** + **conflict-predictor** + **stale-detector** + **cleanup-planner**.

## Kiến trúc

```
  MULTI-WORKTREE (agent A, B, C song song)
        │
        ▼
  ┌─── WORKTREE REGISTRY ───────────────────────────────────┐
  │  wt-A: branch feat-a, active, files=[parser.rs, lex.rs]  │
  │  wt-B: branch feat-b, active, files=[parser.rs, ast.rs]  │
  │  wt-C: branch feat-c, stale 5d, files=[README.md]        │
  └───────────────────────┬─────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
  ┌─── CONFLICT ───┐ ┌─── STALE ───┐ ┌─── CLEANUP ──────────┐
  │ A∩B: parser.rs │ │ C: 5d stale │ │ C → DELETE (stale)   │
  │ → HIGH RISK    │ │ → flag      │ │ A,B → KEEP (active)  │
  │ (cùng file)    │ │             │ │ merged branch → PRUNE│
  └────────────────┘ └─────────────┘ └──────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/collab — multi-agent collab (nền — UE worktree ở đây)
// ✅ packages/sync — sync layer (nền — UE merge/conflict)
// ✅ packages/tools hashline-edit.ts — file edit (nền — UE track edit-set)
// ✅ packages/agent subagent.ts — subagent (nền — UE track owner)

// ❌ THIẾU: worktree-registry (path/branch/last-active/owner tracking)
// ❌ THIẾU: conflict-predictor (edit-set overlap → risk)
// ❌ THIẾU: stale-detector (last-active + N days)
// ❌ THIẾU: cleanup-planner (stale/merged → delete recommendation)
```

## Implementation

```typescript
// packages/collab/src/worktree-lifecycle.ts (MỚI)
interface Worktree {
  path: string; branch: string; lastActive: number;
  owner: string; files: string[]; merged: boolean;
}
type Risk = 'none' | 'low' | 'high';

class WorktreeLifecycle {
  private trees: Worktree[] = [];
  constructor(private now: () => number, private staleDays: number) {}

  register(wt: Worktree): void { this.trees.push(wt); }

  // predict conflict: worktree overlap file-set → risk
  predictConflicts(): { a: string; b: string; risk: Risk; files: string[] }[] {
    const out: { a: string; b: string; risk: Risk; files: string[] }[] = [];
    for (let i = 0; i < this.trees.length; i++) {
      for (let j = i + 1; j < this.trees.length; j++) {
        const overlap = this.trees[i].files.filter(f => this.trees[j].files.includes(f));
        if (overlap.length > 0)
          out.push({ a: this.trees[i].branch, b: this.trees[j].branch, risk: 'high', files: overlap });
      }
    }
    return out;
  }

  // detect stale worktrees
  detectStale(): Worktree[] {
    const cutoff = this.now() - this.staleDays * 86_400_000;
    return this.trees.filter(w => w.lastActive < cutoff && !w.merged);
  }

  // cleanup plan: stale or merged → recommend delete
  cleanupPlan(): { worktree: Worktree; reason: string; action: string }[] {
    const stale = this.detectStale();
    const plan: { worktree: Worktree; reason: string; action: string }[] = [];
    for (const w of stale) plan.push({ worktree: w, reason: `stale ${Math.round((this.now() - w.lastActive) / 86_400_000)}d`, action: 'DELETE' });
    for (const w of this.trees.filter(t => t.merged)) plan.push({ worktree: w, reason: 'merged', action: 'PRUNE-BRANCH' });
    return plan;
  }
}

// Usage:
// lifecycle.register({path:'wt-A', branch:'feat-a', lastActive:now(), owner:'agentA', files:['parser.rs'], merged:false});
// lifecycle.predictConflicts() → [{a:'feat-a', b:'feat-b', risk:'high', files:['parser.rs']}]
// lifecycle.cleanupPlan() → [{worktree:wtC, reason:'stale 5d', action:'DELETE'}]
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Predict conflict sớm (file overlap → cảnh báo trước merge) | ❌ Edit-set tracking overhead (mỗi file-change record) |
| ✅ Dọn stale worktree (giải phóng disk/branch) | ❌ Conflict false-positive (edit cùng file nhưng khác hàm) |
| ✅ Cleanup plan rõ (DELETE/PRUNE recommendation) | ❌ Stale false-positive (long-running task đúng là im) |
| ✅ Multi-agent aware (track owner-agent) | ❌ Cleanup destructive (xóa nhánh chưa merge → mất code) |

## Khác các hướng gần

| | Manual worktree mgmt | Sync auto-merge | UE: Lifecycle-Service |
|---|---|---|---|
| Cái gì | User tự quản worktree | Tự merge khi sync | **Track + predict + stale + cleanup** |
| Conflict predict | ❌ | ❌ (merge rồi mới biết) | **✅ file-overlap pre-merge** |
| Stale cleanup | ❌ | ❌ | **✅ N-day detection** |

## Khi nào chọn

- Nhiều agent/subagent chạy song song trên worktree riêng
- Cần predict conflict trước khi merge (không đợi merge fail)
- Worktree hay bị bỏ hoang → cần dọn stale
- Nối packages/collab + packages/sync + packages/tools hashline-edit.ts + packages/agent subagent.ts; guard conflict-precision (edit-set overlap → check có cùng hàm không, không chỉ file), stale-tolerance (long-running task không flag nhầm), và cleanup-safety (không xóa branch chưa merge — verify merged trước DELETE); UE = worktree lifecycle service, kết hợp 547 UA memory-persistence (worktree state persist) + packages/sync (merge layer)
