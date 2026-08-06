# Hướng ADI: Feature Intake Risk Lanes — mọi implementation prompt qua intake gate trước khi chọn lane

> **Nguồn gốc:** harness-experimental | **Coupling:** 🟢 — gate ở biên, không đụng core loop | **Agent-agnostic:** ✅ — thuần convention + checklist | **Code sẵn:** ⚠️ (sẵn audit/eval; thiếu intake classifier) | **Effort:** 1 tuần

## Nguồn gốc

**harness-experimental** định nghĩa **FEATURE_INTAKE.md**: mọi implementation prompt phải đi qua **intake gate** — một chuỗi bước bắt buộc trước khi agent chạm code: (1) **classify input type** — là feature mới, bug fix, refactor, hay question; (2) **restate as work item** — viết lại prompt thành work item có cấu trúc; (3) **find affected docs/stories** — xác định tài liệu và story bị ảnh hưởng; (4) **risk checklist** — đánh dấu các yếu tố rủi ro (đụng core, migration, breaking change, v.v.); (5) **chọn lane**: tiny / normal / high-risk.

Điểm mấu chốt: **human không cần tự phân loại risk** — harness làm. Mỗi lane có **template + validation expectation riêng**: lane tiny chỉ cần test đơn giản, lane high-risk bắt buộc plan + acceptance criteria + review. Việc phân loại thành công cụ (không phải cảm tính) giảm quyết định tùy tiện.

## Mô tả

Với mya, intake gate nằm trước `createAgent(...).run()`: prompt thô → classifier (rule-based hoặc LLM) → work item (typed) → risk score → lane. Lane quyết định: (a) workflow nào chạy (workflows runner), (b) mức verification bắt buộc (eval tiers), (c) approval cần thiết (tools approval). `packages/audit` có sẵn `FailureScenario`/`RecoveryRecipe` — intake có thể tham chiếu để chọn recovery; `packages/eval` có sẵn 3 tier để map lane → verification level.

## Kiến trúc (ASCII)

```
  PROMPT THÔ
    │
    ▼ INTAKE GATE
  1. classify input type ── feature | bugfix | refactor | question
  2. restate as work item (cấu trúc: goal, scope, affected)
  3. find affected docs/stories (scan docs + story store)
  4. risk checklist (core? migration? breaking? secrets?)
  5. chọn lane (harness tự phân loại)
        ├─ tiny       ──► template đơn giản + test 1 file
        ├─ normal     ──► template đủ + test + docs
        └─ high-risk  ──► plan + acceptance + review bắt buộc
            │
            ▼
  EXECUTION theo lane → validation expectation của lane
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/audit — AuditLog + recovery.ts (FailureScenario/RecoveryRecipe)
//   (nền risk checklist — map rủi ro → recovery)
// ✅ packages/eval — Parity/Integration/Credentialed tiers
//   (nền validation expectation theo lane)
// ✅ packages/tools — approval.ts (gate human cho lane high-risk)
// ✅ packages/workflows — WorkflowContext + runner (lane → workflow)
// ✅ packages/skills — SkillStore (nền template per lane)

// ❌ THIẾU: intake classifier (input type → work item)
// ❌ THIẾU: risk scoring tự động (rule + LLM hybrid)
// ❌ THIẾU: lane registry (tiny/normal/high-risk → template + validation)
```

## Implementation

```typescript
// packages/agent/src/intake.ts (NEW)
export type InputKind = "feature" | "bugfix" | "refactor" | "question";
export type Lane = "tiny" | "normal" | "high-risk";

export interface WorkItem {
  kind: InputKind;
  goal: string;
  affected: string[];        // docs/stories bị ảnh hưởng
  risks: string[];           // từ risk checklist
  lane: Lane;
}

const RISK_RULES: Array<[RegExp, string]> = [
  [/packages\/core/, "core"],
  [/migrat|schema/, "migration"],
  [/breaking|BREAKING/, "breaking-change"],
  [/secret|token|key/, "secrets"],
];

export function classifyIntake(prompt: string): WorkItem {
  const kind = detectKind(prompt);
  const risks = RISK_RULES.filter(([re]) => re.test(prompt)).map(([, r]) => r);
  const lane: Lane =
    kind === "question" ? "tiny"
    : risks.includes("core") || risks.includes("migration") ? "high-risk"
    : risks.length > 0 ? "normal"
    : "tiny";
  return { kind, goal: restate(prompt), affected: scanAffected(prompt), risks, lane };
}

export function validationFor(lane: Lane): string[] {
  // map lane → validation expectation (nối packages/eval tiers)
  return lane === "high-risk"
    ? ["plan", "acceptance-criteria", "review", "test:critical"]
    : lane === "normal" ? ["test", "typecheck"] : ["test-one-file"];
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Human khỏi phân loại risk thủ công | ❌ Classifier sai → lane sai → verification lệch |
| ✅ Lane có template + validation riêng | ❌ Intake gate thêm bước cho mọi prompt |
| ✅ Risk checklist bắt buộc, không cảm tính | ❌ Rule-based thiếu context tinh tế |
| ✅ Map được sang recovery (audit) + eval | ❌ LLM classifier tốn token cho prompt nhỏ |

## Khác các hướng gần

| | ADI Intake Lanes | ADJ Maturity Ladder | ADH Acceptance Criteria |
|---|---|---|---|
| Điểm vào | Trước mọi prompt | Trước khi gọi "có harness" | Trước execution |
| Output | Work item + lane | Level H0→H2 | Criteria list |
| Đo lường | Risk checklist | Criteria inspectable | Command/artifact |

## Khi nào chọn

- Nhiều loại task trộn lẫn (feature/bugfix/refactor) cần quy trình khác nhau
- Muốn human khỏi phân loại risk mỗi lần
- Đã có eval tiers + audit recovery — chỉ cần gate nối vào
- Task high-risk cần plan + acceptance bắt buộc, task nhỏ không cần