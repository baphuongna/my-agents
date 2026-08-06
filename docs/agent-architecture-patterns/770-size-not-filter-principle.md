# Hướng ACP: Size-Not-Filter Principle — "Size is NEVER a filter axis — verify + compare still are" — 103/106 site được APPLY dù lớn, 3 site REJECT vì merit

> **Nguồn gốc:** pi-crew-distill-v3 (references/apply-plan.md) | **Coupling:** 🟢 — nguyên tắc quyết định, không đụng kiến trúc | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có batch plan — chưa có size-guard trong quyết định) | **Effort:** 1 tuần

## Nguồn gốc

**pi-crew-distill-v3** tuyên bố **Core Principle #8**: **"Size is NEVER a filter axis — verify + compare still are"**. Bằng chứng: **103/106 site được APPLY dù số lượng lớn** (106 chỗ là lớn — dễ bị "lười" mà hoãn), **3 site bị REJECT vì merit** (behavioral regression — đổi hành vi null/undefined) **chứ không vì số lượng**. Nguyên tắc thể hiện **balance giữa under-apply** (không làm vì sợ lớn → nợ kỹ thuật) **và over-apply** (làm quá tay → regression). Filter thật sự là **verify** (parity test, evidence) và **compare** (so sánh hành vi trước/sau) — size chỉ ảnh hưởng cách tổ chức (chia batch), không ảnh hưởng quyết định làm hay không.

## Mô tả

mya size-not-filter principle: (1) **rule cố định** — trong quyết định APPLY/REJECT, **size không bao giờ là lý do** — reject chỉ vì merit (đổi hành vi, regression), apply vì verify pass; (2) **size ảnh hưởng tổ chức, không phải quyết định** — lớn → chia batch (ACL), không → defer; (3) **guard chống under-apply** — nếu plan nói "hoãn vì quá nhiều" → bị ACO scrutinize flag (size-defer lazy-mode); (4) **guard chống over-apply** — apply chỉ trong scope đã verify; (5) **đo lường** — ghi số site apply/reject kèm lý do để kiểm tra balance. Nối ACL/ACN/ACO — ACP là nguyên tắc xuyên suốt các bước đó.

## Kiến trúc

```
  QUYẾT ĐỊNH APPLY / REJECT
       ├── FILTER ĐƯỢC DÙNG:
       │     verify   — parity test / evidence pass?
       │     compare  — hành vi trước vs sau có khác?
       └── FILTER KHÔNG BAO GIỜ ĐƯỢC DÙNG:
             size     — 106 sites quá lớn → hoãn?  ❌ NEVER
             └── size chỉ ảnh hưởng: chia batch theo feature
  103/106 APPLY (dù lớn — verify + compare pass)
    3/106 REJECT (vì merit — behavioral regression)
       ▼
  BALANCE: under-apply (nợ kỹ thuật)  ↔  over-apply (regression)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools partition.ts (ACN) — buildApplyPlan (nền — apply/reject + reason)
// ✅ packages/eval harness.ts — ParityHarness + identicalPassthrough (nền — verify)
// ✅ packages/tools grep-evidence.ts (ACM) — evidence (nền — compare source)
// ✅ packages/council scrutinize.ts (ACO) — size-defer flag (nền — guard chống under-apply)
// ✅ packages/audit index.ts — AuditLog (nền — ghi apply/reject + lý do)

// ❌ THIẾU: size-guard rule (chặn reject/defer vì size trong code path)
// ❌ THIẾU: balance report (apply vs reject kèm lý do — đo under/over)
```
## Implementation
```typescript
// packages/tools/src/size-guard.ts (MỚI)
export interface Decision {
  siteId: string;
  action: "apply" | "reject";
  /** Lý do — KHÔNG được phép chứa lý do size. */
  reason: string;
}
/** Các lý do hợp lệ cho reject — merit-only. */
const VALID_REJECT_REASONS = [
  "behavioral-regression",
  "semantics-changed",
  "out-of-scope",
  "already-sanitized",
];
/** Guard: reject có phải vì size không — nếu có là vi phạm principle. */
export function assertNoSizeFilter(decisions: Decision[]): string[] {
  const violations: string[] = [];
  const SIZE_HINTS = /size|số lượng|quá nhiều|quá lớn|khối lượng|lớn quá|nhiều quá/i;
  for (const d of decisions) {
    if (d.action === "reject" && SIZE_HINTS.test(d.reason)) {
      violations.push(`${d.siteId}: reject reason chứa size hint — "${d.reason}"`);
    }
  }
  return violations;
}
/** Verify lý do reject thuộc merit-only set. */
export function validRejectReason(reason: string): boolean {
  return VALID_REJECT_REASONS.includes(reason);
}
/** Balance report — đo under/over-apply. */
export interface BalanceReport {
  total: number;
  applied: number;
  rejected: number;
  /** Tỷ lệ reject — quá cao (>30%) nghi under-verify, quá thấp (<2%) nghi over-apply. */
  rejectRatio: number;
  ok: boolean;
}
export function balanceReport(decisions: Decision[]): BalanceReport {
  const total = decisions.length;
  const applied = decisions.filter((d) => d.action === "apply").length;
  const rejected = total - applied;
  const rejectRatio = total === 0 ? 0 : rejected / total;
  return {
    total,
    applied,
    rejected,
    rejectRatio,
    // Balance: reject có lý do merit (không phải 0 tuyệt đối, không quá cao).
    ok: rejectRatio >= 0.02 && rejectRatio <= 0.3,
  };
}
/** Gate quyết định — size không bao giờ là filter. */
export function gateDecisions(decisions: Decision[]): { ok: boolean; violations: string[]; report: BalanceReport } {
  const violations = assertNoSizeFilter(decisions);
  const report = balanceReport(decisions);
  return { ok: violations.length === 0 && report.ok, violations, report };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống nợ kỹ thuật — không hoãn vì khối lượng | ❌ Refactor lớn vẫn tốn thời gian (dù đúng đắn) |
| ✅ Reject phải merit — chất lượng quyết định cao | ❌ Balance threshold cần calibrate theo loại task |
| ✅ Đo balance — under/over-apply nhìn thấy được | ❌ Guard regex size-hint có thể miss cách diễn đạt khác |
| ✅ Verify + compare là filter thật — an toàn hơn | ❌ Đòi hỏi parity test đủ tốt để tin vào apply |

## Khác các hướng gần

| | ACO: Scrutinize (lazy-mode hunt) | ACP: Size-Not-Filter |
|---|---|---|
| Phạm vi | Hunt size-defer trong plan | **Nguyên tắc xuyên suốt quyết định apply/reject** |
| Cơ chế | Finding trỏ dòng | **Guard + balance report (đo lường)** |
| Mục tiêu | Phát hiện vi phạm | **Chặn vi phạm + đo cân bằng** |
| Quan hệ | ACO flag | **ACP là rule mà ACO enforce** |

## Khi nào chọn

- Refactor hàng loạt — cần nguyên tắc rõ để không hoãn vì lớn
- Muốn đo balance under/over-apply thay vì tin cảm tính
- Đã có ACL/ACN/ACO — ACP là rule + guard chung
- Guard: reject reason merit-only, size-guard bắt buộc, balance report trong audit
