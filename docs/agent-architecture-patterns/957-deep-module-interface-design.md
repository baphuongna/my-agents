# Hướng AJU: Deep Module Interface Design — PRD template yêu cầu sketch module rồi tìm cơ hội extract "deep modules", thiết kế hướng testability ngay từ spec

> **Nguồn gốc:** skills (skills/engineering/to-prd/SKILL.md) | **Coupling:** 🟢 — spec convention, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có prompts + assembler; thiếu deep-module sketch stage) | **Effort:** 1-2 tuần

## Nguồn gốc

**skills** (skills/engineering/to-prd/SKILL.md) có PRD template yêu cầu **sketch module trước** rồi tìm cơ hội extract **"deep modules"** — khái niệm từ John Ousterhout *A Philosophy of Software Design*: module **encapsulate nhiều functionality sau interface đơn giản** (interface nhỏ, implementation sâu — ngược với shallow module: interface to mà chẳng làm gì nhiều); deep module **testable** (logic nằm trong, đầu vào/ra rõ ràng) và **ít thay đổi** (interface ổn định). Thiết kế **hướng testability ngay từ spec** — không đợi code rồi mới nghĩ test.

Giá trị: (1) **interface đơn giản** — caller ít bị phụ thuộc, đổi implementation không vỡ; (2) **testable từ spec** — module deep có ranh giới rõ → test dễ viết, dễ fake; (3) **ít thay đổi** — interface ổn định → ít cascade refactor; (4) **bắt shallow module từ giai đoạn PRD** — không phải refactor khi code đã viết.

## Mô tả

Với mya, pattern = **deep-module sketch stage** trong spec pipeline: (1) **PRD template thêm section "Module Sketch"** — mỗi feature phải vẽ module: interface công khai (tên hàm/type, ngắn) + implementation ẩn (logic bên trong, dày); (2) **shallow detector** — review sketch: interface dài mà implementation mỏng (chỉ pass-through/gọi người khác) → flag "shallow" — đề xuất merge hoặc tái cấu trúc; (3) **testability rubric** — mỗi module sketch phải trả lời: input/output gì, state gì, fake được gì — nếu không fake được (phụ thuộc cứng fs/network) thì sketch lại; (4) nơi gắn — mya có `packages/prompts` (assembler + compressors — nơi định hình prompt template) và `packages/skills` (skill body có thể chứa template) — deep-module sketch là convention trong PRD prompt. Đây là pattern **design-for-testability at spec time**: chất lượng interface quyết định trước khi một dòng code được viết.

## Kiến trúc (ASCII)

```
  FEATURE REQUEST
    │
    ▼ PRD TEMPLATE (to-prd)
  ├─ 1. Mô tả + acceptance criteria
  ├─ 2. MODULE SKETCH ──► vẽ interface (ngắn) + implementation (dày)
  │      │
  │      ▼ SHALLOW DETECTOR
  │    interface dài + impl mỏng (pass-through) ──► flag → merge/tái cấu trúc
  │      │
  │      ▼ TESTABILITY RUBRIC
  │    input/output rõ? state rõ? fake được? ──► không → sketch lại
  │
  └─ 3. Test plan (sinh từ module sketch — testable ngay từ spec)
    │
    ▼ IMPLEMENT (module deep — interface nhỏ, logic dày, ít thay đổi)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts/src/assembler.ts — assemblePrompt (nơi nhúng PRD template)
// ✅ packages/prompts/src/request-context.ts — request context (nền — spec input)
// ✅ packages/skills/src/skill.ts — Skill body (skill chứa PRD template convention)
// ✅ packages/eval/src/harness.ts — ParityHarness (nền — test plan từ spec)
// ✅ packages/core/src/loop.ts — agent loop (nền — spec → implementation pipeline)

// ❌ THIẾU: Module Sketch section trong PRD template
// ❌ THIẾU: shallow module detector (interface dài / impl mỏng)
// ❌ THIẾU: testability rubric (fake được? state rõ? ranh giới rõ?)
```

## Implementation

```typescript
// packages/prompts/src/deep-module.ts (NEW)
export interface ModuleSketch {
  name: string;
  /** Interface công khai — PHẢI ngắn (deep module: interface nhỏ). */
  api: string[];
  /** Implementation ẩn — mô tả độ dày logic bên trong. */
  implDepth: "thin" | "medium" | "deep";
  /** Phụ thuộc ngoài — có fake được không (testability rubric). */
  hardDeps: string[];                 // "fs", "network", "clock"…
  state: "none" | "internal" | "shared";
  input: string;                      // input rõ ràng?
  output: string;                     // output rõ ràng?
}

/** Shallow detector — interface dài + impl mỏng → cần merge/tái cấu trúc. */
export function isShallowModule(sketch: ModuleSketch): boolean {
  const interfaceHeavy = sketch.api.length > 6;          // interface to
  const implThin = sketch.implDepth === "thin";          // mà chẳng làm gì
  return interfaceHeavy && implThin;
}

/** Testability rubric — module sketch phải qua 3 câu hỏi. */
export function testabilityScore(sketch: ModuleSketch): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!sketch.input.trim()) reasons.push("input không rõ — không viết test được");
  if (!sketch.output.trim()) reasons.push("output không rõ — không assert được");
  if (sketch.state === "shared") reasons.push("state shared — test dính nhau, cần isolate");
  const fakeable = sketch.hardDeps.every((d) => d === "clock" || d === "fs"); // fake được
  if (!fakeable) reasons.push(`hard deps không fake được: ${sketch.hardDeps.join(", ")}`);
  return { ok: reasons.length === 0, reasons };
}

/** Đánh giá "deep-ness": điểm cao = interface nhỏ + logic dày + testable. */
export function deepnessScore(sketch: ModuleSketch): number {
  const { ok } = testabilityScore(sketch);
  const interfacePenalty = Math.max(0, sketch.api.length - 3);   // interface càng nhỏ càng tốt
  const depth = sketch.implDepth === "deep" ? 2 : sketch.implDepth === "medium" ? 1 : 0;
  return ok ? 10 + depth - interfacePenalty : 0;                  // 0 = chưa qua rubric
}
// Nối assembler: nhúng Module Sketch section vào PRD prompt template
// Nối eval: test plan sinh từ sketch (input/output đã khai) — testable từ spec
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Interface nhỏ — caller ít phụ thuộc, đổi impl không vỡ | ❌ Sketch tốn thời gian PRD — cần cân bằng độ sâu |
| ✅ Testable từ spec — không chờ code mới nghĩ test | ❌ Đánh giá depth chủ quan — cần rubric rõ |
| ✅ Bắt shallow module sớm — không refactor muộn | ❌ Hard deps đôi khi không tránh được (native) |
| ✅ Interface ổn định — ít cascade thay đổi | ❌ Over-abstract — deep quá thành khó hiểu |

## Khác các hướng gần

| | AJU Deep Module | 646 Assumption Surfacing | 114 Spec-Driven Dev |
|---|---|---|---|
| Trọng tâm | Interface nhỏ + logic dày | Nêu giả định trước khi code | Spec là primary artifact |
| Cơ chế | Module sketch + rubric | 4-phase gated | Spec sinh code |
| Quan hệ | Chất lượng interface trong spec | Giả định của spec | Khung tổng thể |

## Khi nào chọn

- Feature phức tạp, nhiều logic — muốn interface ổn định từ đầu
- Muốn test viết được ngay khi code xong (testable by construction)
- PRD team đã quen sketch — thêm rubric chống shallow module
- Guard: interface ngắn, impl dày, fake được, input/output rõ — đo bằng deepnessScore