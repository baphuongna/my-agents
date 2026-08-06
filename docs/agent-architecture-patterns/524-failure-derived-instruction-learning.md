# Hướng TD: Failure-Derived Instruction Learning — turn failure thành instruction/lesson bền vững tái dùng run sau

> **Nguồn gốc:** hermes-agent `tools/memory_tool.py`, `tools/tool_search.py` (skill/instruction reuse), `background_review` (review → lesson); "turn failure into durable instruction"; "lesson learned persists across runs"; "instruction reused next run"; "failure → procedural memory" | **Coupling:** 🟡 — thêm failure→instruction pipeline (phân tích fail → rút lesson → persist → tái dùng) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (memory + review sẵn — chưa có failure-analyzer + lesson-persist + reuse-inject) | **Effort:** 3-4 tuần

## Nguồn gốc

**hermes-agent** khi turn **fail** (tool error, wrong output, user correction) không chỉ log — mà **phân tích → rút lesson** (instruction: "khi gặp X, làm Y"), **persist** thành memory bền vững, và **tái dùng run sau** (inject lesson vào context khi pattern tương tự xuất hiện). Nguyên tắc: **failure là dữ liệu học** — mỗi fail → 1 instruction cụ thể, actionable (không phải generic "cẩn thận"); lesson bền vững (persist, không mất); tái dùng proactively (agent không lặp sai). Khác **JP Procedural-Memory** (lưu cách làm) — TD là **failure-derived lesson** (sai → học); khác **84 llm-as-judge** (đánh giá) — TD là **self-improvement loop**.

## Mô tả

mya failure-derived instruction learning: (1) **Fail detect**: turn fail (error, wrong, user-correct). (2) **Analyze**: root-cause → rút lesson cụ thể ("khi edit file chưa save, run test → false negative; luôn save trước test"). (3) **Persist**: lesson → memory bền vững (instruction store, có trigger pattern). (4) **Reuse**: run sau, khi pattern tương tự → inject lesson vào context (proactive reminder). mya có memory + review — TD thêm **failure-analyzer** + **lesson-persist** + **reuse-injector**.

## Kiến trúc

```
  TURN FAIL (tool error / wrong output / user correct)
        │
        ▼
  ┌─── FAILURE ANALYZER (root-cause → lesson) ───────────┐
  │  fail: "test fail sau edit"                             │
  │  root-cause: "file chưa save khi chạy test"             │
  │  lesson: "khi edit xong, SAVE trước khi test"           │
  │  trigger pattern: "edit → test"                         │
  └───────────────────────┬─────────────────────────────┘
                          │ (persist durable)
                          ▼
  ┌─── LESSON STORE (bền vững, tái dùng) ────────────────┐
  │  { pattern:"edit→test", lesson:"SAVE trước test",      │
  │    source:"run #42 fail", ts }                          │
  └───────────────────────┬─────────────────────────────┘
                          │ (run sau, pattern tương tự)
                          ▼
  ┌─── REUSE-INJECT (proactive reminder) ────────────────┐
  │  agent sắp "edit → test" → inject lesson               │
  │  "⚠ nhớ SAVE trước test (learned from run #42)"        │
  │  → agent không lặp sai                                   │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory brain-store — durable store (nền — TD lesson persist)
// ✅ JP procedural-memory — "cách làm" (nền — TD = failure-derived subset)
// ✅ 117 toolchain-feedback — exec feedback (nền — TD fail detect)

// ❌ THIẾU: failure-analyzer (fail → root-cause → specific lesson)
// ❌ THIẾU: lesson store (bền vững + trigger pattern)
// ❌ THIẾU: reuse-injector (pattern match → inject lesson proactive)
// ❌ THIẾU: dedup (lesson trùng → gộp, không spam)
```

## Implementation

```typescript
// packages/agent/src/failure-instruction.ts (MỚI)
interface Lesson { pattern: string; instruction: string; source: string; ts: number }

class FailureInstructionLearning {
  private lessons: Lesson[] = [];
  constructor(
    private now: () => number,
    private analyze: (fail: string) => Promise<{ pattern: string; instruction: string }>,
    private matchPattern: (pattern: string, context: string) => boolean,
  ) {}

  // on failure → analyze → persist lesson
  async learn(fail: string, source: string): Promise<void> {
    const { pattern, instruction } = await this.analyze(fail);
    // dedup: gộp nếu pattern đã có
    const existing = this.lessons.find(l => l.pattern === pattern);
    if (existing) { existing.instruction = instruction; return; }
    this.lessons.push({ pattern, instruction, source, ts: this.now() });
  }

  // reuse: match current context → inject relevant lessons
  inject(context: string): string[] {
    return this.lessons
      .filter(l => this.matchPattern(l.pattern, context))
      .map(l => `⚠ ${l.instruction} (learned from ${l.source})`);
  }
}

// Usage:
// on fail → learning.learn("test fail after edit", "run #42");
//   → lesson: "edit→test" / "SAVE trước test"
// next run, agent sắp edit→test:
// const reminders = learning.inject("edit parser.rs then test");
//   → ["⚠ SAVE trước test (learned from run #42)"]
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tự cải thiện (fail → học, không lặp sai) | ❌ Lesson sai (analyze root-cause nhầm) |
| ✅ Lesson bền vững (persist, tái dùng cross-run) | ❌ Lesson spam (quá nhiều → noise) |
| ✅ Proactive (inject trước khi lặp sai) | ❌ Pattern match false-positive (inject không đúng lúc) |
| ✅ Cụ thể, actionable (không generic) | ❌ Analyze cost (LLM call mỗi fail) |

## Khác các hướng gần

| | JP Procedural-Memory | 84 LLM-as-Judge | TD: Failure-Instruction |
|---|---|---|---|
| Cái gì | Lưu "cách làm" | Đánh giá output | **Fail → lesson → tái dùng** |
| Nguồn | Success/thủ tục | Judge | **Failure (root-cause)** |
| Reuse | Manual/retrieve | ❌ | **Proactive inject** |

## Khi nào chọn

- Agent hay lặp sai cùng pattern → cần self-improve
- Fail có root-cause rõ (analyze được) → lesson cụ thể
- Muốn lesson bền vững (cross-run, không mất)
- Nối packages/memory brain-store + JP procedural-memory + 117 toolchain-feedback; guard lesson quality (analyze chính xác, specific/actionable), dedup (gộp lesson trùng, không spam), và inject precision (pattern match đúng, không false-positive noise); TD = failure-derived instruction learning, kết hợp JP procedural-memory (success) + IH memory-rollback (undo lesson sai)
