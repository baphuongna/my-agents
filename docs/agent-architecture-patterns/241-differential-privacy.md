# Hướng IG: Differential Privacy — nhiễu + budget riêng tư

> **Nguồn gốc:** Dwork "Differential Privacy" (2006, Calibrating Noise); Dwork & Roth "Algorithmic Foundations of DP"; Google/Federated Learning DP; "Private Fine-tuning of LLMs" (Yu et al. 2022, Opacus)
> **Coupling:** 🔴 — DP noise ảnh hưởng mọi data read/write trong pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (redact 214 + audit 198 sẵn — thiếu DP noise mechanism + budget tracker)
> **Effort:** 4-6 tuần

## Nguồn gốc

Differential privacy (Dwork 2006) — khái niệm hình thức về quyền riêng tư: query dataset → thêm **nhiễu có tính toán** (Laplace/Gaussian) sao cho output "gần như không đổi" dù 1 người có hay không có trong dataset. Tham số **ε (epsilon)** — privacy budget: nhỏ = riêng tư hơn (nhiễu nhiều = chính xác ít), lớn = chính xác hơn (riêu tư ít). **Composition**: mỗi query tiêu tốn budget — dùng hết → không query thêm được (privacy exhaustion). Trong LLM: **private fine-tuning** (Yu et al. 2022, Opacus) — thêm DP-SGD noise vào gradient khi fine-tune → model không memorize training data. Cho agent memory: thêm noise khi truy vấn memory → không rò rỉ fact cá nhân của user khác.

Khác **214 PII-redaction** (HF — *xóa* PII trước khi dùng) — IG *thêm nhiễu* để output không leak dù vẫn chứa data. Khác **155 right-to-be-forgotten** (xóa data) — IG *bảo vệ* data khi vẫn cần dùng. Nối **193 multi-tenant-isolation** (multi-user privacy), **240 data-lineage** (IF — track budget usage), **201 fine-tuning** (DP-SGD).

## Mô tả

mya differential privacy: khi agent truy vấn memory/RAG chứa data nhiều user → thêm **noise** (Laplace/Gaussian) vào kết quả → không rò rỉ chính xác fact của bất kỳ user nào. Track **ε budget** — mỗi query tiêu tốn, hết budget → từ chối hoặc tăng noise (utility giảm). mya đã có PII redaction (214) — IG bổ sung cho trường hợp *cần data nhưng phải mờ hoá*. DP-SGD cho fine-tuning (201) — thêm gradient noise. Khó: DP **cơ bản làm giảm utility** — phải cân bằng privacy vs accuracy.

## Kiến trúc

```
  QUERY: "summarize usage patterns across all tenants"
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  DP MECHANISM (Laplace / Gaussian noise)      │
  │                                               │
  │  true result: 42 (exact — leak!)              │
  │  + noise(Laplace, scale=1/ε) = 42 + 1.3       │
  │  released: 43.3 (≈ true — no single-user leak)│
  │                                               │
  │  ε BUDGET TRACKER:                            │
  │   · initial: ε = 1.0                          │
  │   · this query: cost = 0.1                    │
  │   · remaining: 0.9                            │
  │   · when ε → 0: refuse or max-noise           │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────┐
  │  GUARANTEE (Dwork 2006):                      │
  │  output ≈ same whether any single user's data │
  │  is in or out → no individual leak            │
  └──────────────────────────────────────────────┘
```

```
mya: redact 214 + multi-tenant 193 sẵn — thiếu DP noise mechanism + ε budget tracker
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/redact.ts — PII redaction (xóa data — khác DP noise)
// ✅ 214 pii-redaction (HF) — strip sensitive data (documented)
// ✅ 193 multi-tenant-isolation — tenant separation (privacy boundary)
// ✅ 198 audit trails — log queries (track budget usage)
// ✅ 201 fine-tuning-custom-models — DP-SGD candidate (gradient noise)

// ❌ THIẾU: DP noise mechanism (Laplace/Gaussian — calibrated to ε)
// ❌ THIẾU: ε privacy budget tracker (composition — accumulate cost)
// ❌ THIẾU: DP-SGD in fine-tuning loop (Opacus-style gradient noise)
// ❌ THIẾU: utility/privacy trade-off config (per-query ε allocation)
```

## Implementation

```typescript
// packages/core/src/differential-privacy.ts (NEW)
class PrivacyBudget {
  private spent = 0;
  constructor(private epsilon: number) {}   // total ε budget

  remaining(): number { return this.epsilon - this.spent; }

  charge(cost: number): boolean {
    if (this.spent + cost > this.epsilon) return false; // budget exhausted
    this.spent += cost;
    return true;
  }
}

class DPQuery {
  constructor(private budget: PrivacyBudget) {}

  // Laplace mechanism: true_value + Laplace(0, sensitivity/ε)
  numericQuery(trueValue: number, sensitivity: number, epsilon: number): number | null {
    if (!this.budget.charge(epsilon)) return null; // privacy exhausted → refuse
    const scale = sensitivity / epsilon;
    const noise = laplaceSample(0, scale);
    return trueValue + noise; // noisy — no single-record leak
  }

  // For text/retrieval: add noise to embedding similarity (top-k with noise)
  privateRetrieval(query: Embedding, corpus: Embedding[], epsilon: number): number[] {
    if (!this.budget.charge(epsilon)) return [];
    const scores = corpus.map((c, i) => ({ i, s: cosine(query, c) + gaussianNoise(1 / epsilon) }));
    return scores.sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.i);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bảo vệ hình thức — no single-user leak (Dwork 2006) | ❌ Utility giảm (nhiễu → kém chính xác) |
| ✅ Budget-bounded (ε exhaustion → tự dừng) | ❌ ε tuning khó (privacy vs accuracy trade-off) |
| ✅ DP-SGD fine-tuning — model không memorize (Yu 2022) | ❌ DP-SGD chậm + tốn memory (per-sample gradient) |
| ✅ Multi-tenant privacy (nối 193) | ❌ Complexity cao (4-6 tuần) |

## Khác các hướng gần

| | 214 PII Redaction (HF) | 155 Right-to-be-Forgotten | IG: Differential Privacy |
|---|---|---|---|
| Cách | Xóa PII | Xóa data hồn | **Thêm nhiễu (vẫn dùng data)** |
| Khi | Trước khi gửi LLM | On request | **Mỗi query (budget)** |
| Guarantee | Không có PII | Data biến mất | **No single-record leak** |

## Khi nào chọn

- Multi-tenant — query aggregate qua data nhiều user (193)
- Compliance nghiêm ngặt — cần *hình thức* privacy guarantee (không chỉ redaction)
- Fine-tuning trên data nhạy cảm — DP-SGD chống memorize (201)
- OK với utility trade-off (kém chính xác đổi lấy privacy)
