# Hướng AIA: Group-Join-Consolidated-Notify — background agents trong một group được giữ lại cho đến khi tất cả hoàn tất (hoặc timeout 30s), rồi gửi một notification gộp duy nhất; straggler sau partial delivery được gom lại batch 15s — tránh nudge liên tục làm gián đoạn main agent

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟡 — notify batching | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có durable-ack + dedup; chưa có group-join batching) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagent3** background agents trong một **group** được giữ lại cho đến khi tất cả hoàn tất (hoặc **timeout 30s**), rồi gửi **một notification gộp duy nhất**; **straggler** sau partial delivery được gom lại **batch 15s** — tránh nudge liên tục làm gián đoạn main agent. Nguyên tắc: **group-join** — chờ cả nhóm trước notify (một thay vì N); **timeout ceiling** — không chờ vô hạn (30s); **straggler batching** — completion trễ gom batch 15s; **minimize interruption** — main agent không bị nudge liên tục.

## Mô tả

Với mya, pattern = **group-join consolidated notify**: (1) mya đã có **durable-ack** (packages/core) — completion delivery; (2) mya có completion dedupe (AHS); (3) AIA thêm **group concept** — spawn nhiều agent với cùng groupId; (4) **join**: completion chờ cho đến khi cả group done HOẶC timeout 30s → gửi 1 notification gộp; (5) **straggler batching** — completion đến sau partial delivery (đã notify) → gom 15s → batch thêm; (6) áp dụng trong notify path (intercom/UI).

## Kiến trúc (ASCII)

```
  GROUP { id, agents: [A, B, C] }
    │
    ├─ A completes (t=2s) ──► HOLD (chờ B, C)
    ├─ B completes (t=5s) ──► HOLD (chờ C)
    ├─ C completes (t=8s) ──► ALL DONE
    │    └─► NOTIFY GỘP (1 notification: A+B+C results)     [join success]
    │
    └─ hoặc timeout 30s ──► NOTIFY GỘP partial (A+B)         [timeout ceiling]
         │
         ▼ C (straggler) completes (t=35s, sau partial delivery)
         └─► BATCH 15s (gom straggler) ──► NOTIFY ADDENDUM (C result)
  (1 notification thay vì 3 — không nudge liên tục)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core durable-ack.ts — completion delivery (terminal/retry/deliver)
// ✅ packages/intercom reply-tracker.ts — notify round-trip (nền batching)
// ✅ packages/core time.ts — nowWallclock (timeout/batch timing)
// ✅ AHS completion-dedupe — dedup (kết hợp AIA)

// ❌ THIẾU: group concept (groupId) + join logic
// ❌ THIẾU: consolidated notify (1 thay vì N)
// ❌ THIẾU: straggler batching 15s
```

## Implementation

```typescript
// packages/core/src/group-join.ts (NEW)
import { nowWallclock } from "@my-agent/core";

export interface GroupCompletion { groupId: string; results: Map<string, unknown> }

const JOIN_TIMEOUT_MS = 30_000;
const STRAGGLER_BATCH_MS = 15_000;

/** Chờ cả group hoặc timeout — gửi 1 notification gộp. */
export class GroupJoiner {
  private groups = new Map<string, { total: number; results: Map<string, unknown>; startedAt: number; flush: (g: GroupCompletion) => void }>();
  /** Track group — total agents. */
  register(groupId: string, total: number, flush: (g: GroupCompletion) => void, now: number): void {
    this.groups.set(groupId, { total, results: new Map(), startedAt: now, flush });
  }
  /** Agent complete — hold cho đến full hoặc timeout. */
  complete(groupId: string, agentId: string, result: unknown, now: number): void {
    const g = this.groups.get(groupId); if (!g) return;
    g.results.set(agentId, result);
    const full = g.results.size >= g.total;
    const timedOut = now - g.startedAt >= JOIN_TIMEOUT_MS;
    if (full || timedOut) {
      g.flush({ groupId, results: g.results });   // NOTIFY GỘP
      this.groups.delete(groupId);
    }
  }
}
// Straggler: completion sau flush → timer 15s → batch addendum notify.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 1 notification thay vì N — ít gián đoạn | ❌ Join delay (chờ group) — latency notify tăng |
| ✅ Timeout ceiling — không chờ vô hạn | ❌ Straggler batch = notification thứ 2 (vẫn 2) |
| ✅ Straggler batching — không nudge từng cái | ❌ Group phải declare trước (total count) |
| ✅ Nối durable-ack sẵn | ❌ Timeout 30s phải calibrate theo workload |

## Khác các hướng gần

| | AIA Group-Join-Consolidated | AHS Completion-Dedupe-Key | AHQ Intercom-Supervisor-Bridge |
|---|---|---|---|
| Trọng tâm | Gộp notify N completion | Dedupe 1 completion | Subagent → supervisor |
| Cơ chế | Join 30s + straggler 15s | id: + tuple + seen-set | contact_supervisor + reference-only |
| Quan hệ | N event → 1 notify | 1 event bị duplicate | 1 event escalation |

## Khi nào chọn

- Spawn nhiều agent liên quan → muốn 1 notification gộp
- Main agent hay bị nudge liên tục → cần batching
- Group có straggler (1 chậm) → cần partial + addendum
- Guard: join timeout ceiling, straggler batch window, group total declare, calibrate theo workload
