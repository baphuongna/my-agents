# Hướng DDDDDDD: Multi-Criteria Decision — agent chọn phương án bằng TOPSIS/khung tiêu chí

> **Nguồn gốc:** arXiv 2601.22433 "When LLM meets Fuzzy-TOPSIS" (LLM + MCDM); TOPSIS (Hwang & Yoon 1981 — ScienceDirect); Nature s41598-026 "Multi-criteria consensus group decision making" (prospect-regret TOPSIS); MetricGate TOPSIS calculator
> **Coupling:** 🟢 — thêm lớp quyết định, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cost/effort/risk data sẵn; thiếu MCDM engine)
> **Effort:** 1 tuần

## Nguồn gốc

Multi-criteria decision: **chọn phương án tối ưu khi nhiều tiêu chí xung đột (chi phí vs chất lượng vs thời gian)** — TOPSIS (Hwang-Yoon): "evaluates alternatives based on geometric closeness to ideal and nadir points" — chuẩn: normal hóa → trọng số → khoảng cách tới lý tưởng → rank; arXiv 2601.22433: LLM + Fuzzy-TOPSIS kết hợp "multicriteria decision-making (MCDM) theory to develop LLM-TOPSIS" — LLM định lượng tiêu chí mơ hồ (chất lượng, rủi ro) rồi TOPSIS rank; Nature 2026: group decision + prospect theory — chọn theo kỳ vọng/luyến tiếc. Điểm khác **RR routing** (chọn agent/tool theo rule) và **AAAAAA arena** (chọn config bằng Elo) — DDDDDDD *chọn theo khung tiêu chí tường minh*: khi agent phải chọn giữa N phương án (model, tool, chiến lược, thứ tự thực thi): khai báo tiêu chí (cost XXXXX, chất lượng PP, effort, rủi ro, thời gian) + trọng số → điểm mỗi phương án (LLM chấm từng tiêu chí — chuẩn hóa) → TOPSIS rank → chọn #1 (+ giải thích TTTT). Nối XXXXX (cost criterion), PP (quality), TTTT (giải thích lựa chọn), WW (policy — tiêu chí bắt buộc), EEEEEE (group decision — nhiều agent mỗi agent chấm tiêu chí riêng).

## Mô tả

mya MCDM: (1) **khai báo bài toán** — alternatives (N phương án) + criteria (chi phí, chất lượng, rủi ro, tốc độ, carbon NNNNNN...); (2) **trọng số** — theo task/ngữ cảnh (task quan trọng → quality nặng; budget eo → cost nặng — từ WW policy/config); (3) **ma trận đánh giá** — LLM chấm mỗi alternative trên từng tiêu chí (chuẩn hóa cùng thang — arXiv Fuzzy-TOPSIS cho tiêu chí mơ hồ); dữ liệu cứng (cost/thời gian) lấy từ meter thật (XXXXX) không đoán; (4) **TOPSIS rank** — ideal (tốt nhất mọi tiêu chí) vs nadir (tệ nhất) → khoảng cách → điểm closeness → xếp hạng; (5) **chọn + giải thích** — chọn #1, kèm lý do (TTTT: đạt tiêu chí nào, hy sinh tiêu chí nào); (6) **nhạy cảm** — đổi trọng số có đổi kết quả không (sensitivity — trọng số sai → quyết định sai): báo nếu 2 phương án sát nhau (ngang điểm — cần thêm tiêu chí/người).

## Kiến trúc

```
  BÀI TOÁN: alternatives (N) + criteria (cost/quality/risk/time/carbon) + weights
        │
        ▼
  MA TRẬN: LLM chấm tiêu chí mơ hồ (Fuzzy-TOPSIS — arXiv) + dữ liệu cứng
        │  cost/time từ meter thật (XXXXX) — không đoán
        ▼
  TOPSIS: normal hóa → closeness (ideal vs nadir — Hwang-Yoon) → rank
        │
        ▼
  CHỌN #1 + GIẢI THÍCH (TTTT — đạt gì, hy sinh gì)
        │
        ▼
  NHẠY CẢM: đổi trọng số đổi kết quả? · ngang điểm → thêm tiêu chí/người (EEEEEE)
```

```
mya: XXXXX + PP + TTTT SẸN — thiếu: MCDM engine (ma trận + TOPSIS rank)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ XXXXX finops — cost data (tiêu chí cứng)
// ✅ PP eval — chất lượng data (tiêu chí)
// ✅ TTTT explainable — giải thích lựa chọn
// ✅ WW policy — trọng số theo task
// ✅ NNNNNN carbon — tiêu chí carbon
// ✅ EEEEEE consensus — group decision (mỗi agent 1 tiêu chí)

// ❌ THIẾU: MCDM engine (ma trận + TOPSIS)
// ❌ THIẾU: sensitivity check
// ❌ THIẾU: LLM scoring chuẩn hóa (Fuzzy)
```

## Implementation

```typescript
// packages/mcdm/src/topsis.ts (NEW)
export function topsis(matrix: number[][], weights: number[], benefit: boolean[]): number[] {
  const norm = normalize(matrix);                       // chuẩn hóa
  const ideal = norm.map((c, j) => benefit[j] ? max(c) : min(c)); // lý tưởng
  const nadir = norm.map((c, j) => benefit[j] ? min(c) : max(c));
  return norm.map(a => {
    const dI = distance(a, ideal, weights);             // gần lý tưởng
    const dN = distance(a, nadir, weights);             // xa nadir
    return dN / (dI + dN);                              // closeness → rank
  });
}
// LLM chấm tiêu chí mơ hồ (arXiv 2601.22433) · cứng từ meter (XXXXX)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Quyết định có khung — không "đoán" giữa các tiêu chí | ❌ Khai báo tiêu chí/trọng số — cần công sức đầu |
| ✅ TOPSIS minh bạch (khoảng cách — giải thích được TTTT) | ❐ LLM chấm tiêu chí mơ hồ có thể lệch (Fuzzy giảm) |
| ✅ Dữ liệu cứng từ meter thật — không bịa | ❌ Ngang điểm — cần thêm chiều/người |
| ✅ Xây trên XXXXX + PP + TTTT | ❌ Task đơn giản — MCDM quá tay |

## Khác các hướng gần

| | RR Routing | AAAAAA Arena | DDDDDDD: MCDM |
|---|---|---|---|
| Cơ chế | Rule/tag | Elo A/B | **Tiêu chí + trọng số + TOPSIS** |
| Dùng khi | Route quen | So config | **Nhiều tiêu chí xung đột** |
| Quan hệ | Đơn giản | 1 tiêu chí (thắng thua) | **Tổng quát hơn cả 2** |

## Khi nào chọn

- Chọn giữa N phương án với tiêu chí xung đột (rẻ vs tốt vs nhanh)
- Quyết định đáng tiền — cần khung + giải thích (TTTT)
- Đã có XXXXX + PP + TTTT — thêm MCDM engine + sensitivity
- Nhóm nhiều agent cùng chấm (EEEEEE + MCDM group)