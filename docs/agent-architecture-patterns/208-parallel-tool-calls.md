# Hướng AAAAAAAA: Parallel Tool Calls — LLM yêu cầu nhiều tool độc lập trong 1 lần, thực thi song song

> **Nguồn gốc:** Airbyte "What Are Parallel Tool Calls in LLMs?" ("pattern where the LLM identifies independent operations, requests them all in a single response"); OpenHands SDK "Parallel Tool Execution" ("when LLM requests multiple tool calls, the SDK executes them concurrently rather than sequentially"); Restate "Parallel Tool Calls" ("executing them in parallel significantly reduces latency"); tianpan.co "Parallel Tool Calls: The Coupling Test" (bật parallel tool calls **lộ ra hidden coupling** — 3 failure modes: shared state, ordering, side-effect)
> **Coupling:** 🔴 — bọc trần coupling ngầm của tool (shared state/order/rate-limit)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool loop chạy giày lần lượt; chưa có executor song ca)
> **Effort:** 1-3 tuần

## Nguồn gốc

Parallel tool: **thay vì LLM gọi tool A rồi chờ A xong mới gọi B độc lập — gom vài call độc lập vào 1 turn, execute concurrent, trả cùng lúc** — cuts latency (OpenHands SDK: ``Concurrency Ctrl``); Airbyte: "LLM identifies independent operations"; Restate: giảm latency đáng kể. Nhưng **tianpan.co**: parallel *test đơn* — (1) **shared state** — 2 tool cùng cập nhật 1 field → race; (2) **ordering**: parallel tool không đảm bảo trật tự — nếu B cần A, đừng parallel; (3) **rate limit/quota chung**: Redis/đếm call nó override → burst. So với **186 ensemble** (nhiều agent) — parallel gọi *độc lập cùng client*; **230 reactive-dataflow** — qua reactive pipeline (view của hẳn); 202 — communication. Đối với mya: tool có read (song ca OK an toàn) vs write (phải serialize theo khóa).

## Kiến trúc

```
   LLM TURN (muốn call A, B, C cùng lúc — 1 response: tool_calls[])
        │
        ▼
  DAG / GROUP (tian: phân loại)
      A, C — READ → song ca OK
      B     — WRITE / quanh khóa → theo depend (nếu A→B không parallel)
        │
        ▼
  EXECUTE (Promise.all đối với group read OK; batch lock cho write)
        │
        ▼
  MERGE kết quả (mỗi tool xong theo index — bind đúng tên)
   · retry riêng lẻ (tool lỗi không chết cả nhóm)
```

```
mya: listener gọi/tool tuần tự; chưa có DAG parse + batch
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool-call — a candidate (chạy tuần tự, minh bạch)
// ✅ 27 reactive-dataflow — sơ đồ phụ thuộc tool
// ✅ 196 rate-limiting — nhận biết effect + hạn mức
// ✅ 178 dynamic routing — chọn nơi thực thi

// ❌ THIẾU: executor chạy song ca (dùng lam những gì đã có)
// ❌ THIẾU: phát hiện tuple "read , read— both okay"— vs "write cùng khóa"
// ❌ THIẾU: merge an toàn (naming — gọi sai tên thường mất kết quả)
```

## Implementation

```typescript
// packages/toolpar/src/parallel.ts (NEW)
export async function parallelTools(calls: ToolCall[]): Promise<Result[]> {
  const { reads, writes } = partitionByEffect(calls);   // tian: classify coupling
  assertNoConflicting(writes);                          // cùng khóa → từ chối
  const out = await Promise.allSettled(reads.map(run));
  return collectOriginalOrder(calls, out);              // trả về theo thứ tự request
}
// batch lock theo resource hash cho write (redis — tránh race shared state)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm latency nhiều — N call độc lập × RTT 1 lần | ❌ Lộ coupling ngầm: 2 write cùng key — race (tian) |
| ✅ LLM turn ít — chi phí 1 turn cho N tasks | ❌ Debug khó hơn — kết quả "mảnh" merge lẫn |
| ✅ Hợp pipeline fan-out (crawl N sites, fetch N files) | ❌ Rate limit/hạn mức chung — burst búa |
| ✅ Khi đã có 27 reactive-dataflow — song song tự nhiên | ❌ Nếu phần lớn phụ thuộc lẫn nhau → parallel không tác dụng |

## Khác các hướng gần

| | 27 Reactive | 202 Comm | AAAAAAAA: Par-tool |
|---|---|---|---|
| Mục | Điều phối thứ tự | Trao đổi thông tin | **Gom call độc-exc song song** |
| Vị trí | dependency graph | bus | **Executor của agent** |
| Quan hệ | Để cung cấp | — | **Đọc khai thác — nhiều ô cửa cùng lúc** |



## Khi nào chọn

- Tool calls là hệ thuật nhiều trong 1 — đọc file, fetch url, query
- Đã có phân biệt read/write effect (tian: read OK, write lock)
- Không đổi khi: hay order (B cần A) > thời — giữ tuần
- Luôn kèm: lock cho shared resource + cho rate limit chung