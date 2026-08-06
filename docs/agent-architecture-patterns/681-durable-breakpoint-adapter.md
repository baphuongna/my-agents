# Hướng ZE: Durable Breakpoint Adapter — breakpoint chờ approve sống qua session timeout/restart/handoff nhờ state nằm trong journal + pluggable backend (GitHub Issues approve bằng comment) — human-in-the-loop bền vững
> **Nguồn gốc:** babysitter (docs/user-guide/features/breakpoints.md) | **Coupling:** 🟡 — breakpoint state vào journal + backend adapter | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (core/supervised + gateway approval-relay — chưa có durable breakpoint journal) | **Effort:** 2-3 tuần

## Nguồn gốc

**babysitter** cần **breakpoint** (chờ human approve giữa chừng) — nhưng breakpoint in-memory **chết theo session**: session timeout, restart, handoff sang agent khác → mất trạng thái chờ. Giải pháp **durable breakpoint**: state chờ approve nằm trong **journal** (persistent store), và backend approve **pluggable** — GitHub Issues: tạo issue cho breakpoint, human comment `/approve` → adapter đọc comment → resolve. Breakpoint sống qua **session chết**, qua **restart**, qua **handoff** vì nó không thuộc process — thuộc journal + backend ngoài. Nguyên tắc: **human-in-the-loop phải sống lâu hơn session — state durably journaled, approve qua pluggable backend**.

## Mô tả

mya durable breakpoint adapter: (1) **Breakpoint record** — id, phase, context, status(pending/approved/rejected) ghi vào **journal** (SQLite/JSONL persistent). (2) **Backend adapter** — interface approve backend: GitHub Issues (comment), web, channel (WhatsApp/Matrix — mya có channels). (3) **Resume** — sau restart/handoff, scan journal → breakpoint pending → chờ approve trên backend. (4) **Timeout** — breakpoint hết hạn → ghi rejected + lý do. mya có core/supervised.ts + gateway approval-relay.ts + channels — ZE thêm **breakpoint journal store** + **backend adapter interface** + **resume scan**.

## Kiến trúc

```
  AGENT ──phase cần approve──▶ BREAKPOINT (id: bp-42)
                                   │
  ┌─── JOURNAL (persistent) ───────┴──────────────┐
  │  { id: bp-42, phase: "act", status: "pending", │
  │    context: {...}, createdAt, expiresAt }       │
  └────────────────────┬───────────────────────────┘
                       │ (session restart / handoff)
                       ▼
  ┌─── BACKEND ADAPTER (pluggable) ───────────────┐
  │  [GitHub Issues] issue + comment /approve      │
  │  [Web] approval page (approval-relay)          │
  │  [Channel] WhatsApp/Matrix reply               │
  └────────────────────┬───────────────────────────┘
                       ▼  approve event
  ┌─── RESUME ────────────────────────────────────┐
  │  journal: status → approved                    │
  │  agent (có thể khác session) resume phase act   │
  └────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core supervised.ts — supervisedTask (nền — ZE approval task)
// ✅ packages/gateway approval-relay.ts — ApprovalRelay (nền — ZE web backend)
// ✅ packages/channels — WhatsApp/Matrix adapters (nền — ZE channel backend)
// ✅ packages/audit index.ts — AuditLog (nền — ZE journal analog)
// ✅ packages/memory sqlite-store.ts — persistent store (nền — ZE journal store)

// ❌ THIẾU: breakpoint journal (state durably persisted, không in-memory)
// ❌ THIẾU: backend adapter interface (GitHub Issues/Web/Channel pluggable)
// ❌ THIẾU: resume scan (restart/handoff → tìm pending breakpoint)
```

## Implementation

```typescript
// packages/core/src/durable-breakpoint.ts (MỚI)

type BpStatus = "pending" | "approved" | "rejected" | "expired";

interface Breakpoint { id: string; phase: string; context: unknown; status: BpStatus; createdAt: number; expiresAt: number }

interface BreakpointBackend {
  publish(bp: Breakpoint): Promise<void>;          // tạo issue/web prompt/channel msg
  wait(bp: Breakpoint, timeoutMs: number): Promise<"approved" | "rejected">;
}

interface Journal { save(bp: Breakpoint): Promise<void>; load(status?: BpStatus): Promise<Breakpoint[]> }

class DurableBreakpoint {
  constructor(private journal: Journal, private backends: BreakpointBackend[]) {}

  // Tạo breakpoint: state vào journal TRƯỚC khi chờ — sống qua restart
  async request(id: string, phase: string, context: unknown, ttlMs: number): Promise<"approved" | "rejected"> {
    const bp: Breakpoint = { id, phase, context, status: "pending", createdAt: Date.now(), expiresAt: Date.now() + ttlMs };
    await this.journal.save(bp);
    for (const b of this.backends) await b.publish(bp);          // publish ra backend
    const verdict = await this.backends[0].wait(bp, ttlMs);      // chờ approve (backend ngoài)
    bp.status = verdict;
    await this.journal.save(bp);                                  // cập nhật journal
    return verdict;
  }

  // Resume: scan journal sau restart/handoff → pending breakpoint chờ approve
  async resumePending(): Promise<Breakpoint[]> {
    const pending = (await this.journal.load("pending")).filter(b => b.expiresAt > Date.now());
    for (const b of pending) {                                    // chưa approve → publish lại + chờ
      const verdict = await this.backends[0].wait(b, b.expiresAt - Date.now());
      b.status = verdict; await this.journal.save(b);
    }
    return (await this.journal.load("pending")).filter(b => b.expiresAt > Date.now());
  }
}
// Usage:
// const bp = new DurableBreakpoint(sqliteJournal, [githubIssuesBackend, webApprovalBackend]);
// await bp.request("bp-42", "act", { file: "src/a.ts" }, 24 * 3600_000);
// // session chết → restart → bp.resumePending() → bp-42 vẫn chờ, approve qua comment
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Human-in-the-loop sống qua restart/handoff | ❌ Journal store phải đúng (mất journal = mất breakpoint) |
| ✅ Backend pluggable (GitHub/Web/Channel) | ❌ Backend wait có thể treo (timeout phải chặt) |
| ✅ Audit được (mọi status chuyển ghi journal) | ❌ Publish lại khi resume → duplicate notification |
| ✅ Session chết không mất việc đang chờ | ❌ Context trong journal phải serializable |

## Khác các hướng gần

| | In-memory breakpoint | Cron re-run | ZE: Durable Breakpoint |
|---|---|---|---|
| Restart | ❌ mất | Chạy lại từ đầu | **✅ journal giữ** |
| Backend | 1 (TUI) | ✗ | **Pluggable** |
| Handoff | ✗ | ✗ | **✅ resume scan** |

## Khi nào chọn

- Session dài, hay timeout/restart — không thể chờ approve trong memory
- Muốn approve qua nhiều kênh (GitHub/Web/Channel)
- Handoff giữa agent cần giữ trạng thái chờ
- Nối packages/core supervised.ts + gateway approval-relay.ts + channels + audit index.ts + memory sqlite-store.ts; guard journal-atomicity (save trước publish), timeout-enforcement (expired → rejected + lý do), và resume-idempotency (resume không publish duplicate); ZE = durable breakpoint adapter, kết hợp 680 ZD mandatory-stop-enforcement (halt → breakpoint) + 688 ZL compaction-survival-notes (state sống qua compaction)
