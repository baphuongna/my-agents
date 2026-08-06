# Hướng CL: Prompt/Context Caching — cache prefix prompt tái sử dụng

> **Nguồn gốc:** "Evaluation of Prompt Caching for Long-Horizon Agentic" (arXiv 2601.06007, 2026); OpenAI cookbook prompt_caching101
> **Coupling:** 🟢 — tầng LLM client, agent không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai LLM client sẵn; thiếu prompt layout cho cache)
> **Effort:** 1 tuần

## Nguồn gốc

Prompt caching: LLM API **cache prefix** của prompt giữa các requests — lần sau gửi cùng prefix → phí rẻ hơn, latency thấp (TTFT). arXiv 2601.06007 (2026) benchmark long-horizon agentic: **giảm 41-80% API cost, cải thiện time-to-first-token 13-31%**; Flexera 2026: giảm tới 90% input cost. Quy tắc vàng (OpenAI cookbook + kinh nghiệm): **static-first, dynamic-last** — cache chỉ chạy trên prefix; đặt phần ổn định (system prompt, tool defs, lịch sử củ) đầu prompt, phần thay đổi (input mới) cuối. Đây là **working memory của agent**: agent loop gửi đi gửi lại gần nguyên tool spec + system prompt (đỏ nền VVV durable → cache prefix). Khác **OOOO Semantic Cache** (cache *response* hàng query) — MMMM cache *prefix của prompt* (transparent, không đổi output).

## Mô tả

mya layout mọi prompt agent theo **static-first**: (1) system prompt + role + skills (P static), (2) tool definitions (OO — ổn định), (3) lịch sử conversation đã cache (append-only, tail mới động), (4) input mới cuối cùng. Khi gửi lên provider hỗ trợ cache (Anthropic/OpenAI cache_control): prefix dài ổn định → hit cache. Đo: cache hit tokens / total (metric — JJJ) + cost giảm (SS). Lưu ý mỗi provider có cache TTL/độ dài tối thiểu khác nhau (5/20/40 phút — window). Nối: VVV durable — snapshot lâu dài; MMMM — snapshot ngắn dùng lại giữa steps.

## Kiến trúc

```
  PROMPT LAYOUT (static-first — cache hoạt động trên prefix):
  ┌────────────────────────────────────────────────────┐
  │ [1] system + role + skills   │ static  ──┐         │
  │ [2] tool defs (OO)           │ static    │  CACHE  │
  │ [3] history (append-only)    │ semi      │  PREFIX │
  │ [4] current input/turn       │ dynamic ──┴─────────│  ← đặt CUỐI
  └────────────────────────────────────────────────────┘

  agent step 1 ──► send(prefix)            ── cache WRITE
  agent step 2 ──► send(same prefix + 1)   ── cache HIT (TTFT nhanh, rẻ)
  agent step 3 ──► send(same prefix + 2)   ── cache HIT
  (N steps trường long-horizon: 41-80% cost giảm — arXiv 2026)

  metric: cache_hit_tokens / total_tokens (JJJ + SS chi phí)
```

```
mya: packages/ai LLM client SẴN — agent loop gửi lặp theo OO + history
     thiếu: prompt layout static-first + cache_control + metric
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — LLM client (model-routing, fallback) — nơi thêm cache
// ✅ packages/prompts (P) — system + role + skills ổn định (static candidate)
// ✅ packages/tools OO — tool defs ổn định (static candidate)
// ✅ VVV durable — snapshot dài hạn (nuôi MMMM)
// ✅ JJJ + SS — metric cost/latency (đo cache hit)

// ❌ THIẾU: prompt layout static-first (đầu = static, cuối = dynamic)
// ❌ THIẾU: cache_control metadata (Anthropic/OpenAI)
// ❌ THIẾU: metric cache_hit / cost giảm
// ❌ THIẾU: chính sách history append-only (không xáo prefix)
```

## Implementation

```typescript
// packages/ai/src/prompt-cache.ts (NEW)
interface CachedPrompt {
  layout: Array<{ kind: "static" | "history" | "dynamic"; content: string }>;
}

function layoutPrompt(parts: AgentPromptParts): CachedPrompt {
  // static-first: system(P) + tools(OO) đầu, history giữa, input cuối
  return {
    layout: [
      { kind: "static", content: parts.system },       // cache ổn định
      { kind: "static", content: parts.tools },         // OO defs
      { kind: "history", content: parts.history },      // append-only
      { kind: "dynamic", content: parts.input },        // thay đổi mỗi turn
    ],
  };
}

// history append-only: không chèn vào giữa → prefix không hỏng cache
// metric: (cacheHitTokens / inputTokens) — theo dõi JJJ
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm 41-80% cost long-horizon (arXiv 2601.06007) | ❌ Cache hit phụ thuộc provider TTL/window |
| ✅ TTFT giảm 13-31% — agent phản hồi nhanh | ❐ Cache không cho output (chỉ prefix) |
| ✅ Transparent — đổi layout, không đổi logic | ❌ Violation static-first làm hỏng hit |
| ✅ Đơn giản: 1 tuần, coupling thấp | ❌ History dài → token vẫn tốn (track SS) |
| ✅ Nối VVV (snapshot) — 2 lớp cache | |

## Khác các hướng gần

| | OOOO Semantic Cache | VVV Durable Execution | MMMM: Prompt Cache |
|---|---|---|---|
| Cache gì | Response hàng query | State/task | **Prefix prompt** |
| Cơ chế | Embed + vector | Snapshot | **Prefix match (transparent)** |
| Thời gian sống | Query-level | Lâu dài | **Provider TTL** |
| Mối quan hệ | Combo (cả 2) | Nuôi prefix | **Tầng ngắn hạn** |

## Khi nào chọn

- Agent loop dài (nhiều steps) gửi đi gửi lại history + tool defs
- Bị tốn LLM token một lượng lớn (SS đo)
- Sử dụng provider có prompt caching (Anthropic/OpenAI)
- Muốn lợi tức nhanh, coupling thấp