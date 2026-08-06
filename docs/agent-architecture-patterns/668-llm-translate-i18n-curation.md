# Hướng YR: LLM Translate i18n Curation — auto_add_skills.py gọi Claude Haiku 4.5 tự dịch mô tả ZH→EN rồi chèn vào cả 2 README — dùng LLM giá rẻ trong curation pipeline (scripts/auto_add_skills.py)

> **Nguồn gốc:** awesome-human-distillation (scripts/auto_add_skills.py) | **Coupling:** 🟢 — curation step, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có AI bridge + fallback — chưa có translate step) | **Effort:** 1-2 tuần

## Nguồn gốc

**awesome-human-distillation** tự động hóa bản địa hóa: script `auto_add_skills.py` nhận skill mới (mô tả tiếng Trung), gọi **Claude Haiku 4.5** (model giá rẻ) **tự dịch mô tả ZH→EN**, rồi chèn cả 2 bản vào 2 README (README tiếng Trung + tiếng Anh). Điểm mấu chốt: **dùng LLM giá rẻ trong curation pipeline** — không cần dịch giả con người, không cần model đắt; Haiku đủ tốt cho one-line description. Pipeline curation có thêm bước LLM nhưng chi phí thấp (mỗi mô tả 1 call nhỏ).

## Mô tả

mya áp dụng llm-translate-i18n-curation: pipeline skill intake (667 YQ form → 663 YM curation) thêm bước **i18n normalize**: (1) mô tả gốc (ngôn ngữ bất kỳ) → detect lang; (2) nếu không phải EN → gọi **cheap LLM** (mya có `ai/fallback.ts` + model routing — dùng model giá rẻ trong route) dịch sang EN; (3) lưu `description_i18n: { original, en }` vào entry; (4) chèn cả 2 vào README tương ứng (mỗi ngôn ngữ một README — như 2 README của awesome). Translate fail (LLM lỗi) → giữ bản gốc + đánh dấu `needs_translation` — không chặn pipeline. Chi phí: dùng model rẻ + cache bản dịch (cùng text không dịch lại). mya có sẵn packages/ai (model routing, fallback, key-rotation), prompts (assembler) — YR thêm **translate step** + **i18n cache**.

## Kiến trúc

```
  Skill mới (mô tả ZH) ──► INTAKE (667 YQ)
       │
       ▼
  I18N NORMALIZE:
    detect lang ──► không EN?
       │              │
       │              ▼
       │   CALL CHEAP LLM (Claude Haiku / model rẻ qua ai/fallback)
       │     "Dịch: <desc> → EN"   ← 1 call nhỏ, cache theo hash
       │              │
       │              ▼
       │   en = bản dịch; lỗi → giữ gốc + needs_translation
       ▼
  Entry: { description_original: "...", description_en: "..." }
       │
       ▼
  Chèn vào 2 README (ZH + EN) — mỗi ngôn ngữ một file
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai fallback.ts — fallback khi model lỗi (nền — YR translate fail → giữ gốc)
// ✅ packages/ai model-routing.ts — route model (nền — YR chọn model rẻ)
// ✅ packages/ai key-rotation.ts — xoay key (nền — YR nhiều call không chạm rate limit)
// ✅ packages/ai mock.ts — mock provider (nền — YR test translate)

// ❌ THIẾU: translate step (detect lang → dịch → i18n entry)
// ❌ THIẾU: i18n cache (cùng text không dịch lại — hash)
```

## Implementation (TS)

```typescript
// packages/skills/src/i18n-curate.ts (MỚI)
import { createHash } from "node:crypto";

export interface TranslateFn {
  (text: string, to: string): Promise<string | null>; // null = fail
}

const CACHE = new Map<string, string>(); // hash(text) → en

export class I18nCuration {
  constructor(private translate: TranslateFn) {}

  private cacheKey(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  /** Detect ngôn ngữ heuristic — không cần LLM cho việc này. */
  isEnglish(text: string): boolean {
    return /^[\x00-\x7F\s.,!?;:'"()-]+$/.test(text); // ASCII thuần → EN
  }

  async normalize(description: string): Promise<{ original: string; en: string; needsTranslation: boolean }> {
    if (this.isEnglish(description)) return { original: description, en: description, needsTranslation: false };

    const key = this.cacheKey(description);
    const cached = CACHE.get(key);
    if (cached) return { original: description, en: cached, needsTranslation: false };

    const en = await this.translate(description, "en"); // cheap LLM (Haiku-class)
    if (en === null) return { original: description, en: description, needsTranslation: true }; // không chặn pipeline

    CACHE.set(key, en); // cache — cùng text không dịch lại
    return { original: description, en, needsTranslation: false };
  }

  /** Chèn vào cả 2 README — mỗi ngôn ngữ một file. */
  mergeInto(readmeZh: string, readmeEn: string, entry: { original: string; en: string }): { readmeZh: string; readmeEn: string } {
    return {
      readmeZh: `${readmeZh}\n- ${entry.original}`,
      readmeEn: `${readmeEn}\n- ${entry.en}`,
    };
  }
}

// Usage:
// const i18n = new I18nCuration((t) => cheapLlmTranslate(t, "en")); // Haiku-class qua ai/fallback
// const r = await i18n.normalize("检测钓鱼邮件的技能");
// r.needsTranslation || console.log(r.en); // "Skill for detecting phishing emails"
// const { readmeZh, readmeEn } = i18n.mergeInto(readmeZh, readmeEn, r);
```

## Được

- ✅ Chi phí thấp — Haiku-class model, 1 call nhỏ per entry
- ✅ Cache — cùng text không dịch lại, tiết kiệm lần sau
- ✅ Không chặn pipeline — translate fail giữ gốc + flag
- ✅ Mỗi ngôn ngữ một README — i18n surface tách biệt
- ✅ Tái dùng ai/fallback — model lỗi có fallback, không crash pipeline

## Mất

- ❌ Chất lượng dịch — one-line ngữ cảnh ít, dịch sai thuật ngữ kỹ thuật
- ❌ LLM phụ thuộc — pipeline chậm hơn (network call), cần timeout
- ❌ Detect heuristic — ASCII thuần nhưng là code/tiếng lóng → không dịch

## Khác các hướng gần

| | Dịch tay (người) | Không dịch (1 ngôn ngữ) | YR: LLM Translate |
|---|---|---|---|
| Chi phí | cao | 0 | **rẻ (Haiku + cache)** |
| Tự động | không | không | **trong pipeline** |
| Độ phủ i18n | tốt | thấp | **ZH/EN song song** |

## Khi nào chọn

- Pipeline curation nhận skill đa ngôn ngữ, cần EN để index/discover
- Muốn tự động hóa dịch với chi phí thấp (không thuê dịch giả)
- Có ai/fallback + model-routing sẵn — YR thêm translate step + cache
- Nối packages/ai fallback.ts (translate fail-safe) + model-routing.ts (chọn model rẻ) + key-rotation.ts (nhiều call); guard translate-timeout (call quá 10s → fail, không kẹt pipeline), cache-persistence (cache trong memory — nên lưu disk `~/.mya/i18n-cache.json`), và quality-sample (dịch kém — golden test vài mẫu ZH→EN); YR = i18n curation, kết hợp 667 YQ issue-form (intake) + 663 YM badge-curation (pipeline) + 70-llm-gateway (route call LLM)
