# Hướng JX: Data Minimization — chỉ thu thập/đưa vào LLM dữ liệu tối thiểu cần thiết

> **Nguồn gốc:** GDPR Art. 5 "data minimisation" ("collect only what is necessary"); "least privilege for data"; privacy by design; "need-to-know basis"; prompt design minimal context; OWASP data minimization; "don't over-share context with LLM"
> **Coupling:** 🟡 — ảnh hưởng prompt xây + tool lấy data
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (prompt compression CV sẵn — chưa có explicit minimization policy)
> **Effort:** 1-2 tuần

## Nguồn gốc

Data minimization (GDPR Art. 5): chỉ thu thập/xử lý dữ liệu *cần thiết cho mục đích cụ thể* — không thừa. Privacy by design (GDPR): minimization là nguyên tắc cốt. Least privilege áp cho data: agent chỉ truy cập/đưa vào context đúng mức cần. Đối với LLM: đưa toàn file/hội thoại đầy đủ vào context = over-share → tăng cost, rủi ro leak (PII), nhiễu giảm chất lượng. Minimization: chỉ select field/section/token liên quan đến task. Khác **100 CV prompt compression** (nén token *sau* khi có) — JX *lựa chọn ít data hơn ngay từ đầu*; khác **HF (214) PII redaction** (lọc PII) — JX giảm *tất cả* data thừa không chỉ PII; khác **JW (283) classification** (gắn nhãn) — JX *giảm lượng* dựa trên nhu cầu; khác **218 HJ tool output compression** (nén output tool) — JX *chọn không lấy* thay vì nén.

## Mô tả

mya data minimization: trước khi đưa data vào LLM context, **lựa chọn** chỉ phần liên quan task — field cần, section cần, không dump toàn file. VD: task "tóm tắt phần A" → chỉ đọc section A, không cả file. Tool chỉ trả field cần (projection). mya có prompt compression (CV) — JX bước *trước*: không nén thừa mà không lấy thừa. Giảm cost, leak risk, nhiễu.

## Kiến trúc

```
  TASK ("tóm tắt section A của file")
        │
        ▼
  MINIMIZATION POLICY — "cần gì để làm task này?"
        │
        ▼
  PROJECTION / SELECT
   · file → chỉ section A (không cả file)
   · tool → chỉ field name, status (không dump all)
   · memory → chỉ record liên quan (không toàn history)
        │
        ▼
  LLM CONTEXT (tối thiểu — chỉ cần thiết)
        │ (nếu vẫn dài → compression CV 100 là bước sau)
        ▼
  RESPONSE
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 100 CV prompt compression — nén token (bước SAU minimization)
// ✅ 218 HJ tool output compression — nén output tool (bổ sung)
// ✅ CJ (88) memory recall — select record liên quan (nền)
// ✅ HF (214) PII redaction — lọc PII (lớp khác)
// ✅ JW (283) classification — phân loại (kết hợp)

// ❌ THIẾU: explicit minimization policy (chỉ lấy cần thiết)
// ❌ THIẾU: tool projection (select field, không dump)
// ❌ THIẾU: context-need analysis (task → field cần)
```

## Implementation

```typescript
// packages/minimize/src/index.ts (NEW)
interface Need { fields: string[]; section?: string; since?: number; }
function deriveNeed(task: string): Need {                 // task → field/section cần
  // VD "summarize section A" → { section: "A" }; "status of task X" → { fields: ["status"] }
  return analyze(task);
}
async function minimize(task: string, source: Source): Promise<string> {
  const need = deriveNeed(task);
  const slice = project(source, need);                    // chỉ lấy field/section cần — không dump all
  return slice;                                            // tối thiểu — giảm cost/leak/nhiễu
}
// tool: chỉ trả field cần (projection); memory: recall chỉ liên quan (CJ 88)
// nếu slice vẫn dài → compression (CV 100) là bước sau
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm cost/token — ít data hơn (GDPR minimization) | ❌ Lựa chọn sai field → thiếu context, LLM sai |
| ✅ Giảm leak risk — ít PII/secret trong context | ❌ derive-need khó (task mơ hồ → cần gì?) |
| ✅ Ít nhiễu — context tập trung tăng chất lượng | ❌ Over-minimize → mất thông tin quan trọng |
| ✅ Tốc độ — ít token = nhanh hơn | ❌ Phân tích need tốn thêm bước |

## Khác các hướng gần

| | 100 CV Compression | HF PII Redaction | JW Classification | JX: Minimization |
|---|---|---|---|---|
| Cái gì | Nén token sau | Lọc PII cụ thể | Gắn nhãn | **Chọn ít data từ đầu** |
| Khi nào | Context đã có | Trước LLM (PII) | Mọi data | **Trước khi lấy** |
| Mục | Giảm token | Bảo vệ PII | Định tuyến | **Least-data need-to-know** |

## Khi nào chọn

- Agent hay dump toàn file/history → over-share tốn cost + rủi ro
- Task rõ phạm vi (section A, field status) — minimization dễ
- Cost/privacy nhạy — ít data vào LLM hơn
- Luôn: minimization trước, compression (CV) sau; không over-minimize mất context; kết hợp JW để biết data gì nhạy
