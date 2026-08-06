# Hướng HHHHHHHH: Deadline-Bounded Execution — giới hạn thời gian chạy của mỗi bước LLM, trả kết quả một phần, không leo thang

> **Nguồn gốc:** YouTube "LLM Retry Budgets: Cut Latency, Cost, and Duplicate Side Effects" ("design bounded retry behavior using deadlines, cost, priority, error classification"); zylos.ai "LLM Output Streaming" (TTFT — time-to-first-token, dominated by prefill phase); LinkedIn "Why Increasing Your API Timeout Won't Fix LLM Latency" (gọi LLM như REST API — send and wait — không đúng với latency LLM); BAML docs "Configuring Timeouts" (timeout mọi stage — prevent requests hanging indefinitely); mdpgroup (TTFT, TPOT, latency — "20% requests timeout" quản lý bằng thời gian-bước)
> **Coupling:** 🟡 — chạm mọi placeholder gọi LLM/agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (timeout cứng đơn lẻ; chưa deadline-budget + partial result)
> **Effort:** 2-4 tuần

## Nguồn gốc

Deadline-bound: **thay vì timeout cứng mặc định, gán *deadline* cho mỗi task lượn lên cả agent — nếu quá hạn: trả kết quả từng phần/ fallback / huỷ — không chờ vô hạn** — baml: "prevent requests hanging indefinitely"; retrybudget: gộp deadline + cost + priority + phân loại lỗi; LinkedIn: gọi LLM như REST "send and wait" — nhưng LLM latency biến động — timeout tăng lên vô ích; zylos: TTFT do prefill — nên deadline phải tính theo *giai đoạn* (TTFT vs TPOT), retry-stream vs cắt. Khác **196 rate-limiting** (hạn mức theo cửa sổ — không phải thời hạn từng yêu cầu) và **203 loop-guard** (dừng vòng lặp không tiến — khác mức) — HHH deadline là *thước thời gian tuyệt đối* (budget đã cấp), trả partial. Kết nối: **203** dùng deadline làm cơ chế dừng; **196 rate-limiting** giới hạn tần suất; **44 cost-budget** giới hạn chi phí. mya: retries có nhưng deadline global + partial chưa.

## Kiến trúc

```
  USER REQUEST ──► BUDGET (deadline quyết định theo tầng task priority)
        │
        ▼
  SUBTASKS (mỗi bước kế thừa deadline còn + margin — chết cả chain)
        │
        ▼
  LLM CALL (timeout theo *giai đoạn* — prefill TTFT vs token TPOT)
        │   ├── còn budget → chạy tiếp
        │   └── hết → PARTIAL RESULT (trả những gì đã làm — mark incomplete)
        ▼
  RETRY (bounded — theo deadline, không lặp vô hạn — 203)
```

```
mya: timeout cứng per call — chưa rải deadline + trả partial
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 203 retry guard — sẵn chống lặp-không-tiến
// ✅ timeout mặc định mỗi call (thô — chưa phân theo pha)
// ✅ 12 event-stream — trả từng phần (nền để partial)

// ❌ THIẾU: deadline propagation (cha→con — budget phân bổ)
// ❌ THIẾU: timeout theo giai đoạn (TTFT vs token rate)
// ❌ THIẾU: trả partial có đánh dấu (incomplete — để user quyết)
```

## Implementation

```typescript
// packages/deadline/src/budget.ts (NEW)
export function withDeadline<T>(task: Task<T>, budget: Duration): Promise<T> {
  const deadline = now + budget;
  return orchestrate(task, {
    stageTimeout: (phase) => phase === "prefill" ? ttf1(deadline) : tpot(deadline),
    onOver: () => partial(task, { incomplete: true }),   // trả nửa chừng — đánh dấu
    retry: { classify: err, ttl: remaining(deadline) },  // retry có hạn (203)
  });
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không treo vô hạn — UX ổn định (BAML prevent hang) | ❌ LLM latency biến — deadline cứng có thể cắt lúc sắp xong |
| ✅ Trả partial — user thấy tiến, đã quyết tiếp (không mất trắng) | ❌ Partial đôi vô dụng nếu task không chia được |
| ✅ Không trả thêm token sau deadline (tiết kiệm cost) | ❌ Vẫn không "chữa" LLM chậm — chỉ giới hạn impact |
| ✅ Kết hợp 203 — retry có hạn, giảm duplicate side-effect | ❌ Phân product phải đánh dấu incomplete — thêm việc |

## Khác các hướng gần

| | 203 Loop-guard | 196 Rate-limit | 44 Cost-budget | HHHHHHHH: Deadline |
|---|---|---|---|---|
| Mục | Dừng lặp không tiến | Giới hạn tần suất | Giới hạn chi phí | **Chấm hết theo thời gian** |
| Tiêu chí | Tiến độ | Số request/cửa sổ | Token/cost | **Clock — deadline tuyệt đối** |
| Quan hệ | Bổ sung | Bổ sung | Bổ sung | **Xuyên dọc — áp lên mọi call** |

## Khi nào chọn

- LLM tắc/biến động (latency không ổn định) — request bị treo thường xuyên
- Task lớn nhiều bước — muốn trả tiến bộ khi budget cạn
- Cost quan trọng — không muốn trả token sau deadline
- Luôn: đánh dấu partial rõ "incomplete" để không tự tin dùng nửa kết quả