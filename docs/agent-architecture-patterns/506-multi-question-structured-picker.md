# Hướng SL: Multi-Question Structured Picker — picker đa câu hỏi form (single/multi/Other) thay hỏi tự do

> **Nguồn gốc:** pi-soly (structured question picker); "multi-question form picker"; "single/multi/Other options"; "structured clarification vs free-form"; "batched questions in one picker"
> **Coupling:** 🟢 — thêm picker UI component cho clarification (thay free-form ask), không đổi loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/intercom interactive UI sẵn — chưa có multi-question picker schema + renderer)
> **Effort:** 1-2 tuần

## Nguồn gốc

**pi-soly** pattern: khi agent cần **clarify** (hỏi user nhiều câu), thay vì hỏi **tự do** từng câu một (round-trip nhiều lần, chậm), dùng **structured picker** — **form đa câu hỏi** trong 1 UI, mỗi câu có kiểu **single** (chọn 1), **multi** (chọn nhiều), hoặc **Other** (user gõ tự do nếu option không khớp). Nguyên tắc: **hỏi cấu trúc 1 lần tốt hơn hỏi tự do nhiều lần** — user trả lời tất cả trong 1 form, agent nhận structured response (parse được, không mơ hồ). Ví dụ: agent cần biết framework + test-runner + package-manager → 1 picker 3 câu (single/multi/Other) thay 3 vòng chat. Khác free-form ask (1 câu/lượt) — SL là **batched structured form**.

## Mô tả

mya multi-question structured picker: (1) **Question schema**: agent định nghĩa câu hỏi `[{ id, prompt, type: single|multi, options[], allowOther }]`. (2) **Render form**: UI (packages/intercom) render tất cả câu hỏi trong 1 picker — single = radio, multi = checkbox, Other = text input fallback. (3) **User trả lời 1 lần**: user điền toàn bộ form → submit. (4) **Structured response**: parse → `[{ id, value: string[] }]` (machine-readable, không mơ hồ). (5) **Resume loop**: agent nhận response → tiếp tục (không round-trip thêm). mya có packages/intercom interactive UI — SL thêm **picker schema** + **form renderer** + **response parser**.

## Kiến trúc

```
  AGENT cần clarify (3 câu):
  ┌─────────────────────────────────────────────────────┐
  │  questions:                                          │
  │  q1: "Framework?" type=single [React, Vue, Svelte]   │
  │  q2: "Test runner?" type=multi [vitest, jest, mocha] │
  │  q3: "Pkg manager?" type=single [npm, pnpm, yarn]    │
  │  (allowOther: true — mỗi câu có Other text input)    │
  └───────────────┬─────────────────────────────────────┘
                  │ render form
                  ▼
  ┌─── PICKER (1 UI, multi-question) ───────────────────┐
  │  Framework?    ( ) React  (•) Vue  ( ) Svelte  [Other]│
  │  Test runner?  [x] vitest [ ] jest [ ] mocha  [Other]│
  │  Pkg manager?  ( ) npm  (•) pnpm  ( ) yarn  [Other]  │
  │                                      [ SUBMIT ]       │
  └───────────────┬─────────────────────────────────────┘
                  │ user submit 1 lần
                  ▼
  ┌─── STRUCTURED RESPONSE ─────────────────────────────┐
  │  [ { id: q1, value: [Vue] },                          │
  │    { id: q2, value: [vitest] },                       │
  │    { id: q3, value: [pnpm] } ]                        │
  │  → agent parse, không mơ hồ, tiếp tục loop            │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/intercom — interactive UI (nền — SL render picker qua nó)
// ✅ agent loop — clarification (nền — SL = structured thay free-form)

// ❌ THIẾU: picker schema (question: id/prompt/type/options/allowOther)
// ❌ THIẾU: form renderer (single=radio, multi=checkbox, Other=text)
// ❌ THIẾU: response parser (submit → [{ id, value[] }])
```

## Implementation

```typescript
// packages/intercom/src/multi-question-picker.ts (MỚI)
type QType = 'single' | 'multi';
interface Question { id: string; prompt: string; type: QType; options: string[]; allowOther?: boolean }
interface Answer { id: string; value: string[] }

class MultiQuestionPicker {
  // validate schema
  validate(qs: Question[]): string | null {
    const ids = new Set<string>();
    for (const q of qs) {
      if (ids.has(q.id)) return `duplicate id: ${q.id}`;
      ids.add(q.id);
      if (q.type === 'single' && q.options.length < 2) return `single needs ≥2 options: ${q.id}`;
    }
    return null;
  }

  // render → collect (qua intercom UI; ở đây mock prompt logic)
  async render(qs: Question[], ui: { select: (q: Question) => Promise<string[]> }): Promise<Answer[]> {
    const answers: Answer[] = [];
    for (const q of qs) {
      const value = await ui.select(q);
      // validate single → max 1
      if (q.type === 'single' && value.length > 1) value.length = 1;
      // Other fallback đã nằm trong options khi allowOther
      answers.push({ id: q.id, value });
    }
    return answers;
  }

  // parse response → structured map
  parseMap(answers: Answer[]): Record<string, string[]> {
    const m: Record<string, string[]> = {};
    for (const a of answers) m[a.id] = a.value;
    return m;
  }
}

// Usage:
// const qs = [
//   { id: 'fw', prompt: 'Framework?', type: 'single', options: ['React','Vue','Svelte'], allowOther: true },
//   { id: 'test', prompt: 'Test runner?', type: 'multi', options: ['vitest','jest','mocha'], allowOther: true },
// ];
// const answers = await picker.render(qs, intercomSelect);
// const cfg = picker.parseMap(answers);  // { fw: ['Vue'], test: ['vitest'] } → loop tiếp tục
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Batched (1 form thay nhiều round-trip) | ❌ Cần biết câu hỏi trước (không động khi user trả lời giữa chừng) |
| ✅ Structured (parse được, không mơ hồ) | ❌ Option hạn chế (Other fallback nhưng vẫn thiếu linh hoạt) |
| ✅ UX nhanh (user trả lời 1 lần) | ❌ UI phức tạp (radio/checkbox/Other render) |
| ✅ Phối packages/intercom | ❌ Schema validation overhead |

## Khác các hướng gần

| | Free-Form Ask | Single-Question Prompt | SL: Multi-Question-Picker |
|---|---|---|---|
| Số câu/lượt | 1 | 1 | **N (batched form)** |
| Structured | ❌ (free text) | ✅ 1 câu | **✅ multi + Other** |
| Round-trip | Nhiều | 1 | **1 (tất cả câu)** |

## Khi nào chọn

- Agent cần clarify nhiều câu (framework + test + pkg — batched)
- Muốn structured response (parse được, không mơ hồ)
- User OK với form (không muốn chat nhiều vòng)
- Nối packages/intercom (interactive UI); guard schema validation (duplicate id, single needs ≥2) + Other fallback (user gõ khi option không khớp) + dynamic disable (câu sau phụ thuộc câu trước — optional); phối agent loop clarification (SL = structured replacement)
