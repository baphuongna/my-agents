# Hướng ER: Scheduled Agents — agent tự chạy định kỳ (cron), tóm tắt/kiểm tra liên tục

> **Nguồn gốc:** Fast.io "AI Agent Job Scheduling: Best Patterns for 2026" (cron/event triggers/state persistence); ChatGPT Scheduled Tasks 2026 (periodic summaries); Azure SRE Agent scheduled tasks; AMD/GAIA recurring task scheduler (#550); Panaversity "Loop Skill and Cron Tools" (`/loop 15m`)
> **Coupling:** 🟢 — thêm bộ lập lịch, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cron sẵn + durable + session sẵn; thiếu recurring agent UI/state)
> **Effort:** 1 tuần

## Nguồn gốc

Scheduled agents: **agent chạy định kỳ — tổng kết, kiểm tra, theo dõi — không cần ai gọi** — Fast.io: "Schedule AI agent jobs with cron, event triggers, state persistence — handle artifacts between runs, reliable recurring workflows"; ChatGPT 2026: "Scheduled Tasks runs recurring and one-off prompts, reminders, and periodic summaries — a weekly roundup generated from a standing prompt"; Azure SRE: "automate monitoring, enforce security, validate recovery"; Panaversity: "parent agent can use /loop to periodically check on long-running subagent work: /loop 15m". Điểm khác **DD reconcile** (mong muốn state = state thực — vòng lặp k8s) — SSSSSS *task định kỳ có ngữ cảnh*: cron + agent; mỗi lần chạy: nhận ngữ cảnh lần trước (state persistence — artifacts QQQQ + memory), sinh tóm tắt mới, lưu artifact, so với lần trước (đổi gì?). Nối cron (sẵn — scheduler), UUUU durable (sống qua restart), QQQQ (artifact giữa các lần), TT (checkpoint), YYYY (metric mỗi lần chạy), BBBBBB (kiểm tra agent có chạy đúng giờ không).

## Mô tả

mya scheduled agents: (1) **định nghĩa** — agent + schedule (cron: mỗi giờ/ngày/tuần) + standing prompt (nhiệm vụ lặp); (2) **state giữa các lần** — mỗi lần chạy nhận: artifact lần trước (QQQQ), memory tăng dần (MM) — "weekly roundup" biết tuần trước viết gì; (3) **kết quả có chỗ** — output lưu artifact versioned + thông báo nếu có thay đổi đáng chú ý (so lần trước); (4) **sống qua restart** — UUUU durable: schedule + state lưu DB (AMD/GAIA: "tasks survive server restart — reloaded from DB"); (5) **giám sát chính mình** — BBBBBB: agent có chạy đúng giờ/không kẹt không (missed runs → alert); (6) **rẻ** — chạy không phải lúc nào cũng cần LLM: task đơn giản (check trạng thái) dùng script + LLM chỉ khi thay đổi (chống tốn token vô ích — SS).

## Kiến trúc

```
  SCHEDULE (cron — sẵn): mỗi giờ/ngày/tuần ──► STANDING PROMPT (nhiệm vụ lặp)
        │
        ▼
  STATE GIỮA CÁC LẦN: artifact lần trước (QQQQ) + memory (MM)
        │
        ▼
  CHẠY: agent xử lý → output mới (versioned artifact — QQQQ)
        │
        ▼
  SO VỚI LẦN TRƯỚC: có thay đổi đáng chú ý? → thông báo (không spam)
        │
        ▼
  SỐNG QUA RESTART: schedule + state trong DB (UUUU durable — AMD/GAIA)
        │
        ▼
  TỰ GIÁM SÁT: BBBBBB — chạy đúng giờ? kẹt? missed run → alert
```

```
mya: cron + durable + QQQQ SẸN — thiếu: recurring agent state + change-diff + notify
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ cron — scheduler (nền tảng chạy định kỳ)
// ✅ UUUU durable — sống qua restart
// ✅ QQQQ artifact — lưu kết quả giữa các lần
// ✅ MM memory — ngữ cảnh tích lũy
// ✅ BBBBBB watchdog — kiểm tra đúng giờ/kẹt

// ❌ THIẾU: recurring agent runner (standing prompt + state per run)
// ❌ THIẾU: change-diff + notify (so với lần trước)
// ❌ THIẾU: skip LLM khi không cần (SS — chạy script trước)
```

## Implementation

```typescript
// packages/schedule/src/recurring.ts (NEW)
export class RecurringAgent {
  async run(job: ScheduledJob, prev: Artifact | null): Promise<Result> {
    if (!this.shouldRunLLM(job, prev)) return scriptOnly(job); // SS — rẻ
    const out = await agent.run(job.prompt, { prev });         // standing prompt
    const diff = await diff(prev, out);                        // đổi gì?
    if (diff.notable) notify(job.channel, out);                // chỉ thông báo đáng chú ý
    return artifacts.save(job, out);                           // QQQQ — versioned
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tự động tổng kết/kiểm tra định kỳ — không cần người gọi | ❌ Prompt không tốt → spam vô nghĩa mỗi ngày |
| ✅ State giữa các lần — "weekly roundup" có ngữ cảnh | ❐ Tốn token nếu không tối ưu (SS — script trước) |
| ✅ Chỉ thông báo khi có thay đổi đáng chú ý (diff) | ❌ Lịch sai/kẹt — cần tự giám sát (BBBBBB) |
| ✅ Xây trên cron + durable + QQQQ | ❌ Task quá thường (mỗi phút) → tải nhỏ nhưng dồn |

## Khác các hướng gần

| | DD Reconcile | TT Checkpoint | SSSSSS: Scheduled |
|---|---|---|---|
| Kích hoạt | Vòng lặp trạng thái | Sự kiện/chủ động | **Cron định kỳ** |
| Mục đích | Đưa về mong muốn | Dừng/tiếp tục | **Chạy lặp + ngữ cảnh lần trước** |
| Quan hệ | Nền | Thành phần | **Dùng cả 2** |

## Khi nào chọn

- Cần tổng kết định kỳ (daily/weekly report) — agent làm hộ
- Cần theo dõi lặp (check status, giá, cạnh tranh) — có ngữ cảnh lần trước
- Đã có cron + durable + QQQQ — thêm recurring runner + diff/notify
- SRE/ops — agent tự kiểm tra an toàn định kỳ (Azure SRE Agent)