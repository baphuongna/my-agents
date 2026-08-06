# Hướng JQ: Reasoning Memoization — cache kết quả suy luận theo input, dùng lại khi lặp

> **Nguồn gốc:** "memoization" (Donald Michie 1968); dynamic programming (Bellman — reuse subproblem results); "LLM reasoning caching"; prompt caching (Anthropic/OpenAI — cache prefix KV); CoT (chain-of-thought) repeated computation; LangChain "LLM cache"; GI (191) KV/semantic cache
> **Coupling:** 🟡 — chèn memo layer tại reasoning boundary
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (semantic cache GI sẵn — chưa có reasoning-subproblem memo)
> **Effort:** 1-2 tuần

## Nguồn gốc

Memoization (Michie 1968): lưu kết quả hàm theo input — gọi lại cùng input → trả kết quả lưu, không tính lại. Dynamic programming (Bellman): reuse kết quả subproblem. Áp cho reasoning: agent hay suy luận *lại* cùng sub-question (vd "parse spec này thành steps" lặp nhiều task) → memo theo (sub-question canonical) bỏ ra kết quả suy luận. Anthropic/OpenAI prompt caching: cache prefix KV — cùng system+context → giảm prefill cost. Khác **GI (191) KV/semantic cache** (cache *output LLM* theo key/embedding) — JQ memo *subproblem reasoning* (mảnh reasoning tái dùng ráp vào chain mới); khác **JJ (270) coalescing** (gộp concurrent) — JQ cache *đã xong*; khác **DU (125) structured reasoning** (output có cấu trúc) — JQ cache *kết quả* của structured reasoning; khác **JP (276) procedural** (lưu how-to thủ tục) — JQ lưu *kết quả suy luận cụ thể*.

## Mô tả

mya reasoning memoization: tách reasoning thành sub-step → memo theo canonical(sub-question + context-hash). Khi chain reasoning gặp sub-question đã memo → dùng kết quả, bỏ bước LLM. mya có semantic cache (GI) nhưng cache ở output cuối — JQ memo ở *mức sub-step*, cho phép ráp mảnh vào chain mới. Tăng tốc task có sub-question lặp (parse, classify, extract). TTL + invalidation khi context thay đổi.

## Kiến trúc

```
  CHAIN OF REASONING (step1 → step2 → step3 ...)
        │
        ▼ mỗi step:
  CANONICAL(step + context-hash) ──► MEMO?
        │                              │
   miss │                         hit  │
        ▼                              ▼
  LLM REASON (step) ──► STORE ──►  REUSE (bỏ LLM call)
        │                              │
        └──────────► result ───────────┘
                          │
        TTL/invalidation khi context thay đổi
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GI (191) KV/semantic cache — cache output (sẵn nền)
// ✅ DU (125) structured reasoning — output có cấu trúc (sẵn chỗ memo)
// ✅ 39 AM cache layer — tool-result cache (sẵn)
// ✅ 100 CV prompt compression — canonical hóa (bổ sung)

// ❌ THIẾU: reasoning-subproblem memo (mức step, không chỉ output)
// ❌ THIẾU: canonical key (normalize sub-question + context-hash)
// ❌ THIẾU: invalidation policy (khi context/skill đổi — kết quả cũ hỏng)
```

## Implementation

```typescript
// packages/memo/src/reasoning.ts (NEW)
const memo = new Map<string, Promise<unknown>>();
function keyOf(step: string, ctx: Ctx): string {
  return sha256(JSON.stringify({ step: canonical(step), ctxHash: ctx.fingerprint() }));
}
export async function memoReason(step: string, ctx: Ctx, llm: () => Promise<unknown>) {
  const k = keyOf(step, ctx);
  const hit = memo.get(k);
  if (hit) return hit;                       // reuse — bỏ LLM call
  const p = llm().finally(() => setTimeout(() => memo.delete(k), TTL)); // TTL
  memo.set(k, p);
  return p;
}
// invalidation: ctx.fingerprint đổi (skill/procedural 276 update) → key khác → miss tự nhiên
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tăng tốc — sub-question lặp không tính lại (Michie/DP) | ❌ Stale — context đổi nhưng memo còn (cần invalidation) |
| ✅ Giảm cost/token — bỏ LLM call cho sub-step trùng | ❌ Key canonical khó — nhỏ khác biệt = miss/trúng nhầm |
| ✅ Ráp mảnh vào chain mới (khác GI cache output cố định) | ❌ Memo bloat — cần TTL/LRU dọn |
| ✅ Tự hợp với GI (output) — lớp khác | ❌ Non-deterministic reasoning (temp>0) memo sai |

## Khác các hướng gần

| | GI KV/Sem Cache | JJ Coalescing | JP Procedural | JQ: Reasoning Memo |
|---|---|---|---|---|
| Cache gì | Output LLM | Concurrent call | How-to thủ tục | **Sub-step reasoning** |
| Khi hit | Sau khi xong | Trong khi chạy | Khi gặp goal tương tự | **Sub-question trùng** |
| Mức | Output cuối | Request | Procedure | **Step trong chain** |

## Khi nào chọn

- Reasoning có sub-question lặp (parse, classify, extract) — worth memo
- Cần tốc độ + tiết kiệm token (sub-step lặp nhiều)
- Reasoning deterministic (temp 0) — kết quả tái dùng hợp lệ
- Luôn: TTL + canonical key + invalidation khi skill/context (JP 276) đổi; không memo non-deterministic
