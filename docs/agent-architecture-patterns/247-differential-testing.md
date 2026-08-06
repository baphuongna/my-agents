# Hướng IM: Differential Testing — so sánh output nhiều phiên bản

> **Nguồn gốc:** "Differential testing" (McKeeman 1998, classic); Google "regression testing for ML"; "shadow deployment" (129); Promptfoo/Airbench LLM regression; "backwards compatibility testing for prompts"
> **Coupling:** 🟢 — test harness lớp ngoài, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval harness + versioning 135 sẵn — thiếu diff-compare + regression gate)
> **Effort:** 1-2 tuần

## Nguồn gốc

Differential testing (McKeeman 1998) — chạy **cùng input qua nhiều phiên bản implementation** → so sánh output, flag khác biệt. Gốc từ compiler testing (GCC vs LLVM). Áp vào LLM: chạy cùng prompt qua (1) model cũ vs mới, (2) prompt v1 vs v2, (3) config cũ vs mới → diff output. Promptfoo, Airbench — LLM regression testing: "did my change break anything?" Google ML regression: shadow deployment (129) — new model serve shadow traffic, compare vs old live. Prompt versioning (173): đổi prompt → differential test trước deploy.

Khác **129 shadow-deployment** (route traffic song song cho model mới) — IM là *test batch offline* (không traffic thật). Khác **190 property-based-testing** (test invariant/property) — IM so sánh *giữa phiên bản*. Nối **135 agent-versioning**, **173 prompt-versioning-ab-testing**, **175 structured-output-validation** (validate diff), **246 judge-calibration** (IL — judge quyết định diff có ý nghĩa không).

## Mô tả

mya differential testing: (1) **test corpus** — tập input cố định (prompts, tasks); (2) **run baseline** (phiên bản hiện tại) + **run candidate** (phiên bản mới: model/prompt/config); (3) **diff compare** — so sánh output: exact match? semantic match (judge 246)? quality change? (4) **regression gate** — nếu candidate tệ hơn baseline trên bất kỳ case → block deploy. mya đã có eval harness (packages/eval) + agent-versioning (135) + prompt-versioning (173) — IM thêm **diff-compare engine + regression gate**.

## Kiến trúc

```
  TEST CORPUS (100 prompts/tasks — cố định)
        │
        ├──► BASELINE (current: model-A, prompt-v3)
        │      run all 100 → outputs_baseline[]
        │
        └──► CANDIDATE (new: model-B, prompt-v4)
               run all 100 → outputs_candidate[]
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  DIFF COMPARE ENGINE                           │
  │                                               │
  │  for each test case i:                        │
  │   · exact match? baseline[i] === candidate[i] │
  │   · semantic match? (judge 246 IL)            │
  │   · quality delta? (score baseline - candidate)│
  │   · structural? (175 — same schema?)          │
  │                                               │
  │  RESULT:                                      │
  │   · 78/100 identical ✓                        │
  │   · 15/100 semantic-similar ✓                 │
  │   · 5/100 REGRESSION ✗ (candidate worse)      │
   │   · 2/100 IMPROVED ✓                         │
  └──────────────────┬───────────────────────────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
     regressions > 0     regressions = 0
            │                 │
            ▼                 ▼
     ┌────────────┐    ┌────────────┐
     │ BLOCK      │    │ DEPLOY ✓   │
     │ (investigate│    │ candidate  │
     │  before     │    │ is safe    │
     │  deploy)    │    └────────────┘
     └────────────┘
```

```
mya: eval harness + versioning 135/173 sẵn — thiếu diff-compare engine + regression gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval/src/harness.ts — eval harness (run test cases)
// ✅ 135 agent-versioning — version tracking (baseline vs candidate)
// ✅ 173 prompt-versioning-ab-testing — prompt versions (differential input)
// ✅ 129 shadow-deployment — live differential (related — IM is offline)
// ✅ 175 structured-output-validation — schema check (diff validation)
// ✅ 246 judge-calibration (IL) — semantic match judge

// ❌ THIẾU: diff-compare engine (baseline vs candidate output comparison)
// ❌ THIẾU: regression gate (block deploy if candidate worse)
// ❌ THIẾU: test corpus management (fixed input set for reproducibility)
// ❌ THIẾU: quality-delta scoring (per-case improvement/regression)
```

## Implementation

```typescript
// packages/eval/src/differential.ts (NEW)
interface DiffResult {
  identical: number;
  semanticSimilar: number;
  regressions: TestCase[];
  improvements: TestCase[];
  total: number;
}

class DifferentialTester {
  constructor(private corpus: TestCase[], private judge: CalibratedJudge) {}

  async run(baseline: Version, candidate: Version): Promise<DiffResult> {
    const baseOutputs = await this.runVersion(baseline);
    const candOutputs = await this.runVersion(candidate);

    const result: DiffResult = { identical: 0, semanticSimilar: 0, regressions: [], improvements: [], total: this.corpus.length };

    for (let i = 0; i < this.corpus.length; i++) {
      if (baseOutputs[i] === candOutputs[i]) { result.identical++; continue; }
      const verdict = await this.judge.compare(baseOutputs[i], candOutputs[i], this.corpus[i].rubric);
      if (verdict.winner === "A") result.regressions.push(this.corpus[i]);    // baseline won → regression
      else if (verdict.winner === "B") result.improvements.push(this.corpus[i]); // candidate won
      else result.semanticSimilar++;
    }
    return result;
  }

  // Regression gate: block deploy if any regression
  canDeploy(result: DiffResult, maxRegressions = 0): boolean {
    return result.regressions.length <= maxRegressions;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện regression trước deploy (McKeeman) | ❌ Cost (2× run: baseline + candidate) |
| ✅ Reproducible (fixed corpus — không random) | ❌ Corpus coverage (không cover hết case mới) |
| ✅ Regression gate — block deploy tự động | ❌ Semantic diff cần judge (246 IL — thêm cost) |
| ✅ Nối eval + versioning (sẵn) | ❌ Flaky (LLM non-deterministic — cần multi-run) |

## Khác các hướng gần

| | 129 Shadow Deploy | 190 Property-Based | IM: Differential Testing |
|---|---|---|---|
| Mục | Live traffic diff | Test invariant | **Offline version diff** |
| Traffic | Real (shadow) | Generated | **Fixed corpus** |
| When | Production | CI/unit | **Pre-deploy gate** |

## Khi nào chọn

- Đổi model/prompt/config — cần biết có regression không (135, 173)
- Pre-deploy gate — block nếu tệ hơn baseline
- Multi-version support — cần A/B compare (173 prompt-versioning)
- OK với 2× eval cost để đảm bảo không regression
