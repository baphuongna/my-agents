# Hướng JJ: Request Coalescing — gộp nhiều LLM call trùng prompt thành 1 forward, chia kết quả

> **Nguồn gốc:** Netflix Hystrix "Request Collapser" (gom N request đồng thời thành batch); GitHub "Request Coalescing" ( Collapse pattern); Wikipedia "Request collapsing"; Cloudflare cache `stale-while-revalidate` coalescing; LangChain "dedup concurrent LLM calls"; Redis single-flight pattern (`SETNX` lock — 1 call, N waiter)
> **Coupling:** 🟡 — chèn tầng dedup giữa caller và LLM provider
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (semantic cache sẵn — chưa có single-flight gate)
> **Effort:** 1-2 tuần

## Nguồn gốc

Request coalescing (Hystrix Request Collapser): khi N caller gửi *cùng* request trong 1 khoảng thời gian → **chỉ 1 thật sự gọi hạ tầng, N-1 còn lại chờ kết quả dùng chung** thay vì bắn N lần. Redis single-flight: dùng `SETNX` lock — request đầu lấy lock, request sau thấy in-flight → attach vào promise chờ. Cloudflare áp dụng cho cache stampede (thundering herd): nhiều request miss cache cùng lúc → 1 đi fetch, còn lại đợi. Đối với LLM: prompt giống hệt (cùng model, temperature 0, cùng system) → output deterministic → dùng chung hoàn toàn hợp lệ. Khác **GI (191) KV/semantic cache** (cache *kết quả* theo key sau khi xong) — JJ gộp *khi đang chạy*, giảm duplicate *concurrent*; khác **HN (222) batch processing** (gom request *khác nhau* vào 1 forward) — JJ gom request *giống nhau* thành 1. Khác **GU (203) retry** (lặp khi lỗi) — JJ chống lặp khi *thành công trùng*.

## Mô tả

mya request coalescing: trước mỗi LLM call, tính hash của (model, messages, params). Nếu đã có in-flight call cùng hash → attach waiter vào promise đó, không gọi thêm. Kết quả về → trả cho tất cả waiter. Cửa sổ coalesce ngắn (ms–s) để gộp được concurrent burst. mya hiện gọi LLM qua provider layer — có semantic cache (GI) nhưng cache chỉ hit khi *đã xong*; concurrent burst cùng prompt (vd 3 sub-agent cùng hỏi) vẫn bắn 3 lần. JJ thêm single-flight gate ở provider wrapper.

## Kiến trúc

```
  Caller A ─┐
  Caller B ─┼─► HASH(model+messages+params) ──► in-flight map?
  Caller C ─┘                                         │
                                               ┌──────┴──────┐
                                          miss │             │ hit (lock held)
                                               ▼             ▼
                                      LLM CALL (1)      ATTACH waiter
                                          │             (A,B,C chờ cùng promise)
                                          ▼
                                      RESOLVE ──► broadcast cho A, B, C
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GI (191) KV/semantic cache — cache kết quả theo key (sẵn)
// ✅ provider wrapper — chỗ chèn single-flight (sẵn chỗ)
// ✅ HN (222) batch — gom request khác nhau (khác mục đích)

// ❌ THIẾU: in-flight promise map (single-flight gate)
// ❌ THIẾU: hash chuẩn (model + messages + params determinism)
// ❌ THIẾU: window timeout (waiter không chờ vô hạn)
```

## Implementation

```typescript
// packages/coalesce/src/singleflight.ts (NEW)
const inflight = new Map<string, Promise<string>>();   // hash → in-flight call

function keyOf(model: string, messages: unknown[], params: unknown): string {
  return sha256(JSON.stringify({ model, messages, params }));   // deterministic
}

export async function coalescedCall(
  model: string, messages: unknown[], params: unknown,
  exec: () => Promise<string>, ttl = 10_000,
): Promise<string> {
  const key = keyOf(model, messages, params);
  const existing = inflight.get(key);
  if (existing) return existing;                          // attach waiter — không bắn thêm
  const p = exec().finally(() => inflight.delete(key));   // dọn khi xong
  inflight.set(key, p);
  return withTimeout(p, ttl);                             // waiter không chờ vô hạn (215)
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm cost — N call trùng → 1 forward (Netflix) | ❌ Chỉ trúng khi prompt giống HẾT (temp 0, params) |
| ✅ Chống thundering herd / cache stampede (Cloudflare) | ❌ Waiter chậm theo call chậm nhất — không rút ngắn |
| ✅ Tăng throughput burst (nhiều sub-agent cùng hỏi) | ❌ Phải dọn in-flight map (leak nếu crash giữa chừng) |
| ✅ Nối GI cache — cache miss burst cũng gộp được | ❌ Không dùng được cho non-deterministic (temp>0) |

## Khác các hướng gần

| | GI Semantic Cache | HN Batch | JJ: Coalescing |
|---|---|---|---|
| Gộp gì | Cache kết quả | Request *khác nhau* | **Request *giống nhau* concurrent** |
| Khi trúng | Sau khi xong | Chủ động queue | **Trong khi đang chạy** |
| Mục | Tránh recompute | Tăng throughput/cost | **Chống duplicate concurrent** |

## Khi nào chọn

- Nhiều sub-agent (199) có thể hỏi cùng prompt cùng lúc → burst trùng
- LLM call deterministic (temperature 0) — kết quả dùng chung hợp lệ
- Cost nhạy cảm — muốn cắt duplicate concurrent, không chỉ cache after-the-fact
- Không dùng khi: output có tính ngẫu nhiên (temp>0) — gộp sẽ trả giống nhau mất đa dạng
