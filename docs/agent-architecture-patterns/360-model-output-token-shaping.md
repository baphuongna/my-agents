# Hướng MV: Model Output Token Shaping — giảm token model VIẾT RA: verbosity steering + effort routing

> **Nguồn gốc:** OpenAI reasoning_effort (low/medium/high); "thinking budget"; output length control; DeepSeek R1 thinking budget; "verbosity steering"; structured output; GPT-5 `reasoning.effort`; "test-time compute shaping"
> **Coupling:** 🟢 — output shaping layer (prompt param + effort param trước generate)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (307 verbosity-adapt + 346 slow-fast reasoning sẵn — chưa có effort routing)
> **Effort:** 1-1.5 tuần

## Nguồn gốc

**Token reduction không chỉ ở đầu vào** (context) — mà cả **đầu ra** (model viết ra). **reasoning_effort** (OpenAI o-series / GPT-5): tham số low/medium/high quyết định **bao nhiêu token reasoning** model bỏ ra — câu dễ → low (ít thinking), câu khó → high. **Verbosity steering**: hướng dẫn model viết ngắn/gọn qua system prompt + max_tokens. **Thinking budget** (DeepSeek R1): giới hạn token suy nghĩ. Nguyên tắc: **token model viết ra cũng tốn tiền + latency** — steer verbosity + route effort theo độ khó → giảm ~30-60% output token. Khác **346 MH slow-fast** (chọn reasoning depth technique) — MV **chọn tham số API** (effort/verbosity); khác **307 KU verbosity-adapt** (post-hoc trim) — MV **pre-emptive** (trước khi generate).

## Mô tả

mya model output token shaping: trước khi gọi LLM, router phân loại query (easy/medium/hard) → set **effort** (low/medium/high) + **verbosity** (terse/concise/detailed) + **max_tokens**. Easy → low effort + terse + max 200; hard → high effort + detailed + max 2000. Kết quả: token output giảm đáng kể cho câu dễ, vẫn đầy đủ cho câu khó. Nối 346 MH slow-fast (depth technique) — MV là **param-level** shaping (API knob).

## Kiến trúc

```
  USER QUERY
       │
       ▼
  ┌─── EFFORT + VERBOSITY ROUTER ────────────────┐
  │  classify difficulty (reuse 346 MH router):  │
  │   · "list files" → EASY                       │
  │   · "design auth system" → HARD               │
  └──┬───────────────┬───────────────────────────┘
     ▼ easy          ▼ hard
  effort: low      effort: high
  verbosity: terse verbosity: detailed
  max_tokens: 200  max_tokens: 2000
     │                │
     ▼                ▼
  ┌─── LLM CALL (shaped params) ──────────────────┐
  │  system: "Answer in ≤ 3 lines" (terse)        │
  │  reasoning_effort: low | medium | high        │
  │  max_tokens: 200 | 2000                       │
  └──┬───────────────────────────────────────────┘
     ▼
  SHAPED OUTPUT (≈ 40-60% ít token hơn câu dễ)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 307 KU output-verbosity-adapt — trim output (nền — MV pre-emptive)
// ✅ 346 MH slow-fast-reasoning — depth router (nền — MV reuse classifier)
// ✅ 320 LH cost-per-step — cost tracking (feedback cho router)
// ✅ 342 MD output-quality-pipeline — gate (chống output quá ngắn)

// ❌ THIẾU: effort routing (reasoning_effort low/med/high per query)
// ❌ THIẾU: verbosity steering (prompt + max_tokens per query)
// ❌ THIẾU: difficulty → effort map (tuning)
```

## Implementation

```typescript
// packages/agent/src/output-shaping.ts (NEW)
type Effort = 'low' | 'medium' | 'high';
type Verbosity = 'terse' | 'concise' | 'detailed';

interface ShapeParams {
  effort: Effort;
  verbosity: Verbosity;
  maxTokens: number;
  systemSuffix: string;
}

const SHAPE: Record<Effort & Verbosity, ...> = undefined as never;

class OutputShaper {
  // Map difficulty (0-1) → shape params
  shape(difficulty: number): ShapeParams {
    if (difficulty < 0.33) {
      return { effort: 'low', verbosity: 'terse', maxTokens: 200,
        systemSuffix: 'Answer in ≤ 3 lines, no preamble.' };
    }
    if (difficulty < 0.66) {
      return { effort: 'medium', verbosity: 'concise', maxTokens: 800,
        systemSuffix: 'Be concise. Omit filler.' };
    }
    return { effort: 'high', verbosity: 'detailed', maxTokens: 2000,
      systemSuffix: 'Be thorough and precise.' };
  }

  // Build LLM call options
  buildCall(query: string, difficulty: number) {
    const s = this.shape(difficulty);
    return {
      messages: [
        { role: 'system', content: `${s.systemSuffix}` },
        { role: 'user', content: query },
      ],
      reasoningEffort: s.effort,   // OpenAI o-series / GPT-5
      maxTokens: s.maxTokens,
    };
  }
}

// Usage:
// const difficulty = await router.classify(query);  // reuse 346 MH
// const call = shaper.buildCall(query, difficulty);
// const out = await llm.complete(call);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm 30-60% output token câu dễ (effort) | ❌ Effort quá thấp → câu khó trả sai/thiếu |
| ✅ Giảm latency + cost (ít token = nhanh + rẻ) | ❌ max_tokens cứng cắt output giữa chừng |
| ✅ Pre-emptive (không cần regenerate) | ❌ Verbosity steering không luôn tuân thủ |
| ✅ Nối 346 MH (classifier) + 320 LH (cost) | ❌ Difficulty→effort map cần tune per model |

## Khác các hướng gần

| | 307 Verbosity Adapt | 346 Slow-Fast Reasoning | 100 Prompt Compression | MV: Output Shaping |
|---|---|---|---|---|
| Cái gì | Trim output sau | Chọn depth technique | Nén đầu vào | **Steer output trước generate** |
| Khi | Post-hoc | Pre-generate | Pre-generate | Pre-generate |
| reasoning_effort | ❌ | ❌ | ❌ | ✅ |
| max_tokens | ❌ | ❌ | ❌ | ✅ |

## Khi nào chọn

- Dùng model có reasoning_effort/thinking budget (o-series, GPT-5, R1)
- Muốn giảm cost/latency output (token model viết ra nhiều)
- Mix query easy/hard (đã có 346 MH classifier)
- Kết hợp 346 MH (difficulty router) + MV (effort+verbosity param) + 342 MD (gate chống quá ngắn); tune difficulty→effort map, guard max_tokens cắt giữa chừng
