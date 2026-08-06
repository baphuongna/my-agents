# Hướng KE: Cancel Propagation — hủy lan truyền xuống cây subagent, dọn context đúng

> **Nguồn gốc:** Go `context.Context` cancellation; Web/Node `AbortController`; Tokio `CancellationToken` (Rust); Kotlin structured concurrency; Swift Task cancellation
> **Coupling:** 🟡 — agent tree cần gắn cancellation token
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagent spawn sẵn — thiếu AbortSignal lan truyền)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Structured concurrency** (Kotlin/Nathaniel J. Smith "Notes on structured concurrency"; Swift async/let): khi parent scope hủy → mọi child bị hủy theo — không có child "lạc". Go `context.WithCancel`: signal lan qua call graph, mỗi hàm check `ctx.Err()`. Tokio (Rust) `CancellationToken`: "a single token can be used to signal cancellation to any number of tasks." Web `AbortController`: fetch/sub-operations chia sẻ 1 signal — `abort()` dừng toàn bộ. Nguyên tắc chung: **cancellation là cây, không phải sự kiện rời rạc** — parent hủy → subtree gọn (dọn file tạm, đóng kết nối, không token thừa).

## Mô tả

mya chạy agent-tree: parent spawn subagent → subagent gọi tool → tool spawn LLM call. Khi user bấm **Cancel** (hoặc 215 deadline hết, hoặc 42 circuit-breaker mở) → phải hủy **toàn bộ nhánh** chứ không chỉ task đầu. Mỗi subagent/tool nhận `AbortSignal`; check giữa các bước (giữa 2 LLM call, giữa tool call). Khi hủy: dọn file tạm (git checkout rollback), huỷ LLM request đang bay, ghi partial state (45 checkpoint) để resume. Khác "kill process" thô: cancel **cooperative** — agent tự thấy signal, dọn sạch rồi thoát.

## Kiến trúc

```
  USER: Cancel  ──►  ROOT ABORT SIGNAL (cancel all)
                          │ propagate
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   PARENT AGENT      SUBAGENT A         SUBAGENT B
   (sees signal,     (check signal,     (LLM call
    finishes step,    abort LLM,         in-flight →
    checkpoint,       cleanup temp)      AbortController.abort())
    exit)                   │                  │
                           ▼                  ▼
                      TOOL (cancels)    LLM (stream
                      file write        aborted, no
                      → unlink temp)    more tokens billed)

  Parent-hủy ⇒ subtree gọn — không subagent mồ côi, không LLM đốt token thừa
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent/src/pool.ts — session pool (có thể gắn signal)
// ✅ 26 actor-model — agent = actor (actor có thể nhận kill msg)
// ✅ 215 deadline-bound-execution — timeout (một dạng cancel)
// ✅ 45 wait-event-checkpoint — checkpoint để resume sau abort
// ✅ 54 handoff — giao subagent (cần cancel lan qua nhánh)

// ❌ THIẾU: AbortSignal lan truyền parent → child → tool
// ❌ THIẾU: cooperative cancel checkpoint (dọn giữa bước)
// ❌ THIẾU: cleanup hook (unlink file tạm, rollback git) khi abort
// ❌ THIẾU: abort stream LLM đang bay (stop token billing)
```

## Implementation

```typescript
// packages/agent/src/cancel.ts (NEW)
interface Cancellable {
  signal: AbortSignal;
  onCancel(fn: () => Promise<void>): void; // cleanup hook
}

class AgentTree {
  private controller = new AbortController();
  private cleanups: Array<() => Promise<void>> = [];

  cancel(): void { this.controller.abort(); }

  // Spawn subagent kế thừa signal — child hủy khi parent hủy
  spawnChild(): AgentTree {
    const child = new AgentTree();
    this.onCancel(() => child.cancel()); // parent-cancel ⇒ child-cancel
    return child;
  }

  onCancel(fn: () => Promise<void>): void { this.cleanups.push(fn); }

  // Agent loop: check signal giữa mỗi bước
  async step(): Promise<void> {
    if (this.controller.signal.aborted) {
      await this.cleanup(); // dọn file tạm, rollback, checkpoint
      return;
    }
    // ... làm việc ...
  }

  private async cleanup(): Promise<void> {
    await Promise.allSettled(this.cleanups.map((fn) => fn())); // gọn, không ném
  }
}

// LLM call chia sẻ signal → stream abort, ngưng billing token
const res = await llm.complete({ prompt, signal: tree.signal });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không subagent mồ côi (structured concurrency) | ❌ Mỗi bước phải check signal (boilerplate) |
| ✅ Dừng LLM stream đúng lúc — không đốt token thừa | ❌ Cleanup hook có thể fail (cần allSettled) |
| ✅ Dọn file tạm / rollback git khi abort | ❌ Cooperative — agent "phối hợp" (không kill cứng) |
| ✅ Checkpoint (45) cho resume sau abort | ❌ Nested signal phức tạp ở cây sâu |

## Khác các hướng gần

| | 215 Deadline Bound | 42 Circuit Breaker | KE: Cancel Propagation |
|---|---|---|---|
| Kích hoạt | Timeout (deadline) | Quá nhiều fail | **User / parent signal** |
| Phạm vi | 1 task | System-wide | **Cây (subtree)** |
| Dọn dẹp | Bỏ task | Ngừng gọi | **Cooperative cleanup + checkpoint** |
| Lan truyền | ❌ (chỉ task đó) | ❌ (global flag) | ✅ parent → child → tool |

## Khi nào chọn

- Agent spawn subagent / tool (cây sâu) — phải hủy gọn cả nhánh
- User cần Cancel đúng lúc (UI/CLI), không đợi task xong
- Cần dọn file tạm / rollback git khi hủy (artifact sạch)
- LLM stream phải abort sớm (tiết kiệm cost khi user đổi ý)
