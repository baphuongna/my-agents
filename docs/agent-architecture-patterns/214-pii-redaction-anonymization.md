# Hướng GGGGGGGG: PII Redaction & Anonymization — lọc dữ liệu nhạy cảm trước khi gửi LLM và sau khi nhận output

> **Nguồn gốc:** arXiv 2501.12465 "Adaptive PII Mitigation Framework for LLMs" ("GDPR mandates stricter anonymization for sensitive identifiers — replacing email..."); PredictionGuard "PII detection and redaction for LLM pipelines" ("LLM apps can reveal sensitive information through outputs — unauthorized access, IP loss"); radicalbit "PII redaction and anonymization at the gateway level" (gateway-level để enforce privacy); Presidio PII Redaction Guard (redacts PII before LLM + sweeps output để catch leaked/hallucinated data); LBL "Handling PII with LLMs" (privacy filter models + sanitization); strac.io (automated tools identify + redact sensitive info from outputs)
> **Coupling:** 🟡 — chặn giữa input/output và LLM (gateway)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (chưa có lớp redaction riêng — cần thêm)
> **Effort:** 2-4 tuần

## Nguồn gốc

PII redaction: **phát hiện dữ liệu nhạy cảm (email, SĐT, địa chỉ, mã) — thay bằng placeholder trước khi gửi LLM; quét output sau khi LLM trả để bắt rò rỉ/hallucinated PII** — PredictionGuard: output LLM có thể phơi bày thông tin → unauthorized access/IP loss; radicalbit: enforce tại gateway — một nơi áp cho mọi traffic; Presidio guard: redact trước + sweep sau ("catch leaked or hallucinated data"); arXiv 2501.12465: adaptive — mức anonymization theo regulation (GDPR yêu cầu mạnh). Khác **168 guardrails** (chặn hành động nguy hiểm) và **200 prompt-injection defense** (chống prompt độc) — GGGGG tập trung *quyền riêng tư dữ liệu*; **190 dynamic-permissions** (quyền truy cập) — khác: quản lý quyền không làm sạch dữ liệu. Kết nối: **198 audit** (ghi khi redaction xảy ra), **199 delegate** (redact trước khi giao sub-agent), **63 firewall** (có thể kết hợp lớp này), **self-heal** — placeholder map lại sau response.

## Kiến trúc

```
  USER INPUT ──► PII DETECT (regex + NER model — email/phone/address/ID)
        │            │
        │      REPLACE (email → [EMAIL_1] — map id lưu riêng)
        ▼            ▼
  LLM (gọi với text đã sạch — không chạm raw PII)
        │
        ▼
  LLM OUTPUT ──► SWEEP (quét lại — bắt leaked/hallucinated PII mới)
        │            │
        │      RESTORE (thay placeholder ngược lại cho user — nếu an toàn)
        ▼
  RESPONSE (sạch, đúng người xem)
```

```
mya: chưa có lớp redaction — PII đi thẳng vào LLM
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 168 guardrails — chặn hành động nguy hiểm (nền chung)
// ✅ 200 injection defense — chống prompt độc (lớp khác)
// ✅ 198 audit — sẵn ghi sự kiện
// ✅ 199 delegated — sẵn khi giao việc sub-agent

// ❌ THIẾU: detector PII (regex + NER — Presidio-style)
// ❌ THIẾU: placeholder map + restore an toàn
// ❌ THIẾU: sweep output (bắt LLM "bịa" PII mới)
```

## Implementation

```typescript
// packages/piiredact/src/redact.ts (NEW)
export class PiiGuard {
  async process(text: string): Promise<string> {
    const pii = await detect(text);                 // NER + regex — Presidio
    const map = pii.map(x => placeholder(x));       // EMAIL_1, PHONE_2…
    this.store(map);                                // map lưu riêng (GDPR — arXiv)
    return replace(text, map);
  }
  async sweep(output: string): Promise<string> {
    const leaked = await detect(output);            // bắt rò rỉ mới
    if (leaked.length) this.audit(leaked);          // 198 — ghi
    return replace(output, leaked.map(placeholder)); // chặn trước khi tới user
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tuân GDPR/HIPAA — dữ liệu nhạy không vào LLM (arXiv) | ❌ Detector sai → redact nhầm content hợp lệ |
| ✅ Chặn tại gateway — 1 nơi, mọi agent (radicalbit) | ❌ Placeholder đổi nội dung — LLM context bớt "tự nhiên" |
| ✅ Sweep output — bắt cả PII LLM *bịa* ra (hallucinate) | ❌ Restore phức — map phải giữ an toàn riêng |
| ✅ Xây trên 198/168/200 | ❌ Hiệu năng: thêm 1-2 lớp detect mỗi request |

## Khác các hướng gần

| | 168 Guardrail | 200 Inject-def | GGGGGGGG: PII |
|---|---|---|---|
| Mục | Chặn hành động | Chống prompt độc | **Bảo vệ dữ liệu nhạy cảm** |
| Đối tượng | Hành động | Input prompt | **Dữ liệu (input + output)** |
| Quan hệ | Cùng tầng | Cùng tầng | **Bổ sung — xử lý riêng tư** |

## Khi nào chọn

- Xử lý dữ liệu user (ticket, hồ sơ, email) — bắt buộc GDPR/HIPAA
- Agent gọi LLM ngoài/cloud — không muốn PII lọt ra ngoài
- Output đưa cho người khác xem (report, dashboard) — cần sweep
- Luôn: placeholder-map + restore theo quyền — không restore cho user khác