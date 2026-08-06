# Hướng IA: Output Moderation — lọc toxicity/PII trước khi trả user

> **Nguồn gốc:** OpenAI Moderation API (2023+); Perspective API (Jigsaw/Google); NeMo Guardrails "output rail"; AWS Bedrock Guardrails; Llama Guard (Meta 2023)
> **Coupling:** 🟡 — chặn giữa LLM output và user response (gateway)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (redact + threat-scan sẵn — thiếu moderation classifier + policy gate)
> **Effort:** 2-3 tuần

## Nguồn gốc

Output moderation đã chuẩn hoá qua **OpenAI Moderation API** — classifier phân loại output thành hate/threats/self-harm/sexual/violence. **Perspective API** (Jigsaw) dùng trong YouTube/Comments — toxicity scoring. **Llama Guard** (Meta 2023) — open-weight classifier chạy local, đánh giá cả input prompt lẫn output response theo taxonomy an toàn. **NeMo Guardrails** khái niệm **output rail**: mọi response LLM phải qua rail trước khi tới user — chặn toxicity, PII, unsafe content. **AWS Bedrock Guardrails**: policy-driven (chỉ định nội dung bị cấm + PII filters + denied topics) áp dụng gateway-level cho mọi model.

Điểm khác **214 PII Redaction** (HF — chỉ lọc *dữ liệu nhạy cảm* thông tin cá nhân) — IA rộng hơn: toxicity, policy violation, harmful instructions. Khác **168 guardrails** (FL — chặn *hành động/tool call* nguy hiểm) — IA chặn *nội dung text* trong response. Ba lớp bổ sung: FL chặn action, HF lọc PII, IA moderate nội dung. Nối **200 prompt-injection** (đầu vào), **198 audit** (ghi moderation action).

## Mô tả

mya output moderation: sau khi LLM trả response, trước khi gửi user qua gateway/channel — chạy qua **moderation pipeline**: (1) PII sweep (nối **214 HF** — redact.ts sẵn); (2) toxicity classifier (Perspective/Llama Guard/OpenAI Moderation); (3) policy match (topic deny-list, banned content); (4) unsafe → block + thay bằng safe fallback, audit (198), alert (227). mya đã có `redactSensitiveText` (core/redact.ts) + `threat-scan.ts` — thiếu classifier toxicity + policy gate cấu hình được.

## Kiến trúc

```
  LLM OUTPUT (assistant response)
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  MODERATION PIPELINE (output rail)            │
  │                                               │
  │  ① PII SWEEP (214 HF)                         │
  │     redactSensitiveText → strip email/phone   │
  │                                               │
  │  ② TOXICITY CLASSIFIER                        │
  │     Perspective / Llama Guard / OpenAI Mod    │
  │     → scores: hate, threat, violence, ...     │
  │                                               │
  │  ③ POLICY MATCH                               │
  │     deny-topics, banned patterns, PII strict  │
  │                                               │
  │  ④ DECISION: pass / block / redact / escalate │
  └────────┬──────────────┬──────────────┬───────┘
           │ pass         │ block        │ escalate
           ▼              ▼              ▼
     ┌──────────┐  ┌────────────┐  ┌──────────┐
     │ SEND     │  │ SAFE FALL  │  │ HUMAN    │
     │ to user  │  │ + AUDIT    │  │ REVIEW   │
     └──────────┘  │ + ALERT    │  │ (132)    │
                   └────────────┘  └──────────┘
```

```
mya: redactSensitiveText + threat-scan sẵn — thiếu toxicity classifier + policy gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/redact.ts — redactSensitiveText (PII email/phone/cred — sẵn!)
// ✅ packages/core/src/threat-scan.ts — threat scanning (pattern-based)
// ✅ packages/secrets — makeSecretRedactor (scrub before audit)
// ✅ packages/gateway/src/channel-adapters.ts — channel output path (hook point)
// ✅ 198 audit trails — log moderation decision
// ✅ 168 guardrails (FL) — action-level guard (đã document)

// ❌ THIẾU: toxicity classifier (Perspective / Llama Guard / OpenAI Moderation)
// ❌ THIẾU: moderation policy config (deny-topics, thresholds, PII strict)
// ❌ THIẾU: output rail gateway hook (chặn mọi response trước user)
// ❌ THIẾU: safe-fallback response template
```

## Implementation

```typescript
// packages/gateway/src/moderation.ts (NEW)
interface ModerationResult {
  decision: "pass" | "block" | "redact" | "escalate";
  scores: Record<string, number>;   // { hate: 0.02, threat: 0.91, ... }
  reason?: string;
  cleaned?: string;                 // redacted/blocked-safe version
}

class OutputModerator {
  constructor(
    private classifier: ToxicityClassifier,  // Perspective / Llama Guard
    private policy: ModerationPolicy,
    private audit: AuditLog,
  ) {}

  async moderate(text: string): Promise<ModerationResult> {
    // ① PII sweep (reuse existing redact.ts)
    const clean = redactSensitiveText(text, { force: this.policy.piiStrict });

    // ② toxicity classify
    const scores = await this.classifier.score(clean);

    // ③ policy thresholds
    for (const [cat, val] of Object.entries(scores)) {
      const limit = this.policy.thresholds[cat] ?? 0.8;
      if (val > limit) {
        this.audit.append({ type: "moderation.block", cat, score: val, text: clean.slice(0, 200) });
        return { decision: "block", scores, reason: `${cat}=${val}>${limit}`, cleaned: this.policy.safeFallback };
      }
    }
    return { decision: "pass", scores, cleaned: clean };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn toxic/harmful content (OpenAI Moderation, Llama Guard) | ❌ Latency thêm (classifier call mỗi response) |
| ✅ PII không rò rỉ (nối 214 HF) | ❌ False positive (block nội dung hợp lệ) |
| ✅ Policy-driven — áp dụng gateway-level (Bedrock) | ❌ Cost (classifier API per-request) |
| ✅ Audit mọi moderation action (198) | ❌ Bypass: agent viết code sinh content xấu |
| ✅ redact.ts + threat-scan sẵn (1 phần) | ❌ Tuning thresholds per-domain |

## Khác các hướng gần

| | 214 PII Redaction (HF) | 168 Guardrails (FL) | IA: Output Moderation |
|---|---|---|---|
| Mục | Lọc *thông tin cá nhân* | Chặn *hành động/tool* | **Moderate *nội dung*** |
| Giai đoạn | Input + Output | Action (before exec) | **Output (before user)** |
| Detect | Regex/NER | Policy/perms | **Classifier + policy** |

## Khi nào chọn

- Agent trả response trực tiếp cho end-user (chat, email, report)
- Cần tuân thủ content policy (toxicity, hate, violence, self-harm)
- PII strict mode (GDPR/CCPA — nối 214 HF)
- Multi-tenant — mỗi tenant policy khác nhau (141)
