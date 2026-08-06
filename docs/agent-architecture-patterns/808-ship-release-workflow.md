# Hướng AEB: Ship Release Workflow — chuẩn hóa release path bằng lệnh /ship

> **Nguồn gốc:** gstack | **Coupling:** 🟡 — gắn git + test + version + PR | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn eval + audit; thiếu ship CLI) | **Effort:** 1-2 tuần

## Nguồn gốc

**gstack** có **`/ship`** chuẩn hóa toàn bộ release path: **detect + merge base branch → run tests → review diff → bump VERSION → update CHANGELOG → commit → push → tạo PR**. Kèm **workspace-aware version queue** (version bump theo thứ tự, biết workspace nào đang giữ version nào) và **`/landing-report`** dashboard read-only (xem trạng thái release, không sửa được).

Pattern là **release checklist được thực thi bằng lệnh**: không phải con người nhớ từng bước mà là một pipeline có thứ tự bắt buộc — test phải pass trước khi bump version, diff phải được review trước khi commit. `landing-report` read-only đảm bảo dashboard không bị agent sửa nhầm.

## Mô tả

Với mya, ship pipeline nằm trong `packages/workflows` (runner đã có) hoặc CLI riêng: các bước là stage có gate (nối ADH acceptance — test pass là criterion bắt buộc). `packages/eval` chạy test tiers; `packages/audit` ghi từng bước ship; version bump + CHANGELOG qua `packages/tools` hashline-edit (an toàn, có verify). Workspace-aware queue: `packages/memory` lưu version per workspace. Landing-report: `packages/print` render read-only — không có tool write path. Gap: chưa có pipeline ship + version queue.

## Kiến trúc (ASCII)

```
  /ship ──► PIPELINE (thứ tự bắt buộc, gate mỗi bước)
    1. detect + merge base branch (git)
    2. run tests ──► PASS mới đi tiếp (nối eval tiers)
    3. review diff (human hoặc agent review)
    4. bump VERSION (workspace-aware version queue)
    5. update CHANGELOG
    6. commit → push
    7. tạo PR
            │
            ▼
  /landing-report (dashboard READ-ONLY)
    ├─ xem trạng thái release
    └─ KHÔNG có write path — không sửa được nhầm
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows — runner + WorkflowContext (nền ship pipeline)
// ✅ packages/eval — tiers (chạy tests — gate step 2)
// ✅ packages/audit — AuditLog (ghi từng bước ship)
// ✅ packages/tools/src/hashline-edit.ts — edit có verify (bump VERSION/CHANGELOG an toàn)
// ✅ packages/memory — SQLite (version queue per workspace)
// ✅ packages/print — render (landing-report dashboard)

// ❌ THIẾU: ship pipeline (7 bước có gate)
// ❌ THIẾU: workspace-aware version queue
// ❌ THIẾU: landing-report read-only (không write path)
```

## Implementation

```typescript
// packages/workflows/src/ship.ts (NEW)
export interface ShipContext {
  baseBranch: string;
  workspace: string;           // version queue key
  versionFile: string;
  changelogFile: string;
  dryRun: boolean;
}

export async function ship(ctx: ShipContext, tools: ToolSet): Promise<ShipReport> {
  const steps: string[] = [];
  // 1. detect + merge base
  steps.push(await tools.git(`merge-base ${ctx.baseBranch} HEAD`));
  // 2. run tests — gate: PASS mới đi tiếp
  const test = await tools.eval("all");
  if (!test.ok) return { ok: false, steps, failedAt: "tests" };
  steps.push(`tests: ${test.passed}/${test.total}`);
  // 3. review diff (agent review hoặc human gate)
  const diff = await tools.git(`diff origin/${ctx.baseBranch}..HEAD`);
  const approved = ctx.dryRun ? true : await tools.approve("review diff", diff.slice(0, 4000));
  if (!approved) return { ok: false, steps, failedAt: "review" };
  // 4-5. bump VERSION + CHANGELOG (hashline-edit có verify)
  const next = nextVersion(ctx.workspace);           // workspace-aware queue
  await tools.edit(ctx.versionFile, bump(next));
  await tools.edit(ctx.changelogFile, prepend(next, ctx.workspace));
  // 6-7. commit → push → PR
  await tools.git(`commit -am "release ${next}" && push`);
  const pr = await tools.pr(`release ${next}`, diff);
  return { ok: true, steps: [...steps, `bump ${next}`, `PR #${pr.number}`] };
}

export function nextVersion(workspace: string): string {
  // version queue per workspace (packages/memory) — tăng theo thứ tự
  return bumpSemver(versionOf(workspace));
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Release không quên bước — pipeline bắt buộc | ❌ Pipeline cứng — release đặc biệt khó bypass |
| ✅ Gate test PASS trước bump | ❌ Review diff có thể chậm (human gate) |
| ✅ Version queue per workspace — hết lộn | ❌ Landing-report cần cập nhật thường xuyên |
| ✅ Audit từng bước — biết release fail ở đâu | ❌ Dry-run không test được bước thật |

## Khác các hướng gần

| | AEB Ship Workflow | ADN Story Verify | ADH Acceptance |
|---|---|---|---|
| Phạm vi | Release path | Story lifecycle | Per-task criteria |
| Gate | Test PASS + review | verify_command | Command/artifact |
| Output | PR + version bump | verify-all report | Turn closure |

## Khi nào chọn

- Release nhiều lần — cần pipeline chuẩn không quên bước
- Version phải bump theo workspace đúng thứ tự
- Đã có workflows + eval + hashline-edit — thêm ship pipeline
- Muốn dashboard read-only xem trạng thái release