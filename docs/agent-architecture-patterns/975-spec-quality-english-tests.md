# Hướng AKM: Spec Quality English Tests — `vetc-spec-quality` được ví "Unit Tests for English": validate spec trước khi implement (đo ambiguity, contradiction, gaps), `vetc-spec-driven` chuyển requirement → structured spec theo pipeline BA→Code 13 bước

> **Nguồn gốc:** vetc-dev-kit (README.md, skills/vetc-spec-quality/SKILL.md) | **Coupling:** 🟢 — spec validation stage | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có prompts + eval; thiếu spec validator) | **Effort:** 2 tuần

## Nguồn gốc

**vetc-dev-kit** có **`vetc-spec-quality`** được ví **"Unit Tests for English"**: (1) **validate spec trước khi implement** — spec là "code" cần được test — đo **ambiguity** (mơ hồ: "handle errors properly" — thế nào là properly?), **contradiction** (mâu thuẫn: "fast" vs "thorough"), **gaps** (thiếu: không nói xử lý edge case nào); (2) **`vetc-spec-driven`** — chuyển requirement → **structured spec** theo pipeline **BA→Code 13 bước** (Business Analyst thu thập → phân tích → spec có cấu trúc → code); (3) **chất lượng spec là gate, không phải hy vọng** — spec kém → code kém chắc chắn — chặn từ spec, không đợi code rồi mới sửa.

Giá trị: (1) **spec được đo** — ambiguity/contradiction/gaps thành số liệu, không cảm tính; (2) **chặn sớm** — lỗi spec rẻ hơn lỗi code gấp nhiều lần; (3) **structured** — spec có cấu trúc (sections, criteria, edge cases) — máy kiểm được; (4) **gate rõ** — spec chưa đạt chuẩn thì không implement.

## Mô tả

Với mya, pattern = **spec validator như test suite**: (1) **spec model** — structured spec: `{ sections: [{ title, body }], criteria: string[], edgeCases: string[], constraints: string[] }` (nối AKD spec-first); (2) **ambiguity detector** — quét từ mơ hồ ("properly", "soon", "etc", "v.v", "xử lý lỗi") + câu không có động từ đo được → flag; (3) **contradiction detector** — cặp câu mâu thuẫn (so sánh nghĩa — heuristic keyword: "không được" vs "cho phép", "nhanh" vs "kỹ") → flag; (4) **gap detector** — acceptance criteria không có edge case tương ứng (input rỗng, lỗi, giới hạn) → flag "thiếu"; (5) **quality gate** — spec chưa đạt (số flag > ngưỡng) → chặn implement (nối AKD/AKK router — Path B chỉ chạy khi spec pass); (6) nơi gắn — `packages/prompts` (spec template), `packages/eval` (validator chạy như test), `packages/skills` (skill body hướng dẫn). Đây là pattern **machine-checked specifications**: spec là artifact có test riêng trước khi trở thành code.

## Kiến trúc (ASCII)

```
  REQUIREMENT (user / BA)
    │
    ▼ vetc-spec-driven — BA→Code 13 bước → STRUCTURED SPEC
  ├─ sections · acceptance criteria · edge cases · constraints
    │
    ▼ vetc-spec-quality — "UNIT TESTS FOR ENGLISH" (validate trước implement)
  ├─ AMBIGUITY — "handle errors properly" → flag (properly mơ hồ)
  ├─ CONTRADICTION — "nhanh" vs "kỹ lưỡng" cùng chỗ → flag
  └─ GAPS — criteria không có edge case (rỗng/lỗi/giới hạn) → flag
    │
    ▼ QUALITY GATE — số flag > ngưỡng → CHẶN implement (sửa spec trước)
    ▼ ĐẠT ──► implement (spec là gate, không phải hy vọng)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts/src/assembler.ts — assemblePrompt · eval/src/harness.ts — ParityHarness
// ✅ packages/skills/src/skill.ts — Skill body · tools lsp-cascade diagnostics (mẫu)
// ✅ packages/council/src/adversarial.ts — review (nền — contradiction check nâng cao)
// ❌ THIẾU: structured spec model · ambiguity/contradiction/gap detectors · quality gate
```

## Implementation

```typescript
// packages/eval/src/spec-quality.ts (NEW)
export interface StructuredSpec {
  title: string;
  sections: Array<{ id: string; body: string }>;
  criteria: string[];          // acceptance criteria
  edgeCases: string[];         // edge case đã khai báo
  constraints: string[];
}
export interface SpecFinding { kind: "ambiguity" | "contradiction" | "gap"; section: string; detail: string }

/** Từ mơ hồ — "properly/soon/etc/v.v/xử lý lỗi" — không đo được. */
const AMBIGUOUS = /\b(properly|soon|etc|v\.v|v\.v\.|somehow|asap|a lot|nhiều|đúng cách|tốt hơn)\b/i;

/** Ambiguity detector — từ mơ hồ + câu không có động từ hành động. */
export function detectAmbiguity(spec: StructuredSpec): SpecFinding[] {
  const findings: SpecFinding[] = [];
  for (const s of spec.sections) {
    if (AMBIGUOUS.test(s.body)) {
      findings.push({ kind: "ambiguity", section: s.id, detail: `"${AMBIGUOUS.exec(s.body)?.[0]}" mơ hồ — cần đo được` });
    }
    if (s.body.trim().length > 0 && !/\b(sẽ|phải|cần|phải trả|return|throw|ghi|lưu|gọi)\b/i.test(s.body)) {
      findings.push({ kind: "ambiguity", section: s.id, detail: "câu không có hành động đo được — không test được" });
    }
  }
  return findings;
}

/** Contradiction detector — cặp "không được" vs "cho phép" cùng chủ đề. */
export function detectContradiction(spec: StructuredSpec): SpecFinding[] {
  const findings: SpecFinding[] = [];
  const text = spec.sections.map((s) => `${s.id}: ${s.body}`).join("\n");
  const forbids = [...text.matchAll(/không (?:được|cho phép|nên)\s+([a-zà-ỹ]+)/gi)].map((m) => m[1]!.toLowerCase());
  const allows = [...text.matchAll(/(?:cho phép|được phép|hỗ trợ)\s+([a-zà-ỹ]+)/gi)].map((m) => m[1]!.toLowerCase());
  for (const f of forbids) {
    if (allows.includes(f)) {
      findings.push({ kind: "contradiction", section: spec.title, detail: `"không được ${f}" nhưng "cho phép ${f}" — mâu thuẫn` });
    }
  }
  return findings;
}

/** Gap detector — criteria không có edge case tương ứng (rỗng/lỗi/giới hạn). */
export function detectGaps(spec: StructuredSpec): SpecFinding[] {
  const findings: SpecFinding[] = [];
  const edges = spec.edgeCases.join(" ").toLowerCase();
  const criteria = spec.criteria.join(" ").toLowerCase();
  if (criteria.includes("input") && !edges.includes("rỗng") && !edges.includes("empty")) {
    findings.push({ kind: "gap", section: spec.title, detail: "criteria có input nhưng thiếu edge case input rỗng" });
  }
  if (criteria.includes("lưu") && !edges.includes("lỗi") && !edges.includes("fail")) {
    findings.push({ kind: "gap", section: spec.title, detail: "criteria có lưu trữ nhưng thiếu edge case lỗi ghi" });
  }
  return findings;
}

/** Quality gate — tổng flag > ngưỡng → chặn implement (spec là gate). */
export function specQualityGate(spec: StructuredSpec, threshold = 3): { ok: boolean; findings: SpecFinding[] } {
  const findings = [...detectAmbiguity(spec), ...detectContradiction(spec), ...detectGaps(spec)];
  return { ok: findings.length <= threshold, findings };
}
// Nối AKD: quality gate chạy trước spec → plan → code (spec pass mới sinh code)
// Nối AKK: Path B (quick) chỉ chạy khi specQualityGate ok
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Spec được đo — ambiguity/contradiction/gaps thành số | ❌ Heuristic bắt nhầm (từ mơ hồ dùng đúng nghĩa) |
| ✅ Chặn sớm — lỗi spec rẻ hơn lỗi code nhiều lần | ❌ Viết spec structured tốn công hơn prose tự do |
| ✅ Gate rõ — spec chưa đạt thì không implement | ❌ Contradiction semantic phức tạp — heuristic không đủ |
| ✅ Máy kiểm được — validator chạy như test | ❌ Ngưỡng flag tùy chỉnh — cần cân chỉnh |

## Khác các hướng gần

| | AKM Spec Quality | AKD Spec Source of Truth | 646 Assumption Surfacing |
|---|---|---|---|
| Trọng tâm | Validate spec (English tests) | Spec là primary artifact | Giả định trước code |
| Cơ chế | Ambiguity/contradiction/gap | spec → plan → code | 4-phase gated |
| Quan hệ | Gate chất lượng cho AKD | Chứa AKM | Giả định trong spec |

## Khi nào chọn

- Spec hay mơ hồ/mâu thuẫn — code sinh ra sai từ spec
- Muốn spec được "test" trước khi implement (Unit Tests for English)
- Đã có prompts + eval — thêm validator là rẻ
- Guard: spec structured, ambiguity/contradiction/gap đo được, gate chặn implement khi kém