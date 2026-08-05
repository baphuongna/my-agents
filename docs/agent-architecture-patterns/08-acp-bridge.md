# Hướng H: ACP Protocol Bridge — mya ĐÃ CÓ package này

> **Coupling:** 🟢 Protocol (JSON-RPC over stdio)
> **Agent-agnostic:** ✅ — bất kỳ agent implement ACP
> **Code sẵn:** ✅ packages/acp

## Mô tả

Agent Client Protocol (ACP) là chuẩn giao tiếp agent-to-agent. mya spawn agent làm subprocess, giao tiếp qua JSON-RPC over stdio. Protocol: task/start (giao việc), task/progress (báo tiến trình), task/done (hoàn thành). Tool calls của agent route qua parent's permission gate.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                    mya daemon                            │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │    ACP Protocol Bridge (packages/acp)            │   │
│   │                                                  │   │
│   │    Wire protocol (JSON-RPC over stdio):          │   │
│   │    · task/start(goal, context, allowedTools)     │   │
│   │    · task/progress(output, tokensUsed)           │   │
│   │    · task/done(result, summary, keyOutputs)      │   │
│   │    · tool-request → parent permission gate       │   │
│   │    · tool-result ← parent returns                │   │
│   │                                                  │   │
│   │    Event ledger (bounded, replayable)            │   │
│   │    Session lineage (spawn tree)                  │   │
│   │    Triple-gate permission relay                  │   │
│   └────────────────────┬─────────────────────────────┘   │
│                        │                                 │
│   spawn("pi-rpc")      │ spawn("claude")    spawn("xyz") │
│   ←ACP→                │ ←ACP→              ←ACP→        │
╔════════════════════════╪═════════════════════════════════╗
║   ┌────────────┐  ┌────▼─────────┐  ┌────────────┐       ║
║   │  pi        │  │  claude      │  │  any agent │       ║
║   │  --mode rpc│  │  (ACP mode)  │  │ (ACP impl) │       ║
║   │            │  │              │  │            │       ║
║   │ own loop   │  │ own loop     │  │ own loop   │       ║
║   │ own tools  │  │ own tools    │  │ own tools  │       ║
║   └────────────┘  └──────────────┘  └────────────┘       ║
║   Bất kỳ agent implement ACP = orchestrated              ║
╚══════════════════════════════════════════════════════════╝
```

## mya ĐÃ BUILD packages/acp

```typescript
// packages/acp/src/index.ts — ĐÃ IMPLEMENT
export class AcpEventLedger {
  // Bounded replayable event log
  append(event: AcpEvent): void;
  replay(since: Cursor): AcpEvent[];
}

export interface LineageNode {
  sessionId: string;
  parentId?: string;
  depth: number;
  children: LineageNode[];
}

// Triple-gate permission relay:
// External agent's tool calls route through parent's permission gate
export async function relayToolRequest(
  toolName: string,
  input: unknown,
  parentGate: PermissionGate,
): Promise<ToolResult> {
  // 1. Check parent's permission rules
  const allowed = parentGate.check(toolName, input);
  // 2. If needs approval → ask parent (human)
  if (allowed.needsApproval) {
    const approved = await parentGate.askHuman(toolName, input);
    if (!approved) return { ok: false, error: "denied by parent" };
  }
  // 3. Execute (or let agent execute)
  return { ok: true, output: "..." };
}
```

## Khác MCP ở chỗ

| | MCP | ACP |
|---|---|---|
| Mục đích | Expose TOOLS (functions) | Delegate TASKS (goals) |
| Granularity | Tool-level (call function) | Task-level (give goal, get result) |
| Communication | Request-response | Stream (task/start → progress → done) |
| Permission | None built-in | Triple-gate relay (parent controls) |
| Lineage | None | Spawn tree tracking |
| Replay | None | Bounded event ledger |

## Protocol chi tiết

### Parent → Child (task delegation)
```jsonrpc
{"method":"task/start","id":"t1","params":{
  "goal":"Fix the authentication bug in auth.ts",
  "context":"User reported JWT validation fails on expired tokens",
  "allowedTools":["read","write","edit","bash","grep"],
  "budget":{"maxToolRounds":25,"maxTokens":100000}
}}
```

### Child → Parent (progress)
```jsonrpc
{"method":"task/progress","params":{
  "taskId":"t1",
  "output":"Reading auth.ts...",
  "tokensUsed":500
}}
```

### Child → Parent (tool permission request)
```jsonrpc
{"method":"tool-request","id":"tr1","params":{
  "tool":"bash",
  "input":{"command":"npm test"}
}}
```

### Parent → Child (tool result)
```jsonrpc
{"result":{"id":"tr1","output":"All tests passed"}}
```

### Child → Parent (done)
```jsonrpc
{"method":"task/done","params":{
  "taskId":"t1",
  "result":"Fixed JWT validation to handle expired tokens",
  "summary":"Added try-catch around jwt.verify() in auth.ts:42",
  "keyOutputs":["auth.ts:42","auth.test.ts:15"]
}}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Code sẵn (packages/acp) | ❌ Agents phải implement ACP protocol |
| ✅ Permission relay (parent controls child tools) | ❌ Protocol overhead (JSON-RPC framing) |
| ✅ Session lineage tracking | ❌ Stdio-only (không network transport) |
| ✅ Replayable event ledger | ❌ No shared state (serialize everything) |
| ✅ Standardized wire protocol | ❌ ACP chưa phổ biến (adoption barrier) |

## Khi nào chọn

- Muốn standardized protocol cho agent-to-agent
- Cần permission relay (parent controls child's tool access)
- OK với agents phải implement ACP
- Muốn replay/debug (event ledger)

## Migration path

1. Wire `packages/acp` làm primary integration mode
2. PiInProcessRuntime → PiAcpRuntime (spawn pi --mode rpc, speak ACP)
3. ClaudeRuntime → thêm ACP layer (wrap stdin/stdout trong ACP protocol)
4. SmartRouter route đến ACP bridge thay vì in-process runtime
