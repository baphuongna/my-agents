# Hướng QM: Fuzzy Kernel Tool Reentry — kernel Python/JS bền eval gọi lại tool agent qua loopback bridge

> **Nguồn gốc:** oh-my-pi (fuzzy kernel tool reentry); "persistent kernel calls back agent tools"; "loopback bridge for code→agent tool invocation"; "durable eval with agent tool access"; "bidirectional code-execution ↔ tool bridge"
> **Coupling:** 🟡 — cần persistent kernel + loopback bridge + tool reentry protocol
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (code-exec tool + kernel sẵn — chưa có loopback bridge + tool reentry from kernel)
> **Effort:** 3-4 tuần

## Nguồn gốc

**oh-my-pi** có **kernel bền** (persistent Python/JS — sống qua nhiều eval, giữ state). Kernel có thể **gọi lại tool agent** qua **loopback bridge**: code trong kernel invoke agent tool (read file, search, query memory) → bridge route → agent tool → result trả về kernel. Giống **Jupyter kernel** (persistent) + **RPC** (call across boundary). **Fuzzy**: bridge handle imperfect/async (timeout, retry, partial result). Nguyên tắc: **code execution ↔ agent tool = bidirectional** — agent gọi code (eval), code gọi lại agent tool (reentry). Khác **83 tool-discovery** (find tools) — QM là **invoke tool from kernel**; khác code-exec (agent → code) — QM thêm **code → agent (reentry)**.

## Mô tả

mya fuzzy kernel tool reentry: **persistent kernel** (Python/JS) chạy code. Kernel expose **loopback bridge**: `agent.read_file("path")`, `agent.search("query")`, `agent.memory_query(...)`. Code trong kernel gọi → bridge serialize request → route về agent tool dispatcher → tool execute → result serialize → trả về kernel. **Fuzzy handling**: timeout (code chờ tool), retry (tool fail), partial (streaming result). Kernel bền (state persist giữa eval). Nối code-exec tool + 83 tool-discovery + 88 hybrid-graph-vector.

## Kiến trúc

```
  AGENT ──────eval(code)──────► KERNEL (persistent Python/JS)
                                   │
                                   │ code runs:
                                   │ data = agent.read_file("data.json")
                                   │     │
                                   │     │ ← loopback bridge call
                                   │     ▼
  AGENT ◄──tool-result(data)── BRIDGE ──► agent.read_file tool
  (tool dispatcher)                │       │
                                   │       ▼
                                   │   FILESYSTEM
                                   │       │
                                   │       ▼
                                   │   result → serialize → bridge
                                   │     │
                                   │     ▼
  AGENT                           KERNEL receives result, continues
                                   │ data = {...}  ← tool result
                                   │ process(data)
                                   │
                                   ▼
                               KERNEL OUTPUT → agent

  BIDIRECTIONAL:
  Agent → Kernel:  eval(code)           (existing code-exec)
  Kernel → Agent:  agent.tool(...)      (NEW: loopback reentry)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ code-exec tool — agent → code execution (nền — QM adds reentry)
// ✅ persistent kernel — durable Python/JS (nền — QM = loopback trên kernel)
// ✅ 83 tool-discovery — tool registry (nền — QM = kernel invokes from registry)
// ✅ 88 hybrid-graph-vector-memory — memory query (tool kernel can call)

// ❌ THIẾU: loopback bridge (kernel → agent tool dispatcher route)
// ❌ THIẾU: tool reentry protocol (serialize request/response across boundary)
// ❌ THIẾU: fuzzy handling (timeout, retry, partial result in bridge)
// ❌ THIẾU: kernel-side agent.* API surface (read_file, search, memory_query)
```

## Implementation

```typescript
// packages/agent/src/kernel-reentry.ts (NEW)
interface ToolReentryRequest {
  toolName: string;
  args: unknown[];
  callId: string;
}
interface ToolReentryResponse {
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

class LoopbackBridge {
  constructor(private toolDispatcher: (name: string, args: unknown[]) => Promise<unknown>) {}

  // Called from kernel (via injected agent.* API)
  async callTool(request: ToolReentryRequest): Promise<ToolReentryResponse> {
    try {
      const result = await this.withTimeout(
        this.toolDispatcher(request.toolName, request.args),
        30_000, // 30s timeout (fuzzy)
      );
      return { callId: request.callId, ok: true, result };
    } catch (err) {
      // Fuzzy: retry once on failure
      try {
        const retry = await this.toolDispatcher(request.toolName, request.args);
        return { callId: request.callId, ok: true, result: retry };
      } catch (retryErr) {
        return { callId: request.callId, ok: false, error: String(retryErr) };
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }
}

// Inject agent.* API surface into kernel
function injectAgentApi(kernel: { eval: (code: string) => Promise<unknown> }, bridge: LoopbackBridge): void {
  // Prepend agent.* bridge shim to every eval
  const shim = `
    const agent = {
      read_file: (path) => __bridge_call__('read', [path]),
      search: (query) => __bridge_call__('grep', [query]),
      memory_query: (q) => __bridge_call__('memory_query', [q]),
    };
  `;
  // Kernel's __bridge_call__ routes to LoopbackBridge.callTool
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bidirectional (code → agent tool, không chỉ agent → code) | ❌ Bridge complexity (serialize, route, timeout) |
| ✅ Persistent kernel + tool access (code giữ state, gọi tool) | ❌ Security (kernel arbitrary code → agent tool = escalation) |
| ✅ Fuzzy handling (timeout, retry, partial) | ❌ Deadlock risk (tool calls eval → eval calls tool → ...) |
| ✅ Powerful (data analysis code query memory directly) | ❌ Latency (bridge round-trip per tool call) |

## Khác các hướng gần

| | 83 Tool-Discovery | code-exec tool | 08 Subagents | QM: Kernel-Reentry |
|---|---|---|---|---|
| Trọng tâm | Find tools | Agent → code | Delegate task | **Code → agent tool** |
| Hướng | Agent → tool | Agent → code | Agent → agent | **Kernel → agent (reentry)** |
| Kernel | ❌ | ✅ (stateless?) | ❌ | **✅ (persistent + tool access)** |

## Khi nào chọn

- Code trong kernel cần gọi agent tool (read file, search, query memory)
- Persistent kernel (state giữ qua eval) + tool access
- Muốn bidirectional (agent → code + code → agent)
- Nối code-exec tool + 83 tool-discovery + 88 hybrid-graph-vector-memory
