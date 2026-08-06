# Hướng AKD: Spec Sources of Truth — SDD đảo ngược quyền lực: spec (PRD) là primary artifact sinh ra implementation plans và code, code là expression của spec

> **Nguồn gốc:** spec-kit (spec-driven.md) | **Coupling:** 🟡 — workflow convention đổi quyền lực giữa spec/code | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có prompts + workflows; thiếu spec-first pipeline) | **Effort:** 2 tuần

## Nguồn gốc

**spec-kit** (spec-driven.md) có **SDD — Spec-Driven Development** **đảo ngược quyền lực**: (1) **spec (PRD) là primary artifact** — sinh ra implementation plans và code (code không phải nguồn, spec mới là nguồn); (2) **code là expression của spec** — code là "bản dịch" của spec xuống implementation; (3) **maintenance = evolving spec** — muốn đổi hành vi thì sửa spec trước, code theo sau; (4) **debugging = sửa spec/plan sinh code sai** — bug là triệu chứng spec/plan sai, không phải "sửa code mù"; (5) **"code serves specifications"** — nguyên tắc trung tâm: code phục vụ spec, không ngược lại.

Giá trị: (1) **một nguồn sự thật** — spec là chỗ duy nhất định nghĩa "cái gì", code chỉ là "làm sao"; (2) **maintenance có hướng** — đổi spec → plan/code tái sinh (không sửa lung tung trong code); (3) **debugging có gốc** — bug → trace về spec/plan sai chỗ nào; (4) **review tập trung** — review spec thay vì review từng dòng code.

## Mô tả

Với mya, pattern = **spec-first pipeline** trong workflow: (1) **spec artifact** — PRD là file đầu tiên được tạo (markdown — `packages/memory` + prompts để lưu); (2) **spec → plan generator** — từ PRD sinh implementation plan (feature numbering + semantic branches — nối AKE); (3) **plan → code** — plan sinh code theo slice (nối AJS vertical slices); (4) **traceability** — mỗi file code có header trỏ về spec section (spec id) — đổi spec biết code nào bị ảnh hưởng; (5) **maintenance flow** — đổi hành vi = sửa PRD → regenerate plan/code, không sửa code trực tiếp; (6) nơi gắn — `packages/prompts` (assembler — PRD template), `packages/workflows` (runner — pipeline), `packages/skills` (skill body hướng dẫn flow). Đây là pattern **spec-as-source-of-truth**: quyền lực thuộc spec, code là derived artifact — đảo ngược thói quen "code là chính, doc là phụ".

## Kiến trúc (ASCII)

```
  SPEC (PRD) — PRIMARY ARTIFACT (nguồn sự thật duy nhất)
    │
    ▼ sinh ra (spec → plan → code — một chiều)
  ├─ IMPLEMENTATION PLAN (features + branches — nối AKE)
  ├─ CODE (expression của spec — header trỏ spec section)
  └─ TESTS (từ acceptance criteria trong spec)
    │
    ▼ MAINTENANCE = EVOLVING SPEC (không sửa code trực tiếp)
  ├─ đổi hành vi ──► SỬA SPEC trước → regenerate plan/code
  └─ bug ──► trace về SPEC/PLAN sai → sửa spec/plan sinh code sai
  "CODE SERVES SPECIFICATIONS"
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts/src/assembler.ts — assemblePrompt (nơi nhúng PRD template)
// ✅ packages/workflows/src/runner.ts — pipeline() (nền — spec→plan→code stages)
// ✅ packages/skills/src/skill.ts — Skill body (skill hướng dẫn SDD flow)
// ✅ packages/memory/src/store.ts — Brain store (nơi lưu spec artifact)
// ✅ packages/tools/src/hashline-edit.ts — edit tool (nền — sửa spec)

// ❌ THIẾU: spec artifact convention (PRD là primary, không phải doc phụ)
// ❌ THIẾU: spec → plan generator (traceability spec section → code)
// ❌ THIẾU: maintenance flow (đổi hành vi = sửa spec, không sửa code mù)
```

## Implementation

```typescript
// packages/workflows/src/spec-driven.ts (NEW)
export interface SpecSection { id: string; title: string; body: string }
export interface SpecArtifact {
  path: string;                // PRD file path — primary artifact
  version: number;
  sections: SpecSection[];     // mỗi section có id để traceability
}

/** Spec → plan — từ sections sinh implementation plan (feature list). */
export function specToPlan(spec: SpecArtifact): Array<{ feature: string; specId: string; tasks: string[] }> {
  return spec.sections.map((s) => ({
    feature: s.title,
    specId: s.id,                              // traceability: code trỏ về specId
    tasks: s.body.split("\n").filter((l) => l.trim().startsWith("- ")).map((l) => l.trim().slice(2)),
  }));
}

/** Traceability — file code header trỏ spec section; đổi spec biết code bị ảnh hưởng. */
export function codeHeader(specId: string, specPath: string): string {
  return `// Generated from spec ${specId} (${specPath}) — code serves specifications.\n// Đổi hành vi: sửa SPEC, không sửa code trực tiếp.\n`;
}

/** Debugging flow — bug trace về spec/plan sai, không sửa code mù. */
export function traceBugToSpec(
  failingFile: string,
  plan: Array<{ feature: string; specId: string }>,
  fileToSpec: (file: string) => string | null,
): { specId: string | null; planEntry: string | null; action: string } {
  const specId = fileToSpec(failingFile);
  if (!specId) {
    return { specId: null, planEntry: null, action: "file không có traceability — thêm header spec trước khi sửa" };
  }
  const entry = plan.find((p) => p.specId === specId);
  return { specId, planEntry: entry?.feature ?? null, action: `review spec "${specId}" + plan trước — code chỉ là expression` };
}

/** Maintenance gate — không cho sửa code khi spec chưa được cập nhật. */
export function requireSpecFirst(
  spec: SpecArtifact,
  file: string,
  fileToSpec: (file: string) => string | null,
): { allowed: boolean; reason: string } {
  const specId = fileToSpec(file);
  if (!specId) return { allowed: false, reason: "code không trỏ spec — cập nhật header trước" };
  return spec.sections.some((s) => s.id === specId)
    ? { allowed: true, reason: "" }
    : { allowed: false, reason: `spec section "${specId}" không tồn tại — sửa spec trước` };
}
// Nối skills: skill body hướng dẫn SDD flow (spec → plan → code → evolve spec)
// Nối AKE: specToPlan nối feature numbering + branch generation
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một nguồn sự thật — spec định nghĩa "cái gì" | ❌ Spec cũ/lệch code — phải kỷ luật cập nhật |
| ✅ Maintenance có hướng — sửa spec → tái sinh code | ❌ Overhead viết spec trước cho thay đổi nhỏ |
| ✅ Debugging có gốc — trace về spec/plan sai | ❌ Traceability yêu cầu header kỷ luật |
| ✅ Review tập trung vào spec | ❌ Đảo ngược thói quen — team cần training |

## Khác các hướng gần

| | AKD Spec Source of Truth | 114 Spec-Driven Dev | 646 Assumption Surfacing |
|---|---|---|---|
| Trọng tâm | Spec là primary artifact | Khung SDD tổng thể | Nêu giả định trước code |
| Cơ chế | spec → plan → code một chiều | Spec sinh code | 4-phase gated |
| Quan hệ | Nguyên tắc cốt lõi của 114 | Chứa AKD | Giả định trong spec |

## Khi nào chọn

- Project cần một nguồn sự thật cho "cái gì cần làm" — code hay lệch yêu cầu
- Maintenance thường xuyên đổi hành vi — muốn sửa spec thay vì sửa code mù
- Đã có prompts + workflows — thêm spec-first pipeline
- Guard: spec trước, code trỏ spec (traceability), đổi hành vi = sửa spec, bug trace về spec