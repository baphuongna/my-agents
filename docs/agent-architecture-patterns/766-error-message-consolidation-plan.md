# Hướng ACL: Error Message Consolidation Plan — distill plan phát hiện inline anti-pattern và gom về helper chung theo batch

> **Nguồn gốc:** pi-crew-distill-v2 (references/apply-plan.md) | **Coupling:** 🟡 — cần plan + batch refactor trên codebase | **Agent-agnostic:** ⚠️ (dựa trên phân tích agent) | **Code sẵn:** ⚠️ (có audit + recovery — chưa có apply-plan pipeline) | **Effort:** 2 tuần

## Nguồn gốc

**pi-crew-distill-v2** tạo **distill plan** phát hiện **106 chỗ inline anti-pattern** — biểu thức lặp lại `X instanceof Error ? X.message : String(X)` — trong codebase pi-crew, và đề xuất **gom về helper chung `errorMessage()`** (guards.ts:95). Quyết định quan trọng: **không defer chỉ vì kích thước** (106 chỗ là lớn, nhưng "lazy-mode-6 avoidance" — không trì hoãn vì khối lượng) mà **chia nhỏ theo feature/directory** — mỗi batch một đơn vị áp dụng, review được, rollback được. Nguyên tắc: **anti-pattern inline được đo đếm, gom về helper, chia batch theo feature, không defer vì size**.

## Mô tả

mya error message consolidation plan: (1) **detect anti-pattern** — quét codebase tìm biểu thức `instanceof Error ? .message : String(...)` lặp lại (pattern match + đếm); (2) **helper chung** — tạo `errorMessage(err: unknown): string` trong shared module xử lý mọi nhánh (Error, string, null/undefined, object); (3) **chia batch theo directory/feature** — mỗi batch ≤ N site, áp dụng + test + review độc lập; (4) **không defer vì size** — 106 site vẫn làm, chỉ chia nhỏ để giảm rủi ro; (5) **verdict per site** — drop-in / const-stored / reject (xem ACN). Nối ACM (exact-count-grep-evidence) — ACL đếm chính xác, ACM cung cấp evidence.

## Kiến trúc

```
  CODEBASE (pi-crew analog → mya packages/)
       ▼
  DETECT (grep pattern — 106 sites)
    X instanceof Error ? X.message : String(X)
       ▼
  HELPER CHUNG
    errorMessage(err: unknown): string
      ├─ Error      → err.message
      ├─ string     → err
      ├─ null/undef → "unknown error"
      └─ object     → String(err) — preserve
       ▼
  BATCH THEO FEATURE (directory)
    batch 1: packages/a (44 sites) → apply + test + review
    batch 2: packages/b (59 sites) → apply + test + review
    ...
  KHÔNG DEFER VÌ SIZE — chỉ chia nhỏ để rollback an toàn
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/audit recovery.ts — runRecovery (nền — batch apply có rollback)
// ✅ packages/audit index.ts — AuditLog (nền — ghi mỗi batch apply)
// ✅ packages/core types.ts — LifecycleError { state, error } (nền — error model)
// ✅ packages/core exit.ts — NativeResult (nền — error handling chuẩn)
// ✅ packages/eval harness.ts — ParityHarness (nền — kiểm tra không đổi hành vi)

// ❌ THIẾU: detect anti-pattern (grep pattern + đếm)
// ❌ THIẾU: errorMessage() helper chung
// ❌ THIẾU: batch-by-directory apply pipeline + per-batch verdict
```
## Implementation
```typescript
// packages/core/src/error-message.ts (MỚI)
/** Helper chung — thay mọi inline `X instanceof Error ? X.message : String(X)`. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err === null || err === undefined) return "unknown error";
  // Object lạ: preserve hành vi String(err) cũ — KHÔNG đổi semantics.
  return String(err);
}
/** Detect anti-pattern trong một file — đếm chính xác, kèm line number. */
export function detectInlineErrorPattern(src: string): Array<{ line: number; text: string }> {
  // Pattern: `X instanceof Error ? X.message : String(X)`
  const re = /(\w+)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*String\(\s*\1\s*\)/g;
  const out: Array<{ line: number; text: string }> = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) out.push({ line: i + 1, text: lines[i]!.trim() });
  }
  return out;
}
/** Batch plan theo directory — mỗi batch là một đơn vị apply độc lập. */
export interface BatchPlan {
  batchId: string;
  directory: string;
  sites: Array<{ file: string; line: number }>;
}
export function buildBatchPlan(
  byFile: Map<string, Array<{ line: number }>>,
  batchSize = 20,
): BatchPlan[] {
  const plans: BatchPlan[] = [];
  let batchId = 0;
  for (const [file, sites] of byFile) {
    const dir = file.split("/").slice(0, -1).join("/") || ".";
    for (let i = 0; i < sites.length; i += batchSize) {
      plans.push({
        batchId: ++batchId,
        directory: dir,
        sites: sites.slice(i, i + batchSize).map((s) => ({ file, line: s.line })),
      });
    }
  }
  return plans;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hết inline anti-pattern — một helper, một hành vi | ❌ Batch lớn → nhiều commit, cần test từng batch |
| ✅ Chia theo feature — review/rollback độc lập | ❌ Detect regex có thể miss biến thể (thêm ngoặc, dòng dài) |
| ✅ Không defer vì size — nợ kỹ thuật xử lý dứt điểm | ❌ Helper phải giữ semantics cũ (null/undefined) |
| ✅ Per-batch verdict — audit được từng quyết định | ❌ Refactor hàng loạt rủi ro regression nếu thiếu parity test |

## Khác các hướng gần

| | Recovery recipes (audit/recovery.ts) | ACL: Consolidation Plan |
|---|---|---|
| Mục đích | Sửa state sau lỗi runtime | **Gom inline anti-pattern về helper** |
| Đơn vị | Recipe chạy khi fail | **Batch theo directory, per-site verdict** |
| Quyết định | Có/không recovery | **Không defer vì size — chia nhỏ theo feature** |
| Đo lường | VerifyResult | **Số site + line number chính xác** |

## Khi nào chọn

- Codebase có pattern lặp lại inline (instanceof Error ? .message : String(...)) với số lượng lớn
- Muốn gom về helper chung nhưng không đổi hành vi (parity test)
- Muốn refactor theo batch để review/rollback an toàn thay vì defer vì khối lượng
- Guard: parity test từng batch, helper preserve semantics, verdict per site có lý do
