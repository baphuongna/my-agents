# Hướng GI: KV & Semantic Cache — tầng cache LLM 2 lớp: KV (inference) + semantic (output reuse)

> **Nguồn gốc:** Sebastian Raschka "What is a KV cache" (stores key/value tensors từ attention — inference optimization); machinelearningmastery "Complete Guide to Inference Caching" (KV + semantic + prompt caching giảm cost/latency); Medium mrschneider "Semantic vs KV Cache" (KV — internal representations; semantic — reuse kết quả tương tự); Spheron "Semantic Caching" (semantic cắt 30-70% inference cost — GPTCache/Redis); SafeKV (arXiv 2508.08438 — KV-cache prompt leakage side-channel)
> **Coupling:** 🟢 — lớp hạ tầng, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (KKKKKKK prompt cache sẵn; thiếu KV + semantic layer)
> **Effort:** 1-2 tuần

## Nguồn gốc

KV & semantic cache: **2 tầng cache LLM khác nhau — KV cache lưu tensor attention (tính nhanh lần gọi lại), semantic cache lưu KẾT QUẢ cho request gần nghĩa** — Raschka: "KV cache stores the key and value tensors produced by every attention layer — primarily an inference optimization"; mrschneider: "KV caching makes inference more efficient; semantic caching ... reuse similar query results"; Spheron: "semantic caching cuts LLM inference costs 30-70% by reusing similar query results (GPTCache/Redis)"; SafeKV (arXiv 2508.08438): KV cache có rủi ro side-channel — prompt leakage (nhiều user chung cache). Điểm khác **KKKKKKK prompt cache** (prefix cache — lặp phần đầu prompt) — JJJJJJJJ *toàn diện hơn*: (1) KV cache — tự model/provider làm (prefix + session reuse — đỡ tính lại attention); (2) semantic cache — mya tự làm: request gần nghĩa (embedding similarity) → trả kết quả đã tính (GPTCache-style) — không gọi LLM; (3) cache đúng task — chỉ cache deterministic (same input → same output: summarize, extract, format) — KHÔNG cache task sinh mới; (4) TTL + invalidation — dữ liệu đổi → cache cũ (RAG — docs thay đổi phải invalidate); (5) security — cache per tenant (SafeKV — không cho agent/user khác đọc cache của nhau — prompt leakage); (6) metric — hit rate + cost tiết kiệm (YYYY + LLLLLLL attribution). Nối KKKKKKK (prompt cache — tầng trên), YYY (đo), LLLLLLL (attribution cache hit rẻ), WWWWWW (task deterministic hay không — quyết cache), 155 (forget — xóa cache user), VVVVVVV (data governance — cache là dữ liệu nhạy).

## Kiến trúc

```
  LLM CALL
        │
        ▼
  SEMANTIC CACHE (Spheron — GPTCache/Redis): query gần nghĩa → kết quả cũ
   · 30-70% cost giảm · chỉ task deterministic (summarize/extract/format)
        │  MISS
        ▼
  KV CACHE (Raschka — model tự làm): attention tensors reuse — nhanh TTFT
        │  MISS
        ▼
  LLM → lưu kết quả (TTL + invalidation — RAG thay đổi → bỏ cache)
        │
        ▼
  SECURITY (SafeKV): cache per tenant — chống prompt leakage
   · METRIC (YYYY): hit rate · cost tiết kiệm (LLLLLLL)
```

```
mya: KKKKKKK SẴN — thiếu: semantic cache + KV layer + per-tenant
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ KKKKKKK prompt caching — prefix cache (tầng trên)
// ✅ Redis — hạ tầng cache (nền)
// ✅ YYY finops + LLLLLLL — đo hit/cost
// ✅ WWWWWW intent — biết task deterministic không
// ✅ VVVVVVV data governance — cache là dữ liệu (permission)
// ✅ 155 forget — xóa cache user

// ❌ THIẾU: semantic cache (embedding similarity — GPTCache)
// ❌ THIẾU: invalidation theo nguồn dữ liệu (RAG thay đổi)
// ❌ THIẾU: per-tenant isolation (SafeKV — prompt leakage)
```

## Implementation

```typescript
// packages/cache2/src/semantic.ts (NEW)
export class SemanticCache {
  async get(q: Query): Promise<Hit | undefined> {
    if (!isDeterministic(q)) return;           // WWWWWW — chỉ task deterministic
    const n = nearest(embed(q), store);        // embedding similarity
    return within(n, EPSILON) ? n.value : undefined; // GPTCache style
  }
  async put(q: Query, r: Result): Promise<void> {
    store.set(embed(q), r, { ttl: ttl(q), tenant: q.tenant }); // SafeKV — per tenant
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 30-70% cost giảm (semantic — Spheron) + TTFT nhanh (KV) | ❌ Semantic sai → trả kết quả cũ sai ngữ cảnh |
| ✅ Task lặp (summarize/extract) — chạy 1 lần trả mãi | ❐ Invalidation phức tạp — RAG đổi là cache cũ |
| ✅ Nhẹ — Redis + embedding đã có | ❌ Per-tenant cần phân vùng cẩn thận (SafeKV) |
| ✅ Xây trên KKKKKKK + Redis + YYY | ❌ Kết quả trả về không mới — user hỏi "cập nhật chưa" |

## Khác các hướng gần

| | KKKKKKK Prompt Cache | 166 Prefix | JJJJJJJJ: KV+Semantic |
|---|---|---|---|
| Lưu gì | Phần prompt lặp | KV tensors | **Kết quả + tensor (2 tầng)** |
| Mức | Provider/API | Inference | **Output reuse + inference** |
| Quan hệ | Tầng trên | Tầng dưới | **Kết hợp tối ưu + per-tenant** |

## Khi nào chọn

- Nhiều request lặp cùng nghĩa (tool-like: extract/summarize/format)
- Muốn kết hợp cả 3 tầng cache (prompt + KV + semantic — tối đa)
- Chạy multi-tenant — phải tách cache per tenant (SafeKV)
- Đã có KKKKKKK + Redis + YYY — thêm semantic + invalidation