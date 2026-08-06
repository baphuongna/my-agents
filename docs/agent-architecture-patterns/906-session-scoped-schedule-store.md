# Hướng AHV: Session-Scoped-Schedule-Store — scheduled subagents lưu ở `<cwd>/.pi/subagent-schedules/<sessionId>.json` với PID-based file locking an toàn cross-instance; schedule (cron/interval/one-shot) reset khi `/new`, restore khi `/resume`; fires bypass maxConcurrent queue

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟡 — schedule persistence | **Agent-agnostic:** ⚠️ (pi session model) | **Code sẵn:** ⚠️ (có cron store + cross-process-lock; chưa có per-session schedule + reset/restore) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-subagent3** scheduled subagents lưu ở **`<cwd>/.pi/subagent-schedules/<sessionId>.json`** với **PID-based file locking** an toàn cross-instance; schedule (cron/interval/one-shot) **reset khi `/new`**, **restore khi `/resume`**; **fires bypass maxConcurrent queue**. Nguyên tắc: **per-session scoping** — schedule gắn session, không global (mỗi conversation có lịch riêng); **PID lock cross-instance** — nhiều Pi instance cùng cwd không ghi đè; **lifecycle-aware** — new session reset, resume restore; **priority bypass** — scheduled fire ưu tiên vượt queue.

## Mô tả

Với mya, pattern = **per-session schedule store**: (1) mya đã có **cron package** (packages/cron) — scheduler cron/interval/once + atomic claim + TTL lease + cross-process-lock.ts — đúng cơ chế schedule + lock; (2) AHV thêm **per-session scoping** — schedule file theo `<sessionId>.json` thay vì global cron.json; (3) **PID-based file lock** (nối cross-process-lock.ts) — acquire trước write; (4) **reset on `/new`** — new session → xóa schedule file; **restore on `/resume`** — resume session → load schedule file; (5) **bypass queue** — scheduled fire ưu tiên vượt maxConcurrent (nối AIE parallel-queue).

## Kiến trúc (ASCII)

```
  <cwd>/.pi/subagent-schedules/
    ├─ <sessionA>.json   ← schedule của session A (cron/interval/once)
    └─ <sessionB>.json   ← schedule của session B
         │
         ▼ PID file lock (cross-process-lock.ts):
         acquire lock ──► read/modify/write ──► release
         (nhiều Pi instance cùng cwd — an toàn)
  /new  ──► reset (xóa <sessionId>.json)
  /resume ──► restore (load <sessionId>.json)
  fire  ──► BYPASS maxConcurrent queue (priority)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/cron index.ts — scheduler cron/interval/once + atomic claim + TTL lease
// ✅ packages/cron cross-process-lock.ts — PID-based file lock (flock + PID liveness)
// ✅ packages/cron cron-store.ts — schedule store (cron.json — nền per-session)
// ✅ packages/cron scan.ts — trigger types (cron/interval/once)
// ✅ packages/core time.ts — nowWallclock (schedule fire timing)

// ❌ THIẾU: per-session scoping (<sessionId>.json)
// ❌ THIẾU: reset on /new + restore on /resume lifecycle hooks
// ❌ THIẾU: bypass maxConcurrent queue (priority fire)
```

## Implementation

```typescript
// packages/cron/src/session-schedule-store.ts (NEW)
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { acquireCronLock } from "./cross-process-lock.js";
import { nowWallclock } from "@my-agent/core";

export interface SessionSchedule { type: "cron" | "interval" | "once"; spec: string | number; agent: string; prompt: string }

/** Per-session schedule store — PID lock cross-instance. */
export class SessionScheduleStore {
  constructor(private readonly dir: string) { mkdirSync(dir, { recursive: true }); }
  private path(sessionId: string): string { return join(this.dir, `${sessionId}.json`); }

  /** Set/replace schedule cho session — PID lock. */
  set(sessionId: string, sched: SessionSchedule): void {
    const release = acquireCronLock(`sched:${sessionId}`); if (!release) throw new Error("lock busy");
    try { writeFileSync(this.path(sessionId), JSON.stringify(sched, null, 2), { mode: 0o600 }); }
    finally { release(); }
  }
  /** Restore khi /resume — load schedule. */
  restore(sessionId: string): SessionSchedule | null {
    const p = this.path(sessionId); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }
  /** Reset khi /new — xóa schedule. */
  reset(sessionId: string): void { try { unlinkSync(this.path(sessionId)); } catch { /* ok */ } }
}
// scheduler: fire → spawnSubagent(prompt) BYPASS queue (priority flag); cron scan
// đọc per-session files thay vì global cron.json.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Per-session scoping — lịch riêng từng conversation | ❌ N file per session — nhiều file |
| ✅ PID lock cross-instance an toàn | ❌ Bypass queue có thể starvation regular agent |
| ✅ Reset/restore theo lifecycle (/new, /resume) | ❌ Restore phải validate spec còn hợp lệ |
| ✅ Nối cron + cross-process-lock sẵn | ❌ cwd-relative path — di chuyển cwd = mất lịch |

## Khác các hướng gần

| | AHV Session-Scoped-Schedule | AIE Parallel-Background-Queue | AHR Stale-Run-Reconciler |
|---|---|---|---|
| Trọng tâm | Lưu schedule per-session | Queue concurrency limit | Sửa orphan run |
| Cơ chế | <sessionId>.json + PID lock | Semaphore + wait queue | PID-liveness + grace |
| Quan hệ | Persist lịch | Chạy lịch (queue) | Cleanup sau lịch |

## Khi nào chọn

- Cần schedule gắn per-session (mỗi conversation lịch riêng)
- Nhiều Pi instance cùng cwd → cần PID lock
- Muốn reset/new + restore/resume lifecycle
- Guard: PID lock cross-instance, cwd-relative path documented, bypass queue có priority ceiling, validate spec on restore
