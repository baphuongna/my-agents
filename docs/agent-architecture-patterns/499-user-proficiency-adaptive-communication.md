# Hướng SE: User Proficiency Adaptive Communication — phát hiện trình độ user, tự chỉnh tone giải thích

> **Nguồn gốc:** harness (user proficiency detection); "adaptive communication tone by user skill"; "detect user expertise from conversation"; "expert vs novice explanation depth"; "proficiency signal scoring"
> **Coupling:** 🟢 — thêm proficiency detector + tone adapter (không đổi core loop, chỉ chỉnh system-prompt framing)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/agent system-prompt sẵn — chưa có proficiency detector + tone profile)
> **Effort:** 2 tuần

## Nguồn gốc

**harness** pattern: agent **phát hiện trình độ user** từ cách hỏi/câu hỏi trước (novice hỏi "cài vitest thế nào", expert hỏi "mock vi.fn type generic"), rồi **tự chỉnh tone giải thích**: novice → giải thích từng bước + kèm khái niệm nền; expert → ngắn gọn, bỏ qua basic, đi thẳng code. Nguyên tắc: **một tone không phục vụ tất cả** — quá cơ bản làm expert chán, quá nâng làm novice lạc. Proficiency là **signal** (câu hỏi chứa jargon? có debug-độ-sâu không? có sửa sai agent không?) → **score** → **tone profile** (beginner/intermediate/expert). Khác adaptive ngẫu nhiên — SE **dựa signal + score**; khác user-config tĩnh — SE **học trong conversation**.

## Mô tả

mya user proficiency adaptive communication: (1) **Signal collector**: mỗi user message → extract signal (jargon density, có self-correct agent không, hỏi how vs why, độ dài câu hỏi). (2) **Proficiency score**: signal → score (beginner 0-33 / intermediate 34-66 / expert 67-100). (3) **Tone profile**: score → profile (beginner: bước từng bước + khái niệm; intermediate: vừa phải; expert: ngắn + skip basic). (4) **System-prompt framing**: chèn tone profile vào system prompt → LLM điều chỉnh giải thích. (5) **Update rolling**: mỗi message cập nhật score (rolling average — không đổi giật cục). mya có system-prompt builder — SE thêm **proficiency detector** (signal → score) + **tone profile injector**.

## Kiến trúc

```
  USER MESSAGE: "vitest config pool:forks dùng thế nào với vi.fn generic mock?"
        │
        ▼
  ┌─── SIGNAL COLLECTOR ────────────────────────────────┐
  │  jargon: "pool:forks", "vi.fn", "generic mock" (3)   │
  │  self-correct: false                                  │
  │  question-type: how (config)                          │
  │  length: medium                                       │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── PROFICIENCY SCORE ───────────────────────────────┐
  │  score = 78/100 → EXPERT                              │
  └───────────────┬─────────────────────────────────────┘
                  │ (rolling average)
                  ▼
  ┌─── TONE PROFILE ────────────────────────────────────┐
  │  expert → "ngắn gọn, skip basic, đi thẳng code,       │
  │   không giải thích jargon đã biết"                    │
  └───────────────┬─────────────────────────────────────┘
                  │ inject vào system prompt
                  ▼
  ┌─── LLM (tone đã chỉnh) ─────────────────────────────┐
  │  reply: "pool:'forks' + vi.fn<T>():                 │
  │   const m = vi.fn<(x: number) => string>(); ..."     │
  │  (không giải thích "vi.fn là gì")                     │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent — system-prompt builder (nền — SE inject tone profile)
// ✅ conversation history — messages (nền — SE extract signal)
// ✅ memory store — user profile persistence (nền — SE lưu proficiency)

// ❌ THIẾU: signal collector (jargon/correct/type/length từ message)
// ❌ THIẾU: proficiency scorer (signal → 0-100 score)
// ❌ THIẾU: tone profile (score → explanation framing)
// ❌ THIỐU: system-prompt injector (tone profile → system prompt)
```

## Implementation

```typescript
// packages/agent/src/proficiency-adaptive.ts (MỚI)
interface Signal { jargonCount: number; selfCorrect: boolean; qType: 'how' | 'why' | 'what'; length: number }

const JARGON = new Set(['vi.fn', 'pool', 'forks', 'generic', 'mock', 'async', 'await', 'napi', 'clippy', 'AST']);

class ProficiencyAdaptive {
  private scores: number[] = []; // rolling

  // extract signal từ user message
  private extract(msg: string): Signal {
    const words = msg.toLowerCase().split(/\W+/);
    const jargonCount = words.filter(w => JARGON.has(w)).length;
    const qType = /\blàm sao|how\b/.test(msg) ? 'how' : /\btại sao|why\b/.test(msg) ? 'why' : 'what';
    return { jargonCount, selfCorrect: /\bsai\b|no,|không,/.test(msg), qType, length: msg.length };
  }

  // score 0-100
  score(msg: string): number {
    const s = this.extract(msg);
    let score = 30 + s.jargonCount * 12; // jargon → expert
    if (s.selfCorrect) score += 20; // sửa agent → expert
    if (s.qType === 'why') score += 10; // hỏi why → depth
    score = Math.min(100, score);
    this.scores.push(score);
    if (this.scores.length > 10) this.scores.shift(); // rolling 10
    return this.avg();
  }

  private avg(): number {
    return Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length);
  }

  // tone profile từ score
  toneProfile(): string {
    const s = this.avg();
    if (s < 34) return 'BEGINNER: giải thích từng bước, kèm khái niệm nền, tránh jargon không định nghĩa';
    if (s < 67) return 'INTERMEDIATE: giải thích vừa phải, định nghĩa jargon mới, skip cực basic';
    return 'EXPERT: ngắn gọn, đi thẳng code, skip basic, không giải thích jargon phổ biến';
  }

  // inject vào system prompt
  inject(systemPrompt: string): string {
    return `${systemPrompt}\n\n[Adaptive tone: ${this.toneProfile()}]`;
  }
}

// Usage:
// proficiency.score(userMsg);                       // update rolling
// systemPrompt = proficiency.inject(systemPrompt);  // tone đã chỉnh
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tone phù hợp (novice hiểu, expert không chán) | ❌ Signal sai (đo nhầm → tone lệch) |
| ✅ UX tốt hơn (không quá cơ bản/nâng) | ❌ Jargon list tĩnh (cập nhật thủ công) |
| ✅ Rolling (thích ứng trong conversation) | ❌ Cold-start (chưa đủ message → score mơ hồ) |
| ✅ Phối memory (lưu proficiency lâu dài) | ❌ Mất cá tính (tone máy móc) |

## Khác các hướng gần

| | User-Config tĩnh | Adaptive ngẫu nhiên | SE: Proficiency-Adaptive |
|---|---|---|---|
| Tone | User set 1 lần | Random | **Signal → score → tone** |
| Thích ứng | ❌ | ❌ | **Rolling trong conversation** |
| Cơ sở | Tuyên bố | Không | **Hành vi thực (jargon/correct)** |

## Khi nào chọn

- User đa trình độ (novice + expert dùng chung agent)
- Muốn UX tốt (tone phù hợp từng người)
- Chấp nhận signal-based (không hoàn hảo nhưng tốt hơn one-size)
- Nối packages/agent (system-prompt) + memory (lưu proficiency cross-session); guard signal accuracy (jargon list cập nhật) + cold-start (default intermediate đến khi đủ data) + rolling window (không đổi giật cục); phối 499 tone profile persist vào memory (lâu dài)
