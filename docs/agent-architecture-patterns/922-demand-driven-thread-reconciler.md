# Hướng AIL: Demand-Driven-Thread-Reconciler — thread/tab lifecycle điều khiển bởi state machine (`stable`, `provisioning`, `sync-required`, `cleanup-required`) với pure plans, proof-before-delete, leader-epoch checks; Bot API không có listing đầy đủ nên sync là demand-driven slices chứ không phải read-model hoàn chỉnh

> **Nguồn gốc:** pi-telegram | **Coupling:** 🟡 — distributed reconcile | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có sync convergence + collab; chưa có thread state machine + proof-before-delete) | **Effort:** 2 tuần

## Nguồn gốc

**pi-telegram** thread/tab lifecycle điều khiển bởi **state machine** (`stable`, `provisioning`, `sync-required`, `cleanup-required`) với **pure plans**, **proof-before-delete**, **leader-epoch checks**; Bot API không có listing đầy đủ nên sync là **demand-driven slices** chứ không phải read-model hoàn chỉnh. Nguyên tắc: **explicit state machine** — lifecycle qua transition rõ (không ad-hoc); **pure plans** — compute plan từ state, execute riêng (testable); **proof-before-delete** — không xóa thread chưa chứng minh tồn tại; **leader-epoch** — chỉ leader epoch hiện tại act (stale epoch no-op); **demand-driven** — sync slice khi cần, không full read-model.

## Mô tả

Với mya, pattern = **thread reconciler state machine**: (1) mya đã có **sync** (packages/sync) — HLC convergence, và **collab** relay; (2) AIL thêm **thread state machine**: `stable → provisioning → sync-required → cleanup-required → stable`; (3) **pure plan functions** — `planSync(state) → actions[]` (no side-effect, testable); (4) **proof-before-delete** — delete chỉ khi có proof thread tồn tại (getUpdates evidence); (5) **leader-epoch** — action gắn epoch, stale epoch (leader change) → no-op (nối AII); (6) **demand-driven** — sync khi access thread, không background full-scan.

## Kiến trúc (ASCII)

```
  THREAD STATE MACHINE (pure transitions)
    stable ──(access missing?)──► sync-required
    sync-required ──(plan+exec)──► provisioning ──► stable
    stable ──(stale/orphan?)──► cleanup-required ──(proof-before-delete)──► stable

  PURE PLAN (no side-effect — testable):
    planSync(state) → actions[]        // compute từ state
    executePlan(actions)               // side-effect riêng

  PROOF-BEFORE-DELETE: delete thread CHỈ khi có proof tồn tại
  LEADER-EPOCH: action gắn epoch; stale epoch (leader đổi) → no-op

  DEMAND-DRIVEN (Bot API không có full listing):
    access thread X → sync slice X (KHÔNG background full read-model)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/sync index.ts — HLC convergence (coordination nền)
// ✅ packages/collab relay.ts — event bus (state propagation nền)
// ✅ packages/core time.ts — nowWallclock (epoch timing)
// ✅ AII multi-instance-bus-leader — leader-epoch concept (nền)

// ❌ THIẾU: thread state machine (stable/provisioning/sync/cleanup)
// ❌ THIẾU: pure plan functions (planSync → actions)
// ❌ THIẾU: proof-before-delete + leader-epoch gating
// ❌ THIẾU: demand-driven slice sync
```

## Implementation

```typescript
// packages/channels/src/thread-reconciler.ts (NEW)
export type ThreadState = "stable" | "provisioning" | "sync-required" | "cleanup-required";
export interface Thread { id: string; state: ThreadState; epoch: string; lastSeenAt: number }

export type Action =
  | { kind: "sync"; threadId: string }
  | { kind: "delete"; threadId: string; proof: unknown }
  | { kind: "noop" };

/** PURE PLAN — compute actions từ state (no side-effect, testable). */
export function planSync(t: Thread, hasProof: boolean, currentEpoch: string): Action {
  if (t.epoch !== currentEpoch) return { kind: "noop" };          // stale epoch — no-op
  switch (t.state) {
    case "sync-required": return { kind: "sync", threadId: t.id };
    case "cleanup-required": return hasProof
      ? { kind: "delete", threadId: t.id, proof: true }            // proof-before-delete
      : { kind: "sync", threadId: t.id };                          // no proof → sync to get proof
    default: return { kind: "noop" };
  }
}
/** Execute plan — side-effect riêng (gọi Bot API). */
export async function executePlan(a: Action, api: { sync(id: string): Promise<void>; delete(id: string): Promise<void> }): Promise<void> {
  if (a.kind === "sync") await api.sync(a.threadId);
  else if (a.kind === "delete") await api.delete(a.threadId);
}
// demand-driven: access thread X → planSync(thread X) → executePlan (slice, không full).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ State machine rõ — lifecycle không ad-hoc | ❌ State machine phức tạp (4 state) |
| ✅ Pure plans testable | ❌ Proof-before-delete cần API call thêm |
| ✅ Proof-before-delete an toàn (không xóa nhầm) | ❌ Leader-epoch sync phải propagate |
| ✅ Demand-driven — không tốn full-scan | ❌ Slice sync có thể miss thread chưa access |

## Khác các hướng gần

| | AIL Demand-Driven-Thread-Reconciler | AII Multi-Instance-Bus-Leader | AHR Stale-Run-Reconciler |
|---|---|---|---|
| Trọng tâm | Thread lifecycle state machine | Leader poll multi-instance | Sửa orphan run |
| Cơ chế | Pure plans + proof + epoch | Leader/follower + heartbeat | PID-liveness + grace |
| Quan hệ | Distributed reconcile | Distributed coordination | Local reconcile |

## Khi nào chọn

- Thread/tab lifecycle phức tạp → cần state machine rõ
- Bot API không có full listing → demand-driven slice sync
- Cần proof-before-delete (an toàn, không xóa nhầm)
- Guard: pure plans (testable), proof-before-delete, leader-epoch gating, demand-driven not full-scan
