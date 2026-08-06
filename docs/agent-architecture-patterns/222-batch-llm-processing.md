# Hướng OOOOOOOO: Batch Processing & Context Batching — gom nhiều request qua 1 forward, tăng throughput giảm cost

> **Nguồn gốc:** apxml "Async & Batching in RAG" ("LLMs achieve much higher throughput khi processing inputs in batches — GPUs designed for parallel computation"); zylos "LLM Inference Optimization" ("continuous batching delivers up to 23x throughput"); AnyScale "Batch LLM Inference" (cost giảm tới 2.9x so với online — Bedrock/OpenAI); Swfate "Batch Inference 70% cut 2026"; deepchecks "Batch Processing for LLMs" (cuts inference costs, boosts throughput, scale AI workloads); Spheron (PagedAttention — 64+ concurrent — 25% higher throughput)
> **Coupling:** 🟢 — chỉ chạm tầng gọi LLM (phía sau)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (gọi online từng request — chưa batching queue)
> **Effort:** 3-6 tuần

## Nguồn gốc

Batching: **thay vì gọi model từng request — chờ/gom request thuộc dạng giống nhau (cùng kích thước, nhánh) vào một batch; LLM xử lý song song trên GPU — throughput tăng nhiều, chi phí giảm** — apxml: "batching allows exploit parallelism"; AnyScale: 2.9x rẻ hơn online; Swfate: 70% cut; zylos: continuous batching 23x. Khác **async concurrency** (song song nhưng từng request riêng lẻ) — OOOO *gom chung forward*. Khác **message-broker (early)** — queue lưu công việc but batch tại inference layer. Kết nối: **205 self-consistency** (nhiều sample — có thể batch), **202 EDA** (event → batch window), mya — hiện gọi trực tiếp/online bất đồng bộ — chưa có buffer batch tầng serving.

## Kiến trúc

```
  REQUESTS (RAG call, tool summarize, self-consistency N-sample, eval)
        │
        ▼
  QUEUE/COLLECTOR (gom request — chờ window: 500ms / tới ngưỡng N)
        │
        ▼
  BATCHER (sắp xếp: cùng model, same token budget → batch)
        │
        ▼
  GPU / Serving (1 forward-batch — continuous batching)
        │
        ▼
  RETURN (map result về request ban đầu; latency = max(batch))
```

```
mya: gọi từng request online — chưa collector/batching tầng serving
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 12 event-stream — async sẵn (nền)
// ✅ 12 event-stream — concurrency cơ bản (chưa là batch)
// ✅ 202 EDA — event-driven có
// ✅ 70 llm-gateway/05 llm-proxy — quản lý request

// ❌ THIẾU: queue/collector (gom window)
// ❌ THIẾU: serving-side batch (host / reduced rate)
// ❌ THIẾU: chunk theo model/prompt — quyết latency vs throughput
```

## Implementation

```typescript
// packages/batch/src/batcher.ts (NEW)
export class Batcher {
  async infer(request: Req): Promise<Resp> {
    const lane = await queue.pull(request);      // gom window — batching
    if (lane.full) return lane.flush();           // đủ ngưỡng → forward 1 lần
    return lane.await();                          // chờ — rồi trả theo id
  }
}
// kết: áp dụng tốt: self-consistency N samples cùng batching → rẻ hơn
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Throughput tăng nhiều (2-23x — zylos) | ❌ Latency tăng (chờ window) — không hợp bulk realtime |
| ✅ Giảm chi phí 50-70% (Swfate; AnyScale 2.9x) | ❌ Cần kiểm soát queue/backpressure |
| ✅ GPU dùng triệt — hạ cost | ❌ Phải cân batch vs realtime — tránh congest |
| ✅ Kết 12/202 — tích nhẹ | ❌ Không giúp ích cho 1 request lẻ — chỉ lợi khi volume cao |

## Khác các hướng gần

| | 202 EDA | 12 Stream | OOOOOOOO: Batch |
|---|---|---|---|
| Mục | Event flow | Token ra | **Gom chung forward** |
| Vị trí | Bus | Output | **Inference layer** |
| Quan hệ | Nguồn | Đưa ra | **Chỉ phục vụ — phía dưới** |

## Khi nào chọn

- Volume lớn (crawl ban đêm, eval, background job) — không cần latency time
- Cost model đắt — batch giảm 2-3x
- đã có queue/EDA; làm thêm lớp serving
- Không khi: thời gian thực interactive — giữ sync