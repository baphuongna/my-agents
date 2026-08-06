# Hướng OK: Observability-Driven Harness — harness tự tiến hóa dựa trên observability

> **Nguồn gốc:** Papers Meta-Harness; "self-evolving evaluation"; "observability gap detection"; "telemetry-driven test generation"; "failure-mode discovery loop"; "harness adapts to production signals"
> **Coupling:** 🟡 — thêm harness-evolution meta-loop (telemetry → new test → harness)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval + tool-test-harness + lifecycle-hooks sẵn — chưa có observability-driven harness evolution)
> **Effort:** 4-5 tuần

## Nguồn gốc

**Meta-Harness**: harness (test/eval suite) không cố định — **tự tiến hóa** dựa trên **observability data** (production telemetry, error logs, failure modes, usage patterns). Khi agent gặp **failure mode chưa covered** → harness tự **generate test mới** cover mode đó. **Observability gap detection**: so sánh production failure patterns vs harness coverage → tìm **gap** (mode production gặp nhưng harness chưa test) → thêm test. **Telemetry-driven test generation**: production log ("agent timed out on X", "agent hallucinated Y") → trigger test case mới. Nguyên tắc: **harness học từ production** — mỗi failure mode thực → test mới → harness mạnh hơn → agent ít fail hơn. Khác **400 OJ** (harness as distill surface) — OK là **harness self-evolution**; khác **117 toolchain-feedback** (compile/test loop) — OK là **harness meta-improvement**.

## Mô tả

mya observability-driven harness: (1) **Observe**: thu thập production telemetry (agent failures, timeouts, hallucinations, edge cases) qua lifecycle-hooks + logging. (2) **Gap detection**: so sánh observed failure modes vs harness coverage → tìm uncovered modes. (3) **Generate test**: cho mỗi gap → generate test case mới (LLM hoặc template) cover mode đó. (4) **Add to harness**: test mới vào eval suite. (5) **Feedback loop**: agent chạy harness mới → ít fail hơn → telemetry giảm → harness hội tụ. mya có `packages/eval` + `tool-test-harness` + `292 lifecycle-hooks` — OK thêm **telemetry collector** + **gap detector** + **test generator** + **harness evolution loop**.

## Kiến trúc

```
  PRODUCTION (agent running in real tasks):
  ┌─────────────────────────────────────────────────────┐
  │  Telemetry (via 292 lifecycle-hooks + logging):     │
  │    · agent timed out on task X                      │
  │    · agent hallucinated API in task Y               │
  │    · agent failed to handle empty input in Z        │
  │    · tool call error pattern: "ENOENT on *.tmp"     │
  └───────────────────────┬─────────────────────────────┘
                          │ (telemetry stream)
                          ▼
  ┌─── GAP DETECTION ──────────────────────────────────┐
  │                                                     │
  │  observed failure modes:                            │
  │    {timeout-X, hallucination-Y, empty-input-Z}      │
  │                                                     │
  │  harness coverage:                                  │
  │    {basic-read, basic-write, error-handling}        │
  │                                                     │
  │  GAP = observed − covered:                          │
  │    {timeout-X, hallucination-Y, empty-input-Z}      │
  │    ← NOT covered by current harness                 │
  └───────────────────────┬─────────────────────────────┘
                          │ (uncovered modes)
                          ▼
  ┌─── TEST GENERATION ────────────────────────────────┐
  │  for each gap:                                      │
  │    generate test case covering that failure mode    │
  │    (LLM-generate or template-instantiate)           │
  │                                                     │
  │    timeout-X → test: "long-running task, verify     │
  │                     agent handles timeout"          │
  │    hallucination-Y → test: "API that doesn't exist  │
  │                        verify agent detects"        │
  └───────────────────────┬─────────────────────────────┘
                          │ (new tests)
                          ▼
  ┌─── HARNESS EVOLUTION ──────────────────────────────┐
  │  add new tests to eval suite                        │
  │  → agent must pass new tests                        │
  │  → failure modes now covered                        │
  │  → production telemetry decreases (fewer gaps)      │
  │  → harness converges (covers all observed modes)    │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — evaluation harness (nền — OK evolves this)
// ✅ scripts/tool-test-harness — test execution (nền — OK new tests)
// ✅ 292 lifecycle-hooks — event hooks (nền — OK telemetry source)
// ✅ 117 toolchain-feedback-loop — build/test feedback (nền)
// ✅ 400 OJ harness-distillation — harness as surface (nền — OK = meta-evolution)

// ❌ THIẾU: telemetry collector (production failure patterns)
// ❌ THIẾU: gap detector (observed modes − covered modes)
// ❌ THIẾU: test generator (gap → new test case)
// ❌ THIẾU: harness evolution loop (add tests → re-eval → feedback)
```

## Implementation

```typescript
// packages/eval/src/observability-harness.ts (MỚI)
interface FailureMode {
  id: string;           // e.g. 'timeout-long-task'
  description: string;  // 'agent timed out on long-running task'
  occurrences: number;  // how often in production
  firstSeen: number;
}

interface HarnessCoverage {
  coveredModes: Set<string>;  // failure mode IDs already tested
}

class ObservabilityDrivenHarness {
  private observed = new Map<string, FailureMode>();
  private covered = new Set<string>();

  // Record production failure (via 292 lifecycle-hooks telemetry)
  recordFailure(mode: FailureMode): void {
    const existing = this.observed.get(mode.id);
    if (existing) {
      existing.occurrences += mode.occurrences;
    } else {
      this.observed.set(mode.id, mode);
    }
  }

  // Detect gaps — observed modes not yet covered
  detectGaps(): FailureMode[] {
    return [...this.observed.values()]
      .filter(m => !this.covered.has(m.id))
      .sort((a, b) => b.occurrences - a.occurrences);  // prioritize frequent
  }

  // Generate test for a gap
  async generateTest(
    gap: FailureMode,
    llmGenerate: (prompt: string) => Promise<string>,
  ): Promise<{ testId: string; testCode: string }> {
    const prompt = `Generate a test case covering this failure mode:
      ${gap.description}
      Occurred ${gap.occurrences} times in production.
      Test should verify the agent handles this correctly.`;
    const testCode = await llmGenerate(prompt);
    return { testId: `test-${gap.id}`, testCode };
  }

  // Evolve — generate + add tests for all gaps
  async evolve(
    llmGenerate: (prompt: string) => Promise<string>,
    addTest: (testId: string, code: string) => void,
  ): Promise<{ added: number; gaps: FailureMode[] }> {
    const gaps = this.detectGaps();
    for (const gap of gaps) {
      const test = await this.generateTest(gap, llmGenerate);
      addTest(test.testId, test.testCode);
      this.covered.add(gap.id);  // mark as covered
    }
    return { added: gaps.length, gaps };
  }

  // Convergence check — no more uncovered gaps
  isConverged(): boolean {
    return this.detectGaps().length === 0;
  }
}

// Telemetry wiring (via 292 hooks):
// hooks.on('agent-failure', (event) => {
//   harness.recordFailure({
//     id: classifyFailure(event),
//     description: event.description,
//     occurrences: 1,
//     firstSeen: Date.now(),
//   });
// });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Harness tự cover failure mode thực (không manual) | ❌ Telemetry quality (log thiếu context → gap mơ hồ) |
| ✅ Giảm production failure (mỗi mode → test → fix) | ❌ LLM test generation (test sai → false pass/fail) |
| ✅ Prioritize frequent modes (occurrences sort) | ❌ Test bloat (mỗi failure → 1 test → harness phình) |
| ✅ Nối 400 OJ (harness stronger → distill better) | ❌ Convergence slow (production luôn có mode mới) |

## Khác các hướng gần

| | 117 Toolchain-Feedback | 118 Error-Analysis | 400 OJ Distillation | OK: Observability-Harness |
|---|---|---|---|---|
| Cái gì | Compile/test loop | Analyze errors | Distill from harness | **Harness tự tiến hóa** |
| Source | Build/test | Error log | Trajectory | **Production telemetry** |
| Gap | ❌ | ❌ | ❌ | ✅ observed − covered |
| Generate | ❌ | ❌ | ❌ | ✅ test từ gap |

## Khi nào chọn

- Agent chạy production (có telemetry/failure data để học)
- Harness manual không đủ (failure mode mới liên tục xuất hiện)
- Muốn harness tự cover gap (không cần người viết test thủ công)
- Nối 292 lifecycle-hooks (telemetry source) + 400 OJ (harness as distill surface → OK strengthens it) + 118 error-analysis; OK là **meta-loop**: observe → gap → generate test → evolve harness → fewer production failures; guard test bloat + LLM test quality
