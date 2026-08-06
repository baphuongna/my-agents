# Hướng TR: Skill Curated Promotion — Lab/ chứa skill thử nghiệm; promoted vào skills/ khi qua validate + routing evals

> **Nguồn gốc:** ClaudeSkills `Lab/` (experimental skills), `skills/` (promoted), `scripts/validate.py`; "Lab/ holds experimental skills — not in the gate"; "promoted to skills/ when passing validate.py + routing evals"; "curated promotion — quality gate before skill goes live" | **Coupling:** 🟡 — thêm Lab/ dir + validation gate + promotion pipeline vào skill curator | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (SkillStore + curator sẵn — chưa có Lab/ staging + promotion gate) | **Effort:** 2-3 tuần

## Nguồn gốc

**ClaudeSkills** chia skill thành **2 giai đoạn**: (1) **Lab/** — skill thử nghiệm (agent-created, prototype, chưa verified) — **không vào gate** (không auto-trigger trong production). (2) **skills/** — skill **promoted** (qua `validate.py` — schema/format check + `routing-evals.json` — chứng minh routing đúng) → vào gate (auto-trigger). **Promotion pipeline**: Lab/ skill → validate → routing eval pass → **promote** (move Lab/ → skills/). Nguyên tắc: **skill có quality gate** — không phải skill nào tạo ra cũng auto-live; phải **prove** routing đúng trước khi vào production. Khách publish-all (tất cả skill live) — TR **curated** (chỉ skill pass gate mới live).

## Mô tả

mya skill curated promotion: (1) **Lab/ staging**: skill mới (agent-created, prototype) vào `Lab/` — **SkillStore load nhưng không auto-trigger** (index riêng, không vào stable prompt tier). (2) **Validation gate**: `validate.py` equivalent — check schema (frontmatter đúng?), format (body hợp lệ?), triggers (không conflict). (3) **Routing eval**: Lab skill → run routing eval (`TL`) → prove trigger đúng (should_trigger/should_not). (4) **Promotion**: validate + routing eval pass → move `Lab/ → skills/` (vào stable prompt tier, auto-trigger). (5) **Rejection**: fail → stay Lab/ (hoặc archive). mya có SkillStore + curator — TR thêm **Lab/ staging** + **validation gate** + **promotion pipeline**.

## Kiến trúc

```
  NEW SKILL (agent-created / prototype)
        │
        ▼
  ┌─── Lab/ (staging — KHÔNG auto-trigger) ──────────────┐
  │  Lab/experimental-skill/SKILL.md                       │
  │  → SkillStore load (index riêng, không vào stable tier) │
  │  → KHÔNG auto-trigger trong production                  │
  └───────────┬───────────────────────────────────────────┘
              │  promotion attempt
              ▼
  ┌─── VALIDATION GATE (validate.py equivalent) ──────────┐
  │  check 1: schema (frontmatter name+description+triggers)│
  │  check 2: format (body non-empty, valid markdown)       │
  │  check 3: trigger conflict (không trùng skill đã live)  │
  │  → PASS → tiếp tục                                      │
  │  → FAIL → stay Lab/ (fix rồi retry)                    │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── ROUTING EVAL (prove trigger đúng) ─────────────────┐
  │  routing cases: should_trigger / should_not             │
  │  → pass-rate >= threshold (vd 90%)?                     │
  │  → PASS → promote                                       │
  │  → FAIL → stay Lab/ (tuning trigger phrase)             │
  └───────────┬───────────────────────────────────────────┘
              │  both pass
              ▼
  ┌─── PROMOTE (Lab/ → skills/) ──────────────────────────┐
  │  move Lab/experimental-skill/ → skills/experimental-skill/│
  │  → vào stable prompt tier (auto-trigger)                │
  │  → curated: chỉ skill proven mới live                   │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills SkillStore.discover — skill loading (nền — TR load Lab/ + skills/)
// ✅ packages/skills curator — curation (archive/prune) (nền — TR promotion = curated curation)
// ✅ packages/skills SkillProvenance — provenance kind (nền — TR Lab/ = staging kind)
// ✅ packages/eval ParityHarness — eval (nền — TR routing eval gate)

// ❌ THIẾU: Lab/ staging dir (skill load nhưng không vào stable tier)
// ❌ THIẾU: validation gate (schema + format + trigger conflict check)
// ❌ THIẾU: promotion pipeline (validate + routing eval → move Lab/ → skills/)
```

## Implementation

```typescript
// packages/skills/src/promotion.ts (MỚI)
import type { SkillStore, Skill } from "./curator.js";

interface ValidationResult { valid: boolean; errors: string[] }
interface PromotionResult { promoted: boolean; reason: string }

class SkillPromotion {
  constructor(
    private store: SkillStore,
    private validate: (skill: Skill) => ValidationResult,
    private runRoutingEval: (skillName: string) => Promise<number>, // pass-rate
  ) {}

  // promote Lab/ skill → skills/ (validate + routing eval gate)
  async promote(skillName: string, threshold = 0.9): Promise<PromotionResult> {
    const skill = this.store.get(skillName);
    if (!skill) return { promoted: false, reason: "skill not found" };

    // STEP 1: validation gate
    const validation = this.validate(skill);
    if (!validation.valid) return { promoted: false, reason: `validation failed: ${validation.errors.join(", ")}` };

    // STEP 2: routing eval (prove trigger đúng)
    const passRate = await this.runRoutingEval(skillName);
    if (passRate < threshold) return { promoted: false, reason: `routing eval pass-rate ${passRate} < ${threshold}` };

    // STEP 3: promote (move to live tier)
    // skill.provenance.kind = promoted; → enters stable prompt tier
    return { promoted: true, reason: `validated + routing eval ${(passRate * 100 | 0)}%` };
  }
}

// validate: schema + format + trigger conflict
function validateSkill(skill: Skill, liveTriggers: string[]): ValidationResult {
  const errors: string[] = [];
  if (!skill.name) errors.push("missing name");
  if (!skill.description) errors.push("missing description");
  if (!skill.body.trim()) errors.push("empty body");
  // trigger conflict: Lab skill trigger trùng live skill?
  const conflicts = skill.triggers.filter(t => liveTriggers.includes(t));
  if (conflicts.length) errors.push(`trigger conflict: ${conflicts.join(", ")}`);
  return { valid: errors.length === 0, errors };
}

// Usage:
// const promo = new SkillPromotion(store, validateSkill, runRoutingEval);
// const result = await promo.promote("experimental-skill");
// → result.promoted = true chỉ khi validate + routing eval pass
```

## Được

- ✅ Quality gate (skill phải prove routing đúng trước khi live)
- ✅ Curated (chỉ skill pass gate → auto-trigger — giảm noise)
- ✅ Safe experimentation (Lab/ cho prototype — không ảnh hưởng production)
- ✅ Trigger conflict prevention (validate check trùng — không route nhầm)

## Mất

- ❌ Promotion friction (Lab/ skill chờ gate → chậm vào production)
- ❌ Eval maintenance (routing eval per skill → nhiều eval)
- ❌ Lab/ accumulation (skill kẹt Lab/ → clutter)
- ❌ Threshold tuning (routing eval threshold quá cao → skill khó promote)

## Khác

Khác **curator** (archive/prune inactive skill) — TR là **promote** (Lab/ → skills/, thêm vào live). Khác **TL routing-eval-cases** (eval routing của skill đã live) — TR **gate trước** promote (prove routing trước khi live). Khác **TI cheap-model-delegation** (delegate task) — TR **curate skill lifecycle**.

## Khi nào chọn

- Agent tự tạo skill (AgentCreated) → cần quality gate trước khi auto-trigger
- Muốn curated production (chỉ skill proven mới live — giảm routing noise)
- Nhiều prototype skill (cần Lab/ staging — không flood production)
- Nối packages/skills SkillStore + curator + SkillProvenance + packages/eval ParityHarness; guard validate completeness (check schema + format + conflict), routing eval relevance (eval đúng routing behavior), và Lab/ cleanup (prune Lab/ skill cũ — không accumulate); TR = skill curated promotion, kết hợp TL routing-eval-cases (eval gate) + TP skill-policy-boundary (policy check trong validate)
