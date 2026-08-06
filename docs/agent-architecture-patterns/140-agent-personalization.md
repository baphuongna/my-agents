# Hướng EJ: Agent Personalization — agent thích nghi theo người dùng qua memory preference

> **Nguồn gốc:** AdaPA-Agent (NeurIPS 2025, Adaptive Preference Arithmetic); arXiv 2409.11192 "Long-Term Memory for Personal AI Systems"; mem0/memVerge "AI Personalization Memory"; Playlab Adaptive Memory
> **Coupling:** 🟢 — thêm lớp preference, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory 3-tier + corrections IIIII + profile sẵn; thiếu preference store + adaptive)
> **Effort:** 1-2 tuần

## Nguồn gốc

Agent personalization: **agent lưu preference/interest/needs của người dùng, thích nghi theo thời gian** — AdaPA-Agent (NeurIPS 2025): "models dynamic preference strengths via Adaptive Preference Arithmetic — memory enables learning and personalization"; arXiv 2409.11192: "integrating long-term memory in personal AI systems significantly enhances functionality — continuously learn from user"; mem0: "customizable memory layers" — ChatGPT/Gemini memory; memVerge: "systems retain user context, preferences, interaction history — evolve from reactive tools toward personalized". Điểm khác **IIIII corrections** (học từ chỉnh sửa — hành động cụ thể) và **MM memory** (3-tier — lưu sự kiện) — KKKKKK *học sở thích*: user nói "tôi thích X / làm theo cách Y" + hành vi lặp lại → preference store có thứ bậc (yếu→mạnh — adaptive arithmetic AdaPA); agent áp preference vào output/tool lựa chọn (format, style, mức độ chi tiết, tool ưu tiên). Nối MM (memory — nguồn sự kiện), IIIII (corrections — học từ sửa), TTTT (giải thích khi áp preference), WW (policy — preference không vượt quyền).

## Mô tả

mya personalization: (1) **preference store** — user khai báo + học từ hành vi (MM event log): thích, không thích, cách làm, level quota (lazy→eager); (2) **adaptive strength** — AdaPA: preference có trọng số thay đổi theo tần suất/khớp (nhất quán với bằng chứng), xác nhận lại định kỳ (stale preference cần hỏi lại); (3) **áp dụng** — trước mỗi task: inject preference phù hợp vào context (format output, độ dài, tool ưu tiên, anpha rủi ro) — không inject hết (RRRR context); (4) **giải thích** — khi áp dụng "anh từng chọn dạng này (TTTT)" — tăng tin cậy; (5) **hết hạn độ** — preference cũ/không còn đúng → hỏi lại/loại bỏ (chống overfit 1 người); (6) **quyền** — preference chỉ ảnh hưởng trong giới hạn policy WW (không ép agent làm việc sai an toàn/đạo đức).

## Kiến trúc

```
  NGUỒN: user khai báo + hành vi lặp (MM event log) + corrections (IIIII)
        │
        ▼
  PREFERENCE STORE (thích/không/cách làm) + STRENGTH (AdaPA adaptive weight)
        │
        ▼
  ÁP DỤNG trước task: inject preference phù hợp (không hết — RRRR context)
        │  format · độ dài · tool ưu tiên · mức độ chi tiết · risk anpha
        ▼
  GIẢI THÍCH: "anh từng chọn dạng này" (TTTT) — tăng tin cậy
        │
        ▼
  HẾT HẠN: preference stale → hỏi lại/loại (chống overfit) · giới hạn policy WW
```

```
mya: MM + IIIII + RRRR SẸN — thiếu: preference store + adaptive strength + tuổi
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ MM memory 3-tier — event log (nguồn học preference)
// ✅ IIIII corrections — học từ chỉnh sửa (preference hành vi)
// ✅ RRRR long-context — inject có chọn lọc
// ✅ TTTT explainable — nêu lý do khi áp dụng
// ✅ WW policy — giới hạn ảnh hưởng preference

// ❌ THIẾU: preference store (thích/không/cách làm — có thứ bậc)
// ❌ THIẾU: adaptive strength (AdaPA — trọng số theo bằng chứng)
// ❌ THIẾU: expiry (preference cũ → hỏi lại)
```

## Implementation

```typescript
// packages/personalize/src/preference.ts (NEW)
export class PreferenceStore {
  apply(prefs: Preference[], task: Task): ContextPatch {
    return prefs
      .filter(p => p.relevant(task))
      .sort((a, b) => b.strength - a.strength)     // AdaPA adaptive weight
      .slice(0, maxPrefs)                           // RRRR — không inject hết
      .map(p => patch(p));                          // format/tool/risk…
  }
  strengthen(p: Preference, evidence: Event) {
    p.strength = adaptiveArithmetic(p.strength, evidence); // NeurIPS 2025
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Output hợp ý — ít chỉnh sửa hơn (IIIII giảm tải) | ❌ Nguy cơ overfit 1 người — làm sai chung |
| ✅ Thích nghi liên tục (adaptive strength — AdaPA) | ❐ Memory preference riêng tư (data — cần consent) |
| ✅ Giải thích khi áp (TTTT) — tin tưởng | ❌ Preference cũ stale — phải hỏi lại/thu hồi |
| ✅ Xây trên MM + IIIII | ❌ Giới hạn policy WW — không ép mọi sở thích |

## Khác các hướng gần

| | MM Memory | IIIII Corrections | KKKKKK: Personalize |
|---|---|---|---|
| Lưu | Sự kiện thô | Chỉnh sửa | **Preference đã suy ra** |
| Học từ | Log | User sửa | **Khai báo + hành vi lặp** |
| Áp dụng | Context quá khứ | Sửa lỗi trước | **Thích nghi output/tool theo người** |

## Khi nào chọn

- 1 người dùng chính — muốn agent ngày càng hợp ý
- User có sở thích format/cách làm riêng rõ ràng
- Đã có MM + IIIII + TTTT — thêm preference store + adaptive + expiry
- Nhiều user chung agent — cần tách preference theo người (XXXXX FinOps tag)