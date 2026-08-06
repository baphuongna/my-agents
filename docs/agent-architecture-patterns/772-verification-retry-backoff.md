# Hướng ACR: Verification Retry Backoff — retry bounded exponential backoff kèm failure-hash dedup, quyết định delay/pause dạng discriminated union

> **Nguồn gốc:** gsd-2 (src/resources/extensions/gsd/auto/verification-retry-policy.ts) | **Coupling:** 🟢 — policy module độc lập | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có supervised backoff + durable-ack — chưa có failure-hash dedup) | **Effort:** 1-2 tuần

## Nguồn gốc

**gsd-2** dùng **verification retry với bounded exponential backoff** (**2s → 30s cap, 10% jitter**) kèm **failure-hash dedup** để **transient failures** (slow tools, flaky LLM calls) **không spin tight retry loop**. Retry key theo **`unitType:unitId`**, và **quyết định delay/pause là discriminated union** — mỗi kết quả retry là một trong các trạng thái rõ ràng (retry sau delay X / pause chờ điều kiện / bỏ hẳn). Failure-hash dedup: nếu cùng failure (cùng hash) lặp lại, không retry mù — có thể chuyển sang bỏ hoặc báo. Nguyên tắc: **retry có chủ đích — bounded, có cap, có jitter, dedup theo hash, quyết định có cấu trúc**.

## Mô tả

mya verification retry backoff: (1) **bounded backoff** — delay khởi đầu 2s, nhân đôi, cap 30s, jitter 10% (tránh thundering herd); (2) **failure-hash** — hash lỗi (message + stack + tool) — cùng hash lặp lại → không retry mù (có thể là lỗi vĩnh viễn); (3) **retry key `unitType:unitId`** — theo dõi riêng từng unit; (4) **discriminated union decision** — `{ type: "retry", delayMs } | { type: "pause", until, reason } | { type: "abandon", reason }`; (5) **transient vs permanent** — slow tool → retry, lỗi logic → abandon. Nối supervised.ts (đã có backoff) — ACR thêm hash dedup + decision union.

## Kiến trúc

```
  VERIFICATION FAIL
       ▼
  FAILURE-HASH (message + stack + tool)
       │  cùng hash lặp lại?
       ├─ có ──▶ không retry mù (có thể permanent → abandon)
       └─ không ──▶ retry policy
       ▼
  BACKOFF (bounded exponential)
    2s → 4s → 8s → … → 30s CAP · jitter ±10%
       ▼
  DECISION (discriminated union)
    { type: "retry",  delayMs }
    { type: "pause",  until, reason }   // chờ điều kiện
    { type: "abandon", reason }          // permanent — bỏ
       ▼
  RETRY KEY: unitType:unitId (theo dõi riêng từng unit)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core supervised.ts — SupervisedTask (baseBackoffMs 1s → maxBackoffMs 30s,
//   restart window, exponential) — nền backoff có sẵn
// ✅ packages/core durable-ack.ts — classifyCompletionTarget terminal/retry/deliver
//   (nền — phân loại retry vs terminal)
// ✅ packages/core laneboard.ts — classifyFreshness (nền — pause/healthy/stalled)
// ✅ packages/core budget.ts — budget tracking (nền — retry có budget)
// ✅ packages/core iteration-budget.ts — IterationBudget (nền — cap số lần retry)

// ❌ THIẾU: failure-hash dedup (cùng hash lặp lại → không retry mù)
// ❌ THIẾU: retry key unitType:unitId
// ❌ THIẾU: decision discriminated union (retry/pause/abandon)
```
## Implementation
```typescript
// packages/core/src/retry-policy.ts (MỚI)
import { createHash } from "node:crypto";
import { nowWallclock } from "./time.js";
export type RetryDecision =
  | { type: "retry"; delayMs: number }
  | { type: "pause"; until: number; reason: string }
  | { type: "abandon"; reason: string };
export interface RetryPolicyOptions {
  baseMs?: number;      // default 2000
  maxMs?: number;       // default 30000
  jitter?: number;      // default 0.10
  maxAttempts?: number; // default 5
}
/** Bounded exponential backoff + jitter. */
export function nextDelayMs(attempt: number, opts: RetryPolicyOptions = {}): number {
  const base = opts.baseMs ?? 2_000;
  const max = opts.maxMs ?? 30_000;
  const jitter = opts.jitter ?? 0.1;
  const exp = Math.min(base * 2 ** attempt, max);
  const j = 1 + (Math.random() * 2 - 1) * jitter; // ±10%
  return Math.round(exp * j);
}
/** Failure hash — message + stack + tool → dedup key. */
export function failureHash(err: unknown, context: string): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const raw = `${context}|${e.message}|${e.stack ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}
/** Retry tracker — key unitType:unitId, dedup theo failure hash. */
export class RetryPolicy {
  private readonly seen = new Map<string, { hash: string; attempts: number; lastAt: number }>();
  constructor(private readonly opts: RetryPolicyOptions = {}) {}
  /** Quyết định retry/pause/abandon — discriminated union. */
  decide(unitType: string, unitId: string, hash: string): RetryDecision {
    const key = `${unitType}:${unitId}`;
    const rec = this.seen.get(key);
    const attempts = (rec?.hash === hash ? rec.attempts : 0) + 1;
    this.seen.set(key, { hash, attempts, lastAt: nowWallclock() });
    // Failure-hash dedup: cùng hash lặp lại ≥ 2 lần liên tiếp → nghi permanent.
    if (rec?.hash === hash && attempts >= 2) {
      return { type: "abandon", reason: `cùng failure hash ${hash} lặp lại ${attempts} lần — permanent nghi ngờ` };
    }
    const max = this.opts.maxAttempts ?? 5;
    if (attempts > max) return { type: "abandon", reason: `vượt maxAttempts=${max}` };
    const delayMs = nextDelayMs(attempts - 1, this.opts);
    return delayMs >= (this.opts.maxMs ?? 30_000)
      ? { type: "pause", until: nowWallclock() + delayMs, reason: "chạm cap — pause trước khi retry" }
      : { type: "retry", delayMs };
  }
}
//        d.type === "retry" → setTimeout(d.delayMs) · "abandon" → báo lỗi thật
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không spin tight loop — bounded + cap + jitter | ❌ Retry delay làm chậm completion khi fail thật |
| ✅ Failure-hash dedup — không retry lỗi permanent mù | ❌ Hash có thể miss lỗi cùng root khác message |
| ✅ Decision union — retry/pause/abandon rõ ràng | ❌ Retry policy cần state (seen map) — phải quản lý lifecycle |
| ✅ Retry key per unit — không đụng unit khác | ❌ Jitter ngẫu nhiên — test cần inject seed |

## Khác các hướng gần

| | SupervisedTask (supervised.ts) | ACR: Retry Policy |
|---|---|---|
| Mục đích | Restart task crash-resilient | **Retry verification với dedup + decision** |
| Backoff | Exponential 1s→30s | **2s→30s cap + 10% jitter** |
| Dedup | Reset counter khi chạy lâu | **Failure-hash dedup (cùng lỗi không retry mù)** |
| Output | Restart loop | **Decision discriminated union** |

## Khi nào chọn

- Verification/worker có transient failures (slow tools, flaky LLM) cần retry có kiểm soát
- Muốn tránh spin tight retry loop (failure-hash dedup)
- Đã có supervised + durable-ack — thêm policy layer
- Guard: bounded + cap + jitter, dedup hash, decision union, test với inject clock
