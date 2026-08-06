# Hướng WT: Model-Judged Loop Assess — vòng lặp assess chạy 2 session mỗi round (producer + model judge riêng phát verdict {done, feedback} đã validate)

> **Nguồn gốc:** rpiv-mono `assess loop` (mỗi round chạy 2 session: producer session làm việc + model judge session riêng phát verdict `{done, feedback}` đã validate); "two sessions per round", "producer + judge", "model judge verdict", "validated done/feedback" | **Coupling:** 🟡 — thêm dual-session assess loop + model-judge vào agent evaluation | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (council + agent + eval sẵn — chưa có dual-session assess + model-judge verdict) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** assess loop không dùng **1 session tự đánh giá** (bias — agent tự nói "done" khi chưa xong). Thay vào đó, mỗi round chạy **2 session độc lập**: (1) **Producer session**: agent làm việc (produce output/artifact). (2) **Model judge session**: một **model riêng** (khác producer) đánh giá output → phát **verdict** `{ done: boolean, feedback: string }`. Judge **validate** output có đạt acceptance criteria không → `done: true` (đạt, dừng) hoặc `done: false` + `feedback` (chưa đạt, producer sửa). Nguyên tắc: **tách producer và judge** — không tự chấm điểm, model thứ 3 validate khách quan.

## Mô tả

mya model-judged loop assess: (1) **Round loop**: mỗi round → producer làm việc → judge đánh giá → verdict. (2) **Producer session**: agent produce output (code, analysis, artifact). (3) **Judge session**: model riêng (vd stronger model, hoặc council) → so sánh output vs acceptance criteria → verdict. (4) **Verdict**: `{ done, feedback }` — done=true → loop kết thúc; done=false → feedback → producer round tiếp. (5) **Validation**: judge dựa trên criteria (không opinion) → khách quan. mya có council + agent + eval — WT thêm **dual-session assess** + **model-judge verdict** + **feedback-driven loop**.

## Kiến trúc

```
  ┌─── ROUND N ──────────────────────────────────────────┐
  │                                                        │
  │  ┌─ PRODUCER SESSION ──────────────────────────────┐  │
  │  │  agent làm việc (produce output/artifact)        │  │
  │  │  → output = "refactored auth.ts, tests added"    │  │
  │  └──────────────────┬──────────────────────────────┘  │
  │                     ▼                                  │
  │  ┌─ MODEL JUDGE SESSION (riêng, khác producer) ────┐  │
  │  │  input: output + acceptance criteria             │  │
  │  │  criteria: "tests pass, no regression, lint ok"  │  │
  │  │  judge: "output có tests? PASS. lint? FAIL."     │  │
  │  │  → VERDICT { done: false, feedback: "fix lint" } │  │
  │  └──────────────────┬──────────────────────────────┘  │
  │                     ▼                                  │
  │  ┌─ VERDICT CHECK ─────────────────────────────────┐  │
  │  │  done: true  → LOOP END (output đạt criteria)    │  │
  │  │  done: false → feedback → ROUND N+1 (producer sửa)│  │
  │  └──────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────┘

  ROUND N+1: producer nhận feedback "fix lint" → sửa → judge lại → ...
  → đến khi done: true (criteria đạt) hoặc maxRounds (timeout)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council — multi-model council (nền — WT judge session analog)
// ✅ packages/agent sdk.ts — agent session (nền — WT producer session)
// ✅ packages/eval — evaluation (nền — WT acceptance criteria)
// ✅ packages/186 multi-agent-debate — multi-agent (nền — WT dual-session reference)
// ✅ packages/core loop.ts — agent loop (nền — WT round loop)

// ❌ THIẾU: dual-session assess (producer + judge riêng mỗi round)
// ❌ THIẾU: model-judge verdict ({done, feedback} structured output)
// ❌ THIẾU: feedback-driven round loop (judge → feedback → producer round)
```

## Implementation

```typescript
// packages/council/src/model-judged-loop-assess.ts (MỘI)
interface Verdict { done: boolean; feedback: string }

interface AssessConfig {
  maxRounds: number;
  acceptanceCriteria: string;        // judge dựa vào đây (không opinion)
}

class ModelJudgedAssessLoop {
  constructor(
    private runProducer: (round: number, feedback: string | null) => Promise<string>,
    private runJudge: (output: string, criteria: string) => Promise<Verdict>,
  ) {}

  // dual-session loop: producer → judge → verdict → (feedback → round++)
  async run(config: AssessConfig): Promise<{ output: string; rounds: number; done: boolean }> {
    let feedback: string | null = null;
    for (let round = 1; round <= config.maxRounds; round++) {
      // PRODUCER session (làm việc)
      const output = await this.runProducer(round, feedback);

      // MODEL JUDGE session (riêng — validate vs criteria)
      const verdict = await this.runJudge(output, config.acceptanceCriteria);

      if (verdict.done) return { output, rounds: round, done: true }; // đạt → end
      feedback = verdict.feedback; // chưa đạt → feedback → round tiếp
    }
    return { output: "", rounds: config.maxRounds, done: false }; // timeout
  }
}

// Usage:
// const loop = new ModelJudgedAssessLoop(
//   (round, fb) => runAgentSession(`refactor task. feedback: ${fb ?? "none"}`),
//   (output, criteria) => runJudgeSession(output, criteria), // model riêng
// );
// const result = await loop.run({ maxRounds: 5, acceptanceCriteria: "tests pass, lint ok" });
// → producer + judge mỗi round; done when criteria met
```

## Được

- ✅ Khách quan (judge riêng — không tự chấm, không bias)
- ✅ Criteria-driven (judge dựa acceptance criteria — không opinion)
- ✅ Feedback loop (done=false → feedback → producer sửa — iterate)
- ✅ Convergence (loop đến khi done hoặc timeout — bounded)

## Mất

- ❌ 2x cost (mỗi round 2 session — producer + judge → tốn token)
- ❌ Judge bias (judge model cũng có bias — không hoàn toàn khách quan)
- ❌ Infinite-ish loop (feedback không converge → maxRounds — có thể không done)
- ❌ Criteria ambiguity (criteria mơ hồ → judge subjective → verdict không ổn định)

## Khác

Khác **186 multi-agent-debate** (N agent debate → consensus) — WT **producer + single judge** (1 làm, 1 chấm — không debate). Khác **self-assess** (agent tự đánh giá) — WT **separate judge** (model khác chấm — khách quan hơn). Khác **84 llm-as-judge** (general eval pattern) — WT **loop assess** (round iterate với feedback, không chỉ 1-shot eval).

## Khi nào chọn

- Task cần validate khách quan (refactor, bug fix — không tin self-report)
- Có acceptance criteria rõ (tests pass, lint ok — judge dựa vào đây)
- Muốn iterate (done=false → feedback → sửa → judge lại — converge)
- Nối packages/council + packages/agent sdk.ts + packages/eval + 186 multi-agent-debate + packages/core loop.ts; guard judge-model-choice (judge ≠ producer model — tránh same bias), criteria-specificity (criteria rõ — test pass, không "looks good"), và convergence-check (maxRounds → escalate nếu không done); WT = model-judged loop assess, kết hợp 186 multi-agent-debate (multi-agent) + 84 llm-as-judge (judge) + packages/council (judge engine)
