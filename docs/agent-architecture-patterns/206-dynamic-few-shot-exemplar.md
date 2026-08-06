# Hướng GX: Dynamic Few-Shot Exemplar Selection — chọn ví dụ phù hợp mỗi câu hỏi, không dùng 1 bộ tĩnh

> **Nguồn gốc:** arXiv 2507.23211 "Enhancing Few-Shot In-Context Learning" ("static prompt đã chuyển sang dynamic retrieval của task-specific exemplars tại thời điểm inference"); Wang W "Dynamic k-shot In-Context Learning" (Dk-ICL — tự quyết k lời cho từng query); tianpan.co "Dynamic Few-Shot Retrieval" ("dynamic few-shot retrieval là intervention high-leverage sau khi team đã tối ưu prompt + system"); ACM "Few-Shot Learning: Fine-Tuning vs. In-Context Learning" (so sánh fine-tune vs ICL)
> **Coupling:** 🟢 — độc lập, chỉ chạm bước build prompt
> **Agent-agnostic:** ✅
> **Code sẵn:** ✅ (chọn ví dụ trong file tool-description/evoprompt — chưa retrieval động + đánh dấu)
> **Effort:** 1-2 tuần

## Nguồn gốc

Dynamic few-shot: **thay bộ ví dụ cố định bằng retrieval nhiều ví dụ phù hợp query mỗi lần** — thay vì "burning" 3-5 mẫu tĩnh trong system prompt — tian.co ("đáng cải thiện"); arXiv: chuyển static prompt → dynamic retrieval of exemplars at inference; D∝-k-ICL — *k* cũng năng (số ví dụ tự khác theo câu hỏi). Điểm khác **197 hybrid-search** (retrieval *kiến thức/tài liệu* cho context) — YYYYYY retrieval từ *bộ ví dụ* (rất mẫu) để đào cách biểu hiện output — không phải tài liệu; **101/151 tool-description-engineering** (mô tả tool) — khác: ví dụ callback *cách* tool. Kết nối **190 evals** (thẩm bộ ví dụ), **178/model-behavior stable** (không cần) — dynamic exemplar tốt khi task này ổn định chuẩn bị trong bộ nhỏ (classification, structured extract, casing); khác hướng giả: 5-shot tĩnh là cách bắt đầu cũ.

## Kiến trúc

```
  QUERY (mới đến)
        │
        ▼
  EXEMPLAR STORE (labelled: query→gold output — few dozen/hundreds)
        │
        ▼
  RETRIEVE top-k (embedding tương đồng — cũng như 197 query)
   · dynamic k (D-k-ICL — tùy độ khó câu hỏi)
        │
        ▼
  BUILD PROMPT (system ít lệnh + K ví dụ chọn theo query)
        │
        ▼
  LLM --> OUTPUT (định dạng đúng pattern ví dụ — không cần template nặng)
```

```
mya: example tĩnh, chưa auto-k, chưa lưu lại từng trường từ system tốt
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ ví dụ nâng cao trong prompt của nhiều tool (tool-example — tĩnh)
// ✅ 197 hybrid search — sẵn hạ tầng retrieval để đổi store
// ✅ 190 eval harness — sẵn đánh giá khi đổi exemplar

// ❌ THIẾU: exemplar store (gold 1 câu + output chuẩn — chưa gom)
// ❌ THIẾU: retrieval động trong build prompt (thay 5-shot tĩnh)
// ❌ THIẾU: tự cập nhật exemplar (khi 190 trả sai — thay ví dụ)
```

## Implementation

```typescript
// packages/exemplar/src/pick.ts (NEW)
export async function pickExemplars(q: Query, k = 5): Promise<Example[]> {
  const vec = await embed(q);
  const kk = adaptiveK(q, k);                 // D-k-ICL — k tự nhiên
  return store.search(vec, kk);                // top-k — giống 202/197
}
// buildPrompt: system (ngắn, không nhét ví dụ) + few-shot từ store
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tốt hơn 5-shot tĩnh (task đa dạng) — ví dụ *liên quan* không là "decisive" | ❌ Cần store lable + embed — thêm công gom/embed ví dụ |
| ✅ Giảm bộ nhớ prompt (không kéo hết ví dụ thừa) | ❌ Đổi ví dụ = đổi giọng — đánh giá lại (190) |
| ✅ Định dạng cứng (JSON/casing) luyện đúng cách ví dụ | ❌ K nhỏ vẫn lệch — bộ ví dụ nghèo thì tệ hơn 0-shot |
| ✅ Nhẹ nhất trong nhóm few-shot chấp — không fine-tuning | ❌ Không thay fine-tune khi đòi định nghĩa "phong cách" |

## Khác các hướng gần

| | 197 RAG | 201 Fine-tune | YYYYYYYY: Exemplar |
|---|---|---|---|
| Mục | Kiến thức lấy về | Trọng số học đặc trưng | **Ví dụ mẫu theo câu hỏi** |
| Vị trí | Context | Model | **Prompt — lạnh (runtime)** |
| Quan hệ | Tri thức | Domain học riêng | **Định dạng/biểu mẫu — phù hợp khi bộ nhiều ít khác nhau** |

## Khi nào chọn

- Task biến thiên theo cụm (query, header, location, phrase) nhưng output pattern ổn định
- Đã có sẵn few gold example; vừa đủ nhiều (không đủ cho fine-tune)
- Muốn cải thiện trong vài ngày; có 190 để kiểm tra thay đổi
- Không may khi: output không có "pattern" rõ — hoặc 0-shot đã đủ