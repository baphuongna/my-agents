# Hướng ACQ: Drift-Driven State Reconciliation — trước mỗi dispatch decision và worker spawn, reconcile phát hiện drift và repair idempotent

> **Nguồn gốc:** gsd-2 (docs/dev/ADR-017-state-reconciliation-drift-driven.md) | **Coupling:** 🟡 — thêm reconcile stage vào dispatch loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có durable-ack + conflict — chưa có drift reconcile pipeline) | **Effort:** 2 tuần

## Nguồn gốc

**gsd-2** chạy **`reconcileBeforeDispatch`** trước **mỗi dispatch decision và worker spawn**: pipeline **derive → detect drift → repair idempotent → re-derive** (cap **2 pass** — không lặp vô hạn). Mỗi **DriftRecord là discriminated union** mang **identifiers cho repair**: `stale-sketch-flag`, `unregistered-milestone`, `roadmap-divergence`, `missing-completion-timestamp`… — repair biết chính xác cần sửa gì. Quan trọng: **blocker terminal tách khỏi drift repairable** — có vấn đề chặn chết (không tự sửa được) khác với drift (sửa được bằng repair handler). Nguyên tắc: **state lệch là chuyện thường, repair idempotent + cap 2 pass, blocker ≠ drift**.

## Mô tả

mya drift-driven state reconciliation: (1) **derive** — dựng state mong đợi từ nguồn (milestones, worker status, completion); (2) **detect drift** — so với state thực tế, mỗi lệch là **DriftRecord** (discriminated union với identifiers); (3) **repair idempotent** — chạy repair handler theo kind, chạy lại nhiều lần ra cùng kết quả; (4) **re-derive + cap 2 pass** — sau repair derive lại, tối đa 2 pass tránh loop; (5) **terminal blocker ≠ drift** — blocker (permission, conflict không tự giải quyết) báo lên, không giả vờ repair. Nối ACT (drift catalog) — ACQ là pipeline, ACT là registry các drift kind.

## Kiến trúc

```
  DISPATCH DECISION / WORKER SPAWN
       ▼
  RECONCILE-BEFORE-DISPATCH
    ├─ DERIVE   — state mong đợi từ nguồn
    ├─ DETECT   — drift? ──▶ DriftRecord (discriminated union)
    ├─ REPAIR   — idempotent theo kind (chạy lại an toàn)
    └─ RE-DERIVE — cap 2 pass (hết pass → dừng, không loop)
       ├─ BLOCKER TERMINAL (không sửa được) ──▶ report, không dispatch
       └─ sạch ──▶ dispatch decision bình thường
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core durable-ack.ts — DurableAckTracker (nền — terminal/retry/deliver classification)
// ✅ packages/core laneboard.ts — classifyFreshness (nền — detect stale/stalled)
// ✅ packages/memory conflict.ts — checkAndResolveConflicts + supersede (nền — repair idempotent)
// ✅ packages/cron cross-process-lock.ts — acquireCronLock (nền — lock trước dispatch)
// ✅ packages/core supervised.ts — SupervisedTask (nền — retry/backoff sau fail)

// ❌ THIẾU: reconcileBeforeDispatch pipeline (derive→detect→repair→re-derive)
// ❌ THIẾU: DriftRecord discriminated union (kind + identifiers cho repair)
// ❌ THIẾU: cap 2 pass + terminal blocker tách khỏi drift repairable
```
## Implementation
```typescript
// packages/core/src/reconcile.ts (MỚI)
export type DriftKind =
  | "stale-sketch-flag"
  | "unregistered-milestone"
  | "roadmap-divergence"
  | "missing-completion-timestamp";
/** Discriminated union — mỗi drift mang identifiers cho repair. */
export type DriftRecord =
  | { kind: "stale-sketch-flag"; taskId: string; flag: string }
  | { kind: "unregistered-milestone"; milestoneId: string; roadmap: string }
  | { kind: "roadmap-divergence"; milestoneId: string; expected: string; actual: string }
  | { kind: "missing-completion-timestamp"; taskId: string };
export interface RepairResult {
  repaired: DriftRecord[];
  /** True nếu còn drift sau pass cuối — re-derive sẽ phát hiện. */
  stillDrifting: DriftRecord[];
}
export type RepairHandler = (drift: DriftRecord) => void;
const MAX_PASSES = 2;
/** Reconcile pipeline — derive → detect → repair → re-derive (cap 2 pass). */
export async function reconcileBeforeDispatch(
  detect: () => Promise<DriftRecord[]>,
  repair: RepairHandler,
  opts: { maxPasses?: number } = {},
): Promise<{ clean: boolean; repairedAll: DriftRecord[]; blocker?: string }> {
  const maxPasses = opts.maxPasses ?? MAX_PASSES;
  const repairedAll: DriftRecord[] = [];
  let drifting = await detect();
  let pass = 0;
  while (drifting.length > 0 && pass < maxPasses) {
    pass += 1;
    for (const d of drifting) repair(d);
    repairedAll.push(...drifting);
    drifting = await detect(); // re-derive — còn drift thì pass tiếp
  }
  if (drifting.length > 0) {
    // Hết cap — đây có thể là drift dai dẳng → coi như blocker nếu kind báo terminal.
    const terminal = drifting.find((d) => isTerminalBlocker(d));
    return {
      clean: false,
      repairedAll,
      blocker: terminal
        ? `blocker terminal: ${terminal.kind} (${JSON.stringify(terminal)})`
        : `còn ${drifting.length} drift sau ${maxPasses} pass — kiểm tra repair handler`,
    };
  }
  return { clean: true, repairedAll };
}
/** Blocker terminal khác drift repairable — không tự sửa được. */
export function isTerminalBlocker(d: DriftRecord): boolean {
  return d.kind === "roadmap-divergence" && d.expected === ""; // roadmap mất gốc — cần người quyết
}
//        if (!r.clean) report blocker — không dispatch
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ State lệch được sửa trước khi dispatch — quyết định trên state sạch | ❌ Reconcile mỗi dispatch = thêm latency |
| ✅ Repair idempotent + cap 2 pass — không loop | ❌ Detect/repair phải viết đúng cho từng drift kind |
| ✅ DriftRecord discriminated — repair biết chính xác sửa gì | ❌ Cap 2 pass có thể không đủ cho drift phức |
| ✅ Blocker terminal tách khỏi drift — không giả vờ sửa | ❌ Terminal blocker detection cần heuristic |

## Khác các hướng gần

| | DurableAck (durable-ack.ts) | ACQ: Reconcile |
|---|---|---|
| Thời điểm | Sau khi phát hiện tip lệch | **TRƯỚC mỗi dispatch/spawn (phòng thủ)** |
| Phân loại | terminal/retry/deliver | **Drift repairable vs blocker terminal** |
| Cơ chế | Release/drop delivery | **Repair idempotent + re-derive cap 2** |
| Mục tiêu | Không mất delivery | **Quyết định trên state sạch** |

## Khi nào chọn

- Dispatch/worker spawn phụ thuộc state có thể lệch (milestones, flags, roadmap)
- Muốn chủ động sửa trước thay vì phản ứng sau fail
- Đã có durable-ack + laneboard + conflict — nối pipeline reconcile
- Guard: repair idempotent (chạy lại an toàn), cap 2 pass, blocker báo rõ không dispatch
