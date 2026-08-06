# Hướng XX: Five-Axis Code Review — review theo 5 trục correctness/readability/architecture/security/performance, approve chuẩn "improves overall code health" (research.md)

> **Nguồn gốc:** agent-skills (code-review-and-quality — research.md) | **Coupling:** 🟢 — review protocol, chạy trước commit | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có council + eval + audit — chưa có reviewer 5 trục) | **Effort:** 1-2 tuần

## Nguồn gốc

**agent-skills** dạy code review theo **5 trục**: `correctness` (đúng chức năng), `readability` (dễ đọc/bảo trì), `architecture` (đúng chỗ, đúng pattern), `security` (lỗ hổng, input validation), `performance` (độ phức tạp, hot path). Mỗi trục review độc lập, ghi comment kèm severity. Chuẩn approve: không phải "không có bug" — mà **"improves overall code health"**: code mới làm tổng thể tốt hơn dù còn chỗ chưa hoàn hảo. Không approve code làm tệ đi chỉ vì "đúng spec".

## Mô tả

mya chạy five-axis review: sau mỗi slice/PR, reviewer (agent hoặc council) duyệt diff theo 5 trục. Mỗi trục ra kết quả: `pass` / `comment` / `block`. Block ở trục security/correctness → không approve. Comment ở readability/architecture → ghi nhận nhưng không chặn nếu tổng thể health tăng. Decision rule: `approve = (không block) && (healthDelta > 0)`. HealthDelta tính từ số comment tích cực trừ tiêu cực có trọng số. mya có sẵn council (nhiều member vote), eval (chạy test), audit trust (kiểm tra quyền) — XX thêm **5-axis reviewer** + **health decision rule**.

## Kiến trúc

```
  Diff ──► AXIS REVIEWERS (song song)
             ├─ correctness : chạy test, đối chiếu spec
             ├─ readability : naming, structure, comments
             ├─ architecture: đúng layer, coupling
             ├─ security    : input, path, injection
             └─ performance : complexity, hot loop
                    │
                    ▼
            ┌─ Verdict ───────────────────────┐
            │  block? (security/correctness)   │
            │  → REJECT (quay Implement)       │
            │  healthDelta > 0? (no block)     │
            │  → APPROVE "improves overall"    │
            └──────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council council.ts — nhiều member vote (nền — XX mỗi trục một member)
// ✅ packages/eval harness.ts — chạy test correctness (nền — XX trục 1)
// ✅ packages/tools osv-check.ts — security scan dependencies (nền — XX trục 4)
// ✅ packages/core threat-scan.ts — quét prompt/input (nền — XX trục 4)

// ❌ THIẾU: 5-axis reviewer (tách trục + severity)
// ❌ THIẾU: healthDelta decision rule
// ❌ THIẾU: block semantics (security/correctness block ≠ comment)
```

## Implementation (TS)

```typescript
// packages/council/src/five-axis-review.ts (MỚI)
export type Axis = "correctness" | "readability" | "architecture" | "security" | "performance";
export type Severity = "nit" | "comment" | "block";

export interface ReviewNote {
  axis: Axis;
  severity: Severity;
  text: string;
}

export interface ReviewVerdict {
  approve: boolean;
  healthDelta: number; // > 0 = improves overall code health
  blockers: ReviewNote[];
}

const BLOCK_AXES: Axis[] = ["security", "correctness"];

export function review(diff: string, notes: ReviewNote[]): ReviewVerdict {
  const blockers = notes.filter((n) => n.severity === "block" && BLOCK_AXES.includes(n.axis));
  // healthDelta: block -3, comment +0, nit +0.5; readability/architecture comment +1 (improvement)
  const weight = (n: ReviewNote): number => {
    if (n.severity === "block") return -3;
    if (n.axis === "readability" || n.axis === "architecture") return 1;
    return 0.5;
  };
  const healthDelta = notes.reduce((sum, n) => sum + weight(n), 0);
  // Chuẩn approve: không block + tổng thể tốt hơn
  const approve = blockers.length === 0 && healthDelta > 0;
  return { approve, healthDelta, blockers };
}

export function formatVerdict(v: ReviewVerdict): string {
  const axes = new Set(v.blockers.map((b) => b.axis));
  return v.approve
    ? `✅ APPROVE (health +${v.healthDelta}) — improves overall code health`
    : `⛔ REJECT — blockers: ${[...axes].join(", ")}`;
}

// Usage:
// const notes = await runAxes(diff, { correctness: runTests, security: osvScan });
// const v = review(diff, notes);
// v.approve ? mergePR() : feedback(notes);  // healthDelta > 0 mới approve
```

## Được

- ✅ Review có cấu trúc — 5 trục cố định, không review cảm tính
- ✅ Block semantics rõ — security/correctness block, còn lại comment
- ✅ Chuẩn approve tích cực — "improves overall health" thay vì "không bug"
- ✅ Song song được — mỗi trục một council member/agent
- ✅ Deterministic — healthDelta tính được, approve/block máy quyết

## Mất

- ❌ Weight chủ quan — healthDelta trọng số cần calibrate
- ❌ Review cost — 5 trục đầy đủ tốn token cho diff nhỏ
- ❌ False approve — healthDelta dương nhưng bỏ sót block ở trục không chạy

## Khác các hướng gần

| | LLM-as-judge (1 judge) | Council vote (N member) | XX: Five-Axis |
|---|---|---|---|
| Cấu trúc | 1 đánh giá tổng | vote theo member | **5 trục chuyên biệt** |
| Block rule | cảm tính | đa số | **security/correctness cứng** |
| Approve chuẩn | "looks good" | majority | **healthDelta > 0** |

## Khi nào chọn

- Cần review có kỷ luật trước mỗi commit/slice (nối 647 XW)
- Muốn phân biệt block (security) với comment (style) — không chặn tiến độ vô lý
- Có council + eval + osv-check sẵn — XX thêm axis runner + verdict rule
- Nối packages/council (mỗi trục một member) + eval (correctness) + tools/osv-check.ts (security); guard severity-calibration (weight không lệch — golden set), block-coverage (mọi trục chạy, không skip security), và approve-bias (healthDelta dương giả do nit spam — cap nit); XX = 5-axis review, kết hợp 646 XV assumption-gate (review theo assumption) + 661 YK verified-framework-ids (security trục dùng ID verify máy)
