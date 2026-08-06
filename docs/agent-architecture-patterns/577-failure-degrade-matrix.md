# Hướng VE: Failure Degrade Matrix — bảng if-then cho nhiệm vụ dài hạn: trigger → first-aid → fallback (serial degrade)

> **Nguồn gốc:** nuwa-skill (failure degrade matrix); "if-then degrade table for long tasks"; "trigger condition → first-aid → fallback"; "serial graceful degradation"; "continue with reduced capability instead of abort" | **Coupling:** 🟡 — thêm degrade matrix lookup vào task-runner failure path | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có trigger→first-aid→fallback matrix) | **Effort:** 3-4 tuần

## Nguồn gốc

**nuwa-skill** cho rằng nhiệm vụ dài hạn không nên **abort sạch** khi fail — mà **degrade serial**: bảng **if-then** ánh xạ **trigger condition** (lỗi gì xảy ra) → **first-aid** (sửa nhẹ, thử lại) → **fallback** (giảm năng lực, tiếp tục thay vì chết). Nếu first-aid không xong → xuống fallback — **khả năng giảm dần** nhưng task **đoạn tiếp tục**. Nguyên tắc: **thất bại không toàn-bỏ** — degrade theo bậc, giữ gìn phần đã làm được. Khác **retry thuần** (thử lại y chang) — VE **đổi cách làm** (degrade); khác fail-fast — VE **fail-graceful, continue**.

## Mô tả

mya failure degrade matrix: (1) **Matrix declare**: mỗi task/skill khai báo degrade rules `{ trigger, firstAid, fallback }`. (2) **Trigger detect**: runner bắt lỗi/thay đổi môi trường → match trigger trong matrix. (3) **First-aid**: áp dụng sửa nhẹ (retry, alternative param, cache clear), thử lại. (4) **Fallback**: nếu first-aid fail → giảm năng lực (chế độ partial, skip optional step) → **tiếp tục** với output degraded. (5) **Annotate**: đánh dấu output "degraded" (để downstream biết). mya có retry/timeout — VE thêm **degrade matrix** + **first-aid runner** + **fallback continuation**.

## Kiến trúc

```
  TASK dài hạn: build + test + deploy
        │ (lỗi xảy ra)
        ▼
  ┌─── TRIGGER MATCH ─────────────────────────────────────┐
  │  trigger: "test-flaky-timeout"                          │
  │  → tìm rule trong DEGRADE MATRIX                        │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── FIRST-AID (sửa nhẹ, thử lại) ──────────────────────┐
  │  retry test với timeout x2 + warm cache                │
  │  → PASS? → continue bình thường                         │
  │  → FAIL? → xuống fallback                               │
  └───────────────────────┬─────────────────────────────┘
                          │ (first-aid fail)
                          ▼
  ┌─── FALLBACK (giảm năng lực, tiếp tục) ────────────────┐
  │  mark test "degraded", skip flaky-suite, build+deploy  │
  │  → TASK TIẾP TỤC (không abort)                          │
  │  → output annotate: "degraded: flaky-suite skipped"    │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ agent-loop retry/timeout — retry thuần (nền — VE = degrade trên retry)
// ✅ 117 toolchain-feedback — exec feedback (nền — VE trigger detect)
// ✅ 524 failure-instruction-learning — lesson (relate — VE = runtime degrade)

// ❌ THIẾU: degrade matrix declare ({ trigger, firstAid, fallback })
// ❌ THIẾU: trigger matcher (lỗi → rule)
// ❌ THIẾU: first-aid runner (sửa nhẹ → retry)
// ❌ THIẾU: fallback continuation (degrade + continue + annotate)
```

## Implementation

```typescript
// packages/agent/src/failure-degrade.ts (MỚI)
interface DegradeRule {
  trigger: RegExp | ((err: unknown) => boolean);
  firstAid: (ctx: DegradeContext) => Promise<boolean>;   // true = fixed
  fallback: (ctx: DegradeContext) => Promise<DegradedResult>;
}
interface DegradeContext { task: string; error: unknown; attempt: number }
interface DegradedResult { ok: boolean; output: string; degraded: boolean; note: string }

class FailureDegradeMatrix {
  private rules: DegradeRule[] = [];
  constructor(private maxFirstAid: number) {}

  addRule(rule: DegradeRule): void { this.rules.push(rule); }

  private match(error: unknown): DegradeRule | undefined {
    return this.rules.find(r =>
      typeof r.trigger === 'function' ? r.trigger(error) : r.trigger.test(String(error)),
    );
  }

  // handle failure: first-aid → fallback → propagate
  async handle(ctx: DegradeContext): Promise<DegradedResult> {
    const rule = this.match(ctx.error);
    if (!rule) {
      return { ok: false, output: '', degraded: false, note: 'no degrade rule — abort' };
    }
    // FIRST-AID: thử sửa nhẹ (giới hạn attempt)
    for (let attempt = 1; attempt <= this.maxFirstAid; attempt++) {
      const fixed = await rule.firstAid({ ...ctx, attempt });
      if (fixed) return { ok: true, output: '', degraded: false, note: `first-aid ok (attempt ${attempt})` };
    }
    // FALLBACK: giảm năng lực, tiếp tục
    const res = await rule.fallback(ctx);
    return { ...res, degraded: true, note: `fallback: ${res.note}` };
  }
}

// Usage:
// matrix.addRule({
//   trigger: /test.*timeout/i,
//   firstAid: async (c) => retryTest({ timeout: 2 * BASE }),   // sửa nhẹ
//   fallback: async (c) => ({ ok:true, output:'build+deploy', note:'flaky-suite skipped' }),
// });
// catch (err) → const res = await matrix.handle({ task:'build-test-deploy', error:err, attempt:0 });
// → degraded: continue + annotate
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task tiếp tục (degrade thay vì abort sạch) | ❌ Matrix trì trệ (trigger chưa cover lỗi mới) |
| ✅ Serial graceful (bậc first-aid → fallback) | ❌ Fallback sai (degenerate output sai) |
| ✅ Giữ phần đã làm (không mất công) | ❌ Complexity (matrix phình nhiều rule) |
| ✅ Annotate degraded (downstream biết) | ❌ Over-degrade (fallback quá sớm) |

## Khác các hướng gần

| | Retry thuần | Fail-fast | VE: Failure-Degrade |
|---|---|---|---|
| Khi fail | Thử lại y chang | Abort ngay | **First-aid → fallback (degrade)** |
| Continue | ⚠️ (nếu retry ok) | ❌ | **✅ degrade + continue** |
| Đổi cách | ❌ | ❌ | **✅ fallback đổi năng lực** |

## Khi nào chọn

- Nhiệm vụ dài hạn, nhiều stage (build→test→deploy) — abort tốn công
- Có cách degrade rõ (partial output còn giá trị)
- Muốn giữ gìn phần đã làm (graceful > toàn-bỏ)
- Nối agent-loop retry/timeout + 117 toolchain-feedback (trigger detect) + 524 failure-instruction (lesson); guard trigger coverage (cover lỗi thực tế), fallback correctness (degraded output vẫn dùng được), và annotate transparency (downstream biết output degraded); VE = failure degrade matrix, kết hợp 575 honest-boundary (degrade = thừa nhận giới hạn) + 524 failure-instruction (fail → học rule mới cho matrix)
