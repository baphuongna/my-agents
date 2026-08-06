# Hướng YV: Expression DNA Stylometry — lượng hóa style fingerprint: sentence length, question ratio, analogy density, certainty tone, forbidden words (口癖) — biến phong cách thành số đo được (FINDINGS.md)

> **Nguồn gốc:** awesome-human-distillation (FINDINGS.md) | **Coupling:** 🟢 — phân tích văn bản, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có redact + canonical-json — chưa có stylometry) | **Effort:** 2-3 tuần

## Nguồn gốc

**awesome-human-distillation** phân tích chất lượng nguồn bằng **expression DNA** — lượng hóa **style fingerprint** của tác giả/nguồn: **sentence length** (câu dài/ngắn), **question ratio** (tỷ lệ câu hỏi), **analogy density** (mật độ so sánh/ví von), **certainty tone** (giọng chắc chắn — "chắc chắn/luôn luôn" vs "có thể/hình như"), **forbidden words (口癖)** (từ lặp/nhịu — "thì, là, ấy"). Mục đích: **biến phong cách thành số đo được** — so sánh nguồn khách quan (nguồn A dùng analogy nhiều hơn nguồn B), phát hiện nguồn lặp từ, phát hiện content AI-slop (câu đều tăm tắp, không question, certainty cao bất thường).

## Mô tả

mya áp dụng expression-dna-stylometry: pipeline phân tích text (skill description, bài viết, conversation source) tính **style vector** gồm 5 chiều: (1) `avgSentenceLen`; (2) `questionRatio` (số câu `?` / tổng câu); (3) `analogyDensity` (từ so sánh: "như, giống, ví như, like, as"); (4) `certaintyTone` (từ chắc: "luôn, chắc chắn, definitely" trừ từ do dự: "có thể, hình như"); (5) `forbiddenWords` (tần suất từ nhịu/lặp). Dùng để: đánh giá nguồn skill (663 YM review — nguồn AI-slop có fingerprint đặc trưng), phân biệt tác giả, theo dõi phong cách thay đổi. mya có sẵn memory/auto-capture (regex pattern), core/redact (xử lý text), ai (LLM đánh giá bổ trợ) — YV thêm **stylometry extractor** + **style vector schema**.

## Kiến trúc

```
  Text (skill desc / bài viết / conversation)
       │
       ▼
  EXPRESSION DNA EXTRACTOR:
    ├─ avgSentenceLen   : đếm từ / số câu
    ├─ questionRatio    : câu có '?' / tổng câu
    ├─ analogyDensity   : "như|giống|like|as|ví như" / từ
    ├─ certaintyTone    : "luôn|chắc chắn|definitely" − "có thể|hình như"
    └─ forbiddenWords   : tần suất từ nhịu ("thì|ấy|..." — 口癖)
       │
       ▼
  STYLE VECTOR [len, qRatio, analogy, certainty, fw]
       │
       ├─ so sánh nguồn: A vs B (cosine / per-axis)
       ├─ AI-slop detect: câu đều, qRatio ~0, certainty cao
       └─ theo dõi phong cách theo thời gian
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory auto-capture.ts — regex pattern scan (nền — YV cùng kỹ thuật)
// ✅ packages/core redact.ts — xử lý text an toàn (nền — YV text pipeline)
// ✅ packages/core canonical-json.ts — JSON chuẩn (nền — YV style vector lưu)
// ✅ packages/memory embeddings.ts — đo tương đồng (nền — YV so sánh vector)

// ❌ THIẾU: stylometry extractor (5 chiều)
// ❌ THIẾU: style vector schema + so sánh
```

## Implementation (TS)

```typescript
// packages/core/src/stylometry.ts (MỚI)
export interface StyleVector {
  avgSentenceLen: number;
  questionRatio: number;   // 0..1
  analogyDensity: number;  // per 100 từ
  certaintyTone: number;   // chắc − do dự
  forbiddenWords: number;  // per 100 từ (口癖)
}

const ANALOGY = /\b(như|giống|ví như|like|as if|similar to)\b/gi;
const CERTAIN = /\b(luôn|chắc chắn|definitely|always|certainly)\b/gi;
const HESITANT = /\b(có thể|hình như|perhaps|maybe|might)\b/gi;
const HABIT = /\b(thì|ấy|đấy|kinda|basically)\b/gi; // 口癖

export function extractStyle(text: string): StyleVector {
  const sentences = text.split(/[.!?。！？]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter(Boolean);
  const questions = text.split(/[?？]/).length - 1;

  const certain = (text.match(CERTAIN) ?? []).length;
  const hesitant = (text.match(HESITANT) ?? []).length;

  return {
    avgSentenceLen: sentences.length ? words.length / sentences.length : 0,
    questionRatio: sentences.length ? questions / sentences.length : 0,
    analogyDensity: (words.length ? (text.match(ANALOGY) ?? []).length / words.length : 0) * 100,
    certaintyTone: certain - hesitant,
    forbiddenWords: (words.length ? (text.match(HABIT) ?? []).length / words.length : 0) * 100,
  };
}

/** AI-slop heuristic: câu đều, không hỏi, chắc chắn cao. */
export function slopScore(v: StyleVector): number {
  const evenLen = v.avgSentenceLen > 5 && v.avgSentenceLen < 20 ? 1 : 0;
  const noQuestion = v.questionRatio === 0 ? 1 : 0;
  const overCertain = v.certaintyTone > 3 ? 1 : 0;
  return evenLen + noQuestion + overCertain; // ≥ 2 → nghi ngờ AI-slop
}

// Usage:
// const v = extractStyle(skill.description);
// slopScore(v) >= 2 → review thêm (663 YM chống AI-slop)
// const a = extractStyle(srcA), b = extractStyle(srcB);
// |a.certaintyTone - b.certaintyTone| > 2 → phong cách khác hẳn
```

## Được

- ✅ Phong cách thành số — so sánh nguồn khách quan, không cảm tính
- ✅ 5 chiều rõ — câu/hỏi/ví von/chắc chắn/nhịu
- ✅ AI-slop heuristic — câu đều + không hỏi + chắc quá → nghi ngờ
- ✅ Rẻ và nhanh — regex thuần, không cần LLM mỗi lần
- ✅ Kết hợp memory/embeddings — vector lưu + so sánh được

## Mất

- ❌ Regex đa ngôn ngữ — từ khóa VI/EN hardcode, ngôn ngữ khác lệch
- ❌ Ngữ cảnh mất — câu hỏi tu từ tính là question ratio
- ❌ Slop heuristic giả — bài viết chuyên môn chuẩn mực bị nghi AI-slop

## Khác các hướng gần

| | Đánh giá cảm tính | LLM judge (1 call) | YV: Stylometry |
|---|---|---|---|
| Chi phí | 0 | LLM call | **regex thuần** |
| Tái lập | không | phụ model | **deterministic** |
| Chiều đo | không | tổng hợp | **5 chiều riêng** |

## Khi nào chọn

- Cần đánh giá nguồn skill/phong cách tác giả một cách đo lường
- Muốn heuristic AI-slop detection giá rẻ trước khi LLM review sâu
- Có auto-capture + redact + embeddings sẵn — YV thêm extractor
- Nối packages/core redact.ts (text pipeline) + memory/auto-capture.ts (regex pattern) + memory/embeddings.ts (so vector); guard multi-lang (từ khóa thêm ngôn ngữ — config), context-loss (tu từ/trích dẫn — loại trước khi đo), và threshold-calibrate (slop ≥ 2 test bằng golden set, tránh false accuse); YV = stylometry, kết hợp 663 YM badge-curation (slop check trong review) + 671 YU triple-gate (epistemic + style) + 673 YW honest-limits (certainty tone liên quan honesty)
