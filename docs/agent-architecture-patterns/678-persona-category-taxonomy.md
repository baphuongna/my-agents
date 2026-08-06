# Hướng ZB: Persona Category Taxonomy — taxonomy 5 category: self-distillation/meta tools, workplace, intimate-family, public figures, spiritual — khung phân loại cho domain persona
> **Nguồn gốc:** awesome-persona-distill-skills (README.md) | **Coupling:** 🟢 — thêm taxonomy const + classifier cho skill/persona | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skills/curator.ts có phân loại skill — chưa có 5-category persona taxonomy) | **Effort:** 1 tuần

## Nguồn gốc

**awesome-persona-distill-skills** chưng cất hàng trăm persona từ người thật → cần **khung phân loại (taxonomy)** để sắp xếp, tìm kiếm, và chọn đúng persona cho task. Taxonomy gồm **5 category**: (1) **self-distillation / meta tools** — persona về chính công cụ/agent (vd "cách tôi dùng tool này"); (2) **workplace** — persona công sở (dev, PM, designer...); (3) **intimate-family** — persona gia đình/thân mật (cách nói chuyện với người thân); (4) **public figures** — persona người nổi tiếng (phong cách của ai đó); (5) **spiritual** — persona tâm linh (thiền, triết lý sống). Mỗi persona gắn 1 category → retrieval lọc nhanh, curation dễ, tránh trộn domain. Nguyên tắc: **domain taxonomy là khung điều hướng cho persona library**.

## Mô tả

mya persona category taxonomy: (1) **5 const categories** — self-distillation/meta-tools, workplace, intimate-family, public-figures, spiritual. (2) **Classifier** — gán category cho skill/persona markdown dựa frontmatter/keywords. (3) **Filter/retrieve** — tìm persona theo category (vd chỉ workplace khi code). (4) **Curation** — skills/curator dùng taxonomy để xếp thư viện. mya có packages/skills curator.ts + skill.ts (skill registry) — ZB thêm **5-category const** + **classifier** + **filter API**.

## Kiến trúc

```
  ┌─── PERSONA LIBRARY (nhiều persona) ─────────────────┐
  │  persona-A.md   persona-B.md   persona-C.md ...        │
  └────────────────────┬──────────────────────────────────┘
                       ▼  classifier (frontmatter + keywords)
  ┌─── 5-CATEGORY TAXONOMY ─────────────────────────────┐
  │  [1] self-distillation/meta-tools   → dùng cho tool dev│
  │  [2] workplace                       → dùng khi code    │
  │  [3] intimate-family                 → chat thân mật    │
  │  [4] public-figures                  → phong cách nổi tiếng│
  │  [5] spiritual                       → tâm linh/triết    │
  └────────────────────┬──────────────────────────────────┘
                       ▼  filter(category)
  ┌─── RETRIEVAL ───────┐
  │  pick persona theo   │
  │  category của task   │
  └──────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — Skill registry + parseSkillMarkdown (nền — ZB classify skill này)
// ✅ packages/skills curator.ts — curation (nền — ZB taxonomy cho curator)
// ✅ packages/prompts assembler.ts — prompt assembly (nền — ZB inject persona theo category)
// ✅ packages/memory domains.ts — domain registry (relate — ZB persona domain analog)

// ❌ THIẾU: 5-category persona taxonomy const
// ❌ THIẾU: classifier (skill/persona → category)
// ❌ THIẾU: filter API (retrieve theo category)
```

## Implementation

```typescript
// packages/skills/src/persona-taxonomy.ts (MỚI)

const PERSONA_CATEGORIES = [
  "self-distillation/meta-tools",
  "workplace",
  "intimate-family",
  "public-figures",
  "spiritual",
] as const;

type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

const KEYWORDS: Record<PersonaCategory, string[]> = {
  "self-distillation/meta-tools": ["tool", "workflow", "agent", "prompt", "distill"],
  "workplace": ["work", "job", "dev", "manager", "design", "meeting", "code"],
  "intimate-family": ["family", "friend", "partner", "mom", "dad", "kid"],
  "public-figures": ["famous", "celebrity", "author", "leader", "style of"],
  "spiritual": ["meditation", "mindfulness", "philosophy", "spiritual", "zen"],
};

// Classifier: frontmatter category hoặc keyword score
function classifyPersona(markdown: string, frontmatterCategory?: string): PersonaCategory | null {
  if (frontmatterCategory && (PERSONA_CATEGORIES as readonly string[]).includes(frontmatterCategory)) {
    return frontmatterCategory as PersonaCategory;
  }
  const text = markdown.toLowerCase();
  let best: PersonaCategory | null = null;
  let bestScore = 0;
  for (const cat of PERSONA_CATEGORIES) {
    const score = KEYWORDS[cat].reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return bestScore > 0 ? best : null;   // không khớp → null (chưa phân loại)
}

// Filter: lấy persona theo category từ library
function filterByCategory(
  library: Array<{ id: string; markdown: string; category?: string }>,
  category: PersonaCategory,
): string[] {
  return library
    .filter(p => classifyPersona(p.markdown, p.category) === category)
    .map(p => p.id);
}
// Usage:
// const cat = classifyPersona(personaMd, persona.frontmatter?.category);
// const workplace = filterByCategory(library, "workplace"); // → ids persona công sở
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Retrieval nhanh theo domain (không quét hết) | ❌ Keyword classifier có thể gán sai category |
| ✅ Curation có khung (tránh library lộn xộn) | ❌ Taxonomy cứng (5 category — domain mới phải thêm) |
| ✅ Prompt chọn đúng persona theo task | ❌ Persona cross-domain (vd workplace + spiritual) bị ép 1 nhãn |
| ✅ Dễ mở rộng (thêm category = thêm const) | ❌ Frontmatter thiếu → phụ thuộc keyword heuristic |

## Khác các hướng gần

| | Flat library | Tags tự do | ZB: Category Taxonomy |
|---|---|---|---|
| Điều hướng | Quét hết | Tag lộn xộn | **5 khung cố định** |
| Filter | ❌ | ⚠️ | **✅ theo category** |
| Curation | Khó | Vừa | **Có chuẩn** |

## Khi nào chọn

- Persona/skill library lớn, cần lọc theo domain khi chạy
- Muốn curation có khung phân loại chuẩn (không tag tự do)
- Task retrieval cần scope domain (vd code → workplace)
- Nối packages/skills curator.ts + skill.ts + prompts assembler.ts + memory domains.ts; guard taxonomy-coverage (persona không category → báo, không bỏ lặng), classifier-accuracy (keyword đủ riêng biệt giữa category), và multi-category (persona cross-domain → cho phép nhiều nhãn nếu cần); ZB = persona category taxonomy, kết hợp 674 YX contradiction-as-feature (persona giữ tension) + packages/skills curator (curation nền)
