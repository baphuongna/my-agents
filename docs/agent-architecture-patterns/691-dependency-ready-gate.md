# Hướng ZO: Dependency-Ready Gate — pattern bd ready: chỉ nhận task mới khi mọi blocker đã resolve — gate trước khi bắt đầu work, không phải lúc kết thúc
> **Nguồn gốc:** beads (WORKFLOWS.md qua research.md) | **Coupling:** 🟡 — gate check trước khi nhận task trong agent/queue | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (task graph ZK nền — chưa có ready gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**beads** dùng pattern **"bd ready"** (backlog-ready): agent **chỉ nhận task mới khi mọi blocker đã resolve**. Gate nằm **trước khi bắt đầu work** — không phải lúc kết thúc (khi bắt đầu mới biết kẹt thì đã tốn công). Nếu task có blocker chưa resolve → không nhận, báo blocker, chờ. Nếu task "ready" (không blocker) → nhận và chạy. Nhờ gate đầu vào: agent không bao giờ lãng phí vào task chưa thể hoàn thành; queue không chứa task "có vẻ làm được nhưng thực ra kẹt". Nguyên tắc: **check readiness trước khi start — not at finish**.

## Mô tả

mya dependency-ready gate: (1) **Ready check** — trước khi nhận task: query task graph → task có blocker chưa resolve? (nối ZK blockedBy). (2) **Gate verdict** — ready (không blocker) → nhận; not-ready (có blocker) → **từ chối + báo blocker list** + chờ. (3) **Queue behavior** — task not-ready không vào work queue (ở backlog, tự resolve khi blocker đóng). (4) **Trigger re-check** — khi blocker resolve → task thành ready → mới được nhận. mya có agent/pool.ts + core/loop.ts + task graph (ZK) — ZO thêm **ready gate check** + **blocker report** + **re-check trigger**.

## Kiến trúc

```
  TASK MỚI (từ queue/backlog)
  ┌─────────────────────────────────────────────────┐
  │  READY GATE (trước khi nhận work)                 │
  │  ┌─────────────────────────────────────────┐     │
  │  │  task.blockedBy = [task-A, task-B]       │     │
  │  │  ┌─ mọi blocker status == closed? ────┐  │     │
  │  │  │  yes → READY → nhận + chạy          │  │     │
  │  │  │  no  → NOT READY → từ chối +        │  │     │
  │  │  │        báo blocker chưa resolve      │  │     │
  │  │  └────────────────────────────────────┘  │     │
  │  └─────────────────────────────────────────┘     │
  └─────────────────────────────────────────────────┘
  → khi blocker resolve → re-check → task thành ready
  → không bao giờ bắt đầu work khi biết chắc sẽ kẹt
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent pool.ts — AgentPool (nền — ZO gate trước spawn)
// ✅ packages/core loop.ts — runTurn (nền — ZO gate trước turn)
// ✅ packages/tools graph-store.ts — GraphStore (nền — ZO task graph query)
// ✅ packages/core session-branch.ts — classifyChildSession (relate — ZO dependency marker)
// ✅ packages/workflows runner.ts — workflow runner (nền — ZO gate workflow input)

// ❌ THIẾU: ready gate check (blocker resolve chưa)
// ❌ THIẾU: blocker report (từ chối + danh sách blocker)
// ❌ THIẾU: re-check trigger (blocker đóng → task ready)
```

## Implementation

```typescript
// packages/agent/src/ready-gate.ts (MỚI)

interface TaskDeps { blockedBy: string[]; statusOf: (id: string) => "open" | "in-progress" | "closed" }

class DependencyReadyGate {
  // Gate trước khi nhận task — không phải lúc kết thúc
  async check(taskId: string, deps: TaskDeps): Promise<{ ready: boolean; blockers: string[] }> {
    const blockers = deps.blockedBy.filter(b => deps.statusOf(b) !== "closed");
    if (blockers.length > 0) {
      return { ready: false, blockers };          // từ chối + báo blocker — chờ
    }
    return { ready: true, blockers: [] };          // ready → nhận + chạy
  }

  // Re-check: khi 1 blocker resolve → task có thể thành ready
  async onBlockerResolved(taskId: string, blockerId: string, deps: TaskDeps): Promise<{ ready: boolean; blockers: string[] }> {
    if (!deps.blockedBy.includes(blockerId)) return { ready: false, blockers: deps.blockedBy };
    return this.check(taskId, deps);               // chạy lại gate đầy đủ
  }
}
// Usage (trong AgentPool.spawn / queue):
// const gate = new DependencyReadyGate();
// const v = await gate.check("task-B", { blockedBy: ["task-A"], statusOf: taskGraph.status });
// if (!v.ready) {
//   queue.backlog(taskId, v.blockers);   // không nhận — chờ blocker resolve
//   return { status: "not-ready", blockers: v.blockers };
// }
// return pool.spawn(taskId);              // ready → mới chạy
// // task-A đóng → gate.onBlockerResolved("task-B", "task-A", deps) → ready → nhận
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không lãng phí work vào task kẹt (gate trước start) | ❌ Gate phải query dependency đúng (thiếu blocker → chạy kẹt) |
| ✅ Queue sạch (không task "tưởng làm được") | ❌ Task chờ lâu nếu blocker không ai xử lý |
| ✅ Re-check tự động khi blocker resolve | ❌ Status stale (blocker đóng rồi nhưng gate thấy cũ) |
| ✅ Báo blocker rõ (biết chính xác chờ gì) | ❌ Gate thêm 1 bước trước mỗi task (overhead nhỏ) |

## Khác các hướng gần

| | Nhận task ngay | Check cuối (khi làm) | ZO: Ready Gate |
|---|---|---|---|
| Thời điểm gate | Không | Lúc kết thúc | **Trước khi start** |
| Lãng phí | Cao | Cao | **✅ 0** |
| Blocker report | Không | Muộn | **✅ ngay** |

## Khi nào chọn

- Task có dependency chéo (blocker giữa task) — nhận nhầm = phí công
- Queue/backlog lớn, cần lọc task làm được trước
- Muốn agent chỉ chạy task chắc chắn hoàn thành được
- Nối packages/agent pool.ts + core loop.ts + tools graph-store.ts + session-branch.ts + workflows runner.ts; guard dependency-accuracy (blockedBy đầy đủ từ task graph), status-freshness (status cập nhật khi blocker đóng), và recheck-trigger (mọi blocker resolve đều kích re-check); ZO = dependency-ready gate, kết hợp 687 ZK graph-task-dependencies (blockedBy query) + 690 ZN blocker-vs-deferrable-triage (xử lý blocker khi gặp)
