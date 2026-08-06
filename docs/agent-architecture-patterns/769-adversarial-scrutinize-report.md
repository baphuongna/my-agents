# Hướng ACO: Adversarial Scrutinize Report — scrutinizer chỉ đọc plan (không grep codebase) để hunt lazy-modes: unevidenced rejections, size-defer, over-apply

> **Nguồn gốc:** pi-crew-distill-v3 (SCRUTINIZE-REPORT.md) | **Coupling:** 🟢 — review stage độc lập | **Agent-agnostic:** ⚠️ (cần model fresh-context) | **Code sẵn:** ⚠️ (có adversarial review — chưa có scrutinize-report stage) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-crew-distill-v3** dùng **SCRUTINIZE-REPORT** — **adversarial review với fresh context**: scrutinizer **chỉ đọc apply-plan.md** (không grep codebase) để hunt **lazy-modes** — những cách "lười" làm giảm chất lượng: **unevidenced rejections** (reject mà không có proof), **size-defer** (trì hoãn vì khối lượng lớn), **over-apply** (apply quá tay, vượt phạm vi). Fresh context quan trọng: scrutinizer không bị nhiễm bởi quá trình làm — chỉ nhìn vào văn bản plan. Ví dụ phát hiện điển hình: chỗ **"zero behavioral change" được assert nhưng chưa được proven** — claim không kèm chứng minh. Nguyên tắc: **review report bằng mắt mới, hunt lazy-mode cụ thể, mọi assert phải proven**.

## Mô tả

mya adversarial scrutinize report: (1) **fresh-context input** — scrutinizer nhận duy nhất plan/report (text), không đọc code, không grep — chống confirmation bias; (2) **lazy-mode checklist** — quét theo danh sách cố định: `unevidenced-rejection` (reject không proof), `size-defer` (defer vì size), `over-apply` (apply vượt scope), `unproven-assert` (claim không chứng minh); (3) **finding per lazy-mode** — mỗi phát hiện trỏ đúng dòng trong plan; (4) **verdict** — plan đạt/không đạt, kèm danh sách phải sửa. Nối ACN (partition/reject) — ACO là khâu kiểm tra plan của ACN; nối council/adversarial.ts (đã có) — ACO dùng model fresh-context.

## Kiến trúc

```
  APPLY-PLAN.md (kết quả ACL + ACM + ACN)
       │  chỉ đọc plan — KHÔNG grep codebase (fresh context)
       ▼
  SCRUTINIZER (model fresh-context)
    ├─ unevidenced-rejection — reject không proof?
    ├─ size-defer            — defer vì size (lazy-mode-6)?
    ├─ over-apply            — apply vượt scope?
    └─ unproven-assert       — "zero behavioral change" chưa proven?
       ▼
  FINDINGS (trỏ đúng dòng plan) + VERDICT (pass / cần sửa)
       ▼
  PLAN ĐƯỢC SỬA → re-scrutinize (nếu cần)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council adversarial.ts — adversarialReview (nền — N reviewer refute)
// ✅ packages/council hindsight.ts — HindsightReviewer (nền — critique sau khi sinh)
// ✅ packages/council council.ts — CouncilProvider (nền — fan-out + vote)
// ✅ packages/eval harness.ts — keyFactPreserved (nền — assert được kiểm tra)
// ✅ packages/audit index.ts — AuditLog (nền — ghi findings + verdict)

// ❌ THIẾU: scrutinize-report stage (fresh context, lazy-mode checklist)
// ❌ THIẾU: finding structure trỏ dòng plan (unevidenced/size-defer/over-apply)
```
## Implementation
```typescript
// packages/council/src/scrutinize.ts (MỚI)
export type LazyMode =
  | "unevidenced-rejection"
  | "size-defer"
  | "over-apply"
  | "unproven-assert";
export interface ScrutinyFinding {
  lazyMode: LazyMode;
  /** Dòng trong plan — trỏ chính xác. */
  planLine: number;
  quote: string;
  reason: string;
}
export interface ScrutinyResult {
  pass: boolean;
  findings: ScrutinyFinding[];
  summary: string;
}
/** Checklist hunt — quét text plan theo lazy-mode. */
export function huntLazyModes(planText: string): ScrutinyFinding[] {
  const findings: ScrutinyFinding[] = [];
  const lines = planText.split("\n");
  const rules: Array<{ lazyMode: LazyMode; re: RegExp; negate?: RegExp; reason: string }> = [
    // 1. Unevidenced rejection: REJECT nhưng không kèm vì sao.
    { lazyMode: "unevidenced-rejection", re: /REJECT/i, negate: /reason|proof|because|vì/i, reason: "REJECT không kèm semantic proof — phải nêu lý do (xem ACN)." },
    // 2. Size defer: defer/hoãn vì số lượng.
    { lazyMode: "size-defer", re: /(defer|hoãn|lùi|trì hoãn).*(size|số lượng|lớn|nhiều)/i, reason: "Size KHÔNG bao giờ là filter axis (Core Principle #8) — chia batch theo feature, không defer vì size." },
    // 3. Over-apply: apply vượt phạm vi khai báo.
    { lazyMode: "over-apply", re: /(apply|áp dụng).*(tất cả|toàn bộ|mọi nơi)/i, negate: /phạm vi|scope/i, reason: "Apply lan rộng không nêu scope — nguy cơ đổi hành vi ngoài phạm vi." },
    // 4. Unproven assert: "zero change" / "không đổi" không kèm bằng chứng.
    { lazyMode: "unproven-assert", re: /(zero behavioral change|không đổi hành vi|no change)/i, negate: /proven|chứng minh|parity|test/i, reason: "Assert 'zero behavioral change' nhưng chưa proven — cần parity test/evidence." },
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const r of rules) {
      if (r.re.test(line) && (!r.negate || !r.negate.test(line))) {
        findings.push({ lazyMode: r.lazyMode, planLine: i + 1, quote: line.trim(), reason: r.reason });
      }
    }
  }
  return findings;
}
/** Verdict — pass khi không có finding. */
export function scrutinize(planText: string): ScrutinyResult {
  const findings = huntLazyModes(planText);
  return {
    pass: findings.length === 0,
    findings,
    summary: findings.length === 0
      ? "Plan sạch lazy-mode — approve."
      : `${findings.length} lazy-mode phát hiện — sửa plan trước khi apply.`,
  };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fresh context chống confirmation bias (không bị nhiễm quá trình) | ❌ Chỉ đọc plan có thể miss lỗi chỉ thấy khi đối chiếu code |
| ✅ Lazy-mode checklist cụ thể — không review chung chung | ❌ Regex hunt có false positive/negative |
| ✅ Finding trỏ đúng dòng — sửa nhanh | ❌ Cần model đủ tốt cho semantic judgment |
| ✅ "Zero change" phải proven — chống claim suông | ❌ Thêm một stage review → thêm latency |

## Khác các hướng gần

| | Adversarial review (council/adversarial.ts) | ACO: Scrutinize Report |
|---|---|---|
| Đầu vào | Findings cần refute | **Plan text (chỉ đọc plan)** |
| Context | Có thể đọc code | **Fresh context — không grep codebase** |
| Mục tiêu | Tìm finding sai | **Hunt lazy-mode (reject không proof, size-defer…)** |
| Output | Votes + filter | **Finding trỏ dòng + verdict pass/sửa** |

## Khi nào chọn

- Plan/refactor lớn cần review độc lập trước khi apply
- Muốn chống các lazy-mode phổ biến (reject vô cớ, defer vì size, apply quá tay)
- Đã có council + hindsight — thêm stage scrutinize là tự nhiên
- Guard: fresh context bắt buộc, checklist lazy-mode cố định, finding trỏ dòng plan
