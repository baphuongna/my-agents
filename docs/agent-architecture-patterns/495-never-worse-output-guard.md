# Hướng SA: Never-Worse Output Guard — filter xong token lớn hơn thì trả nguyên vẹn

> **Nguồn gốc:** rtk (output filter / compression guard); "never-worse guarantee"; "if filtered output larger than input, return original"; "compression pessimization guard"; "noop-on-bloat filter"
> **Coupling:** 🟢 — thêm guard layer sau filter/compress (so token before vs after → fallback)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai compressor sẵn — chưa có pessimization guard + fallback)
> **Effort:** 0.5-1 tuần

## Nguồn gốc

**rtk** định nghĩa **never-worse guarantee** cho output filter/compressor: sau khi lọc/nén, nếu kết quả **lớn hơn (hoặc bằng)** input gốc → **bỏ qua** (return original) thay vì trả bản "nén" phình to hơn. Lý do: một số filter (escape, wrapping, thêm marker, JSON-encode) **tăng token** thay vì giảm — trả bản phình là **tệ hơn** không làm gì. Nguyên tắc: **filter chỉ có giá trị khi nó giảm token** — nếu tăng → noop (trả nguyên) là tối ưu. Khác **100 prompt-compression** (giả định luôn giảm) — SA **kiểm tra + fallback**; khác **494 savings accounting** (đo tổng) — SA là **per-call guard** (mỗi lần filter).

## Mô tả

mya never-worse output guard: (1) **Before count**: đếm token input gốc (trước filter). (2) **Filter/compress**: áp dụng filter (escape/wrap/prune/summarize). (3) **After count**: đếm token kết quả. (4) **Guard check**: nếu `after >= before` → **return original** (noop — filter làm tệ hơn, bỏ); nếu `after < before` → return bản nén. (5) **Telemetry**: ghi nhận bao nhiêu lần filter bị noop (pessimization rate) → nếu cao → filter tệ, cần điều chỉnh. mya có compressor — SA thêm **before/after count + fallback** (1 lớp mỏng, bọc mọi filter).

## Kiến trúc

```
  INPUT (output cần filter/compress)
        │
        ▼
  ┌─── COUNT BEFORE ────────────────────────────────────┐
  │  before = countTokens(input)  (ví dụ 340 tok)        │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── FILTER / COMPRESS ───────────────────────────────┐
  │  apply filter (escape/wrap/prune/summarize)          │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── COUNT AFTER ─────────────────────────────────────┐
  │  after = countTokens(filtered)  (ví dụ 420 tok)      │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── GUARD CHECK ─────────────────────────────────────┐
  │  after >= before?  (420 >= 340 → CÓ, filter phình)   │
  │    YES → RETURN ORIGINAL (noop, không tệ hơn) ───────┼──► output = input (340 tok)
  │    NO  → return filtered (giảm token) ───────────────┼──► output = filtered
  └──────────────────────────────────────────────────────┘
  telemetry: pessimization rate (bao nhiêu % filter bị noop)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — compressor (nền — SA bọc guard quanh nó)
// ✅ budget tracker — token counting (nền — SA before/after count)
// ✅ 100 prompt-compression — filter (nền — SA = guard trên filter)

// ❌ THIẾU: pessimization guard (after >= before → fallback original)
// ❌ THIẾU: per-call noop telemetry (pessimization rate)
// ❌ THIẾU: guard wrapper (bọc MỌI filter uniform)
```

## Implementation

```typescript
// packages/ai/src/never-worse-guard.ts (MỚI)
type Filter<T = string> = (input: T) => T;

class NeverWorseGuard {
  private noopCount = 0;
  private totalCalls = 0;

  constructor(private countTokens: (s: string) => number) {}

  // bọc filter: nếu kết quả lớn hơn → return input (noop)
  guard<T extends string>(input: T, filter: Filter<T>): T {
    this.totalCalls++;
    const before = this.countTokens(input);
    const filtered = filter(input);
    const after = this.countTokens(filtered);
    if (after >= before) {
      this.noopCount++; // filter làm tệ hơn → bỏ
      return input; // never-worse: trả nguyên vẹn
    }
    return filtered;
  }

  // pessimization rate (filter bị noop bao nhiêu %)
  pessimizationRate(): number {
    return this.totalCalls === 0 ? 0 : this.noopCount / this.totalCalls;
  }
}

// Usage:
// const safe = guard.guard(rawOutput, escapeAndWrap);
// // nếu escape phình token → safe = rawOutput (noop); nếu giảm → safe = filtered
// if (guard.pessimizationRate() > 0.3) → filter tệ, cần xem lại
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Never-worse (filter tệ → noop, không bao giờ tệ hơn) | ❌ Overhead đếm token before/after mỗi call |
| ✅ Phát hiện filter tệ (pessimization rate cao → alert) | ❌ Edge: after = before (bằng) → noop (có thể muốn bỏ cũng OK) |
| ✅ Wrapper uniform (bọc mọi filter) | ❌ Chỉ so token count (không so ngữ nghĩa — có thể mất ý dù giảm token) |
| ✅ Phối 100 compression (safety layer) | ❌ Filter tăng nhẹ (<5%) cũng noop (có thể chấp nhận nhỏ) |

## Khác các hướng gần

| | 100 Prompt-Compression | 494 Savings-Accounting | SA: Never-Worse |
|---|---|---|---|
| Cái gì | Nén (giả định giảm) | Đo savings tổng | **Per-call guard (fallback)** |
| Khi filter phình | Vẫn trả bản phình | Không phát hiện | **Return original (noop)** |
| Granularity | Batch | Session | **Mỗi lần filter** |

## Khi nào chọn

- Filter/compressor đôi khi phình token (escape/wrap/JSON-encode)
- Muốn never-worse guarantee (không bao giờ tệ hơn không làm gì)
- Muốn telemetry phát hiện filter tệ (pessimization rate)
- Nối packages/ai (compressor) + budget tracker (token count) + 100 compression; guard count accuracy (đếm before/after đúng) + threshold (after >= before, hoặc after > before*1.05 nếu chấp nhận nhẹ) + telemetry (rate cao → alert); bọc MỌI filter uniform (không quên guard cái nào)
