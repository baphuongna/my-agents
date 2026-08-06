# Hướng PD: Cross-Platform Runtime Adapters — cùng graph chạy cursor/claude/clint qua runtime adapters

> **Nguồn gốc:** graphify (cross-platform runtime adapters); "same graph runs across Cursor/Claude/Cline via adapter"; "runtime abstraction over agent platforms"; "platform-agnostic graph execution"; "adapter pattern for agent runtimes"
> **Coupling:** 🟡 — thêm runtime-adapter abstraction layer trên agent platforms
> **Agent-agnostic:** ⚠️ (agent-platform-specific by nature — adapter bridges)
> **Code sẵn:** ⚠️ (interop protocols + transports sẵn — chưa có cross-platform graph adapter)
> **Effort:** 4-5 tuần

## Nguồn gốc

**graphify** tách **graph logic** khỏi **agent runtime** qua **adapter pattern**: cùng graph (workflow/KG query) chạy trên nhiều platform — **Cursor**, **Claude Code**, **Cline**, **Continue** — mỗi platform có **runtime adapter** dịch graph operations → platform API. Vd graph node "read file" → Cursor adapter gọi Cursor API, Claude adapter gọi Claude API. Nguyên tắc: **graph platform-agnostic** — logic 1 lần, chạy mọi nơi qua adapter. Khác **189 interop-protocols** — PD là **runtime adapter** (không phải protocol); khác **08 ACP-bridge** — PD adapter cho **graph execution** (không phải agent comm).

## Mô tả

mya cross-platform runtime adapters: (1) **Runtime interface** — abstract operations (read, write, search, graph-query). (2) **Adapters** — impl cho mỗi platform (Cursor, Claude, Cline). (3) **Graph executor** — chạy graph nodes qua adapter (platform-agnostic). (4) **Swap runtime** — đổi platform = đổi adapter (graph không đổi). mya có `189 interop` + `08 ACP-bridge` — PD thêm **runtime-adapter** cho graph execution.

## Kiến trúc

```
  ┌─── GRAPH (platform-agnostic logic) ────────────────┐
  │  node: read_file("auth.ts")                         │
  │  node: graph_query("auth dependencies")             │
  │  node: write_file("auth.ts", newContent)            │
  └───────────────────────┬─────────────────────────────┘
                          │ execute via adapter
                          ▼
  ┌─── RUNTIME ADAPTER (swap per platform) ────────────┐
  │                                                     │
  │  ┌─────────────────┐  ┌─────────────────┐          │
  │  │ CursorAdapter   │  │ ClaudeAdapter   │          │
  │  │ read → Cursor   │  │ read → Claude   │          │
  │  │   API           │  │   API           │          │
  │  │ write → Cursor  │  │ write → Claude  │          │
  │  │   edit API      │  │   edit API      │          │
  │  └─────────────────┘  └─────────────────┘          │
  │  ┌─────────────────┐  ┌─────────────────┐          │
  │  │ ClineAdapter    │  │ ContinueAdapter │          │
  │  │ read → Cline    │  │ read → Continue │          │
  │  │   MCP           │  │   API           │          │
  │  └─────────────────┘  └─────────────────┘          │
  └───────────────────────┬─────────────────────────────┘
                          │ same graph, different runtime
                          ▼
  ┌─── PLATFORM EXECUTION ─────────────────────────────┐
  │  Cursor:  graph runs → Cursor does read/write      │
  │  Claude:  graph runs → Claude does read/write      │
  │  Cline:   graph runs → Cline does read/write       │
  │  → SAME GRAPH, different platform capabilities     │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 189 interop-protocols — agent interop (nền — PD = runtime adapter)
// ✅ 08 ACP-bridge — agent comm protocol (nền — PD = graph exec adapter)
// ✅ 09 pi-rpc-bridge — RPC bridge (nền — PD = multi-platform)
// ✅ 164 agentic-workflows-as-code — workflow graph (nền — PD runs graph)
// ✅ 172 multi-agent-collab — multi-agent (nền — PD = cross-runtime)

// ❌ THIẕU: runtime interface (abstract read/write/search/graph-query)
// ❌ THIẕU: platform adapters (Cursor/Claude/Cline impls)
// ❌ THIẕU: graph executor via adapter (platform-agnostic run)
```

## Implementation

```typescript
// packages/agent/src/runtime/cross-platform-adapters.ts (MỚI)
// Abstract runtime interface — platform-agnostic operations
interface RuntimeAdapter {
  platform: string;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  search(query: string): Promise<string[]>;
  graphQuery(query: string): Promise<unknown>;
}

// Concrete adapters
class CursorAdapter implements RuntimeAdapter {
  platform = 'cursor';
  async readFile(path: string): Promise<string> { /* Cursor API */ return ''; }
  async writeFile(path: string, content: string): Promise<void> { /* Cursor edit API */ }
  async search(query: string): Promise<string[]> { /* Cursor search */ return []; }
  async graphQuery(query: string): Promise<unknown> { /* Cursor graph */ return null; }
}

class ClaudeAdapter implements RuntimeAdapter {
  platform = 'claude';
  async readFile(path: string): Promise<string> { /* Claude Code API */ return ''; }
  async writeFile(path: string, content: string): Promise<void> { /* Claude edit */ }
  async search(query: string): Promise<string[]> { return []; }
  async graphQuery(query: string): Promise<unknown> { return null; }
}

class ClineAdapter implements RuntimeAdapter {
  platform = 'cline';
  async readFile(path: string): Promise<string> { /* Cline MCP */ return ''; }
  async writeFile(path: string, content: string): Promise<void> { /* Cline edit */ }
  async search(query: string): Promise<string[]> { return []; }
  async graphQuery(query: string): Promise<unknown> { return null; }
}

// Platform-agnostic graph executor — runs graph nodes via adapter
interface GraphNode {
  op: 'read' | 'write' | 'search' | 'graph-query';
  args: unknown[];
}

class GraphExecutor {
  constructor(private adapter: RuntimeAdapter) {}

  // Swap platform = swap adapter (graph unchanged)
  use(adapter: RuntimeAdapter): void { this.adapter = adapter; }

  async run(nodes: GraphNode[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const node of nodes) {
      switch (node.op) {
        case 'read': results.push(await this.adapter.readFile(node.args[0] as string)); break;
        case 'write': await this.adapter.writeFile(node.args[0] as string, node.args[1] as string); break;
        case 'search': results.push(await this.adapter.search(node.args[0] as string)); break;
        case 'graph-query': results.push(await this.adapter.graphQuery(node.args[0] as string)); break;
      }
    }
    return results;
  }
}

// Usage:
// const graph: GraphNode[] = [
//   { op: 'read', args: ['auth.ts'] },
//   { op: 'graph-query', args: ['auth dependencies'] },
// ];
// const cursorExec = new GraphExecutor(new CursorAdapter());
// await cursorExec.run(graph);  // runs on Cursor
// cursorExec.use(new ClaudeAdapter());
// await cursorExec.run(graph);  // SAME graph runs on Claude
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Graph platform-agnostic (logic 1 lần, chạy mọi nơi) | ❌ Adapter maintenance (mỗi platform API đổi → update) |
| ✅ Swap runtime dễ (đổi adapter, graph giữ) | ❌ Capability mismatch (platform thiếu op → degraded) |
| ✅ Multi-platform test (chạy graph trên nhiều runtime) | ❌ Abstraction leak (platform-specific features mất) |
| ✅ Nối 189 interop + 08 ACP (bridge base) | ❌ Overhead (adapter layer indirection) |

## Khác các hướng gần

| | 189 Interop-Protocols | 08 ACP-Bridge | 164 Workflows-as-Code | PD: Cross-Platform-Adapters |
|---|---|---|---|---|
| Cái gì | Agent interop | Agent comm | Workflow graph | **Runtime adapter pattern** |
| Abstraction | Protocol | Bridge | Workflow | **Runtime interface** |
| Multi-platform | ❌ | ❌ | ❌ | ✅ Cursor/Claude/Cline |
| Swap runtime | ❌ | ❌ | ❌ | ✅ change adapter |

## Khi nào chọn

- Graph/workflow cần chạy trên nhiều platform agent (Cursor + Claude + Cline)
- Muốn logic 1 lần (graph) + adapter per platform
- Cần swap runtime dễ (đổi platform không rewrite graph)
- Nối 189 interop-protocols (interop base) + 08 ACP-bridge (bridge pattern) + 164 agentic-workflows-as-code (graph source); guard capability mismatch (graceful degradation) + adapter maintenance (version pin per platform API)
