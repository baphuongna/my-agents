# Hướng PPPPP: Bounded Self-Correction — tự sửa có giới hạn, fail-loud khi hết vòng

> **Nguồn gốc:** "Self-Correcting Agents Are Not What You Think" (Lanham 2026); SSRN failure taxonomy 2026; 56 Reflexion nền
> **Coupling:** 🟢 — policy vòng, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (RRRR sẵn; thiếu correction policy chung)
> **Effort:** 1 tuần

## Nguồn gốc

Self-correction: agent nhận feedback (lỗi/tự chê) → sửa. Cảnh báo lớn — Lanham 2026: "**self-correcting agents are not what you think** — self-correction introduces entirely new categories of errors" (sửa lại còn tệ hơn — lỗi chồng lỗi); SSRN taxonomy: "when validation fails, return **structured error feedback rather than silent failure** — agents can often self-correct given precise error information". Kết luận chung: self-correction có giá trị **khi**: (1) feedback *cấu trúc* (file:line, thông điệp cụ thể — NNNNN), (2) giới hạn vòng (budget — RRRR), (3) hết vòng → **fail-loud** (báo triage, KHÔNG sửa bừa). Khác **56 Reflexion** (tự phản ánh và sửa — không giới hạn, tự chê có thể sai) — PPPPP thêm *kỷ luật*: bounded + structured + fail-loud; khác **RRRR tool recovery** (sửa params tool) — PPPPP áp cho *mọi fail* (code, task, output).

## Mô tả

mya correction policy áp mọi vòng sửa (code loop NNNNN, task loop, output rewrite): (1) **structured feedback** — lỗi phải kèm: vị trí/điều kiện + thông điệp + gợi ý (không "sai rồi" chung chung — SSRN); (2) **budget vòng** — max N vòng/task (SS — token bound) + theo dõi "vòng sửa có tiến bộ" (lỗi mới xuất hiện? điểm không lên — GGGGG process score) → phát hiện tự-sửa-hại (Lanham); (3) **mode** — self-correct trong vòng; hết vòng → **fail-loud**: báo triage (CCC) với trace (QQQQ) + dừng, không tiếp tục vô hạn; (4) **học** — fail-loud cases → OOOOO error analysis → BBBBB fix gốc (không chỉ sửa con). Nối: NNNNN (structured từ toolchain), RRRR (budget dùng chung), GGGGG (đo tiến bộ vòng).

## Kiến trúc

```
  FAIL ──► STRUCTURED FEEDBACK (file:line · message · gợi ý — SSRN)
        │
        ▼
  SELF-CORRECT vòng ≤ BUDGET (RRRR/SS — token bound)
        │  theo dõi tiến bộ (GGGGG process score):
        │    ├─ lỗi giảm / điểm lên ──► tiếp tục
        │    └─ lỗi MỚI xuất hiện ──► NGHI tự-sửa-hại (Lanham) ──► dừng sớm
        ▼
  HẾT VÒNG còn lỗi ──► FAIL-LOUD: báo triage (CCC) + trace (QQQQ)
        │               (KHÔNG sửa bừa — tự tiện đổi lung tung)
        ▼
  HỌC: fail-loud → OOOOO error analysis → BBBBB fix GỐC (không vá con)
```

```
mya: RRRR budget + trace SẸN — thiếu: correction policy chung + progress check
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ RRRR recovery — budget vòng (mở rộng policy chung)
// ✅ SS budget — token bound
// ✅ NNNNN structured feedback — từ toolchain
// ✅ GGGGG process score — đo tiến bộ vòng
// ✅ CCC handoff + QQQQ trace — fail-loud path
// ✅ OOOOO + BBBBB — học gốc sau fail-loud

// ❌ THIẾU: policy self-correct chung (mọi loop)
// ❌ THIẾU: progress check (lỗi mới? điểm lên?)
// ❌ THIẾU: fail-loud protocol chuẩn (dừng + báo)
```

## Implementation

```typescript
// packages/core/src/correction-policy.ts (NEW)
interface CorrectionCtx { budget: number; progress: (step) => number; }

function shouldContinue(step: StepResult, p: CorrectionCtx): "fix" | "stop" | "fail-loud" {
  if (p.progress(step) > step.prev) return "fix";        // có tiến bộ (GGGGG)
  if (newErrorKind(step)) return "fail-loud";            // lỗi MỚI — tự-sửa-hại
  return step.n >= p.budget ? "fail-loud" : "fix";       // hết budget
}
// fail-loud: dừng + triage (CCC) + trace (QQQQ) — KHÔNG tự tiện
// structured feedback bắt buộc (SSRN) — không "sai rồi" chung chung
// fail-loud cases → OOOOO phân tích → BBBBB fix gốc
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống tự-sửa-hại (lỗi chồng lỗi — Lanham) | ❐ Progress check bằng GGGGG — cần đo chuẩn |
| ✅ Fail-loud thay vì sửa bừa (tiết kiệm + minh bạch) | ❌ Budget quá chặt → bỏ cuộc sớm (tune) |
| ✅ Structured feedback → sửa đúng chỗ hơn (SSRN) | ❌ Policy thêm phức tạp mỗi loop |
| ✅ Học gốc sau fail-loud (OOOOO → BBBBB) | ❌ Không áp cho task khám phá (thử nghiệm) |

## Khác các hướng gần

| | 56 Reflexion | RRRR Recovery | PPPPP: Bounded |
|---|---|---|---|
| Giới hạn | Không | Có (tool) | **Có (mọi loop) + progress** |
| Feedback | Tự chê | Lỗi tool | **Structured bắt buộc** |
| Khi cạn | Sửa tiếp | Fallback | **Fail-loud (dừng + báo)** |
| Mối quan hệ | Nền | 1 dạng | **Chính sách tổng** |

## Khi nào chọn

- Agent hay tự sửa rồi tệ hơn (JJJ detect — tăng token/fail)
- Nhiều vòng sửa (code/task/output) — cần policy chung
- Đã có RRRR + GGGGG + trace — thêm policy + fail-loud
- Muốn minh bạch: dừng hẳn + báo thay vì sửa bừa