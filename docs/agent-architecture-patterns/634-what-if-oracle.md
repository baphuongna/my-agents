# Hướng XJ: What-If Oracle — 6 nhánh kịch bản chuẩn (best/likely/worst/wild-card/contrarian/second-order) mỗi nhánh kèm probability, trigger conditions, required response

> **Nguồn gốc:** scientific-agent-skills (what-if scenario framework) | **Coupling:** 🟢 — thêm analysis skill chạy trước quyết định, không đụng loop core | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (có skills + prompts — chưa có 6-branch scenario template) | **Effort:** 1-2 tuần

## Nguồn gốc

**scientific-agent-skills** định nghĩa skill **what-if** ép agent không được kết luận 1 kịch bản duy nhất. Trước mỗi quyết định quan trọng, agent phải sinh **6 nhánh kịch bản chuẩn**: (1) **Best-case** — mọi thứ đi đúng hướng, (2) **Likely-case** — theo kỳ vọng trung bình, (3) **Worst-case** — mọi thứ sai hướng, (4) **Wild-card** — sự kiện bất ngờ ít xác suất nhưng hậu quả lớn, (5) **Contrarian** — giả định ngược lại quan điểm chính, (6) **Second-order** — hệ quả bậc hai (tác động gián tiếp sau phản ứng bậc nhất). Mỗi nhánh kèm **probability** (0-1), **trigger conditions** (điều kiện xảy ra), **required response** (agent phải làm gì nếu nhánh thành sự thật). Nguyên tắc: **phân nhánh trước, hành động sau** — chống overconfidence và single-point forecasting.

## Mô tả

mya what-if oracle: trước quyết định rủi ro (deploy, migration, xóa data, đổi API), agent chạy skill **what-if** → sinh 6 nhánh kịch bản cấu trúc → trình bày trade-off → chọn action dựa trên expected value + worst-case mitigation. Mỗi nhánh là object `{ branch, probability, triggers[], response }`. Agent không chỉ chọn "đường tốt nhất" mà khai báo sẵn **contingency** (nếu worst-case trigger thì rollback X). mya có skills (SKILL.md progressive disclosure) + prompts — XJ thêm **what-if skill template** + **scenario validator** (kiểm 6 nhánh đủ, probability hợp lệ, response cụ thể).

## Kiến trúc

```
  DECISION POINT (deploy / migrate / delete / API change)
        │
        ▼
  ┌─── WHAT-IF SKILL (sinh 6 nhánh) ────────────────────────┐
  │                                                           │
  │  1. BEST        prob 0.20  triggers: [tests green, perf ok]   response: ship full
  │  2. LIKELY      prob 0.45  triggers: [2-3 bugs, perf ok]      response: ship + hotfix
  │  3. WORST       prob 0.15  triggers: [p0 incident, perf drop] response: rollback + postmortem
  │  4. WILD-CARD   prob 0.05  triggers: [provider outage, leak]  response: failover + comms
  │  5. CONTRARIAN  prob 0.10  triggers: [nobody uses feature]    response: gate behind flag
  │  6. SECOND-ORDER prob 0.05 triggers: [load shifts, cost spike] response: re-budget + scale plan
  └────────────────────────┬──────────────────────────────────┘
                           ▼
  ┌─── VALIDATOR (kiểm cấu trúc) ──────────────────────────┐
  │  ✓ đủ 6 nhánh?  ✓ prob ∈ [0,1]?  ✓ triggers[]?         │
  │  ✓ response cụ thể (không "monitor")?                   │
  │  ✗ → yêu cầu agent bổ sung                              │
  └────────────────────────┬──────────────────────────────┘
                           ▼
  EXPECTED-VALUE = Σ(probᵢ × outcomeᵢ)  +  worst-case mitigation plan
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SKILL.md model + progressive disclosure (nền — XJ what-if là 1 skill)
// ✅ packages/skills curator.ts — skill store/load (nền — XJ load what-if skill)
// ✅ packages/prompts — prompt tiering (nền — XJ scenario template trong body)
// ✅ packages/council — council voting (nền — XJ contrarian branch analog)

// ❌ THIẾU: 6-branch scenario template (best/likely/worst/wild-card/contrarian/second-order)
// ❌ THIẾU: scenario validator (kiểm đủ nhánh, prob hợp lệ, response cụ thể)
// ❌ THIẾU: expected-value reducer (Σ prob × outcome + worst-case mitigation)
```

## Implementation

```typescript
// packages/skills/src/what-if.ts (MỚI)
type BranchKind = "best" | "likely" | "worst" | "wildcard" | "contrarian" | "second-order";

interface ScenarioBranch {
  branch: BranchKind;
  probability: number;        // 0..1
  triggers: string[];         // điều kiện xảy ra nhánh
  response: string;           // agent phải làm gì
  outcome?: number;           // điểm/giá trị kết quả (optional, cho EV)
}

const REQUIRED_BRANCHES: BranchKind[] = [
  "best", "likely", "worst", "wildcard", "contrarian", "second-order",
];

function validateScenarios(branches: ScenarioBranch[]): string[] {
  const errors: string[] = [];
  const kinds = new Set(branches.map((b) => b.branch));
  for (const req of REQUIRED_BRANCHES) {
    if (!kinds.has(req)) errors.push(`thiếu nhánh ${req}`);
  }
  for (const b of branches) {
    if (b.probability < 0 || b.probability > 1) errors.push(`${b.branch}: prob ngoài [0,1]`);
    if (b.triggers.length === 0) errors.push(`${b.branch}: thiếu trigger conditions`);
    if (b.response.length < 5) errors.push(`${b.branch}: response quá mơ hồ`);
  }
  return errors;
}

function expectedValue(branches: ScenarioBranch[]): number {
  return branches
    .filter((b) => typeof b.outcome === "number")
    .reduce((sum, b) => sum + b.probability * (b.outcome ?? 0), 0);
}

// Usage:
// const branches = await runWhatIfSkill(decision);
// const errs = validateScenarios(branches);
// const ev = expectedValue(branches);
// → trình bày EV + worst-case.response làm contingency
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống overconfidence (ép 6 góc nhìn, không 1 đường) | ❌ 6x token (mỗi nhánh tốn prompt + reasoning) |
| ✅ Contingency sẵn (worst-case response = rollback plan) | ❌ Chậm (6 nhánh + validate + EV) |
| ✅ Contrarian check (ép xét ngược quan điểm chính) | ❌ Prob chủ quan (LLM ước lượng prob sai) |
| ✅ Second-order (bắt hệ quả gián tiếp dễ bỏ sót) | ❌ Over-analysis paralysis (quá nhiều kịch bản → không quyết) |

## Khác các hướng gần

| | Single-path plan | Risk checklist | XJ: 6-Branch Oracle |
|---|---|---|---|
| Số nhánh | 1 | N risk item | **6 nhánh cố định (structured)** |
| Probability | ❌ | ❌ | **✅ prob ∈ [0,1]** |
| Contrarian | ❌ | ❌ | **✅ (ép xét ngược)** |
| Second-order | ❌ | ❌ | **✅ (hệ quả bậc hai)** |

## Khi nào chọn

- Quyết định rủi ro cao (deploy production, migration, xóa data, đổi API public)
- Muốn contingency sẵn (worst-case response = rollback/failover plan có sẵn)
- Nối packages/skills skill.ts + curator.ts + packages/council + packages/prompts; guard prob-calibration (LLM ước lượng prob lệch → dùng historical hit-rate), response-specificity (reject response mơ hồ như "monitor"), và decision-gate (validator fail → agent không được quyết, phải bổ sung nhánh); XJ = what-if oracle, kết hợp 635 XK hypothesis-tree-refinement (what-if là 1 nhánh hypothesis tree) + 637 XM security-scan-gate (scan skill what-if trước deploy)
