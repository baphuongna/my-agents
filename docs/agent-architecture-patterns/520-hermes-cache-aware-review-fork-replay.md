# Hướng SZ: Hermes Cache-Aware Review Fork-Replay — fork review-turn: cùng model replay transcript (warm cache), khác model replay digest

> **Nguồn gốc:** hermes-agent `test_background_review.py` (`background_review_callback`, `_MEMORY_REVIEW_PROMPT`, `_SKILL_REVIEW_PROMPT`, `_COMBINED_REVIEW_PROMPT`, review agent, "shuts down memory provider before close"); "background review agent"; "fork review turn"; "warm cache replay"; "digest replay for different model" | **Coupling:** 🟡 — thêm review-fork layer (fork transcript/digest theo cache-awareness của model) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent + transcript sẵn — chưa có review-fork + cache-aware replay selector) | **Effort:** 3-4 tuần

## Nguồn gốc

**hermes-agent** chạy **background review** sau turn (review memory/skills): fork 1 **review-turn** chạy nền. Chiến lược **cache-aware**: nếu review dùng **cùng model** → **replay transcript đầy đủ** (prefix giống → **prompt cache warm**, rẻ); nếu review dùng **model khác** → **replay digest** (transcript rút gọn, vì cache miss với model khác → gửi nguyên transcript tốn token vô ích). Nguyên tắc: **cùng model = tận dụng KV cache** (replay nguyên, prefix hit), **khác model = cache miss** → gửi digest (tiết kiệm). Khác **94 trajectory-replay** (replay để học) — SZ là **review-fork cache-aware**; khác **FJ prompt-cache** (caching layer) — SZ **chiến lược replay theo cache-hit**.

## Mô tả

mya cache-aware review fork-replay: (1) **Trigger**: kết thúc turn → fork review-turn (review memory/skill quality). (2) **Cache check**: review model == main model? (3) **Same-model replay**: replay **transcript đầy đủ** (prefix match → KV cache warm → token rẻ, context đầy đủ). (4) **Diff-model replay**: replay **digest** (transcript rút gọn — cache miss, gửi nguyên tốn token, digest đủ review). (5) **Background**: review chạy nền, không block main loop. mya có subagent + transcript — SZ thêm **review-fork** + **cache-aware replay selector** + **digest generator**.

## Kiến trúc

```
  TURN kết thúc → fork REVIEW-TURN (background)
        │
        ▼
  ┌─── CACHE CHECK (review model == main model?) ────────┐
  │  same model? → prefix sẽ KHỚP KV cache (warm)         │
  │  diff model? → cache MISS (khác KV)                    │
  └───────────┬───────────────────────┬───────────────────┘
       same model                  diff model
              ▼                        ▼
  ┌─── FULL TRANSCRIPT REPLAY ──┐  ┌─── DIGEST REPLAY ─────────┐
  │  replay nguyên transcript    │  │  transcript rút gọn        │
  │  (prefix hit → cache warm)   │  │  (cache miss → tiết kiệm    │
  │  token rẻ, context đầy đủ     │  │   token, đủ để review)      │
  └──────────────┬───────────────┘  └──────────────┬────────────┘
                 │           review result (memory/skill quality)
                 └──────────────────┴──────────────→ main loop
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent subagent — fork agent (nền — SZ review-fork)
// ✅ transcript/log — full transcript (nền — SZ same-model replay)
// ✅ FJ prompt-caching — KV cache awareness (nền — SZ cache check)

// ❌ THIẾU: review-fork trigger (turn end → background review)
// ❌ THIẾU: cache-aware replay selector (same → full, diff → digest)
// ❌ THIẾU: digest generator (transcript → rút gọn đủ review)
// ❌ THIẾU: background runner (review không block main)
```

## Implementation

```typescript
// packages/agent/src/cache-aware-review.ts (MỚI)
interface ReviewInput { model: string; transcript: string[]; reviewPrompt: string }

class CacheAwareReview {
  constructor(
    private digest: (transcript: string[], prompt: string) => string, // rút gọn
    private runReview: (model: string, payload: string, prompt: string) => Promise<string>,
  ) {}

  // fork review-turn (background)
  async forkReview(input: ReviewInput, mainModel: string): Promise<string> {
    const sameModel = input.model === mainModel;
    // cache-aware payload: same → full transcript (warm cache), diff → digest (cache miss)
    const payload = sameModel
      ? input.transcript.join('\n')                 // full (prefix hit KV cache)
      : this.digest(input.transcript, input.reviewPrompt); // digest (miss → tiết kiệm)
    return this.runReview(input.model, payload, input.reviewPrompt);
  }
}

// digest: rút gọn transcript đủ review (giữ key turns, drop filler)
function makeDigest(transcript: string[], prompt: string): string {
  // keep first + last + tool calls, summarize middle
  const head = transcript.slice(0, 2);
  const tail = transcript.slice(-2);
  return `--- digest (${transcript.length} turns) ---\n${head.join('\n')}\n…[${transcript.length - 4} turns elided]…\n${tail.join('\n')}`;
}

// Usage:
// review.forkReview({ model:'gpt-4o', transcript, reviewPrompt: REVIEW_MEMORY }, mainModel);
// same model → full replay (cache warm); diff model → digest (tiết kiệm)
// runs background, result feeds back to memory/skill store
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Same-model tận dụng cache (token rẻ, context đầy đủ) | ❌ Diff-model mất context (digest thiếu chi tiết) |
| ✅ Diff-model tiết kiệm (digest, không gửi nguyên vô ích) | ❌ Digest quality (rút gọn sai → review sai) |
| ✅ Review nền (không block main loop) | ❌ Background resource (review tốn thêm call) |
| ✅ Cache-aware (replay theo cache-hit) | ❌ Cache-detection sai (giả định prefix hit) |

## Khác các hướng gần

| | 94 Trajectory-Replay | FJ Prompt-Cache | SZ: Cache-Aware-Review |
|---|---|---|---|
| Cái gì | Replay để học | Cache layer | **Review-fork theo cache-hit** |
| Replay | Luông full | N/A | **Full (same) / digest (diff)** |
| Mục đích | Learn | Giảm cost | **Review quality + tiết kiệm** |

## Khi nào chọn

- Có background review (memory/skill) sau turn
- Review model có thể khác main model (cheap model review expensive run)
- Muốn tận dụng cache (same model) + tiết kiệm (diff model digest)
- Nối packages/agent subagent + transcript + FJ prompt-caching; guard digest quality (rút gọn giữ đủ signal review), cache-detection accuracy (prefix thực sự hit), và background cleanup (review agent shut down sạch, không leak provider); SZ = cache-aware review fork, kết hợp 94 trajectory-replay (full replay để learn) + FJ prompt-cache
