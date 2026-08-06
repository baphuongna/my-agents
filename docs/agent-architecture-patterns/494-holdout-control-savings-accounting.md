# Hướng RZ: Holdout-Control Savings Accounting — giữ 10% hội thoại đối chứng, báo savings có tin cậy

> **Nguồn gốc:** headroom (context-compression savings measurement); "holdout control sample for compression accounting"; "measured savings with confidence interval"; "A/B control vs compressed"; "savings accounting accuracy"
> **Coupling:** 🟢 — thêm holdout sampler + savings counter quanh compressor (không đổi logic nén)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai compressor + budget tracker sẵn — chưa có holdout control + confidence report)
> **Effort:** 1-2 tuần

## Nguồn gốc

**headroom** yêu cầu **savings accounting trung thực**: khi báo "compressor tiết kiệm 72% token", phải **đo** chứ không ước lượng — và đo phải có **đối chứng (control)**. Cách: giữ **holdout 10%** hội thoại **không nén** (control sample), nén 90% còn lại (treatment), so sánh token thực của 2 nhóm → **savings measured** kèm **khoảng tin cậy (confidence)**. Nguyên tắc: **số savings chỉ đáng tin nếu có control** — không có holdout thì không phân biệt được "tiết kiệm do nén" vs "tiết kiệm do input tự ngắn". Khác **100 prompt-compression** (nén tất cả, không đối chứng) — RZ **giữ control để đo chính xác**; khác budget tracker đếm token tổng — RZ **so control vs treatment**.

## Mô tả

mya holdout-control savings accounting: (1) **Holdout sampler**: mỗi session, random **10% turn/segment** → flag `control=true` (KHÔNG nén), 90% còn lại `control=false` (nén bình thường). (2) **Token counter**: đếm token trước/sau nén **riêng** 2 nhóm (control giữ nguyên token, treatment giảm token). (3) **Savings measured**: `savings = (treatmentBefore - treatmentAfter) / treatmentBefore`. (4) **Confidence**: vì có control, so sánh `controlAfter` vs `controlBefore` ≈ 0 (control không đổi) → **validate** đo đúng; nếu control lệch → đo sai (input đổi). (5) **Report**: savings % + sample size (n) + confidence (control khớp → high confidence). mya có compressor + budget tracker — RZ thêm **holdout sampler** (10% flag) + **per-group counter** + **confidence validator**.

## Kiến trúc

```
  SESSION TURNS (100%):
  ┌─────────────────────────────────────────────────────┐
  │  turn 1 [control=true]  → KHÔNG nén (giữ nguyên)     │  ┐
  │  turn 2 [control=false] → nén (treatment)            │  │ 10% control
  │  turn 3 [control=false] → nén (treatment)            │  │ 90% treatment
  │  turn 4 [control=true]  → KHÔNG nén (control)         │  │
  │  ...                                                  │  │
  └───────────────┬───────────────────┬──────────────────┘
                  │                   │
        ┌─────────▼───────┐  ┌────────▼─────────────────┐
        │ CONTROL (10%)    │  │ TREATMENT (90%)           │
        │  countBefore=820 │  │  countBefore=9100         │
        │  countAfter=820  │  │  countAfter=2500          │
        │  (≈0 change ✓)   │  │  savings=(9100-2500)/9100 │
        │                   │  │       = 72.5%              │
        └─────────┬───────┘  └────────┬─────────────────┘
                  │                   │
                  └────────┬──────────┘
                           ▼
  ┌─── REPORT (confidence) ────────────────────────────┐
  │  savings = 72.5%  |  n = 90 turns  |  control 0%    │
  │  control khớp (≈0 change) → HIGH CONFIDENCE ✓        │
  │  (nếu control lệch nhiều → đo sai, LOW CONFIDENCE)  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — compressor (nền — RZ đo quanh nó)
// ✅ budget tracker — token counting (nền — RZ per-group counter)
// ✅ 100 prompt-compression — nén (nền — RZ thêm control)

// ❌ THIẾU: holdout sampler (10% flag control=true, random)
// ❌ THIẾU: per-group token counter (control vs treatment riêng)
// ❌ THIẾU: confidence validator (control change ≈ 0 → high confidence)
// ❌ THIẾU: savings report (savings % + n + confidence level)
```

## Implementation

```typescript
// packages/ai/src/savings-accounting.ts (MỚI)
interface Turn { id: string; text: string; tokens: number; control: boolean }

class SavingsAccounting {
  private control = { before: 0, after: 0, n: 0 };
  private treatment = { before: 0, after: 0, n: 0 };

  // holdout sampler: 10% → control (random, deterministic-by-seed)
  isControl(turnId: string, holdoutRate = 0.1): boolean {
    const h = hashStr(turnId); // 0..1 deterministic
    return (h % 1000) / 1000 < holdoutRate;
  }

  // đếm per-group (control giữ nguyên, treatment nén)
  record(turn: Turn, afterTokens: number): void {
    const g = turn.control ? this.control : this.treatment;
    g.before += turn.tokens;
    g.after += afterTokens;
    g.n++;
  }

  // savings measured + confidence
  report(): { savingsPct: number; n: number; confidence: 'high' | 'low' } {
    if (this.treatment.before === 0) return { savingsPct: 0, n: 0, confidence: 'low' };
    const savings = (this.treatment.before - this.treatment.after) / this.treatment.before;
    // confidence: control phải ≈ 0 change (không đổi → đo đúng)
    const controlChange = this.control.before > 0
      ? Math.abs(this.control.before - this.control.after) / this.control.before : 0;
    const confidence = controlChange < 0.02 && this.treatment.n >= 30 ? 'high' : 'low';
    return { savingsPct: Math.round(savings * 1000) / 10, n: this.treatment.n, confidence };
  }
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Usage:
// const isCtrl = acct.isControl(turn.id);            // 10% control
// const after = isCtrl ? turn.tokens : compressedTokens;
// acct.record({ ...turn, control: isCtrl }, after);
// const r = acct.report();  // { savingsPct: 72.5, n: 90, confidence: 'high' }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Savings trung thực (có control → đo đúng, không ước lượng) | ❌ 10% không nén (token dư 10% so với nén hết) |
| ✅ Confidence level (control khớp → trust số liệu) | ❌ Sample size nhỏ (n<30 → low confidence) |
| ✅ Phát hiện đo sai (control lệch → cảnh báo) | ❌ Overhead đếm per-group (control + treatment) |
| ✅ Phối 100 compression (measurement layer) | ❌ Random control (cần seed deterministic để reproducible) |

## Khác các hướng gần

| | Budget Tracker | 100 Prompt-Compression | RZ: Holdout-Control |
|---|---|---|---|
| Đo gì | Token tổng | Nén tất cả | **Control vs treatment** |
| Đối chứng | ❌ | ❌ | **✅ 10% holdout** |
| Confidence | ❌ | ❌ | **✅ (control ≈ 0 → trust)** |

## Khi nào chọn

- Cần báo savings chính xác (SLA / cost — số phải đáng tin)
- Muốn validate compressor thật sự tiết kiệm (không self-deception)
- Chấp nhận 10% không nén làm control
- Nối packages/ai (compressor) + budget tracker (token count) + 100 compression; guard holdout rate (10% đủ mẫu) + confidence validator (control change < 2% → high) + sample size (n≥30 mới tin); deterministic seed (reproducible control sample)
