# Hướng SU: Hermes Scale-to-Zero Cron — cron giao scheduler ngoài, arm one-shot fire rồi webhook agent

> **Nguồn gốc:** hermes-agent `cron/scheduler_provider.py` (`CronScheduler` ABC, `InProcessCronScheduler`, "scale-to-zero deployments", "NAS-mediated managed-cron provider", `cron.provider` config key); "scheduler decides WHEN, not WHAT"; "execution + delivery shared"; "external provider (Chronos, Phase 4)" | **Coupling:** 🟢 — tách trigger (scheduler ngoài) khỏi execution (agent), one-shot fire → webhook | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (cron/scheduler chưa có — cần external scheduler + webhook receiver + one-shot arm) | **Effort:** 3-4 tuần

## Nguồn gốc

**hermes-agent** tách **2 trục cron**: **Axis B — trigger** (`CronScheduler` provider: quyết định **kHI** job fire) và **execution+delivery** (`run_job`/`_deliver_result`: job fire → chạy agent + giao kết quả, dùng chung cho mọi provider). Cho **scale-to-zero deployment** (agent không luôn chạy — tốn tài nguyên khi idle), built-in `InProcessCronScheduler` (daemon-thread ticker) không hợp — thay bằng **external managed-cron provider** (NAS-mediated, Chronos Phase 4): agent **scale về 0** khi idle, scheduler ngoài **arm one-shot** job到期 → **fire webhook** đánh thức agent → agent chạy 1 turn + deliver → **scale về 0** lại. Nguyên tắc: **trigger tách execution** — scheduler ngoài giữ thời gian, agent chỉ thức khi cần. Khác **ER Scheduled-Agents** (in-process daemon) — SU là **external scheduler + scale-to-zero**.

## Mô tả

mya scale-to-zero cron: (1) **External scheduler**: managed-cron ngoài (NAS/Chronos) giữ lịch — agent idle = scale-0 (không tốn tài nguyên). (2) **Arm one-shot**: mỗi job到期 → scheduler fire **webhook** (HTTP POST) → đánh thức agent. (3) **Agent wake**: nhận webhook → chạy 1 turn (job logic) + deliver result. (4) **Scale-0 lại**: xong → agent ngủ (idle, không tài nguyên) cho tới webhook tiếp. (5) **Provider split**: trigger (scheduler ngoài) ≠ execution (agent) — đổi provider không đổi logic. mya có `packages/agent` loop + webhook — SU thêm **external scheduler adapter** + **webhook receiver** + **one-shot arm/disarm**.

## Kiến trúc

```
  ┌─── EXTERNAL SCHEDULER (NAS / Chronos) ──────────────┐
  │  giữ lịch: job A mỗi 9:00, job B mỗi 30p               │
  │  agent IDLE = scale-0 (không tài nguyên)               │
  └───────────────────────┬─────────────────────────────┘
                          │ (9:00 → job A due)
                          ▼
  ┌─── ONE-SHOT FIRE (webhook) ──────────────────────────┐
  │  POST https://agent/webhook { job: "A", fire_id }     │
  │  → đánh thức agent (scale 0 → 1)                       │
  └───────────────────────┬─────────────────────────────┘
                          │ (agent wake)
                          ▼
  ┌─── AGENT EXECUTE 1 TURN + DELIVER ───────────────────┐
  │  run_job("A") → agent chạy logic → deliver result      │
  │  xong → arm lại (next due) → scale-0 (ngủ)             │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent loop — agent run (nền — SU execute 1 turn)
// ✅ webhook/HTTP transport — receive (nền — SU webhook receiver)
// ✅ ER scheduled-agents — in-process cron (nền — SU external thay built-in)

// ❌ THIẾU: external scheduler adapter (NAS/Chronos API)
// ❌ THIẾU: webhook receiver (POST → wake agent → run_job)
// ❌ THIẾU: one-shot arm/disarm (schedule next, scale-0 when idle)
// ❌ THIẾU: provider config (cron.provider: builtin | external)
```

## Implementation

```typescript
// packages/agent/src/scale-zero-cron.ts (MỚI)
interface CronJob { id: string; cron: string; prompt: string }

interface ExternalScheduler {
  name: string;
  armOneShot(job: CronJob, webhookUrl: string): Promise<string>; // returns fire token
  disarm(token: string): Promise<void>;
}

class ScaleZeroCron {
  private jobs = new Map<string, { job: CronJob; token?: string }>();
  constructor(
    private scheduler: ExternalScheduler,
    private runJob: (job: CronJob) => Promise<string>, // execute + deliver (shared)
  ) {}

  // register job → arm one-shot (agent can scale-0 after)
  async register(job: CronJob, webhookUrl: string): Promise<void> {
    const token = await this.scheduler.armOneShot(job, webhookUrl);
    this.jobs.set(job.id, { job, token });
  }

  // webhook receiver: external scheduler fired → wake agent
  async onWebhook(payload: { job: string; fire_id: string }): Promise<string> {
    const entry = this.jobs.get(payload.job);
    if (!entry) return 'no such job';
    const result = await this.runJob(entry.job);     // execute 1 turn + deliver
    await this.scheduler.disarm(entry.token!);        // clear fired
    entry.token = await this.scheduler.armOneShot(entry.job, this.webhookUrl); // re-arm next
    return result;
  }

  webhookUrl = ''; // set at boot
}

// Usage:
// await cron.register(jobA, 'https://agent/webhook'); // arm, then scale-0
// // 9:00 → external fires webhook → onWebhook → runJob → re-arm → scale-0
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Scale-to-zero (agent idle = 0 tài nguyên) | ❌ Webhook dependency (external scheduler down → miss job) |
| ✅ Trigger tách execution (đổi provider dễ) | ❌ Wake latency (cold-start khi webhook fire) |
| ✅ External scheduler reliable (NAS/Chronos) | ❌ One-shot arm overhead (re-arm mỗi fire) |
| ✅ Agent chỉ thức khi cần (cost thấp) | ❌ Debug khó (trigger ngoài, không in-process) |

## Khác các hướng gần

| | ER Scheduled-Agents | In-Process Daemon | SU: Scale-Zero-Cron |
|---|---|---|---|
| Cái gì | Cron in-process | Thread ticker | **External scheduler + scale-0** |
| Idle | Luôn chạy (tốn tài nguyên) | Luôn chạy | **Scale-0 (0 tài nguyên)** |
| Trigger | Internal | Internal thread | **External (webhook fire)** |

## Khi nào chọn

- Agent idle nhiều (cron thưa) — scale-0 tiết kiệm tài nguyên
- Có external managed-cron (NAS/Chronos) — đáng tin hơn daemon
- Muốn trigger tách execution (đổi scheduler không đổi logic)
- Nối packages/agent loop + webhook transport + ER scheduled-agents; guard webhook availability (external down → fallback/retry), cold-start latency (wake chậm), và re-arm correctness (one-shot không leak/fire trùng); SU = scale-to-zero qua external scheduler, kết hợp ER Scheduled-Agents (built-in khi agent luôn chạy)
