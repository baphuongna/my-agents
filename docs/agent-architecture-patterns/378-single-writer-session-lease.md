# Hướng NN: Single-Writer Session Lease — một-writer/session JSONL: web giữ runtime, Release bàn giao CLI

> **Nguồn gốc:** pi-mobile (session semantics); "single-writer pattern"; "lease/lock" (229 distributed-locking); "session ownership transfer"; "JSONL append-only log"; "exclusive writer" (database WAL); "handoff protocol" (54); "exclusive access control"
> **Coupling:** 🟢 — session management layer, không đổi core agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session JSONL sẵn — chưa có lease/handoff protocol)
> **Effort:** 2 tuần

## Nguồn gốc

**Single-writer** (database WAL): một process ghi tại một thời điểm → tránh corruption. **Distributed lock / lease** (229): quyền truy cập độc quyền có thời hạn. pi-mobile áp dụng cho **session JSONL**: cùng file session (`~/.pi/agent/sessions/`) được truy cập bởi web UI và native CLI — nhưng **chỉ một writer tại một thời điểm**. Web UI giữ "runtime lease" (active session process). Khi user muốn dùng CLI → web "Release" (dispose runtime, release lease) → CLI pick up cùng JSONL. **Abort** khác **Release**: Abort chỉ dừng run hiện tại (giữ runtime), Release dispose runtime hoàn toàn (bàn giao). Nguyên lý: **không bao giờ 2 writer cùng session** → tránh concurrent append corruption.

## Mô tả

mya single-writer session lease: session = JSONL append-only file. Một **writer** (process giữ runtime) tại một thời điểm. Web UI: `Abort` (dừng run, giữ runtime) vs `Release` (dispose runtime, release lease). CLI: khi web Release → CLI resume cùng JSONL (no concurrent writer). Lease = runtime ownership, không phải file lock (JSONL vẫn readable, chỉ không writable concurrently). Nối 229 distributed-locking + 54 handoff + 327 interruptible (abort = interrupt, release = handoff).

## Kiến trúc

```
  SESSION JSONL: ~/.pi/agent/sessions/session-abc.jsonl
  ┌──────────────────────────────────────────────────┐
  │  { role: 'user', content: '...' }                │  ← append-only
  │  { role: 'assistant', content: '...' }            │
  │  { role: 'tool', name: 'read', result: '...' }    │
  └──────────────────────────────────────────────────┘
        │
        │  WHO IS THE WRITER? (one at a time)
        │
        ▼
  ┌─── LEASE STATE MACHINE ──────────────────────────┐
  │                                                   │
  │  STATE: web-held                                  │
  │  ┌─────────────────────────────────────────────┐  │
  │  │ Web UI runtime (active process)              │  │
  │  │ · streaming live                              │  │
  │  │ · tool execution                              │  │
  │  │ · THE ONLY writer to JSONL                    │  │
  │  └─────────────────────────────────────────────┘  │
  │                                                   │
  │  User actions:                                    │
  │  · ABORT  → stop current run, KEEP runtime        │
  │             (session still web-held, resumable)    │
  │                                                   │
  │  · RELEASE → dispose runtime, RELEASE lease        │
  │             (session free → CLI can pick up)       │
  └───────────────────────┬───────────────────────────┘
                          │ Release
                          ▼
  ┌─── STATE: free ──────────────────────────────────┐
  │                                                   │
  │  CLI: pi --resume session-abc                     │
  │  → acquires lease → becomes THE writer             │
  │  → reads JSONL → continues session                 │
  │                                                   │
  │  ⚠️ Do NOT open same session in web + CLI          │
  │     simultaneously (concurrent writer corruption)  │
  └───────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 229 distributed-locking — lease concept (nền — NN = session lease)
// ✅ 54 handoff — transfer ownership (nền — NN = web→CLI handoff)
// ✅ 327 interruptible-agents — abort/interrupt (nền — NN Abort = interrupt)
// ✅ session JSONL — append-only session log (sẵn)
// ✅ 230 event-sourcing — replay JSONL (nền)

// ❌ THIẾU: lease state machine (web-held / free / cli-held)
// ❌ THIẾU: Release command (dispose runtime, release lease)
// ❌ THIẾU: concurrent-writer detection (warn if 2 writers)
// ❌ THIẾU: handoff protocol (web → CLI JSONL resume)
```

## Implementation

```typescript
// packages/agent/src/session-lease.ts (NEW)
type LeaseState = 'free' | 'web-held' | 'cli-held';

interface SessionLease {
  sessionId: string;
  state: LeaseState;
  holderPid?: number;    // process holding the lease
  acquiredAt?: number;
}

class SingleWriterSessionLease {
  private leases = new Map<string, SessionLease>();

  // Acquire lease — refuse if already held by another writer
  acquire(sessionId: string, holder: 'web' | 'cli', pid: number): { ok: boolean; error?: string } {
    const existing = this.leases.get(sessionId);
    if (existing && existing.state !== 'free' && existing.holderPid !== pid) {
      return {
        ok: false,
        error: `session held by ${existing.state} (pid ${existing.holderPid}) — use Release first`,
      };
    }

    this.leases.set(sessionId, {
      sessionId,
      state: holder === 'web' ? 'web-held' : 'cli-held',
      holderPid: pid,
      acquiredAt: Date.now(),
    });
    return { ok: true };
  }

  // Abort — stop current run but KEEP lease (runtime stays alive)
  abort(sessionId: string, pid: number): { ok: boolean } {
    const lease = this.leases.get(sessionId);
    if (!lease || lease.holderPid !== pid) return { ok: false };
    // Stop the active run, but do NOT release the lease
    // Runtime process stays alive → session still resumable in same UI
    this.stopActiveRun(sessionId);
    return { ok: true };
  }

  // Release — dispose runtime, release lease (handoff to other writer)
  release(sessionId: string, pid: number): { ok: boolean } {
    const lease = this.leases.get(sessionId);
    if (!lease || lease.holderPid !== pid) return { ok: false };
    // Dispose runtime process → JSONL is now free for another writer
    this.disposeRuntime(sessionId);
    this.leases.set(sessionId, { sessionId, state: 'free' });
    return { ok: true };
  }

  // Check: is this session writable by this process?
  canWrite(sessionId: string, pid: number): boolean {
    const lease = this.leases.get(sessionId);
    if (!lease || lease.state === 'free') return true;
    return lease.holderPid === pid;
  }

  private stopActiveRun(sessionId: string): void { /* stop agent loop */ }
  private disposeRuntime(sessionId: string): void { /* kill process, flush JSONL */ }
}

// Usage:
// Web UI: lease.acquire('session-abc', 'web', process.pid) → ✅
// Web UI: lease.abort('session-abc', process.pid) → stops run, keeps web lease
// Web UI: lease.release('session-abc', process.pid) → disposes runtime
// CLI:    lease.acquire('session-abc', 'cli', process.pid) → ✅ (was released)
// CLI:    reads JSONL → resumes session as sole writer
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ No concurrent-writer corruption (single writer) | ❌ Must Release before switching (friction) |
| ✅ Abort vs Release distinction (flexible control) | ❌ Lease overhead (acquire/release per session) |
| ✅ Seamless web→CLI handoff (same JSONL) | ❌ Stuck lease (process crash without release) |
| ✅ JSONL readable by anyone (only write is exclusive) | ❌ No multi-client real-time collab (single writer) |

## Khác các hướng gần

| | 229 Distributed-Locking | 54 Handoff | 327 Interruptible | NN: Session-Lease |
|---|---|---|---|---|
| Mục | Lock resource | Transfer agent | Stop/resume | **Single-writer per session** |
| Lease | Time-bounded | Ownership | Checkpoint | **Runtime ownership (web/CLI)** |
| Handoff | ❌ | ✅ | ❌ | **Release → CLI resume** |

## Khi nào chọn

- Session truy cập từ nhiều client (web UI + CLI)
- Cần tránh concurrent-writer corruption (JSONL append)
- Muốn flexible: Abort (keep runtime) vs Release (handoff)
- Nối 229 locking + 54 handoff + 327 interruptible (abort = interrupt, release = handoff) + 139 cross-device-sessions
