# Hướng WWWWW: Multi-Modal Inputs — agent xử lý ảnh/âm thanh/văn bản

> **Nguồn gốc:** chanl.ai "Voice, Vision, Text in Production" 2026; MLLM (quiq/xenonstack); oneReach
> **Coupling:** 🟡 — input pipeline mới, gateway đổi nhẹ
> **Agent-agnostic:** ⚠️ — preprocess bình thường, LLM phải đọc được
> **Code sẵn:** ⚠️ (inbox sẵn; thiếu media pipeline)
> **Effort:** 2-3 tuần

## Nguồn gốc

Multimodal agents: **agent nhận và xử lý nhiều loại input — text, hình ảnh (screenshot/diagram/chart), giọng nói** — chanl.ai 2026: "architect multimodal AI agents that process voice, vision, and text simultaneously — from STT→LLM→TTS pipelines to vision integration"; xenonstack: "correlate across modalities — connect visual cues with textual instructions"; oneReach: combine text, vision, speech; MLLM (quiq): multimodal LLM integrate text, image, speech. Bản chất: (1) **media → text preprocess** (ảnh: mô tả/OCR; giọng: STT — chanl.ai) hoặc (2) **tokens gốc** (MLLM trực tiếp — tốn hơn); (3) **nhiều input → context chung** (ảnh + lời giải thích cùng task). Khác **RRR firewall** (nội dung text) — WWWWW *đường ống media*; khác **MM memory** (lưu text) — WWWWW lưu cả media artifact (120 QQQQQ).

## Mô tả

mya multimodal layer: (1) **inbox nhận media** — user dán ảnh/ghi âm vào task (inbox sẵn — nhận file); (2) **preprocess** — ảnh: tạo mô tả/OCR (model rẻ PPPP hoặc vision model) → text vào context; giọng: STT (chanl.ai pipeline) → text transcript; (3) **lưu gốc** — file ảnh/audio giữ ở artifacts (QQQQQ) — không ném vào context lần nữa (WRRRR — long-context); (4) **quyết định** — ảnh quan trọng (cần đọc chi tiết: diagram/UI) → giữ token ảnh + gửi MLLM (đắt nhưng đúng); ảnh minh họa → chỉ giữ mô tả (rẻ); (5) **mở rộng dần** — metadata → khi cần mới load ảnh gốc (VVVV progressive disclosure). Chống: ảnh nhiều làm context phình (RRRRR) → policy tóm tắt/vision-only-when-cần.

## Kiến trúc

```
  USER INPUT ──► INBOX (sẵn — nhận media)
        │
        ▼
  PREPROCESS ──► ảnh: OCR/mô tả (PPPP rẻ) · giọng: STT (chanl.ai pipeline)
        │         → TEXT vào context (prompt không phình)
        │
  QUYẾT ĐỊNH (tự do): ảnh chi tiết cần đọc → giữ token ảnh + MLLM (đắt, đúng)
                       ảnh minh họa → chỉ mô tả (rẻ)
        │
        ▼
  LƯU GỐC: file media → artifacts (QQQQQ) · load lại khi cần (VVVV · RRRRR)
```

```
mya: inbox nhận file SẸN — thiếu: preprocess (OCR/STT/mô tả) + policy quyết định
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ inbox — nhận file/media vào task (nền)
// ✅ QQQQQ artifacts — lưu file gốc (không ném context)
// ✅ VVVV progressive disclosure — mô tả trước, gốc khi cần
// ✅ RRRRR long-context — policy chống phình (ảnh → tóm tắt)
// ✅ PPPP local — preprocess model rẻ

// ❌ THIẾU: preprocess pipeline (OCR/STT/mô tả ảnh)
// ❌ THIẾU: policy "giữ token ảnh vs chỉ mô tả"
// ❌ THIẾU: MLLM routing (chọn model đọc ảnh — RR mở rộng)
```

## Implementation

```typescript
// packages/gateway/src/multimodal.ts (NEW)
type Media = { kind: "image" | "audio" | "video"; path: string; size: number };

async function preprocess(m: Media, ctx: TaskCtx): Promise<MediaText> {
  switch (m.kind) {
    case "image":
      const desc = await describeImage(m, "detail");    // PP PP rẻ / OCR
      return { text: desc.text, keepToken: needDetail(m, ctx.task) }; // MLLM khi cần
    case "audio":
      const t = await stt(m);                           // chanl.ai: STT→LLM→TTS
      return { text: t, keepToken: false };
  }
}
// lưu gốc → artifacts (QQQQQ) — không giữ token (RRRRR)
// ảnh chi tiết (diagram/UI) → keepToken=true → gửi MLLM (RR routing)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nhận task thực tế (ảnh lỗi, bảng, ghi âm) | ❌ STT/OCR thêm layer + model (PPPP) |
| ✅ Preprocess rẻ — prompt không phình (RRRRR) | ❐ MLLM tốn token khi giữ ảnh (SS/XXXXX) |
| ✅ Media lưu gốc ở artifacts (QQQQQ) | ❌ Policy "giữ ảnh vs mô tả" cần tune |
| ✅ VVVV mở dần — chỉ load khi cần | ❌ Agent thường không đọc được video (nhỏ) |

## Khác các hướng gần

| | VVVV Disclosure | RRRRR Long-Context | WWWWW: Multi-Modal |
|---|---|---|---|
| Vấn đề | Hiển thị dần | Giữ nội dung | **Loại input** |
| Cơ chế | Metadata→mở | Tóm tắt/offload | **Preprocess media→text** |
| Mối quan hệ | Dùng cho media gốc | Chống phình ảnh | **Đường ống input mới** |

## Khi nào chọn

- User thường đính ảnh/ghi âm vào task (lỗi, minh họa)
- Muốn agent hiểu screenshot/diagram (đổi GUI, UI verify)
- Đã có inbox + artifacts + VVVV — thêm preprocess + policy
- Chấp nhận 2-3 tuần (STT + vision pipeline)