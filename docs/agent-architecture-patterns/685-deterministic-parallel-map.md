# Hướng ZI: Deterministic Parallel Map — ctx.parallel.map chạy task song song nhưng kết quả giữ deterministic — kiểm soát concurrency trong process-as-code
> **Nguồn gốc:** babysitter (docs/user-guide/features/parallel-execution.md) | **Coupling:** 🟢 — thêm ctx.parallel.map vào workflows runner | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (runner.ts có ctx.parallel — chưa deterministic map với concurrency limit) | **Effort:** 1 tuần

## Nguồn gốc

**babysitter** cho process chạy task **song song** qua `ctx.parallel.map` — nhưng song song naive thì **kết quả bất định**: thứ tự hoàn thành khác nhau, side-effect race, output thứ tự lung tung. Giải pháp: `parallel.map(tasks, { concurrency })` chạy giới hạn concurrency nhưng **trả kết quả theo thứ tự input** (không theo thứ tự hoàn thành), **lỗi được gom** (không hủy task khác), và **side-effect được kiểm soát** (task là pure-ish function nhận input, trả output). Deterministic → process chạy lại cho cùng output dù song song. Nguyên tắc: **parallel execution, deterministic result — order by input, not by completion**.

## Mô tả

mya deterministic parallel map: (1) **ctx.parallel.map(tasks, { concurrency })** — chạy tối đa N task đồng thời. (2) **Deterministic output** — kết quả xếp theo index input, không theo thời điểm finish. (3) **Error aggregation** — task fail → gom lỗi, không hủy các task khác (hoặc fail-fast tùy config). (4) **Concurrency control** — queue chặn quá N task chạy cùng lúc. mya có workflows/runner.ts `ctx.parallel` (Promise.all — chưa limit, output theo completion) — ZI thêm **deterministic ordering** + **concurrency limiter** + **error aggregation**.

## Kiến trúc

```
  ctx.parallel.map(tasks, { concurrency: 2 })
  ┌───────────────────────────────────────────────────┐
  │  tasks: [t0, t1, t2, t3]                           │
  │  queue: chạy tối đa 2 cùng lúc                     │
  │  ┌─ t0 ─┐  ┌─ t1 ─┐                                │
  │  └──┬───┘  └──┬───┘                                │
  │     ▼         ▼                                    │
  │  ┌─ t2 ─┐  ┌─ t3 ─┐   (t0/t1 xong → đẩy tiếp)      │
  │  └──┬───┘  └──┬───┘                                │
  │     ▼         ▼                                    │
  └───────────────────────────────────────────────────┘
  OUTPUT: [r0, r1, r2, r3]   ← theo INDEX INPUT
  (không theo thứ tự hoàn thành — deterministic)
  LỖI: gom { index, error } — không hủy task khác
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner.ts — ctx.parallel (Promise.all, nền — ZI thay thế)
// ✅ packages/workflows runner.ts — WorkflowContext (nền — ZI thêm method)
// ✅ packages/agent index.ts — SubagentHandle/spawn (nền — ZI task = subagent)
// ✅ packages/core loop.ts — runTurn (relate — ZI chạy trong process)

// ❌ THIẾU: deterministic ordering (output theo input index)
// ❌ THIẾU: concurrency limit (queue, không Promise.all tràn)
// ❌ THIẾU: error aggregation (gom lỗi, không hủy hàng loạt)
```

## Implementation

```typescript
// packages/workflows/src/deterministic-parallel.ts (MỚI)

interface ParallelOptions { concurrency?: number; failFast?: boolean }

class DeterministicParallel {
  // map: chạy song song nhưng kết quả theo index input — deterministic
  async map<T, R>(
    tasks: Array<(index: number) => Promise<T>>,
    fn: (value: T, index: number) => R,
    opts: ParallelOptions = {},
  ): Promise<Array<R | Error>> {
    const concurrency = opts.concurrency ?? 4;
    const results = new Array<R | Error>(tasks.length);   // placeholder theo index
    let cursor = 0;
    const errors: { index: number; error: Error }[] = [];

    const worker = async (): Promise<void> => {
      while (cursor < tasks.length) {
        const i = cursor++;                                // mỗi worker lấy task kế tiếp
        try {
          const value = await tasks[i](i);
          results[i] = fn(value, i);                       // ghi ĐÚNG index input
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          results[i] = err;
          errors.push({ index: i, error: err });
          if (opts.failFast) return;                        // fail-fast tùy config
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
    await Promise.all(workers);
    return results;                                        // luôn theo thứ tự input
  }
}
// Usage (trong runner.ts):
// const p = new DeterministicParallel();
// const out = await p.map(
//   [() => ctx.spawn("analyze a"), () => ctx.spawn("analyze b")],
//   (text) => text.length,
//   { concurrency: 2 },
// );
// → out[0] = kết quả task 0 (dù task 1 xong trước) — deterministic
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Output deterministic (theo index input) | ❌ Worker nhanh phải chờ slot (nếu limit thấp) |
| ✅ Concurrency có giới hạn (không tràn tài nguyên) | ❌ Side-effect giữa task vẫn có thể race (task không pure) |
| ✅ Error gom được (1 task fail không chết cả batch) | ❌ Error array xen với result (phải check instanceof) |
| ✅ Fail-fast configurable | ❌ Ordering memory (giữ placeholder array) |

## Khác các hướng gần

| | Promise.all | Worker pool riêng | ZI: Deterministic Map |
|---|---|---|---|
| Order | Completion | Completion | **Input index** |
| Limit | Không | Pool | **Concurrency opt** |
| Error | Reject cả | Per worker | **Gom + tùy chọn** |

## Khi nào chọn

- Process cần chạy nhiều task song song (subagent, file analysis) mà kết quả phải ổn định
- Muốn giới hạn concurrency (tài nguyên, rate limit provider)
- Muốn 1 task fail không hủy cả batch (gom lỗi xử lý sau)
- Nối packages/workflows runner.ts + agent index.ts (spawn) + core loop.ts; guard task-purity (task không side-effect chồng lấn), index-stability (kết quả luôn theo index), và concurrency-default (default hợp lý, không tràn); ZI = deterministic parallel map, kết hợp 683 ZG process-as-code (ctx.parallel trong process) + 695 ZS party-mode-consensus (N agent song song có kiểm soát)
