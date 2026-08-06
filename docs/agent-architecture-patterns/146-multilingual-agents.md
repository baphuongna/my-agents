# Hướng QQQQQQ: Multilingual Agents — agent nói nhiều ngôn ngữ, localization theo người dùng

> **Nguồn gốc:** UseInvent "How to Build a Multilingual AI Agent" 2026 (UX native, không "dịch thô"); Delight.ai "Localized AI Agents for Multilingual Customer Service" (localization ≠ translation layer); Fin.ai "Best Multilingual AI Agents 2026"; Aisera "95+ languages"
> **Coupling:** 🟢 — thêm lớp ngôn ngữ, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (prompt package + profile sẵn; thiếu language layer + fallback)
> **Effort:** 1-2 tuần

## Nguồn gốc

Multilingual agents: **agent phục vụ người dùng đúng ngôn ngữ mẹ đẻ, UX "native" không "dịch"** — UseInvent: "language coverage, localization, naming, easy switching, and UX that feels native, not translated"; Delight: "Many agents treat localization as a simple translation layer — switch the language and call it done. But enterprises know better" — localization là cả về văn hóa/chuẩn mực, không chỉ đổi ngôn ngữ; Fin: "resolve customer queries in a customer's native language without routing to language-specific teams"; Aisera: "outperform traditional translation in complex tasks in 95+ languages". Điểm khác **prompt package** (prompt theo task) — QQQQQQ *đa ngôn ngữ có chủ đích*: detect ngôn ngữ user, prompts/chọn template theo ngôn ngữ + văn hóa, tool output nhiều ngôn ngữ xử lý đúng, fallback model khi model yếu tiếng đó (cascade theo language), giữ terminology chuẩn (glossary), không dịch tên/định danh. Nối GG (gateway — select model theo language support), HHH (cascade — model mạnh với ngôn ngữ đó), MM (memory — prefs ngôn ngữ), NNNN (prompt pkg theo l10n), KKKKKK (personalization — ngôn ngữ là preference).

## Mô tả

mya multilingual: (1) **language detect** — nhận ngôn ngữ đầu vào (stdlib/i18n detect hoặc LLM nhẹ); (2) **prompt layer** — system/template theo ngôn ngữ (không dịch runtime prompt tiếng Anh sang tiếng VN — vì nặng + mất nuance); mỗi ngôn ngữ là prompt riêng (i18n folder — chuẩn như l10n code); (3) **glossary/terminology** — thuật ngữ chuẩn không đổi (tên file, API, identifiers giữ nguyên; từ vựng chuyên ngành theo glossary); (4) **model selection theo language** — model hỗ trợ tốt ngôn ngữ đó (GG/HHH: cascade — user tiếng Việt → model tốt tiếng Việt; user Tây Tạng → fallback dịch + model mạnh); (5) **format/UX** — ngày giờ, số, tiền tệ, chuẩn mực văn hóa theo locale (delight/useinvent); (6) **kiểm thử** — pp eval multi-lingual: test agent phản hồi đúng nghĩa (không dịch máy) từng ngôn ngữ.

## Kiến trúc

```
  INPUT ──► LANGUAGE DETECT (locale)
        │
        ▼
  PROMPT LAYER (i18n — template riêng từng ngôn ngữ, không dịch runtime)
        │  + glossary (thuật ngữ chuẩn giữ nguyên — tên/API/identifier)
        ▼
  MODEL SELECT theo language (GG/HHH): model hỗ trợ tốt locale — fallback dịch
        │
        ▼
  FORMAT/UX theo locale: ngày/số/tiền/chuẩn mực văn hóa (Delight — native)
        │
        ▼
  EVAL ĐA NGÔN NGỮ (PP): đúng nghĩa không phải "dịch máy" (UseInvent)
```

```
mya: prompts + profile SẸN — thiếu: language detect + i18n prompt layer + glossary
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ prompt package — template theo task (thêm chiều ngôn ngữ)
// ✅ GG gateway — select model theo capability (thêm language support)
// ✅ HHH cascade — fallback model (theo language)
// ✅ KKKKKK personalization — profile (ngôn ngữ là preference)
// ✅ MM memory — prefs người dùng

// ❌ THIẾU: language detect layer
// ❌ THIẾU: i18n prompt layer (template riêng từng ngôn ngữ)
// ❌ THIẾU: glossary/terminology store
// ❌ THIẾU: eval đa ngôn ngữ (PP)
```

## Implementation

```typescript
// packages/i18n/src/locale.ts (NEW)
export class LocaleLayer {
  async handle(req: Input): Promise<Output> {
    const locale = detect(req, this.supported);       // ngôn ngữ user
    const p = prompts.get(locale, req.task);          // template riêng locale
    const model = this.pick(locale, req);             // GG/HHH — model tốt locale
    const out = await this.call(model, p, glossary(req)); // glossary giữ thuật ngữ
    return localize(out, locale);                     // format — date/num/currency
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ UX native — không "cảm giác dịch máy" (UseInvent) | ❌ Duy trì prompt i18n — mỗi ngôn ngữ 1 template |
| ✅ Không cần team riêng cho từng ngôn ngữ | ❐ Model yếu ngôn ngữ → phải fallback/dịch |
| ✅ Glossary giữ thuật ngữ chuẩn (tên/API không dịch) | ❌ Eval đa ngôn ngữ thêm chi phí (PP) |
| ✅ Xây trên prompts + GG + HHH | ❌ "Native" khó chuẩn với ngôn ngữ ít tài liệu |

## Khác các hướng gần

| | NNNN Prompt Pkg | KKKKKK Personalize | QQQQQQ: Multilingual |
|---|---|---|---|
| Chiều tùy biến | Task | Người dùng | **Ngôn ngữ/văn hóa** |
| Cơ chế | Template task | Preference | **i18n layer + glossary + locale select** |
| Quan hệ | Nền | 1 preference | **Thêm lớp ngôn ngữ lên cả 2** |

## Khi nào chọn

- Người dùng đa ngôn ngữ — agent trả lời đúng tiếng mẹ đẻ
- Không muốn "dịch thô" — UX native cho từng ngôn ngữ
- Đã có prompts + GG + HHH — thêm locale layer + glossary
- Hỗ trợ khách hàng đa quốc gia (Fin — CSAT tăng)