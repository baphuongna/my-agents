# Hướng TM: Brief / Full / Delta Modes — P0 chọn artifact nhẹ nhất theo nhu cầu, eval assert luôn cả expected_mode

> **Nguồn gốc:** ClaudeSkills `evals/mode-evals.json` (brief/full/delta mode selection); "P0 picks the lightest artifact for the need"; "brief = summary, full = complete, delta = changes-only"; "eval always asserts expected_mode alongside result" | **Coupling:** 🟢 — thêm mode-selection logic vào artifact generation, assert mode trong eval | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (eval harness + spill sẵn — chưa có mode-selection + mode-assert) | **Effort:** 1-2 tuần

## Nguồn gốc

**ClaudeSkills** khi sinh artifact (report, summary, diff) — không phải lúc nào cũng sinh **full**. Có **3 mode**: (1) **Brief** — tóm tắt nhẹ (1-2 đoạn, key points). (2) **Full** — artifact đầy đủ (tất cả detail, verbose). (3) **Delta** — chỉ thay đổi (diff so với bản trước, không lặp phần unchanged). P0: **chọn mode nhẹ nhất** đủ nhu cầu (user hỏi "what changed?" → delta, không full). Eval **assert** luôn `expected_mode` cùng kết quả — chứng minh agent chọn mode đúng, không phải chỉ output đúng. Nguyên tắc: **artifact có weight** — brief/full/delta tốn token khác nhau, chọn đúng mode =省钱 + đúng nhu cầu.

## Mô tả

mya brief/full/delta modes: (1) **Mode classify**: phân loại nhu cầu user → mode (tóm tắt → brief, cần đầy đủ → full, hỏi thay đổi → delta). (2) **Generate**: sinh artifact theo mode (brief = ngắn, full = verbose, delta = diff). (3) **Eval assert**: mỗi eval case có `expected_mode` + `expected_output` → assert **cả hai** (mode đúng AND output đúng). (4) **P0 priority**: khi ambiguous → chọn mode nhẹ nhất (brief > delta > full) — không over-generate. mya có eval harness + spill (artifact) — TM thêm **mode selector** + **mode-assert grader**.

## Kiến trúc

```
  USER: "what changed since yesterday?"
        │
        │  classify nhu cầu → mode = DELTA (chỉ thay đổi)
        ▼
  ┌─── MODE SELECTOR (P0: lightest sufficient) ───────────┐
  │  "what changed?" → DELTA (diff, không full)             │
  │  "summarize this" → BRIEF (ngắn, key points)            │
  │  "give me everything" → FULL (verbose, complete)         │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── GENERATE (theo mode) ──────────────────────────────┐
  │  delta: "3 files changed: +42 -15 lines"                │
  │  brief: "feature X implemented, bug Y fixed"            │
  │  full: [verbose report — tất cả detail]                 │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── EVAL (assert mode + output) ───────────────────────┐
  │  case: prompt="what changed?", expected_mode="delta"    │
  │  assert: mode == "delta" ✅ AND output correct ✅       │
  │  → PASS                                                  │
  │  nếu mode == "full" (over-generate) → FAIL (sai mode)  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval ParityHarness — eval harness (nền — TM assert mode ở đây)
// ✅ packages/core spill — artifact spill (nền — TM artifact generation)
// ✅ packages/skills SkillStore — skill model/tools (nền — TM mode per skill)
// ✅ packages/agent exporters — output export (nền — TM mode-aware export)

// ❌ THIẾU: mode selector (classify nhu cầu → brief/full/delta)
// ❌ THIẾU: mode-assert grader (assert expected_mode + output)
// ❌ THIẾU: P0 priority logic (ambiguous → lightest mode)
```

## Implementation

```typescript
// packages/eval/src/mode-evals.ts (MỚI)
type ArtifactMode = "brief" | "full" | "delta";

interface ModeEvalCase {
  prompt: string;
  expectedMode: ArtifactMode;
  expectedOutputContains?: string; // content check
}

interface ModeGrade { caseId: string; modePassed: boolean; outputPassed: boolean; actualMode: ArtifactMode }

class ModeEval {
  constructor(private selectMode: (prompt: string) => ArtifactMode) {}

  grade(cases: ModeEvalCase[]): { results: ModeGrade[]; modePassRate: number } {
    const results = cases.map((c, i) => {
      const actualMode = this.selectMode(c.prompt);
      return {
        caseId: `case-${i}`,
        actualMode,
        modePassed: actualMode === c.expectedMode,
        outputPassed: true, // placeholder — actual output check depends on generation
      } satisfies ModeGrade;
    });
    const modePassRate = results.filter(r => r.modePassed).length / results.length;
    return { results, modePassRate };
  }
}

// P0 mode selector — lightest sufficient
function selectMode(prompt: string): ArtifactMode {
  if (/changed|diff|delta|since/i.test(prompt)) return "delta";
  if (/summar|brief|tl;?dr|quick/i.test(prompt)) return "brief";
  if (/everything|full|complete|detailed|all/i.test(prompt)) return "full";
  return "brief"; // P0: ambiguous → lightest (brief)
}

// Usage:
// const eval = new ModeEval(selectMode);
// const { modePassRate } = eval.grade(modeCases);
// → assert CẢ mode + output (mode sai = regression dù output đúng)
```

## Được

- ✅ Artifact weight-aware (chọn mode nhẹ nhất =省钱 token)
- ✅ Delta mode (chỉ thay đổi — không lặp unchanged)
- ✅ Eval assert mode (chứng minh agent chọn đúng mode, không chỉ output)
- ✅ P0 priority (ambiguous → lightest — không over-generate)

## Mất

- ❌ Mode selection complexity (classify nhu yếu không luôn rõ)
- ❌ Eval overhead (assert mode + output — 2 checks per case)
- ❌ Mode-output mismatch (mode đúng nhưng output sai format cho mode)
- ❌ P0 false-economy (chọn brief quá → thiếu info user cần)

## Khác

Khác **TL routing-eval-cases** (eval skill trigger) — TM **eval artifact mode** (brief/full/delta). Khác **TI cheap-model-delegation** (省钱 model) — TM **省钱 artifact weight** (mode). Khác **TO degraded-mode-shrink** (thu hẹp khi thiếu resource) — TM **chọn weight** theo nhu cầu (không phải degrade).

## Khi nào chọn

- Agent sinh artifact nhiều (report, summary, diff) — weight khác nhau đáng kể
- User nhu cầu khác nhau (tóm tắt vs đầy đủ vs diff) — mode cần phân biệt
- Muốn省钱 token (delta/brief thay vì full khi đủ)
- Nối packages/eval ParityHarness + packages/core spill + packages/agent exporters; guard mode selection precision (classify đúng nhu cầu), P0 calibration (lightest đủ — không thiếu), và eval completeness (assert cả mode + output); TM = brief/full/delta modes, kết hợp TL routing-eval-cases (routing assert) + TN run-summary-observability (track mode selection per run)
