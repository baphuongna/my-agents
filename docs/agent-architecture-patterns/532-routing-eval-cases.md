# Hướng TL: Routing Eval Cases — bộ eval chứng minh khi nào skill bật / khi nào để yên

> **Nguồn gốc:** ClaudeSkills `evals/routing-evals.json` (prompt + `should_trigger`/`should_not` + `expected_mode`); "prove when a skill activates vs stays dormant"; "routing eval — prompt has expected_mode + should_trigger/should_not"; "evidence-based skill activation" | **Coupling:** 🟡 — thêm routing eval harness vào eval pipeline (grade routing decisions) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (eval harness + ParityScenario sẵn — chưa có routing-specific eval cases) | **Effort:** 1-2 tuần

## Nguồn gốc

**ClaudeSkills** để chứng minh **routing đúng** (khi nào skill nên activate, khi nào KHÔNG), tạo **routing eval cases**: mỗi case là (1) **prompt** (user message thật). (2) **expected_mode**: skill nào **nên trigger** (`should_trigger`) hoặc **không nên trigger** (`should_not`). (3) **assertion**: chạy prompt qua routing logic → kiểm output có trigger đúng skill không. Mục đích: **evidence-based** — không tin routing "đúng" vì "trông ổn", mà **prove** bằng eval suite. Khi thay routing logic (thêm skill, đổi trigger phrase) → **re-run eval** → regression detect. Nguyên tắc: **routing có test**, giống code có test.

## Mô tả

mya routing eval cases: (1) **Eval case**: mỗi case = `{ prompt, should_trigger: string[], should_not: string[], expected_mode }`. (2) **Run**: chạy prompt qua skill suggest/route logic → ra triggered skills. (3) **Assert**: triggered ⊇ should_trigger (trigger đủ) ∧ triggered ∩ should_not = ∅ (không trigger sai). (4) **Grade**: pass/fail per case → aggregate pass-rate. (5) **Regression**: thay routing logic → re-run → drop pass-rate = regression. mya có eval harness (ParityHarness) + skill suggest — TL thêm **routing eval cases** + **routing grader**.

## Kiến trúc

```
  routing-evals.json (bộ eval cases)
  ┌─── CASE 1 ────────────────────────────────────────────┐
  │  prompt: "format all JSON files in src/"                 │
  │  should_trigger: ["format-skill"]                        │
  │  should_not: ["deploy-skill", "db-skill"]               │
  │  expected_mode: "format"                                 │
  └───────────────────────────────────────────────────────┘
  ┌─── CASE 2 ────────────────────────────────────────────┐
  │  prompt: "deploy to production"                          │
  │  should_trigger: ["deploy-skill"]                        │
  │  should_not: ["format-skill"]                           │
  │  expected_mode: "deploy"                                 │
  └───────────┬───────────────────────────────────────────┘
              │ (run qua routing logic)
              ▼
  ┌─── ROUTING GRADER ────────────────────────────────────┐
  │  case 1: triggered=[format-skill]                       │
  │    ⊇ should_trigger? ✅                                  │
  │    ∩ should_not? ∅ ✅  → PASS                            │
  │  case 2: triggered=[format-skill]  ← BUG (sai route)    │
  │    ⊇ should_trigger? ❌ (deploy-skill thiếu) → FAIL     │
  │  → pass-rate: 50% → REGRESSION DETECTED                 │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval ParityHarness — eval harness (nền — TL chạy routing cases ở đây)
// ✅ packages/skills SkillStore.suggest — skill routing (nền — TL eval routing decisions)
// ✅ packages/skills SkillIndexEntry — skill index (nền — TL expected_mode)

// ❌ THIẾU: routing eval cases (prompt + should_trigger/should_not + expected_mode)
// ❌ THIẾU: routing grader (triggered ⊇ should_trigger ∧ ∩ should_not = ∅)
// ❌ THIẾU: regression detection (pass-rate drop → alert)
```

## Implementation

```typescript
// packages/eval/src/routing-evals.ts (MỚI)
interface RoutingCase {
  prompt: string;
  shouldTrigger: string[];  // skills PHẢI trigger
  shouldNot: string[];      // skills KHÔNG được trigger
  expectedMode?: string;    // expected orchestration mode
}

interface RoutingGrade { caseId: string; passed: boolean; triggered: string[]; reason?: string }

class RoutingEval {
  constructor(private route: (prompt: string) => string[]) {} // skill suggest/route

  grade(cases: RoutingCase[]): { results: RoutingGrade[]; passRate: number } {
    const results = cases.map((c, i) => {
      const triggered = this.route(c.prompt);
      // assert: triggered ⊇ shouldTrigger (trigger đủ)
      const missing = c.shouldTrigger.filter(s => !triggered.includes(s));
      // assert: triggered ∩ shouldNot = ∅ (không trigger sai)
      const wrong = triggered.filter(s => c.shouldNot.includes(s));
      const passed = missing.length === 0 && wrong.length === 0;
      return {
        caseId: `case-${i}`,
        passed,
        triggered,
        reason: passed ? undefined : `missing=${missing}, wrong=${wrong}`,
      } satisfies RoutingGrade;
    });
    const passRate = results.filter(r => r.passed).length / results.length;
    return { results, passRate };
  }
}

// Usage:
// const eval = new RoutingEval(prompt => skillStore.suggest(prompt).map(s => s.name));
// const { passRate } = eval.grade(routingCases);
// → passRate < 1.0 → regression in routing logic
```

## Được

- ✅ Routing có test (evidence-based, không "trông ổn")
- ✅ Regression detect (thêm skill/đổi trigger → re-run → catch routing drift)
- ✅ Both positive (should_trigger) + negative (should_not) assertions
- ✅ expected_mode assert (orchestration mode đúng)

## Mất

- ❌ Eval maintenance (thêm skill → thêm cases, giữ bộ eval fresh)
- ❌ Case coverage gap (thiếu edge case → routing sai không detect)
- ❌ Routing logic coupling (grade phụ thuộc route fn — nếu route thay signature, eval break)
- ❌ False confidence (pass eval ≠ perfect routing — eval chỉ cover cases đã viết)

## Khác

Khác **ParityHarness** (grade compressor drift) — TL **grade routing decisions** (skill trigger đúng sai). Khác **TM brief-full-delta-modes** (eval artifact mode) — TL **eval routing** (khi nào skill bật). Khác **TR skill-curated-promotion** (gate skill trước promote) — TL **eval routing sau** skill đã live.

## Khi nào chọn

- Có nhiều skill (routing phức tạp — dễ route sai)
- Thay routing logic thường xuyên (thêm skill, đổi trigger → regression risk)
- Muốn evidence-based (prove routing đúng, không đoán)
- Nối packages/eval ParityHarness + packages/skills SkillStore.suggest; guard case coverage (viết cases đủ — positive, negative, edge), eval freshness (thêm case khi thêm skill), và route-fn decoupling (grade qua interface, không hardcode); TL = routing eval cases, kết hợp TM brief-full-delta-modes (artifact mode eval) + TN run-summary-observability (track routing pass-rate per run)
