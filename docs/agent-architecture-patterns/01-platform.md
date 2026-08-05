# Hướng A: Platform (HIỆN TẠI) — mya owns engine

> **Coupling:** 🔴 Nặng — gọi `createAgentSession()` nội bộ pi
> **Agent-agnostic:** ❌ — chỉ pi (in-process) + claude (subprocess)
> **Effort:** 0 (đã implement)

## Mô tả

mya tạo agent session IN-PROCESS bằng `createAgentSession()` từ `@earendil-works/pi-coding-agent`. Pi chạy agent loop trong cùng process với gateway. mya hook vào pi qua extension `mya-bridge` để inject tools, memory, audit, roles, skills.

## Kiến trúc

```
┌─ mya process ────────────────────────────────────────────┐
│                                                          │
│  createAgentSession()  ← gọi API nội bộ pi               │
│  ├─ inject extension (mya-bridge)                        │
│  │   ├─ register 26 tools (read/write/bash/grep/...)    │
│  │   ├─ hook turn_start/turn_end → memory/audit          │
│  │   ├─ hook tool_call/tool_result → Merkle audit        │
│  │   ├─ inject skills vào system prompt                  │
│  │   ├─ apply role overlay (tool filter + model)         │
│  │   ├─ autoCapture: extract facts → Brain               │
│  │   ├─ status reporting (working/done/failed)           │
│  │   └─ cron/channels/sync/collab wiring                 │
│  └─ pi chạy loop TRONG process mya                       │
│     (pi's event loop, pi's context, pi's compaction)     │
│                                                          │
│  ClaudeRuntime: subprocess (ngoại lệ, stdin-prompt)      │
│  MyaNativeRuntime: createAgent() → runTurn() (print mode)│
└──────────────────────────────────────────────────────────┘
```

## Coupling chi tiết

### 🔴 Deep coupling (runtime imports)

| File | Import | Mục đích |
|---|---|---|
| `print/src/pi-main.ts:84` | `await import("main")` | Chạy toàn bộ TUI qua pi entry |
| `print/src/runtimes/pi-in-process.ts:54,66` | `await import("ModelRuntime")`, `await import("pi-coding-agent")` | Tạo pi AgentSession |
| `print/src/pi-subagent.ts:27` | `import { createAgentSession }` (STATIC) | Spawn subagent qua pi session |
| `print/src/main.ts:973` | `await import("createAgentSession")` | Gateway subagent spawning |

### 🟡 Moderate coupling (pi-ai provider)

| File | Import |
|---|---|
| `gateway/index.ts:45-47` | `InMemoryCredentialStore`, `builtinModels`, `registerBunOAuthFlows` |
| `gateway/provider-registry.ts:11` | `builtinProviders()` |
| `agent/index.ts:1010` | `require.resolve.paths("pi-ai")` — fragile |
| `print/pi-main.ts:18-19` | `registerBuiltInApiProviders`, `registerBunOAuthFlows` |

### 🟢 Light coupling (type-only)

| File | Import |
|---|---|
| `core/runtime-spi.ts:15` | `type { Model, Api }` |
| `intercom/*.ts` | `type { ExtensionAPI, Theme, KeybindingsManager }` |

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Inject 26 tools trực tiếp | ❌ Găm pi — pi không OSS → chết |
| ✅ Hook mọi tool call → Merkle audit | ❌ Không agent-agnostic |
| ✅ Memory autoCapture real-time | ❌ Provider infra từ pi-ai |
| ✅ Role overlay (tool filter + model) | ❌ Intercom dùng pi-tui |
| ✅ Skills inject vào system prompt | ❌ Broker spec chưa build |
| ✅ Cost tracking per tool call | ❌ pi in-process (không isolated) |
| ✅ SmartRouter keyword routing | ❌ 7 packages phụ thuộc @earendil-works/* |

## Code thực tế

```typescript
// PiInProcessRuntime.start() — packages/print/src/runtimes/pi-in-process.ts
const { createAgentSession, DefaultResourceLoader } =
  await import("@earendil-works/pi-coding-agent");
const { createMyaBridge } = await import("../mya-bridge.js");
const myaBridge = createMyaBridge({ auditLog, secretStore, hooks, ... });

const { session } = await createAgentSession({
  cwd: opts.cwd,
  agentDir: opts.agentDir,
  resourceLoader,
  modelRuntime: await this.getModelRuntime(),
  extensionFactories: [{ name: "mya-bridge", factory: myaBridge }],
});

await session.bindExtensions({ mode: "print" });
return new PiInProcessSession(session, opts);
```

## Khi nào chọn hướng này

- Pi là open-source vĩnh viễn
- Cần kiểm soát toàn bộ (tools, memory, audit, roles, skills)
- Không cần agent-agnostic
- OK với deep coupling

## Migration path (nếu muốn thoát)

1. Thêm PiRpcRuntime (Hướng R) — spawn `pi --mode rpc` thay vì `createAgentSession()`
2. SmartRouter route đến PiRpcRuntime thay vì PiInProcessRuntime
3. PiInProcessRuntime giữ làm optional (cho deep integration khi cần)
