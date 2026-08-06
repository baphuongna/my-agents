# Hướng YH: Multi-Framework Mapping — frontmatter mỗi skill map 6 framework: mitre_attack, nist_csf, atlas_techniques, d3fend, nist_ai_rmf, mitre_f3 — một skill nhiều compliance checkbox (README.md, skills/*/SKILL.md)

> **Nguồn gốc:** Anthropic-Cybersecurity-Skills (README.md, skills/*/SKILL.md) | **Coupling:** 🟢 — frontmatter metadata, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (skill.ts đã có frontmatter + provenance — thêm mapping field) | **Effort:** 1-2 tuần

## Nguồn gốc

**Anthropic-Cybersecurity-Skills** thiết kế frontmatter mỗi skill map sang **6 framework**: `mitre_attack`, `nist_csf`, `atlas_techniques` (AI threat), `d3fend` (defense), `nist_ai_rmf` (AI risk), `mitre_f3` (foundational). Một skill (ví dụ "phishing detection") map được nhiều ID ở nhiều framework → **một skill đạt nhiều compliance checkbox** cùng lúc. Mục đích: (1) skill discoverable theo framework (người tìm theo ATT&CK thấy skill); (2) coverage đo được (framework nào thiếu skill là biết ngay); (3) compliance audit nhanh (skill đã map framework chuẩn).

## Mô tả

mya áp dụng multi-framework-mapping: schema `Skill` thêm field `frameworks: { mitre_attack?: string[]; nist_csf?: string[]; atlas_techniques?: string[]; d3fend?: string[]; nist_ai_rmf?: string[]; mitre_f3?: string[] }`. Lúc load skill, frontmatter parse ra mapping → index phụ: `framework → skill[]` để query. Skill mới phải map ≥ 1 framework (hoặc đánh dấu `unmapped` + lý do). Dashboard/curator hiển thị coverage: skill nào thiếu mapping, framework nào có gap. mya có sẵn skills/skill.ts (frontmatter + provenance), curator (đánh giá skill), memory/code-index (index phụ) — YH thêm **frameworks field** + **framework index query**.

## Kiến trúc

```
  SKILL.md frontmatter:
  ┌──────────────────────────────────────────────┐
  │ name: phishing-detection                      │
  │ frameworks:                                   │
  │   mitre_attack: [T1566.001]                  │
  │   nist_csf: [PR.PT-4, DE.CM-4]               │
  │   atlas_techniques: [AML.T0024]              │
  │   d3fend: [d3:PhishingAnalysis]              │
  │   nist_ai_rmf: [AI-RMF-1.2]                  │
  │   mitre_f3: [F3.A.1]                          │
  └──────────────────────┬───────────────────────┘
                         ▼
  INDEX: mitre_attack.T1566.001 → [phishing-detection]
         nist_csf.DE.CM-4       → [phishing-detection, log-analysis]
         ...
                         ▼
  Query: "skill nào cover T1566?" → phishing-detection ✅
         "framework nào gap?"     → atlas_techniques thiếu X skill
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — frontmatter + description + provenance (nền — YH thêm field)
// ✅ packages/skills curator.ts — load skill từ dir (nền — YH parse frameworks)
// ✅ packages/memory code-index.ts — index phụ (nền — YH framework → skill index)
// ✅ packages/skills skill-description.ts — mô tả skill prompt (nền — YH hiển thị mapping)

// ❌ THIẾU: frameworks field trong Skill schema
// ❌ THIẾU: framework index (query theo ID framework)
// ❌ THIẾU: coverage report (gap theo framework)
```

## Implementation (TS)

```typescript
// packages/skills/src/framework-map.ts (MỚI)
export const FRAMEWORKS = [
  "mitre_attack", "nist_csf", "atlas_techniques", "d3fend", "nist_ai_rmf", "mitre_f3",
] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export interface FrameworkMapping {
  mitre_attack?: string[];
  nist_csf?: string[];
  atlas_techniques?: string[];
  d3fend?: string[];
  nist_ai_rmf?: string[];
  mitre_f3?: string[];
}

export class FrameworkIndex {
  private idx = new Map<string, Set<string>>(); // "mitre_attack:T1566" → skills

  add(skillName: string, mapping: FrameworkMapping): void {
    for (const fw of FRAMEWORKS) {
      for (const id of mapping[fw] ?? []) {
        const key = `${fw}:${id}`;
        const set = this.idx.get(key) ?? new Set();
        set.add(skillName);
        this.idx.set(key, set);
      }
    }
  }

  /** Query: skill nào cover ID framework này? */
  query(fw: Framework, id: string): string[] {
    return [...(this.idx.get(`${fw}:${id}`) ?? [])];
  }

  /** Coverage gap: framework nào có ID chưa skill nào map. */
  coverage(knownIds: Record<Framework, string[]>): Record<Framework, string[]> {
    const gaps = {} as Record<Framework, string[]>;
    for (const fw of FRAMEWORKS) {
      gaps[fw] = knownIds[fw].filter((id) => this.idx.get(`${fw}:${id}`)?.size === 0);
    }
    return gaps;
  }
}

// Usage:
// const idx = new FrameworkIndex();
// idx.add("phishing-detection", { mitre_attack: ["T1566.001"], nist_csf: ["DE.CM-4"] });
// idx.query("mitre_attack", "T1566.001"); // ["phishing-detection"]
// idx.coverage({ mitre_attack: [...allIds], ... }); // gap theo tactic
```

## Được

- ✅ Một skill nhiều checkbox — mapping 6 framework trong 1 frontmatter
- ✅ Discoverable theo framework — tìm theo ATT&CK thấy skill
- ✅ Coverage đo được — framework gap hiện rõ, ưu tiên phát triển
- ✅ Compliance audit nhanh — audit hỏi "cover DE.CM-4?" trả lời máy được
- ✅ Index phụ rẻ — map trong frontmatter, index dựng lúc load

## Mất

- ❌ ID sai lệch — mapping ID revoked/cũ làm compliance sai (cần 661 YK verify)
- ❌ Bảo trì nặng — skill đổi nội dung phải cập nhật mapping
- ❌ Over-map — skill map mọi framework "cho đủ" làm coverage ảo

## Khác các hướng gần

| | Skill thuần (không metadata) | Tag đơn (topic) | YH: Multi-Framework Map |
|---|---|---|---|
| Metadata | không | 1 tag | **6 framework chuẩn** |
| Coverage | không đo | đo theo tag | **đo theo framework ID** |
| Compliance | không | không | **audit trực tiếp** |

## Khi nào chọn

- Skill library có nhu cầu compliance/audit (security, AI risk)
- Muốn biết framework coverage gap để ưu tiên viết skill
- Có skill.ts + curator sẵn — YH thêm field + index + coverage
- Nối packages/skills skill.ts (schema field) + curator.ts (parse lúc load) + memory/code-index.ts (index); guard id-validity (ID phải verify — nối 661 YK verified-framework-ids), over-mapping (skill map tối đa 2-3 framework thật dùng — chống spam), và index-fresh (skill sửa → rebuild index); YH = framework map, kết hợp 659 YI coverage-matrix-autogen (tự sinh coverage từ mapping) + 661 YK verified-framework-ids (máy verify ID)
