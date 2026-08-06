# Hướng VC: Honest Boundary Contract — mỗi skill khai báo honest boundaries; test biên phải thể hiện uncertainty

> **Nguồn gốc:** nuwa-skill (honest boundaries); "declare what the skill cannot do"; "edge-case tests must show uncertainty"; "know-your-limits contract"; "honest failure over confident hallucination" | **Coupling:** 🟢 — thêm boundary-declaration field + boundary-test harness vào skill | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skill meta + tool-test-harness sẵn — chưa có boundary field + uncertainty-test) | **Effort:** 2-3 tuần

## Nguồn gốc

**nuwa-skill** yêu cầu mỗi Skill không chỉ mô tả năng lực — mà phải **khai báo honest boundaries**: những gì skill **không làm được** (out-of-scope, edge case, data thiếu). Quan trọng hơn, **test biên phải thể hiện uncertainty**: khi feed input ngoài boundary, skill phải **thừa nhận không chắc / refuse** chứ không bịa câu trả lời tự tin. Nguyên tắc: **thất bại trung thực hơn ảo giác tự tin** — skill biết giới hạn, và test chứng minh nó hành xử đúng ở biên (uncertainty, không confident-hallucinate). Khác **394 safeguard-tiering** (lọc output) — VC là **self-declared limit + edge-test**; khác robustness test thuần — VC **assert uncertainty** (không assert đúng/sai).

## Mô tả

mya honest boundary contract: (1) **Boundary declare**: mỗi skill meta thêm `boundaries: string[]` (khả năng KHÔNG làm, vd "không dịch slang", "không có dữ liệu sau 2023"). (2) **Boundary test**: bộ test gồm **edge input** (ngoài boundary) — assert output **thể hiện uncertainty** (keyword "không chắc", "không biết", "ngoài phạm vi", hoặc refuse). (3) **Confidence guard**: nếu skill trả lời confident ở ngoài boundary → **fail** (bịa). mya có skill meta + tool-test-harness — VC thêm **boundary field** + **uncertainty-assert harness**.

## Kiến trúc

```
  SKILL META:
    name: "translator"
    can:  "dịch văn bản chính thức"
    boundaries:                       ← HONEST BOUNDARY CONTRACT
      - "không dịch slang / idioms địa phương"
      - "không xử lý text > 5000 ký tự"
      - "không có dữ liệu ngôn ngữ sau training cutoff"
        │
        ▼
  ┌─── BOUNDARY TEST (edge input → assert uncertainty) ───┐
  │  input (ngoài boundary): "dịch: 'it's raining cats…'" │
  │  expected: thể hiện uncertainty / refuse               │
  │                                                         │
  │  ✓ PASS: "Tôi không chắc về idiom này (ngoài boundary)" │
  │  ✗ FAIL: "Trời đang mưa mèo và chó" (confident-bịa)    │
  └───────────────────────┬─────────────────────────────┘
                          │ (asserted in CI)
                          ▼
  ┌─── CONFIDENCE GUARD ──────────────────────────────────┐
  │  skill confident ở ngoài boundary → TEST FAIL          │
  │  → buộc skill thừa nhận giới hạn                        │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills skill.meta — meta declare (nền — VC thêm boundary field)
// ✅ scripts/tool-test-harness.mjs — skill test (nền — VC = edge-test layer)
// ✅ 394 safeguard-tiering — output filter (relate — VC = pre-declared limit)

// ❌ THIẾU: boundary field trong skill meta (boundaries: string[])
// ❌ THIẾU: uncertainty-assert harness (edge input → assert uncertainty)
// ❌ THIẾU: confidence guard (confident ngoài boundary → fail)
```

## Implementation

```typescript
// packages/skills/src/meta.ts (MỚI/extend)
interface SkillMeta {
  name: string;
  can: string;
  boundaries: string[];          // HONEST BOUNDARY: những gì KHÔNG làm được
}

// packages/agent/src/boundary-test.ts (MỚI)
const UNCERTAINTY_MARKERS = [
  'không chắc', 'không biết', 'ngoài phạm vi', 'không thể đảm bảo',
  'not sure', 'unknown', 'out of scope', 'i don\'t know',
];

interface BoundaryCase { input: string; boundaryIndex: number }

class BoundaryTestHarness {
  constructor(
    private run: (input: string) => Promise<string>,
  ) {}

  // assert: output thể hiện uncertainty khi feed edge input
  async assertUncertainty(c: BoundaryCase, meta: SkillMeta): Promise<{ pass: boolean; reason: string }> {
    const out = (await this.run(c.input)).toLowerCase();
    const showsUncertainty = UNCERTAINTY_MARKERS.some(m => out.includes(m));
    if (showsUncertainty) {
      return { pass: true, reason: `thể hiện uncertainty (boundary: "${meta.boundaries[c.boundaryIndex]}")` };
    }
    // confident ngoài boundary → FAIL (bịa)
    return {
      pass: false,
      reason: `FAIL: trả lời confident ở ngoài boundary "${meta.boundaries[c.boundaryIndex]}" — cần uncertainty`,
    };
  }
}

// Usage (CI):
// for each skill: for each boundary case → harness.assertUncertainty(case, meta)
// → fail nếu skill bịa ngoài boundary
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Skill trung thực (biết giới hạn, không bịa) | ❌ Boundary declare chủ quan (thiếu sót) |
| ✅ Test chứng minh hành vi biên (CI enforce) | ❌ Uncertainty marker leak (false-pass nếu trùng từ) |
| ✅ User tin tưởng (honest > confident-sai) | ❌ Over-refuse (skill từ chối quá nhiều) |
| ✅ Discoverable limit (meta.boundaries) | ❌ Test maintenance (boundary đổi → update case) |

## Khác các hướng gần

| | Robustness test | 394 Safeguard-Tier | VC: Honest-Boundary |
|---|---|---|---|
| Assert gì | Đúng/sai output | Lọc output xấu | **Uncertainty ở biên** |
| Declare | ❌ | ❌ | **✅ boundaries trong meta** |
| Khi nào | Mọi input | Runtime | **Edge (ngoài boundary)** |

## Khi nào chọn

- Skill có phạm vi hẹp, dễ bịa khi ra ngoài (data cutoff, lang-specific)
- Muốn user tin tưởng (honest failure > confident hallucination)
- Cần CI enforce hành vi biên (không regress thành bịa)
- Nối packages/skills meta + scripts/tool-test-harness.mjs + 394 safeguard-tiering; guard boundary completeness (cover chính các edge), uncertainty-marker precision (không false-pass), và refuse calibration (không over-refuse); VC = honest boundary contract, kết hợp 574 persona-agentic (evidence gate refuse) + 577 failure-degrade (khi uncertainty → degrade thay vì bịa)
