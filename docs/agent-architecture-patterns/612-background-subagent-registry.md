# Hướng WN: Background Subagent Registry — background=true async subagent; Job registry có start/extend/waitForPromotion/promote; done gọi parent msg tự động

> **Nguồn gốc:** opencode `background subagent` (async subagent chạy nền; Job registry: `start`/`extend`/`waitForPromotion`/`promote`; khi done → tự gọi parent message); "background=true async subagent", "Job registry lifecycle", "auto parent notification on done", "promotion from background to foreground" | **Coupling:** 🟡 — thêm background job registry + promotion vào subagent system | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent pool + async sẵn — chưa có background registry + promotion + auto-parent-notify) | **Effort:** 2-3 tuần

## Nguồn gốc

**opencode** subagent có thể chạy **background** (`background: true`) — async, không block parent. Job registry quản lý lifecycle: (1) **`start`**: spawn background subagent → trả job handle (parent tiếp tục làm việc khác). (2) **`extend`**: gia hạn job (TTL keep-alive — background job có timeout, extend để không expire). (3) **`waitForPromotion`**: parent đợi background job **promote** (chuyển từ background → foreground, kết quả cần parent xử lý). (4) **`promote`**: background job done → promote kết quả lên parent. (5) **Auto parent notify**: khi background job done → **tự động** gửi message cho parent (parent nhận kết quả không cần poll). Nguyên tắc: **async + registry + promotion + auto-callback**.

## Mô tả

mya background subagent registry: (1) **Background spawn**: `background: true` → subagent chạy async, parent không block. (2) **Job registry**: theo dõi background jobs (status: running/done/promoted). (3) **Extend**: keep-alive TTL (job sắp expire → extend). (4) **Promote**: job done → promote kết quả (background → foreground). (5) **Auto-notify**: done → parent nhận message tự động (callback). mya có subagent pool + async — WN thêm **background registry** + **extend/promotion** + **auto-parent-notify**.

## Kiến trúc

```
  PARENT AGENT
       │ spawn(background: true)
       ▼
  ┌─── JOB REGISTRY: start ──────────────────────────────┐
  │  job = registry.start(goal, background: true)         │
  │  job.id = "job-42", status = "running"                │
  │  → parent KHÔNG block, tiếp tục làm việc khác         │
  └───────────────┬─────────────────────────────────────┘
                  │ (job dài → extend TTL)
                  ▼
  ┌─── EXTEND (TTL keep-alive) ───────────────────────────┐
  │  job sắp expire → registry.extend(job.id) → gia hạn   │
  └───────────────┬─────────────────────────────────────┘
                  │ (job done — async)
                  ▼
  ┌─── AUTO PARENT NOTIFY + PROMOTE ─────────────────────┐
  │  job done → registry tự gửi parent message:           │
  │  "background job job-42 done: result = ..."           │
  │  → parent nhận KHÔNG cần poll                          │
  │  promote(job.id) → kết quả lên foreground context      │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent pool.ts — subagent pool (nền — WN background ở đây)
// ✅ packages/agent subagent.ts — subagent lifecycle (nền — WN job analog)
// ✅ packages/core RuntimeEvent — event stream (nền — WN auto-notify)
// ✅ packages/agent sdk.ts — agent SDK (nền — WN spawn API)

// ❌ THIẾU: background registry (start/extend/waitForPromotion/promote)
// ❌ THIẾU: TTL keep-alive (extend chống expire)
// ❌ THIẾU: auto-parent-notify (done → parent message tự động)
```

## Implementation

```typescript
// packages/agent/src/background-subagent-registry.ts (MỚI)
type JobStatus = "running" | "done" | "promoted";

interface BackgroundJob {
  id: string;
  goal: string;
  status: JobStatus;
  result?: unknown;
  expiresAt: number;
  onDone?: (result: unknown) => void; // parent callback
}

class BackgroundSubagentRegistry {
  private jobs = new Map<string, BackgroundJob>();

  // start: spawn background subagent → job handle (parent không block)
  start(goal: string, ttlMs: number, onDone?: (r: unknown) => void): string {
    const id = crypto.randomUUID();
    const job: BackgroundJob = { id, goal, status: "running", expiresAt: Date.now() + ttlMs, onDone };
    this.jobs.set(id, job);
    return id;
  }

  // extend: TTL keep-alive (chống expire)
  extend(id: string, ttlMs: number): void {
    const job = this.jobs.get(id);
    if (job) job.expiresAt = Date.now() + ttlMs;
  }

  // complete: job done → auto-notify parent (callback) + mark done
  complete(id: string, result: unknown): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = "done";
    job.result = result;
    job.onDone?.(result); // AUTO parent notify
  }

  // promote: background → foreground (kết quả lên parent context)
  promote(id: string): unknown {
    const job = this.jobs.get(id);
    if (!job || job.status !== "done") throw new Error("job not done");
    job.status = "promoted";
    return job.result;
  }

  // waitForPromotion: parent đợi job done → return result
  async waitForPromotion(id: string): Promise<unknown> {
    return new Promise(resolve => {
      const job = this.jobs.get(id);
      if (job?.status === "done") return resolve(job.result);
      const orig = job?.onDone;
      if (job) job.onDone = (r) => { orig?.(r); resolve(r); };
    });
  }
}

// Usage:
// const reg = new BackgroundSubagentRegistry();
// const id = reg.start("analyze code", 60000, r => parent.notify(r)); // background + auto-notify
// reg.extend(id, 60000); // keep-alive
// reg.complete(id, { issues: 3 }); // → auto-notify parent
// const result = await reg.waitForPromotion(id); // hoặc đợi promote
```

## Được

- ✅ Non-blocking (background → parent không đợi, làm việc khác)
- ✅ Auto-callback (done → parent nhận tự động, không poll)
- ✅ Promotion (background → foreground khi cần kết quả)
- ✅ TTL safety (expire job tự cleanup — không leak)

## Mất

- ❌ Concurrency complexity (nhiều background job → state rối)
- ❌ Callback timing (notify đến khi parent đang busy → race)
- ❌ TTL tuning (ngắn → expire sớm, dài → leak resource)
- ❌ Result staleness (background done lâu → kết quả cũ khi promote)

## Khác

Khác **611 WM subagent-depth-gating** (depth limit nesting) — WN **background async** (không block, không depth). Khác **542 TV turn-budget-recovery** (sync budget) — WN **async background** (non-blocking). Khác **poll-based** (parent poll status) — WN **callback-based** (auto-notify on done).

## Khi nào chọn

- Task dài (analysis, build) → parent không block, chạy nền
- Muốn auto-callback (done → parent nhận, không poll)
- Cần promotion (background → foreground khi kết quả cần ngay)
- Nối packages/agent pool.ts + subagent.ts + packages/core RuntimeEvent + sdk.ts; guard TTL-cleanup (expire → cleanup job), callback-race-safety (notify thread-safe), và result-freshness (promote stale → re-run check); WN = background subagent registry, kết hợp 611 WM subagent-depth-gating (depth) + 542 TV turn-budget-recovery (budget)
