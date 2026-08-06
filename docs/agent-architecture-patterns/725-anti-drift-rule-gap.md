# Hướng AAW: Anti-Drift Rule Gap — quy tắc "no data → admit" không kích hoạt trên domain mới vì trigger condition thiếu

> **Nguồn gốc:** f2-experiment (conclusion.md) | **Coupling:** 🟢 — thêm rule coverage audit cho skill/prompt rules | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill model + eval — chưa có trigger-condition audit) | **Effort:** 1 tuần

## Nguồn gốc

**f2-experiment** phát hiện quy tắc **"no data → admit"** (không có dữ liệu thì phải nói không biết) **không kích hoạt trên domain mới**: LLM coi quantization là **within-domain ML** nên áp **first-principles math** rồi trình extrapolation như **stance** — không hề admit. **Gap nằm ở trigger condition của rule**: rule chỉ bắt "không có dữ liệu" khi model nhận ra mình không có dữ liệu — nhưng trên domain mới, model tự tin đó là kiến thức chung nên trigger không bao giờ cháy. Nguyên tắc: **rule phải có trigger condition đủ rộng** — "no data" là trạng thái model khó tự nhận, phải trigger bằng dấu hiệu khách quan (vd chủ đề không có trong corpus, câu hỏi edge).

## Mô tả

mya anti-drift rule gap audit: packages/prompts drift.ts (DriftGrader) + packages/skills skill.ts (rule trong skill body) sẵn nền. AAW thêm **trigger-condition audit**: với mỗi rule phòng drift (admit/no-data/uncertainty), kiểm tra **trigger condition** có đủ mạnh không: (1) trigger dựa trên **nhận thức của model** ("nếu bạn không biết") → yếu — model không nhận được; (2) trigger dựa trên **dấu hiệu khách quan** ("nếu chủ đề không có trong [corpus list]", "nếu câu hỏi là edge") → mạnh. Audit output: rule nào yếu → đề xuất thêm objective trigger. Test: chạy rule trên domain mới (AAU edge set) — rule không kích hoạt = gap.

## Kiến trúc

```
  RULE (trong skill/prompt): "no data → admit"
        │
        ▼
  ┌─── TRIGGER AUDIT ────────────────────────────────┐
  │  trigger dạng "nếu bạn không biết"?               │
  │   → YẾU (model không nhận ra) — gap               │
  │  trigger dạng "nếu chủ đề ∉ corpus / edge"?       │
  │   → MẠNH (khách quan)                             │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── GAP TEST (domain mới — AAU edge set) ─────────┐
  │  rule không kích hoạt trên domain mới             │
  │   → gap xác nhận — thêm objective trigger         │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts drift.ts — DriftGrader (nền đo drift)
// ✅ packages/skills skill.ts — skill body rules (nơi audit)
// ✅ packages/eval harness.ts — golden scenarios (nền gap test)
// ✅ packages/eval edge-question.ts (AAU) — edge set (nền domain mới test)
// ✅ packages/tools find.ts/grep — corpus search (nền objective trigger)

// ❌ THIẾU: trigger-condition classifier (yếu/mạnh)
// ❌ THIẾU: gap test trên domain mới
```

## Implementation

```typescript
// packages/eval/src/rule-audit.ts (NEW)
export type TriggerStrength = "weak" | "strong";

/** Phân loại trigger condition của rule phòng drift. */
export function classifyTrigger(ruleText: string): TriggerStrength {
  // YẾU: dựa vào nhận thức chủ quan của model
  const subjective = /\b(nếu bạn (không )?(biết|rõ)|nếu bạn không chắc|khi bạn thiếu thông tin)\b/i;
  // MẠNH: dựa vào dấu hiệu khách quan (corpus, edge, nguồn)
  const objective = /\b(nếu (chủ đề|topic) (không có|vắng) trong|ngoài (corpus|tài liệu)|edge question|không có trong danh sách)\b/i;
  if (objective.test(ruleText)) return "strong";
  if (subjective.test(ruleText)) return "weak";
  return "weak"; // không có trigger rõ — mặc định yếu
}

export interface RuleAuditResult {
  rule: string;
  trigger: TriggerStrength;
  /** Trigger có nhắc nguồn dữ liệu cụ thể không (corpus path/list)? */
  hasConcreteDataSource: boolean;
}

/** Audit một rule — gap nếu trigger yếu. */
export function auditRule(ruleText: string): RuleAuditResult {
  return {
    rule: ruleText,
    trigger: classifyTrigger(ruleText),
    hasConcreteDataSource: /\b(corpus|tài liệu|docs\/|danh sách|list of)\b/i.test(ruleText),
  };
}

/** Gợi ý sửa rule yếu: thêm objective trigger. */
export function strengthenRule(ruleText: string, dataSource: string): string {
  return `${ruleText}\nTrigger khách quan: nếu chủ đề không có trong ${dataSource} HOẶC câu hỏi là edge/ngoài scope → bắt buộc nói "không có dữ liệu công khai", KHÔNG suy diễn first-principles rồi trình bày như stance.`;
}

/** Gap test: chạy rule trên domain mới (edge set) — không kích hoạt = gap. */
export function testRuleOnNovelDomain(ruleText: string, edgeResponses: string[]): { gap: boolean; evasiveCount: number } {
  const admitRe = /\b(không (biết|rõ)|chưa có dữ liệu|không có dữ liệu công khai|unknown|no public data)\b/i;
  const evasiveCount = edgeResponses.filter((r) => admitRe.test(r)).length;
  // Nếu rule mạnh mà gần như không response nào admit → rule không kích hoạt trên domain mới
  return { gap: classifyTrigger(ruleText) === "strong" && evasiveCount < edgeResponses.length * 0.3, evasiveCount };
}
// Usage: auditRule(skillRule) → trigger weak → strengthenRule(skillRule, "~/.mya/corpus.json")
//   → testRuleOnNovelDomain(sửa xong) → gap hết
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lộ trigger yếu trước khi nó gây drift | ❌ Regex classify trigger — ngôn ngữ tự nhiên đa dạng |
| ✅ Objective trigger — không phụ thuộc model tự nhận | ❌ Corpus list phải duy trì (domain mới thêm vào) |
| ✅ Gap test bằng edge set — bằng chứng thực | ❌ Rule dài ra khi thêm trigger (token cost) |
| ✅ Đề xuất sửa rule cụ thể | ❌ Edge set phủ không hết domain mới |

## Khác các hướng gần

| | DriftGrader (đo drift) | AAW: Rule Gap Audit |
|---|---|---|
| Phát hiện | Drift sau khi xảy ra | **Trigger yếu TRƯỚC khi gây hại** |
| Đối tượng | Compressor | **Rule phòng drift** |
| Cơ chế | Golden replay | **Trigger classify + edge test** |
| Mối quan hệ | Nền đo | **Lớp audit rule** |

## Khi nào chọn

- Skill/prompt có rule phòng drift ("no data → admit") mà vẫn drift trên domain mới
- Muốn audit rule theo trigger condition (khách quan vs chủ quan)
- Đã có drift + edge set (AAU) — thêm rule-audit
- Guard: corpus source cụ thể trong trigger, edge test sau khi sửa, classify test phủ cả 2 loại trigger
