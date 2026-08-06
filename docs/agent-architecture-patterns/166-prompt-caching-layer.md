# Hướng FJ: Prompt Caching Layer — tầng cache prompt/KV giảm cost + latency

> **Nguồn gốc:** arXiv 2601.06007 "An Evaluation of Prompt Caching for Long-Horizon Agentic" (41-80% cost, 13-31% TTFT); AWS "Optimize LLM response costs and latency with caching" (embeddings/tokens/outputs/prompts); Flexera "Prompt Caching: Cut token spend 2026" (90%); preMAI "8 Strategies That Cut API Spend by 80%" (50-70% với caching+routing)
> **Coupling:** 🟢 — lớp độc lập trước LLM, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (Redis cache + gateway sẵn; thiếu LLM-specific caching)
> **Effort:** 1-2 tuần

## Nguồn gốc

Prompt caching: **lưu lại phần prompt lặp lại / KV cache / semantic — gọi lại không phải gửi lại/không tính lại** — arXiv 2601.06007: "prompt caching reduces API costs by 41-80% and improves time to first token by 13-31% across providers" (đo trên agentic long-horizon); AWS: "storing and reusing previously computed embeddings, tokens, model outputs, or prompts"; Flexera: "cuts LLM input costs by up to 90%"; preMAI: "50-70% reduction by combining prompt optimization, caching, and model routing". Điểm khác **YYY cost tracking** (đo cost) và **GGG routing** (chọn model) — KKKKKKK *chủ động giảm cost*: (1) prefix cache (KV) — phần đầu prompt (system prompt + skills) lặp lại → cache (arXiv: 41-80%); (2) semantic cache — request gần giống nhau trả kết quả đã tính (maxim: "highest-impact optimization"); (3) output cache — kết quả lặp lại (AWS outputs); (4) policy — cái gì cache được (invalidation — mbrenndoerfer: hit rates), TTL; (5) đo hit rate (YYYY — theo dõi). Nối YYY (đo tiết kiệm), GGG (routing — cache-aware chọn model), BBB (gateway — chặn giữa), TTTT (lý do — hiển thị cache hit), PP (eval — cache không đổi chất lượng).

## Mô tả

mya prompt caching: (1) **prefix/KV cache** — prompt phần đầu (system, skills, few-shot) cố định → cache (Anthropic/OpenAI native prefix cache) — arXiv 2601.06007: agentic giảm 41-80%; (2) **semantic cache** — với tool/query lặp (embedded — gần nhau về nghĩa → trả cache thay vì LLM) — maximize "highest-impact"; (3) **output cache** — tác vụ deterministic lặp (summarize cùng input, cùng extraction) — AWS outputs; (4) **invalidation** — khi prompt thay đổi/context thay đổi → cache cũ (mbrenndoerfer hit-rate), TTL cho semantic; (5) **metric** — hit rate/cost tiết kiệm (YYYY — FinOps), báo user; (6) **safe policy** — không cache task sinh mới (viết bài — kết quả phải mới), chỉ cache task định nghĩa rõ.

## Kiến trúc

```
  LLM CALL
   │
   ▼
  CACHE LAYER (trước gateway BBB)
   · PREFIX/KV cache: system+skills → giảm 41-80% (arXiv 2601.06007)
   · SEMANTIC cache: query gần nghĩa → kết quả cũ (maxim highest-impact)
   · OUTPUT cache: task lặp deterministic → AWS outputs
   │
   ▼
  MISS? → LLM (routing GGG cache-aware) → lưu cache (TTL + invalidation)
   │
   ▼
  METRIC: YYY — hit rate · cost tiết kiệm · TTFT (Flexera 90%)
```

```
mya: Redis + BBB + YYY SẸN — thiếu: LLM-specific cache policy
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ Redis cache — nền lưu trữ
// ✅ BBB gateway — chặn giữa (chèn cache layer)
// ✅ YYY finops — đo cost (so trước/sau cache)
// ✅ GGG routing — chọn model (cache-aware)
// ✅ TTTT explainable — báo user "cache hit"
// ✅ PP eval — cache không đổi chất lượng

// ❌ THIẾU: prefix/KV cache policy (system+skills)
// ❌ THIẾU: semantic cache (embedding similarity)
// ❌ THIẾU: invalidation policy (mbrenndoerfer hit-rates)
```

## Implementation

```typescript
// packages/cache/src/llm-cache.ts (NEW)
export class PromptCache {
  async call(req: LlmRequest): Promise<LlmResult> {
    const hit = await semantic.match(req);      // embedding similarity (maxim)
    if (hit) { finops.record(hit, "hit"); return hit.result; }
    const res = await llm.route(req, cachePrefix(req)); // GGG — prefix cache
    await store(req, res);                        // TTL + invalidation
    return res;                                   // arXiv: -41-80% cost, -13-31% TTFT
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm 41-80% cost, 13-31% TTFT (arXiv 2601.06007) | ❌ Semantic cache — kết quả cũ cho query "na ná" |
| ✅ Đòn bẩy cao nhất, rủi ro thấp (digitalapplied) | ❐ Invalidation phức tạp (mbrenndoerfer hit-rates) |
| ✅ Nhanh — không phải gọi LLM lại (Flexera 90%) | ❌ Không cache được task sinh mới |
| ✅ Xây trên Redis + BBB + YYY | ❌ Prefix cache phụ thuộc provider hỗ trợ |

## Khác các hướng gần

| | YYY FinOps | GGG Routing | KKKKKKK: Prompt Cache |
|---|---|---|---|
| Vai trò | Đo cost | Chọn model | **Giảm cost/latency thực tế** |
| Cơ chế | Metric | Policy | **Lưu + tái sử dụng (KV/semantic/output)** |
| Quan hệ | Đo hiệu quả | Cache-aware | **Lớp giữa + tiết kiệm token** |

## Khi nào chọn

- Cost LLM cao, nhiều call lặp (agent dài hạn — arXiv long-horizon)
- System prompt/skills lớn cố định — prefix cache lợi ngay
- Đã có Redis + BBB + YYY — thêm cache policy
- Chấp nhận semantic cache cho task định nghĩa rõ (không sinh mới)