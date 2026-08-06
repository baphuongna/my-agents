# Hướng KN: Off-Peak Batch Window — chạy batch LLM lúc giá rẻ, job nền tránh peak

> **Nguồn gốc:** AWS Spot Instances; cloud off-peak pricing; cron/batch scheduling; AWS Batch; utility-grid off-peak
> **Coupling:** 🟢 — scheduler tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (batch/scheduled sẵn — thiếu off-peak detection + deferral)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Off-peak pricing** (electricity grid): năng lượng rẻ ngoài giờ cao điểm — chạy máy giặt/industry lúc đó. Cloud: AWS Spot Instances (dùng capacity thừa, rẻ 90%), off-peak egress. LLM: nhiều provider giá token theo tier/thời gian (batch API rẻ hơn real-time — OpenAI Batch API giảm 50%). Nguyên tắc: job **không cần ngay** (index RAG, sinh synthetic data 91, eval batch, distill 151) → trì hoãn sang cửa sổ giá rẻ, tránh cạnh tranh capacity peak. Cron (148 scheduled-agents) + batch (222).

## Mô tả

mya off-peak batch: job nền (rebuild index RAG, chạy eval suite, distill model 151, tổng hợp memory 82) không cần real-time → xếp vào **cửa sổ off-peak** (giờ provider rẻ / capacity thừa). Scheduler phát hiện off-peak (giờ cố định hoặc API giá động) → chạy batch queue (222). Job cần-gấp (user đang đợi) vẫn real-time. Khác chạy mọi lúc: off-peak **tách urgent vs deferred** — deferred chờ rẻ, tiết kiệm 127 finops. Nối 44 cost-budget (giảm chi phí) + 222 batch.

## Kiến trúc

```
  JOB đến:
    ┌─ URGENT (user đợi) ──────► real-time (pay peak price)
    └─ DEFERRED (nền) ─┐
                       ▼
              ┌─────────────────┐
              │ BATCH QUEUE     │  (RAG index, eval, distill,
              │ (deferred jobs) │   memory consolidate, synth data)
              └────────┬────────┘
                       │ chờ
                       ▼
            ┌───────────────────────┐
            │ OFF-PEAK DETECTOR     │
            │  giờ rẻ (02:00-06:00) │
            │  hoặc API giá động    │
            │  hoặc spot available  │
            └──────────┬────────────┘
                       ▼ yes (rẻ)
            BẠT batch queue → chạy 222
            → tiết kiệm 50-90% (spot / batch API)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 222 batch-llm-processing — batch (nền off-peak)
// ✅ 148 scheduled-agents — cron (chạy theo giờ)
// ✅ 44 cost-budget / 127 agentic-finops — cost (mục tiêu tiết kiệm)
// ✅ 91 synthetic-eval-data — job nền (ứng viên off-peak)
// ✅ 82 memory-consolidation — job nền (ứng viên)

// ❌ THIẾU: off-peak detector (giờ rẻ / giá động / spot)
// ❌ THIẾU: urgent vs deferred classification
// ❌ THIẾU: deferral queue (chờ cửa sổ rẻ)
// ❌ THIẾU: spot/batch-API integration (giá rẻ)
```

## Implementation

```typescript
// packages/agent/src/offpeak.ts (NEW)
interface BatchJob { id: string; urgent: boolean; run: () => Promise<void>; cost: number; }

class OffPeakScheduler {
  private deferred: BatchJob[] = [];

  submit(job: BatchJob): void {
    if (job.urgent) void job.run(); // cần-gấp → chạy ngay
    else this.deferred.push(job);   // nền → chờ off-peak
  }

  isOffPeak(now = new Date()): boolean {
    const h = now.getHours();
    return h >= 2 && h < 6; // cửa sổ rẻ (hoặc check API giá động)
  }

  async tick(): Promise<void> {
    if (!this.isOffPeak() || !this.deferred.length) return;
    // Off-peak → chạy batch (222), dùng spot/batch-API (giá rẻ)
    const batch = this.deferred.splice(0); // lấy tất cả
    await runBatch(batch.map((j) => j.run)); // 222
  }
}

// Cron tick mỗi 15 phút → khi off-peak bạt queue
setInterval(() => scheduler.tick(), 15 * 60 * 1000);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiết kiệm 50-90% (spot / batch API) | ❌ Job nền bị trì hoãn (SLA chậm hơn) |
| ✅ Tránh cạnh tranh capacity peak (ổn định) | ❌ Off-peak window có thể đổi (API động) |
| ✅ Tách urgent/deferred rõ (không đè peak) | ❌ Spot có thể bị pre-empt (cần retry) |
| ✅ Nối 222 batch + 148 cron | ❌ Cửa sổ có thể ngắn (không chạy hết queue) |

## Khác các hướng gần

| | 222 Batch LLM | 148 Scheduled Agents | KN: Off-Peak Batch |
|---|---|---|---|
| Khi | Theo batch size | Theo giờ cố định | **Theo giá/capacity (động)** |
| Mục | Throughput | Đúng giờ | **Rẻ (cost-optimal)** |
| Urgent | ❌ | ❌ | ✅ tách urgent/deferred |
| Tiết kiệm | Medium | ❌ | ✅ lớn (spot/batch) |

## Khi nào chọn

- Job nền không cần real-time (eval, index, distill, synth data)
- Muốn giảm cost (127 finops) — chấp nhận chờ giờ rẻ
- Provider có giá động / spot / batch-API rẻ hơn
- Peak hay bị rate-limit (196) → dồn sang off-peak
