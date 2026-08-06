# Hướng VW: Finalize Independent Branches — finalize tách các branch experiment nhiễu thành branch độc lập không shared file, từ merge-base review riêng

> **Nguồn gốc:** pi-autoresearch (finalize independent branches); "finalize splits noisy experiment branches into independent branches"; "no shared files between branches"; "review from merge-base independently"; "clean isolation per experiment" | **Coupling:** 🟡 — thêm branch-isolation finalize vào experiment loop cleanup | **Agent-agnostic:** ⚠️ (cần git branch model cụ thể) | **Code sẵn:** ⚠️ (git ops sẵn — chưa có independent-branch finalize) | **Effort:** 2 tuần

## Nguồn gốc

**pi-autoresearch** chạy nhiều **experiment branch** song song/tuần tự — mỗi branch sửa code khác nhau. Vấn đề: branch **chia sẻ file** (cùng sửa `src/optimize.ts`) → **merge conflict** + review lẫn lộn (không biết thay đổi nào thuộc experiment nào). Giải pháp **finalize independent branches**: khi **finalize** (kết thúc experiment), **tách mỗi experiment thành branch độc lập** — **không shared file** (mỗi branch chạm file riêng), **review từ merge-base** (so với điểm phân nhánh gốc, không so branch khác). Nguyên tắc: **isolation per experiment** — mỗi experiment là 1 branch sạch, review độc lập. Khác shared-branch (nhiều experiment trên 1 branch) — VW **one-experiment-one-branch**.

## Mô tả

mya finalize independent branches: (1) **Track experiments**: mỗi experiment có branch riêng + file set riêng (no overlap). (2) **Finalize trigger**: khi experiment hoàn thành (keep decision) → finalize. (3) **Isolation check**: verify branch không shared file với branch khác (conflict-free). (4) **Review from merge-base**: diff branch vs merge-base (điểm phân nhánh) — review thay đổi độc lập, không bị nhiễu branch khác. (5) **Merge hoặc archive**: merge branch sạch vào main, hoặc archive nếu không dùng. mya có git ops + session-branch — VW thêm **independent-branch finalize** + **merge-base review**.

## Kiến trúc

```
  EXPERIMENT BRANCHES (từ merge-base)
                 merge-base (abc123)
                /        |         \
        exp/cache     exp/algo    exp/parallel
        (file A)      (file B)    (file C)
        không overlap nhau (no shared file)

  FINALIZE (kết thúc experiment):
  ┌─── ISOLATION CHECK ─────────────────────────────────────┐
  │  exp/cache chạm: {src/A.ts}                               │
  │  exp/algo  chạm: {src/B.ts}                               │
  │  → NO overlap → isolation OK                              │
  │  (nếu overlap → warn conflict, không finalize)            │
  └───────────────┬─────────────────────────────────────────┘
                  ▼
  ┌─── REVIEW FROM MERGE-BASE ──────────────────────────────┐
  │  git diff merge-base..exp/cache → chỉ thấy thay đổi A    │
  │  (không bị nhiễu exp/algo, exp/parallel)                 │
  │  → review độc lập, merge sạch                             │
  └───────────────┬─────────────────────────────────────────┘
                  ▼
  ┌─── MERGE / ARCHIVE ─────────────────────────────────────┐
  │  exp/cache (keep) → merge vào main                        │
  │  exp/algo (revert) → archive (xóa branch, giữ log)       │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core session-branch.ts — session branching (nền — VW branch = đây)
// ✅ packages/agent subagent.ts — subagent isolation (nền — VW relate)
// ✅ 589 VQ experiment-loop — experiment (relate — VW finalize experiment branch)
// ✅ packages/collab — collaboration (nền — VW merge relate)

// ❌ THIẾU: independent-branch finalize (tách experiment thành branch riêng)
// ❌ THIẾU: isolation check (no shared file giữa branch)
// ❌ THIẾU: merge-base review (diff từ merge-base, độc lập)
```

## Implementation

```typescript
// packages/agent/src/finalize-branches.ts (MỚI)
interface ExperimentBranch { name: string; files: Set<string>; mergeBase: string; decision: 'keep' | 'revert' }

class FinalizeIndependentBranches {
  constructor(private git: {
    mergeBase: (b: string) => string; diffFiles: (base: string, b: string) => string[];
    mergeBranch: (b: string) => void; deleteBranch: (b: string) => void;
  }) {}
  private branches: ExperimentBranch[] = [];
  register(branch: ExperimentBranch): void { this.branches.push(branch); }

  // isolation check: branch không shared file
  checkIsolation(): { ok: boolean; conflicts: string[] } {
    const conflicts: string[] = [];
    for (let i = 0; i < this.branches.length; i++) {
      for (let j = i + 1; j < this.branches.length; j++) {
        const a = this.branches[i]!;
        const b = this.branches[j]!;
        const overlap = [...a.files].filter(f => b.files.has(f));
        if (overlap.length > 0) conflicts.push(`${a.name} ∩ ${b.name}: ${overlap.join(', ')}`);
      }
    }
    return { ok: conflicts.length === 0, conflicts };
  }
  // review from merge-base: diff độc lập (không nhiễu branch khác)
  review(branchName: string): string[] {
    const branch = this.branches.find(b => b.name === branchName)!;
    return this.git.diffFiles(branch.mergeBase, branchName);
  }
  // finalize: isolation OK → merge keep / archive revert
  finalize(): { merged: string[]; archived: string[] } {
    const iso = this.checkIsolation();
    if (!iso.ok) throw new Error(`isolation violated: ${iso.conflicts.join('; ')}`);
    const merged: string[] = [];
    const archived: string[] = [];
    for (const b of this.branches) {
      if (b.decision === 'keep') { this.git.mergeBranch(b.name); merged.push(b.name); }
      else { this.git.deleteBranch(b.name); archived.push(b.name); }
    }
    return { merged, archived };
  }
}
// Usage:
// const fb = new FinalizeIndependentBranches(git);
// fb.register({name:'exp/cache', files:new Set(['src/A.ts']), mergeBase:'abc', decision:'keep'});
// fb.register({name:'exp/algo', files:new Set(['src/B.ts']), mergeBase:'abc', decision:'revert'});
// const r = fb.finalize();  // isolation check → merge cache, archive algo
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Clean isolation (mỗi experiment branch riêng, no conflict) | ❌ Branch sprawl (nhiều experiment → nhiều branch) |
| ✅ Independent review (merge-base diff, không nhiễu) | ❌ Merge complexity (nhiều branch → merge顺序) |
| ✅ Conflict-free (isolation check chặn shared file) | ❌ Overhead (quản lý file set per branch) |
| ✅ Selective merge (keep → merge, revert → archive) | ❌ File assignment (agent phải biết chạm file nào) |

## Khác các hướng gần

| | Shared branch | Sequential commit | VW: Independent-Branches |
|---|---|---|---|
| Branch | 1 (tất cả) | 1 (tuần tự) | **N (mỗi experiment 1)** |
| Shared file | ✅ (conflict) | ✅ (overwrite) | **❌ (isolation check)** |
| Review | Lẫn lộn | Toàn bộ | **merge-base (độc lập)** |

## Khi nào chọn

- Nhiều experiment song song cần review độc lập (không nhiễu)
- Muốn merge sạch (no conflict — mỗi branch file riêng)
- Cần selective finalize (keep → merge, revert → archive)
- Nối packages/core session-branch.ts + packages/agent subagent.ts + packages/collab + 589 VQ experiment-loop; guard file-tracking-accuracy (biết chính xác branch chạm file nào), merge-ordering (merge thứ tự tránh conflict downstream), và branch-pruning (dọn branch archive cũ); VW = finalize independent branches, kết hợp 589 VQ (experiment branch cần finalize) + packages/core session-branch (branch infrastructure sẵn)
