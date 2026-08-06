# Hướng LV: Synthetic Data Quality — validation + bias/coverage check cho synthetic data

> **Nguồn gốc:** Synthetic data generation (CTGAN, GAN-based, LLM-generated); "synthetic data fidelity"; distribution matching (KL divergence, KS test); "fidelity-diversity-utility" framework; bias detection; data augmentation quality
> **Coupling:** 🟡 — cần quality validator layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (eval framework sẵn — chưa có synthetic data validator)
> **Effort:** 1.5-2.5 tuần

## Nguồn gốc

**Synthetic data** (CTGAN, GAN, LLM-generated): tạo data giả để train/eval khi data thật khan hiếm hoặc nhạy cảm (PII). Nhưng synthetic data có rủi ro: **distribution mismatch** (không giống real), **bias** (thừa nhóm, thiếu nhóm), **low diversity** (lặp mẫu), **low utility** (không học được gì). Framework "fidelity-diversity-utility" (fidelity: giống real; diversity: đa dạng; utility: hữu ích cho downstream task). Distribution matching: KS test, KL divergence — đo synthetic vs real. Bias detection: demographic parity, coverage metric. Nguyên tắc: **không tin synthetic data mù quáng** — validate trước khi dùng.

## Mô tả

mya synthetic data quality: khi tạo eval corpus / training data bằng LLM hoặc GAN, chạy qua **quality gate** — kiểm fidelity (giống real distribution không), diversity (đa dạng không lặp), bias (cân bằng nhóm không), coverage (phủ đủ edge case không). Nếu quality thấp → tái sinh hoặc bỏ. Nối 333 data-versioning — mỗi synthetic dataset version có quality score. Khác 305 security-eval (security) — LV kiểm **data quality**; khác 334 (self) — LV cũng là 334.

## Kiến trúc

```
  SYNTHETIC DATA GENERATOR (LLM/GAN)
        │
        ▼
  ┌─── QUALITY GATE ───────────────────────┐
  │                                       │
  │  1. FIDELITY: KS-test vs real dist     │
  │     synthetic ≈ real? (p > 0.05)       │
  │                                       │
  │  2. DIVERSITY: unique ratio            │
  │     < 70% unique → LOW (lặp mẫu)       │
  │                                       │
  │  3. BIAS: group coverage               │
  │     group A: 80%, group B: 2% → SKEW   │
  │                                       │
  │  4. UTILITY: downstream eval score     │
  │     train on synthetic → test real     │
  │     score < threshold → LOW UTILITY    │
  │           │                           │
  │    ┌─────┴─────┐                      │
  │    │ PASS       │ FAIL → tái sinh/bỏ  │
  │    └─────┬─────┘                      │
  └──────────┼────────────────────────────┘
             ▼
  DATASET@v3 (quality: 0.87) → dùng cho eval/training
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 299 regression-gates-CI — eval gate (nền — cần quality check)
// ✅ 333 LU data-versioning — version dataset (quality per version)
// ✅ 283 data-classification — classify data (bias detection input)
// ✅ 305 security-eval-suite — eval (nền)

// ❌ THIẾU: fidelity check (distribution matching vs real)
// ❌ THIẾU: diversity metric (unique ratio)
// ❌ THIẾU: bias detection (group coverage/parity)
// ❌ THIẾU: utility validation (train-synthetic-test-real)
```

## Implementation

```typescript
// packages/data/src/synthetic-quality.ts (NEW)
interface QualityReport {
  fidelity: number;    // 0-1 — KS test p-value
  diversity: number;   // 0-1 — unique ratio
  bias: { group: string; coverage: number }[];
  utility: number;     // 0-1 — downstream eval score
  overall: number;     // weighted composite
}

class SyntheticDataValidator {
  constructor(private weights = { fidelity: 0.3, diversity: 0.2, bias: 0.2, utility: 0.3 }) {}

  validate(synthetic: unknown[], real: unknown[], groups: Record<string, unknown[]>): QualityReport {
    const fidelity = this.ksTest(synthetic, real);
    const diversity = this.uniqueRatio(synthetic);
    const bias = this.groupCoverage(synthetic, groups);
    const utility = this.utilityScore(synthetic, real);
    const biasScore = bias.length > 0
      ? 1 - Math.max(...bias.map(b => Math.abs(0.5 - b.coverage) * 2)) : 1;
    const overall =
      fidelity * this.weights.fidelity +
      diversity * this.weights.diversity +
      biasScore * this.weights.bias +
      utility * this.weights.utility;
    return { fidelity, diversity, bias, utility, overall };
  }

  // KS test approximation — distribution matching
  private ksTest(synthetic: unknown[], real: unknown[]): number {
    const sKeys = new Set(synthetic.map(x => JSON.stringify(x)));
    const rKeys = new Set(real.map(x => JSON.stringify(x)));
    const overlap = [...sKeys].filter(k => rKeys.has(k)).length / Math.max(sKeys.size, 1);
    return overlap; // simplified — real KS test uses CDF comparison
  }

  private uniqueRatio(data: unknown[]): number {
    const unique = new Set(data.map(x => JSON.stringify(x))).size;
    return unique / data.length;
  }

  private groupCoverage(data: unknown[], groups: Record<string, unknown[]>): { group: string; coverage: number }[] {
    const total = data.length;
    return Object.entries(groups).map(([g, members]) => ({
      group: g,
      coverage: members.length / total,
    }));
  }

  private utilityScore(_synthetic: unknown[], _real: unknown[]): number {
    return 0.85; // placeholder — train on synthetic, eval on real
  }
}

// Gate: if quality.overall < 0.7 → reject synthetic batch
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không tin synthetic data mù (fidelity-diversity-utility) | ❌ Reference real data cần (KS test) |
| ✅ Phát bias trước khi train/eval (parity) | ❌ Quality metric approximate (KS simplified) |
| ✅ Coverage đảm bảo (đủ edge case) | ❌ Utility test tốn compute (train-test) |
| ✅ Nối 333 versioning → quality per version | ❌ Bias detection chỉ tốt khi group label có |

## Khác các hướng gần

| | 305 Security Eval | 333 Data Versioning | LV: Synthetic Data Quality |
|---|---|---|---|
| Kiểm gì | Security vuln | Dataset version | **Synthetic data quality** |
| Metrics | Redteam/fuzz | Hash/lineage | **Fidelity/diversity/bias** |
| Bias? | ❌ | ❌ | ✅ |
| Gate | Security | Reproduce | **Quality > threshold** |

## Khi nào chọn

- Tạo eval corpus/training data bằng LLM hoặc GAN
- Cần đảm bảo synthetic data representative (không bias)
- Muốn quality gate trước khi dùng synthetic data
- Kết hợp 333 versioning (quality per version) + 283 classification (bias group label)
