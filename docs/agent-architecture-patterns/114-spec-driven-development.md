# Hướng KKKKK: Spec-Driven Development — spec là nguồn sự thật, code sinh từ đó

> **Nguồn gốc:** GitHub Spec-Kit (2025); "Spec-Driven Development: From Code to Contract" (arXiv 2602.00180, 2026); addyosmani "Good Spec" 2026
> **Coupling:** 🟢 — spec là dữ liệu, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (docs/tests sẵn; thiếu spec runtime)
> **Effort:** 1-2 tuần

## Nguồn gốc

Spec-driven development (SDD): **spec là source of truth — code chỉ là implementation phụ** — GitHub blog: "a contract for how your code should behave and becomes the source of truth your tools and AI agents use to generate, test, and validate" (Spec-Kit toolkit); arXiv 2602.00180: "SDD inverts the traditional workflow — specifications as the source of truth, code as supporting"; addyosmani 2026 "How to write a good spec for AI agents" (clarity/focus); OpenSpec: "lightweight spec-driven framework" cho coding agents. Với agent: spec = **executable contract** — agent đọc spec → viết code → chạy tests sinh từ spec → xác nhận. Khác **HHHH agent spec** (mô tả agent config: tools/policies) — KKKKK là *spec sản phẩm* (hành vi cần xây — inputs/outputs, edge cases); khác **W prompt manager** — KKKKK có schema chuẩn + machine-readable.

## Mô tả

mya dùng cho task lập trình (subagent coding — GG): (1) **spec định dạng** — markdown/YAML có cấu trúc: goal, inputs/outputs, edge cases, acceptance criteria (machine-checkable), constraints (not-to-do — anti-hallucination scope); (2) **agent nhận spec làm contract** — implement → sinh tests từ acceptance criteria (nối MMMMM loop) → chạy vitest → báo kết quả theo criteria (53); (3) **verify tự động** — mỗi criterion có test mapping — pass ≠ done: criteria verify (YYYY chống fake); (4) **spec versioned** (VV/28) — đổi spec = đổi contract → SSSS CI chạy lại; (5) **review spec trước** — spec viết tốt → agent làm đúng (addyosmani): checklist spec (goal rõ, scope chống tràn, edge có). Khác TDD thuần (tests viết trước) — SDD *spec đầy đủ* (test chỉ 1 thành phần).

## Kiến trúc

```
  SPEC (source of truth — cấu trúc: goal/inputs/outputs/edge/criteria/constraints)
    │  versioned (VV) · review như code (SSSS CI)
    ▼
  AGENT (subagent coding — GG)
    ├─ đọc spec ──► implement (scope: KHÔNG tràn — constraints)
    ├─ sinh tests từ acceptance criteria (MMMMM)
    ├─ chạy vitest ──► kết quả theo criterion (53)
    └─ verify: criteria pass THẬT (YYYY — chống fake pass)
        │
        ▼
  CI: spec đổi → chạy lại toàn bộ (SSSS) · drift theo criteria (ZZZZ)
```

```
mya: docs/TDD + vitest + eval SẸN — thiếu: spec format chuẩn + verify criteria
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ docs (TDD/coverage) + vitest — nền chạy criteria
// ✅ 53 report — kết quả theo criterion
// ✅ VV audit + 28 versioning — spec versioned
// ✅ SSSS CI — chạy lại khi spec đổi
// ✅ YYYY anti-hack — chống fake pass (xóa test)
// ✅ GG subagents — agent coding nhận spec

// ❌ THIẾU: spec format chuẩn (schema: goal/edge/criteria/constraints)
// ❌ THIẾU: sinh test từ acceptance criteria
// ❌ THIẾU: verify spec-criteria ↔ test mapping
```

## Implementation

```typescript
// packages/spec/src/spec.ts (NEW)
interface Spec {
  goal: string;
  inputs: Schema; outputs: Schema;         // contract machine-readable
  edges: string[];                          // edge cases
  criteria: Array<{ id: string; check: string; test?: string }>;
  constraints: string[];                    // not-to-do (chống tràn scope)
}

function verify(spec: Spec, results: VitestResult): CriteriaReport {
  // mỗi criterion → test mapping → pass THẬT? (YYYY)
  return spec.criteria.map((c) => ({
    id: c.id,
    pass: results.tests[c.test ?? c.id]?.pass ?? false,
  }));
}
// addyosmani: spec tốt = goal rõ · scope chống tràn · edge đủ
// GitHub Spec-Kit: spec = contract sinh code + validate (2025)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Code sinh từ contract — ít lệch yêu cầu | ❌ Spec viết kém → agent làm kém (kỷ luật) |
| ✅ Acceptance criteria machine-checkable (53) | ❐ Spec schema phải thiết kế (đủ—không thừa) |
| ✅ Versioned + CI (SSSS) — đổi spec có vết | ❌ Không hợp task khám phá (spec trước khi biết) |
| ✅ Chống fake pass (YYYY verify criteria) | ❌ Over-spec task nhỏ (tốn thời gian viết) |

## Khác các hướng gần

| | HHHH Agent Spec | 7 TDD | KKKKK: SDD |
|---|---|---|---|
| Spec gì | Agent config | Tests | **Hành vi sản phẩm** |
| Nguồn thật | Runtime config | Tests | **Spec (test chỉ 1 phần)** |
| Mối quan hệ | Bổ sung | Thành phần | **Bao trùm + verify** |

## Khi nào chọn

- Coding tasks lặp lại nhiều (subagent GG)
- Muốn agent làm đúng phạm vi (anti-tràn scope)
- Đã có vitest + eval + versioning — thêm spec layer
- Sẵn sàng kỷ luật viết spec chuẩn (addyosmani)