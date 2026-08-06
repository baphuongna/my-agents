# Hướng JW: Data Classification — gắn nhãn nhạy cảm cho mọi data, định tuyến xử lý theo nhãn

> **Nguồn gốc:** NIST SP 800-60 "Guide to Mapping Types of Information"; GDPR data categories; "data classification" (public/internal/confidential/restricted); Microsoft Purview; AWS Macie (auto-classify PII); Presidio (PII detection); Microsoft Information Protection (labels)
> **Coupling:** 🟡 — thêm classification tag vào data pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (PII detect HF sẵn — chưa có classification routing)
> **Effort:** 2-4 tuần

## Nguồn gốc

Data classification (NIST SP 800-60): mỗi data có **nhãn** (public / internal / confidential / restricted / PII / PHI) → định tuyến xử lý theo nhãn — VD restricted không gửi LLM cloud, PII phải redact (HF 214). AWS Macie/Purview auto-classify (ML detect PII/secret trong S3/blob). Microsoft Information Protection: label đi theo data (persistent tag) — policy apply theo label. Presidio: detect PII → tag. Đối với agent: data vào (user input, tool output, file) → auto-classify → nhãn quyết định: redact (HF) trước LLM, encrypt (JV 282), cấm cloud (minimization JX), audit extra (GP). Khác **HF (214) PII redaction** (redact cụ thể) — JW *gắn nhãn tổng quát* để *định tuyến policy*; khác **284 JX minimization** (lấy ít data) — JW *phân loại* data đã có; khác **JV (282) encryption** (mã hóa) — JW *quyết định có cần mã hóa không* theo nhãn.

## Mô tả

mya data classification: mọi data qua classifier (rule + ML/NER) → gắn label (public/internal/confidential/restricted + PII/PHI flag). Label đi theo data (persistent metadata). Policy engine: restricted → không gửi LLM cloud / local-only; PII → redact (HF) trước LLM; confidential → encrypt (JV). mya có PII detect (HF) — JW tổng quát thành classification framework + policy routing.

## Kiến trúc

```
  DATA IN (user input / tool output / file)
        │
        ▼
  CLASSIFIER (rule + NER/ML — Presidio/Macie-style)
   · level: public | internal | confidential | restricted
   · flags: PII? PHI? secret? financial?
        │
        ▼
  TAG (persistent metadata đi theo data)
        │
        ▼
  POLICY ROUTING
   · restricted → local-only, NO cloud LLM, encrypt JV, audit extra GP
   · PII → redact HF before LLM
   · confidential → encrypt at-rest JV
   · public → no special handling
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ HF (214) PII redaction — detect PII (sản — nền classifier)
// ✅ GP (198) audit — record (sản)
// ✅ JV (282) encryption — mã hóa (sản theo nhãn)
// ✅ 284 JX minimization — ít data (kết hợp)

// ❌ THIẾU: classification taxonomy (level + flags)
// ❌ THIẾU: auto-classifier (rule + NER/ML beyond PII)
// ❌ THIẾU: policy routing engine (nhãn → hành động)
// ❌ THIẾU: persistent tag (label đi theo data)
```

## Implementation

```typescript
// packages/classify/src/index.ts (NEW)
type Level = "public" | "internal" | "confidential" | "restricted";
interface Label { level: Level; pii: boolean; phi: boolean; secret: boolean; }
async function classify(data: Buffer): Promise<Label> {
  const pii = await detectPii(data);            // Presidio-style (HF 214)
  const secret = /api[_-]?key|password|token/i.test(data.toString());
  const level: Level = secret ? "restricted" : pii ? "confidential" : "internal";
  return { level, pii: pii.length > 0, phi: /\b\d{3}-\d{2}-\d{4}\b/.test(data.toString()), secret };
}
function route(l: Label): Policy {
  if (l.level === "restricted") return { cloud: false, encrypt: true, audit: true }; // local-only
  if (l.pii) return { redact: true };                                                 // HF before LLM
  return {};
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Policy theo nhãn — xử lý đúng mức (NIST) | ❌ Misclassification → over/under-handle (rủi ro hoặc phiền) |
| ✅ Auto-classify quy mô (Macie/Purview) | ❌ Classifier chi phí (NER/ML mỗi data) |
| ✅ Persistent tag — label đi theo data (MIP) | ❌ Tag propagation phức (qua copy/tool/copy) |
| ✅ Tuân GDPR/HIPAA — xử lý theo loại | ❌ False negative — secret/PII lọt (cần defense-in-depth) |

## Khác các hướng gần

| | HF PII Redaction | 284 JX Minimization | JV Encryption | JW: Classification |
|---|---|---|---|---|
| Cái gì | Redact PII cụ thể | Lấy ít data | Mã hóa | **Gắn nhãn + định tuyến** |
| Khi nào | Trước LLM | Thiết kế prompt | Persistence | **Mọi data vào** |
| Quan hệ | JW trigger HF | JW giảm nhu cầu | JW quyết định cần | **Meta-layer áp policy** |

## Khi nào chọn

- Agent xử lý đa loại data (PII, secret, public) — cần xử lý khác nhau
- Compliance (GDPR/HIPAA) yêu cầu xử lý theo loại
- Muốn policy-driven (redact/encrypt/cloud-block) tự động theo nhãn
- Luôn: defense-in-depth (classifier có thể miss), persistent tag propagation, audit (GP)
