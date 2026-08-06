# Hướng HL: Multimodal Output Generation — agent tạo ảnh/video/audio, không chỉ trả text

> **Nguồn gốc:** arXiv 2601.03250 "A Versatile Multimodal Agent for Multimedia Content Generation" (MultiMedia-Agent — "emphasizing the interplay between different modalities for richer content generation"); NVIDIA "Build Multimodal Visual AI Agents Powered by NIM" (VLMs add vision — process images, videos); futureagi "How Multimodal LLMs Work in 2026" (image + question → text; vision encoders); Lyzr "What is Multimodal AI?" (software process + integrate information từ multiple types: text, images, audio, video, sensor); Medium "Rise of Large Multimodal Models" (jointly process + reason across modalities)
> **Coupling:** 🟡 — mở rộng pipeline output (thêm tool sinh media + xử lý)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (input đa modality — chưa sinh output media)
> **Effort:** 3-6 tuần

## Nguồn gốc

Multimodal output: **agent không chỉ trả text — còn *sinh* ảnh, video, audio: nhận input đa dạng (image/audio) → suy luận → tạo output media** — arXiv 2601.03250: agent sinh nội dung multimedia — interplay giữa modality; NVIDIA NIM: VLMs xử lý image/video; Lyzr: multimodal AI = integrate từ multiple input types. Khác **multimodal-inputs** (chỉ *đọc* ảnh/âm — có trong mya) — MMMM là *sinh ra*. Khác **203/speech (216)** (audio — nhưng chủ yếu giọng nói) — MMMM tổng quát (ảnh/video/signal). Kết nối: **216 voice** (TTS — một loại output media), **178 routing** (model image-gen/video riêng — nguồn), **181 artifact-mgmt** (file media — lưu/deliver), **214 PII** (ảnh có thể chứa thông tin nhạy — redact nếu upload), **64 cost-budget** (sinh video/ảnh đắt).

## Kiến trúc

```
  USER (mô tả, ảnh tham khảo, âm thanh)
        │
        ▼
  PLAN (agent quyết: text + 1 hay nhiều media — model nào: image/video/audio)
        │
        ▼
  GEN TOOL (image-gen / video-gen / TTS — qua routing 178 chọn model phù hợp)
        │
        ▼
  POST (validate output — kích thước/format; 181 lưu artifact)
        │
        ▼
  DELIVER (trả media + text — chú thích, caption; user xem được)
```

```
mya: nhận ảnh/audio input — chưa sinh media output (text only)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ multimodal-inputs — đọc ảnh/audio (nền)
// ✅ 178 routing — chọn model phù hợp (image/video gen — nền)
// ✅ 181 artifact — lưu/deliver file (nền)
// ✅ 216 voice — TTS (một loại media output — nền)

// ❌ THIẾU: gen tool (image/video/audio — wrapper model sinh)
// ❌ THIẾU: validat media (kích thước/format/giới hạn)
// ❌ THIẾU: caption/chú thích cho media trong kết quả agent
```

## Implementation

```typescript
// packages/mediaout/src/gen.ts (NEW)
export async function generateMedia(spec: MediaSpec, ctx: Ctx): Promise<Artifact> {
  const m = await router.pick(spec);               // 178 — image/video/audio model
  const out = await m.call(spec.prompt, spec.refs); // sinh media (NIM-style)
  const ok = validate(out, spec.format);            // check format/kích thước
  return artifact.store(out, { caption: spec.caption }); // 181 — lưu + caption
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Output phong phú — report có ảnh, video demo, voice | ❌ Chi phí cao (video/image-gen đắt — token nhiều) |
| ✅ Hiểu input đa dạng → kết quả đúng ngữ cảnh | ❌ Model sinh media khó kiểm — cần validate + guard |
| ✅ Dùng chung 178/181/216 — mở rộng nhẹ | ❌ Latency lớn — sinh video rất chậm |
| ✅ Agent hữu ích hơn hẳn với người dùng sáng tạo | ❌ Nội dung sinh có thể nhạy cảm — cần filter (168 guardrails) |

## Khác các hướng gần

| | 216 Voice | Multimodal-in | MMMMMMMM: Media-out |
|---|---|---|---|
| Mục | Giọng nói TTS | Đọc ảnh/audio | **Sinh ảnh/video/audio** |
| Hướng | Output audio | Input | **Output — media mới** |
| Quan hệ | Một loại | Ngược | **Mở rộng — mọi modality** |

## Khi nào chọn

- Sản phẩm cần media (report ảnh, demo video, podcast)
- Người dùng upload ảnh/audio — muốn agent hiểu và trả lời bằng media
- Đã có multimodal input + artifact 181 — mở output là bước kế
- Không khi: output text đủ — thêm media là thêm chi phí + guard