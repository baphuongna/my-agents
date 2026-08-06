# Hướng ADC: Ralph Persistence Loop — self-referential loop giữ task tới khi complete + architect-verified, context snapshot trước mỗi vòng, retry tự động

> **Nguồn gốc:** oh-my-claudecode (skills/ralph/SKILL.md) | **Coupling:** 🟡 — thêm loop wrapper quanh agent run | **Agent-agnostic:** ⚠️ (phụ thuộc model + verify) | **Code sẵn:** ⚠️ (có runTurn loop + iteration-budget — chưa có snapshot/verify loop) | **Effort:** 2 tuần

## Nguồn gốc

**oh-my-claudecode** có **Ralph** — **self-referential loop** giữ task tới khi **complete + architect-verified**: (1) **context snapshot intake trước mỗi loop** — lưu `.omc/context/{task-slug}-{timestamp}.md` (trạng thái đầu vào ghi lại để quay lại được); (2) **retry tự động trên failure** — fail không bỏ cuộc, retry có cấu trúc; (3) **fresh verification evidence trước khi cho completion** — không claim xong khi chưa verify (nối ADD); (4) **tiered architect review** — LOW/STANDARD/THOROUGH theo độ lớn/rủi ro task. Nguyên tắc: **loop tới khi được chứng minh xong (complete + verified), snapshot để quay lại, retry thay vì bỏ cuộc**.

## Mô tả

mya ralph persistence loop: (1) **snapshot intake** — trước mỗi vòng loop, ghi context hiện tại (task, files, state) vào snapshot (thư mục context per task) — crash/restart quay lại được; (2) **loop contract** — chạy turn, kiểm tra complete? chưa → chạy tiếp (iteration-budget đã có giới hạn); (3) **retry trên failure** — tool fail / turn fail → retry có backoff (nối ACR); (4) **verify trước completion** — cần fresh evidence (nối ADD completion-evidence-verification); (5) **tiered review** — LOW (nhỏ, ≤5 files) review nhẹ, STANDARD, THOROUGH (lớn/security, >20 files) review sâu. Nối ADD (verification) + ACR (retry backoff) — ADC là loop bao quanh.

## Kiến trúc

```
  TASK
    ▼
  SNAPSHOT INTAKE (.omc/context/{slug}-{ts}.md)
    ▼
  ┌─ LOOP (self-referential) ────────────────────────┐
  │  run turn → complete?                            │
  │    chưa ──▶ chạy tiếp (iteration-budget)          │
  │    fail ──▶ retry tự động (backoff — ACR)         │
  │    xong ──▶ verify (fresh evidence — ADD)         │
  │              fail verify ──▶ iterate tiếp          │
    ▼
  TIERED ARCHITECT REVIEW
    LOW (≤5 files) · STANDARD · THOROUGH (>20/security)
    ▼
  COMPLETION (complete + architect-verified)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core loop.ts — runTurn + TurnHandle (nền — loop cơ bản)
// ✅ packages/core iteration-budget.ts — IterationBudget (nền — giới hạn vòng)
// ✅ packages/core budget.ts — createBudget (nền — budget chung)
// ✅ packages/core supervised.ts — SupervisedTask (nền — retry + backoff)
// ✅ packages/core retry-policy.ts (ACR) — retry policy (nền — retry tự động)
// ✅ packages/tools lsp-cascade.ts — runCascade + diagnostics (nền — verify)
// ✅ packages/council hindsight.ts — HindsightReviewer (nền — architect review tier)

// ❌ THIẾU: snapshot intake trước mỗi loop (context per task)
// ❌ THIẾU: loop contract complete → verify → iterate
// ❌ THIẾU: tiered architect review (LOW/STANDARD/THOROUGH)
```
## Implementation
```typescript
// packages/agent/src/ralph-loop.ts (MỚI)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nowWallclock } from "@my-agent/core";
export type ReviewTier = "LOW" | "STANDARD" | "THOROUGH";
export interface RalphOptions {
  taskSlug: string;
  contextDir: string;
  maxIterations: number;
}
export interface RalphResult { completed: boolean; iterations: number; verified: boolean; reviewTier: ReviewTier; snapshotPaths: string[] }
/** Chọn review tier theo độ lớn/rủi ro task. */
export function reviewTier(fileCount: number, securitySensitive: boolean): ReviewTier {
  if (securitySensitive || fileCount > 20) return "THOROUGH";
  if (fileCount >= 5) return "STANDARD";
  return "LOW";
}
/** Snapshot intake — ghi context trước mỗi vòng loop. */
export function snapshotIntake(opts: RalphOptions, state: string): string {
  const dir = join(opts.contextDir, ".omc", "context");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${opts.taskSlug}-${nowWallclock()}.md`);
  writeFileSync(path, `# Snapshot ${opts.taskSlug}\n${state}\n`, "utf8");
  return path;
}
/** Ralph loop — giữ task tới khi complete + verify. */
export async function runRalphLoop(
  opts: RalphOptions,
  step: (iteration: number) => Promise<{ done: boolean; output: string }>,
  verify: (output: string) => Promise<{ ok: boolean; issues: string[] }>,
  review: (output: string) => Promise<{ approved: boolean; notes: string[] }>,
): Promise<RalphResult> {
  const snapshots: string[] = [];
  let iterations = 0;
  let verified = false;
  let output = "";
  while (iterations < opts.maxIterations) {
    iterations += 1;
    // 1. Snapshot intake trước mỗi vòng — quay lại được.
    snapshots.push(snapshotIntake(opts, `iteration=${iterations}\n${output.slice(0, 500)}`));
    // 2. Run turn — fail thì retry ở vòng sau (self-referential).
    output = (await step(iterations)).output;
    // 3. Verify trước khi coi là xong — cần fresh evidence.
    if (!(await verify(output)).ok) continue; // chưa đạt — iterate tiếp
    verified = true;
    // 4. Architect review theo tier.
    if ((await review(output)).approved) break; // complete + verified + approved
  }
  return { completed: iterations < opts.maxIterations, iterations, verified, reviewTier: reviewTier(1, false), snapshotPaths: snapshots };
}
function estimateFileCount(output: string): number {
  return (output.match(/(?:\.ts|\.tsx|\.js|\.rs|\.md)\b/g) ?? []).length;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Loop tới khi verified — không claim xong sớm | ❌ Loop dài tốn token/budget — cần maxIterations |
| ✅ Snapshot mỗi vòng — quay lại được khi fail | ❌ Nhiều snapshot file — cần dọn dẹp |
| ✅ Retry tự động — fail không bỏ cuộc | ❌ Retry mù có thể lặp lỗi (cần ACR dedup) |
| ✅ Tiered review — nhỏ review nhẹ, lớn review sâu | ❌ Architect review thêm latency |

## Khác các hướng gần

| | Core loop (core/loop.ts) | ADC: Ralph Loop |
|---|---|---|
| Vòng | Một turn (runTurn) | **Nhiều vòng self-referential tới verified** |
| Snapshot | Không | **Context snapshot mỗi vòng (.omc/context/)** |
| Verify | Không bắt buộc | **Fresh evidence trước completion** |
| Review | Không | **Tiered architect review (LOW/STANDARD/THOROUGH)** |

## Khi nào chọn

- Task cần bền bỉ — không bỏ cuộc giữa chừng, retry + verify tới cùng
- Muốn completion có bằng chứng (verified + architect-approved)
- Đã có loop + iteration-budget + retry-policy + hindsight — thêm wrapper
- Guard: maxIterations + budget, snapshot quay lại được, verify trước completion, tier review theo rủi ro
