# Hướng AHR: Stale-Run-Reconciler — background runs có PID-liveness check; run bị orphan (process chết, thiếu status file) được sửa trạng thái và gắn cờ `repaired` thay vì treo vĩnh viễn; kèm `missingStatusGraceMs` và `staleAlivePidMs` tránh kill nhầm

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟢 — run lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có stale-lock PID-liveness; chưa có run reconciler + grace windows) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents** background runs có **PID-liveness check**: run bị orphan (process chết, thiếu status file) được **sửa trạng thái** và gắn cờ `repaired` thay vì để treo vĩnh viễn. Kèm **`missingStatusGraceMs`** (run sống nhưng thiếu status file — chờ grace trước sửa) và **`staleAlivePidMs`** (PID còn sống nhưng status quá cũ — suspect) để tránh kill nhầm. Nguyên tắc: **reconcile định kỳ** — background run phải có cleanup; **PID-liveness** — `process.kill(pid, 0)` xác nhận process còn sống; **grace windows** — không sửa vội khi thiếu thông tin (status file có thể đang được ghi).

## Mô tả

Với mya, pattern = **stale background-run reconciler**: (1) mya đã có **stale-lock.ts** (packages/gateway) — TTL + PID-liveness + atomic tombstone rename — đúng cơ chế PID check; (2) mya có **AgentPool** (packages/agent) quản lý AgentSessionEntry nhưng chưa có reconcile orphan; (3) AHR thêm **run reconciler** quét định kỳ: với mỗi run → check PID liveness; (4) **3 trạng thái**: `alive+fresh` (ok), `alive+stale` (status cũ hơn `staleAlivePidMs` → suspect, không kill), `dead+missing-status` (orphan → repair sau `missingStatusGraceMs`); (5) **repair** = sửa status thành `failed`/`abandoned` + cờ `repaired: true`.

## Kiến trúc (ASCII)

```
  RECONCILER (quét định kỳ toàn background runs)
    │
    ├─ for each run { pid, statusFile, statusUpdatedAt }:
    │    │
    │    ├─ process.kill(pid, 0)?
    │    │    ├─ YES (alive):
    │    │    │    └─ now - statusUpdatedAt > staleAlivePidMs?
    │    │    │         ├─ NO  → ok (fresh)
    │    │    │         └─ YES → SUSPECT (alive but stale — KHÔNG kill, chỉ flag)
    │    │    └─ NO (dead):
    │    │         └─ statusFile tồn tại?
    │    │              ├─ YES → repair (sửa status=abandoned, cờ repaired)
    │    │              └─ NO  → chờ missingStatusGraceMs → repair (orphan)
    │    ▼
    └─ run orphan không treo vĩnh viễn — repaired + flagged
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway stale-lock.ts — TTL + PID liveness (process.kill(pid,0))
//   + atomic tombstone rename (cơ chế stale detection đã có)
// ✅ packages/cron cross-process-lock.ts — PID liveness + TTL (cron lock)
// ✅ packages/agent pool.ts — AgentSessionEntry (lastActivity, busy — nền track)
// ✅ packages/core durable-ack.ts — completion classification (terminal/retry)
// ✅ packages/core time.ts — nowWallclock (single time helper)

// ❌ THIẾU: run reconciler (quét + repair orphan)
// ❌ THIẾU: missingStatusGraceMs / staleAlivePidMs grace windows
// ❌ THIẾU: cờ repaired + repair action
```

## Implementation

```typescript
// packages/agent/src/stale-run-reconciler.ts (NEW)
import { nowWallclock } from "@my-agent/core";
import { existsSync } from "node:fs";

export interface BackgroundRun {
  pid: number; statusFile: string; statusUpdatedAt: number; status: string;
}
export interface ReconcileOpts {
  missingStatusGraceMs: number; // default 60_000
  staleAlivePidMs: number;     // default 300_000
}
const isAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Sửa orphan run — không kill nhầm nhờ grace windows. */
export function reconcileRun(run: BackgroundRun, now: number, o: ReconcileOpts): BackgroundRun | null {
  if (isAlive(run.pid)) {
    if (now - run.statusUpdatedAt > o.staleAlivePidMs) {
      return { ...run, status: "suspect" }; // alive but stale — KHÔNG kill
    }
    return null; // fresh — ok
  }
  // dead — orphan
  if (!existsSync(run.statusFile) && now - run.statusUpdatedAt < o.missingStatusGraceMs) {
    return null; // grace — status có thể đang ghi, chờ
  }
  return { ...run, status: "abandoned", repaired: true as never }; // repair
}
// pool.ts: setInterval → reconcile all AgentSessionEntry; repair = xóa entry +
// ghi status abandoned vào sessionFile để get_subagent_result không treo.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Orphan run không treo vĩnh viễn | ❌ Quét định kỳ tốn CPU nhẹ |
| ✅ PID-liveness chính xác (không guess) | ❌ PID reuse có thể false-positive alive |
| ✅ Grace windows tránh kill nhầm | ❌ missingStatusGraceMs phải calibrate |
| ✅ Nối stale-lock sẵn | ❌ Repair ghi status — cần atomic (AHT) |

## Khác các hướng gần

| | AHR Stale-Run-Reconciler | AHS Completion-Dedupe-Key | AHT Atomic-JSON-Artifacts |
|---|---|---|---|
| Trọng tâm | Sửa orphan run | Dedupe notify completion | Ghi artifact an toàn |
| Cơ chế | PID-liveness + grace | id: / tuple key | writeAtomicJson |
| Quan hệ | Trước notify (lifecycle) | Trong notify | Khi ghi status/run |

## Khi nào chọn

- Background runs có thể orphan (crash, OOM kill) → cần reconcile
- Muốn PID-liveness chính xác thay vì TTL guess
- Grace windows để không sửa vội / kill nhầm
- Guard: PID-liveness + grace, atomic repair write, calibrate grace theo workload, flag repaired để audit
