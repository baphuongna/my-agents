# Hướng NM: Tool Execution Order Preservation — tool chạy parallel nhưng persist theo thứ tự gọi nguồn

> **Nguồn gốc:** pi-core-agent / pi-agent-core; "parallel tool execution" (208); "causal ordering"; "happened-before" (Lamport); "write-ahead serialization"; "deterministic output ordering"; "parallel execution, serial persistence"; "causal consistency"
> **Coupling:** 🟡 — cần ordering layer giữa parallel execution và persistence
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (parallel tool calls sẵn — chưa có source-order persistence)
> **Effort:** 2 tuần

## Nguồn gốc

**Parallel tool calls** (208): agent gọi nhiều tool cùng lúc → chạy concurrent → giảm latency. Nhưng **kết quả persist theo thứ tự gọi gốc** (source order), không phải thứ tự hoàn thành (completion order). Nguyên lý từ **causal ordering** (Lamport happened-before): nếu tool A được gọi trước tool B trong message, A's result xuất hiện trước B trong output — dù B hoàn thành trước A. Giống **causal consistency** (distributed systems): order trong output phản ánh **intent order** (thứ tự agent muốn), không **execution order** (thứ tự thread finish). Lý do: LLM đọc output tuần tự — nếu result không theo thứ tự gọi, agent nhầm lẫn về因果关系. Khác **208 parallel-tool-calls** (chỉ execution) — NM thêm **deterministic persistence ordering**.

## Mô tả

mya tool execution order preservation: khi agent gọi 3 tool cùng lúc (A, B, C), runtime: (1) execute tất cả **parallel** (concurrent, giảm latency); (2) collect results; (3) **persist/display theo source order** (A → B → C), không theo completion order. Mỗi tool call gắn `callIndex` (vị trí trong message gốc). Reorder buffer: hold result B nếu A chưa xong. Agent thấy output theo thứ tự gọi → consistent mental model. Nối 208 parallel-tool-calls + 122 agent-reproducibility (deterministic order).

## Kiến trúc

```
  AGENT message: 3 tool calls in one response
  ┌──────────────────────────────────────────┐
  │  call#0: read_file("a.ts")               │
  │  call#1: read_file("b.ts")               │
  │  call#2: grep("pattern", "src/")         │
  └──────────────────────────────────────────┘
        │
        │  EXECUTE ALL IN PARALLEL (concurrent)
        ▼
  ┌─── PARALLEL EXECUTION ──────────────────────┐
  │                                              │
  │  call#2 (grep)     finishes FIRST  (50ms)   │
  │  call#0 (read a)   finishes SECOND (80ms)   │
  │  call#1 (read b)   finishes THIRD  (120ms)  │
  │                                              │
  │  completion order: #2, #0, #1               │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  ┌─── REORDER BUFFER (persist in SOURCE ORDER) ─┐
  │                                               │
  │  Hold #2 result until #0 done                 │
  │  Hold #0 result (already done)                │
  │  #1 result arrives → all ready                │
  │                                               │
  │  PERSIST ORDER: #0 → #1 → #2 (source order)  │
  │  NOT: #2 → #0 → #1 (completion order)         │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  AGENT sees results in CALL ORDER:
    [0] a.ts content...
    [1] b.ts content...
    [2] grep results...
  (consistent with causal intent)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 208 parallel-tool-calls — concurrent execution (nền — NM adds ordering)
// ✅ 122 agent-reproducibility — determinism (nền — NM = deterministic order)
// ✅ tool registry + execution — sẵn
// ✅ 291 cancel-propagation — cancel handling (nền)

// ❌ THIẾU: callIndex tracking (source order per tool call)
// ❌ THIẾU: reorder buffer (hold early results until source-order ready)
// ❌ THIẾU: source-order persistence (display/write in call order)
// ❌ THIẾU: deterministic output (same order every replay)
```

## Implementation

```typescript
// packages/agent/src/tool-order.ts (NEW)
interface ToolCall {
  callIndex: number;     // position in agent's message (source order)
  toolName: string;
  args: unknown;
}

interface ToolResult {
  callIndex: number;
  output: string;
  error?: string;
}

class OrderedToolExecutor {
  // Execute parallel, persist in source order
  async executeAndPersist(calls: ToolCall[]): Promise<ToolResult[]> {
    // 1. Fire all calls in parallel
    const promises = calls.map((call) =>
      this.executeTool(call).then((output) => ({ callIndex: call.callIndex, output })),
    );
    const settled = await Promise.allSettled(promises);

    // 2. Build results map
    const results = new Map<number, ToolResult>();
    settled.forEach((s, i) => {
      const callIndex = calls[i]!.callIndex;
      if (s.status === 'fulfilled') {
        results.set(callIndex, { callIndex, output: s.value.output });
      } else {
        results.set(callIndex, { callIndex, output: '', error: String(s.reason) });
      }
    });

    // 3. Return in SOURCE ORDER (not completion order)
    return calls
      .map((c) => results.get(c.callIndex)!)
      .filter(Boolean);
  }

  // Streaming variant: emit results as they complete BUT in source order
  // (hold early results until all preceding indices are done)
  async *executeOrdered(calls: ToolCall[]): AsyncGenerator<ToolResult> {
    const pending = new Map<number, Promise<ToolResult>>();
    const completed = new Map<number, ToolResult>();
    let nextIndex = 0;

    // Fire all parallel
    for (const call of calls) {
      pending.set(call.callIndex, this.executeTool(call));
    }

    // Poll: emit in source order as soon as contiguous prefix is ready
    while (nextIndex < calls.length) {
      const result = await pending.get(nextIndex);
      if (result) {
        completed.set(nextIndex, result);
        // Emit contiguous prefix
        while (completed.has(nextIndex)) {
          yield completed.get(nextIndex)!;
          nextIndex++;
        }
      }
    }
  }

  private async executeTool(call: ToolCall): Promise<ToolResult> {
    // actual tool execution (concurrent)
    return { callIndex: call.callIndex, output: '' };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Parallel speed (concurrent execution) + consistent output | ❌ Reorder buffer latency (hold early results) |
| ✅ Deterministic order (reproducible — same order every run) | ❌ Head-of-line blocking (slow call#0 delays all) |
| ✅ Agent mental model consistent (output theo call order) | ❌ Memory: hold results in buffer |
| ✅ Causal clarity (result[0] = first call) | ❌ Error handling: 1 call fail → reorder still needed |

## Khác các hướng gần

| | 208 Parallel-Tool-Calls | 122 Reproducibility | 291 Cancel-Propagation | NM: Order-Preservation |
|---|---|---|---|---|
| Mục | Concurrent execution | Deterministic run | Cancel fan-out | **Source-order persistence** |
| Order | Completion | Seed-based | ❌ | **Call index (source order)** |
| Parallel | ✅ | ❌ | ❌ | ✅ (execute parallel, persist ordered) |

## Khi nào chọn

- Agent gọi nhiều tool parallel (208) nhưng cần output nhất quán
- Cần reproducibility (deterministic order, 122)
- Agent đọc output tuần tự (causal order = call order)
- Nối 208 parallel-calls + 122 reproducibility + 375 differential-resume (journal order = source order)
