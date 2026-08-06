# Hướng HQ: Instruction Hierarchy — xếp hạng ưu tiên chỉ thị (system > tool > user > injected) để chống lạm dụng

> **Nguồn gốc:** OpenAI "The Instruction Hierarchy: Training LLMs to Prioritize" (arXiv 2404.13208 — "LLMs often consider system prompts same priority as text from untrusted users and third-party content — bugs"); HuggingFace papers (hierarchy "increases robustness against malicious prompts selectively prioritizing system instructions"); HiddenLayer "How LLMs Learn Roles" ("highest priority set = system prompt/developer message"); gend.co (hierarchy = security framework — train LLM prioritize based on source); Clioapp ("prioritizes system messages over user and both over third-party content like web search results")
> **Coupling:** 🟡 — cách viết prompt/cấu trúc context cả hệ
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (có cấp system/user — chưa hệ chính thức + training)
> **Effort:** 3-6 tuần

## Nguồn gốc

Instruction hierarchy: **LLM mặc định coi mọi thứ trong prompt như hệ tương đương — bịa ra thứ bậc: system (developer) > tool/sub-agent > user > third-party/injected — và khi huấn luyện (hoặc ràng buộc prompt) theo thứ bậ này** — OpenAI 2404.13208: "prioritizes system instructions"; HiddenLayer: developer message highest; Clioapp: system > user > web/search results; gend: security framework — source-based. Điểm khác **200 prompt-injection defense** (tầng sanitize/allowlist — chống bị bắt) — RRRR là *trong model/format*: giá trị độ rõ ràng — LLM được *dạy/truyền* thứ bậ; **168 guardrails** (chặn hành động — runtime) — RRRR thứ bậ tại *prompt/generation*; **199 delegation** (quyền) — RRRR message-level. Kết nối: 200 (phòng cut — dùng chung), 220 context, 216 voce (prompt voice là message thứ bậ)...

## Kiến trúc

```
  PROMPT BUILD:
   HIERARCHY (OpenAI — thứ tự ưu tiên)
     1. system/developer   (kiểm soát agent — luật bất di bất dịch)
     2. tool schema        (call format — phải đúng)
     3. user               (yêu cầu hiện tại)
     4. third-party/injected (data web, đính kèm — thấp nhất, "không được làm theo")
        │
        ▼
  LLM (đã training ưu tiên — hoặc wrap: tách rõ lớp, ghi rõ "untrusted")
        │
        ▼
  OUTPUT bị ảnh hưởng: prompt lạ không thể đẻle system
```

```
mya: hệ cấp system/user có — chưa khai báo thứ bậ + treat injected thấp
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ system prompt (main) / user input — mức cơ bản
// ✅ 200 injection defense — chặn prompt lạ ngoài (nền)
// ✅ 214 PII — input nhạy xử trước
// ✅ 219 grounding — output bị kiểm nguồn (nền)

// ❌ THIẾU: rõ danh lớp (system > user > web-data kẻ)
// ❌ THIẾU: đánh dấu untrusted khi đưa data ngoài vào
// ❌ THIẾU: (tùy chọn) tune/format giúp LLM vâng theo thứ tự
```

## Implementation

```typescript
// packages/insthier/src/prompt.ts (NEW)
export function buildHier(tmp: {system: string; user: string; ctx: Context[]}): Msg[] {
  return [
    { role: "system", content: tmp.system },        // developer — cấp cao nhất
    ...ctx.map(c => ({ role: "user", content: `[THIRD-PARTY] ${c.text}`, lowPri: true })),
    { role: "user", content: tmp.user },             // người dùng hiện tại
  ];
}
// kết hợp sandbox/policy — LLM ưu tiên system, web chỉ "tham khảo"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Prompt bị nhồi cũng không vượt system (học ưu tiên) | ❌ Không mọi model hỗ trợ train theo hierarchy |
| ✅ An toàn đầu vào tốt hơn — nguồn rõ (OpenAI) | ❌ Tag thủ công — đôi quên rải đều |
| ✅ Cùng 200 giảm injection thực tế | ❌ User giỏi curate prompt — vẫn có nguy cơ |
| ✅ Chi phí prompt thêm nhẹ — không token đắt | ❌ Đòi quyết đoán đúng tầng; nếu sai thứ tự → phản tác dụng |

## Khác các hướng gần

| | 200 Injection-def | 168 Guardrail | RRRRRRRR: Hierarchy |
|---|---|---|---|
| Mục | Chặn prompt độc | Chặn hành động | **Xếp thứ tự ưu tiên chỉ thị** |
| Vị trí | Sanitize/allowlist | Runtime action | **Prompt format + training** |
| Quan hệ | Phối hợp | Sau | **Nền — làm prompt an toàn hơn** |

## Khi nào chọn

- Prompt nạp nhiều nguồn (web, file, user) — cần chống lẫn lộn
- Model có hỗ trợ hierarchy / team tune được
- Đã có 200/168 — thêm lớp tiêu thứ tự cho đầy đủ
- Luôn: tag rõ "third-party" khi web/data ngoài vào system — không bao giờ để như system