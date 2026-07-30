# mya Agent-Agnostic Architecture Analysis

> **Question**: If mya pushes up one layer (like herdr) — stops managing the AI core,
> lets any agent (pi, Claude Code, OpenCode, ...) be the engine — are the current
> features still viable? For now, use pi as the core.

## TL;DR

**YES — overwhelmingly viable.** mya's coupling to pi is concentrated in exactly
**one package** (`coding-agent`, 58/177 files). The other **169 source files across
6 packages have ZERO pi imports** — they're already agent-agnostic. The bridge's
agent-extension surface is a **9-method local interface** (`MyaPiApi`) that any
agent can implement.

**Transition strategy**: Use pi now → formalize `AgentCore` SPI → add adapters.
Zero rewrites needed.

---

## 1. Evidence: Where is pi coupling?

### Import-level coupling map (compile-time `@my-agent/pi-*` imports)

| Package | Source files | Pi imports | Status |
|---|---|---|---|
| `coding-agent` | 177 | **58** | 🔴 Pi engine (the ONLY deep coupling) |
| `gateway` | 22 | **0** | ✅ Agent-agnostic (2 "imports" are comments) |
| `print` | 39 | **0** | ✅ Agent-agnostic (`MyaPiApi` is local type) |
| `memory` | 53 | **0** | ✅ Agent-agnostic |
| `cron` | 5 | **0** | ✅ Agent-agnostic |
| `web` | 46 | **0** | ✅ Agent-agnostic |
| `agent` | 4 | **0** | ✅ Agent-agnostic |

**169 / 346 files (49%) are already agent-agnostic.** The remaining 51% is the pi
engine itself — which is what gets swapped.

### coding-agent breakdown (where the 58 pi imports live)

```
core/     37 files  ← Agent, AgentSession, model-runtime, sdk, tools, compaction
modes/    13 files  ← InteractiveMode, TUI components
cli/       4 files  ← args parser
main.ts    1 file
```

### The bridge's agent surface is ALREADY abstracted

`packages/print/src/mya-bridge.ts:142`:

```typescript
export interface MyaPiApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, options: unknown): void;
  registerShortcut(shortcut: string, options: unknown): void;
  getActiveTools?(): string[];
  setActiveTools?(toolNames: string[]): void;
  setModel?(model: { id: string; provider?: string }): Promise<boolean>;
  modelRegistry?: { getAll?(): Array<{ id: string; provider?: string }> };
  sendUserMessage?(content: string | unknown[]): void;
}
```

This is **defined locally** — NOT imported from pi. The bridge receives `pi` as a
**runtime parameter** (`createMyaBridge(opts): (pi: MyaPiApi) => void`), not a
compile-time dependency. Rename to `AgentExtensionApi` → any agent that implements
these 9 methods works with the entire mya-bridge.

---

## 2. Feature viability by tier

### Tier 1 — Already agent-agnostic (ZERO work) ✅

| Feature | Why it works |
|---|---|
| **Gateway pool/tree/acquire/kill** | Pure HTTP registry. Sessions have `{command, pid, status}` — agent doesn't matter. |
| **ViewBackend SPI** (tmux/herdr/standalone/zellij/screen) | Opens a terminal with ANY command string. `claude-code`, `opencode`, `mya` — all just argv. |
| **/agents panel** | Reads `/pool/tree` from gateway. Gateway is agent-agnostic → panel is too. |
| **Role-subagent spawn** | `view.open({command: ["claude-code", "--task", ...]})` — any agent. |
| **Role-subagent kill** | Process kill via gateway. Agent-agnostic. |
| **Role-subagent concurrent** | Multiple sessions in pool — any mix of agents. |
| **Memory (Brain/Sqlite)** | 53 files, 0 pi imports. Standalone service. |
| **Cron** | 5 files, 0 pi. Triggers processes/API calls. |
| **Web plugin SDK** | 46 files, 0 pi. Connects to gateway (agent-agnostic). |
| **Role definitions** (roles.ts) | 0 pi imports. JSON-driven role overlay. |
| **Hermes ports** (cron grace-window, web SDK) | Gateway-level. Agent-agnostic. |

### Tier 2 — Needs adapter (MINIMAL work) ⚠️

| Feature | Current mechanism | Adapter need |
|---|---|---|
| **Subagent status** (working/done/failed) | `pi.on("turn_start")` → POST to gateway | Each agent reports status differently. Claude Code: `Stop` hook. OpenCode: server events. |
| **Structured results** (summary/keyOutputs) | `pi.on("message_end")` → parse `<DONE>` | Already broken for pi! Per-adapter capture (CC: stdout parse, OpenCode: JSON-RPC result). |
| **Slash commands** | `pi.registerCommand()` | Each agent's command system. CC: custom commands. OpenCode: custom commands. |
| **Tool registration** | `pi.registerTool()` | Each agent's tool system. CC: MCP tools. OpenCode: custom tools. |
| **Auto-task injection** | `pi.sendUserMessage()` | CC: `--print` or session API. OpenCode: server RPC. |
| **Model switching** | `pi.setModel()` | CC: `--model` flag. OpenCode: config. |

**Adapter contract** = the 9-method `MyaPiApi` interface. Each agent implements it:

```
PiAdapter       → wraps pi's InlineExtension API (CURRENT)
ClaudeCodeAdapter → wraps claude-code hooks + MCP + --print
OpenCodeAdapter  → wraps opencode server JSON-RPC
```

### Tier 3 — Engine-specific (per-agent reimplementation) 🔴

These live inside `coding-agent/src/core/` and are deeply pi-specific:

| Feature | Why it's engine-specific |
|---|---|
| **Agent loop** (`new Agent()`) | pi-agent-src's Agent class. Each agent has its own loop. |
| **Model streaming** (`streamSimple`) | pi-ai's provider abstraction. CC/OpenCode have own model systems. |
| **Model/auth management** (`model-runtime.ts`) | pi-ai providers (37+). CC has Bedrock/OpenAI. OpenCode has its own. |
| **Session management** (`AgentSession`) | pi session lifecycle. CC has `--resume`. OpenCode has server sessions. |
| **Compaction** | pi's block-scoring compaction. CC has its own. |
| **LSP cascade** | pi's tool_result → diagnostics hook. CC: PostToolUse hook. |
| **Output compression** | pi's 5-stage pipeline. CC: hook-based. |

**These are NOT "features" — they're engine internals.** When you swap the engine,
you inherit the new engine's version of these. mya doesn't need to reimplement them.

---

## 3. Architecture: "push up one layer"

### Current

```
┌─────────────────────────────────────────────────────┐
│ mya (print)                                         │
│  gateway · view SPI · agents panel · mya-bridge     │
│  memory · cron · web SDK · roles                    │
├─────────────────────────────────────────────────────┤
│ coding-agent (PI ENGINE — locked to pi)             │
│  Agent · AgentSession · model-runtime · streamSimple│
│  tools · compaction · auth · providers              │
├─────────────────────────────────────────────────────┤
│ pi-agent-src · pi-ai-src (VENDORED PI)              │
└─────────────────────────────────────────────────────┘
```

### Target (agent-agnostic)

```
┌─────────────────────────────────────────────────────┐
│ mya (ORCHESTRATOR — agent-agnostic)                 │
│  gateway · view SPI · agents panel                  │
│  memory · cron · web SDK · roles                    │
├─────────────────────────────────────────────────────┤
│ AgentCore SPI (AgentExtensionApi — 9 methods)       │
│  on() · registerTool() · registerCommand()          │
│  setModel() · sendUserMessage() · ...               │
├──────────────┬──────────────┬───────────────────────┤
│ PiCore       │ ClaudeCode   │ OpenCodeCore          │
│ (coding-agent│ Adapter      │ Adapter               │
│  = current)  │ (claude CLI  │ (opencode server      │
│              │  + hooks)    │  JSON-RPC)            │
├──────────────┼──────────────┼───────────────────────┤
│ pi-agent-src │ claude-code  │ opencode              │
│ (vendored)   │ (external)   │ (external)            │
└──────────────┴──────────────┴───────────────────────┘
```

### What changes vs what stays

| Layer | Change needed |
|---|---|
| gateway, memory, cron, web, agent | **NOTHING** — already agent-agnostic |
| print (view, panel, bridge) | **Rename** `MyaPiApi` → `AgentExtensionApi`. Logic unchanged. |
| coding-agent | **Becomes** `PiCore implements AgentCore`. Already the pi implementation. |
| New: AgentCore SPI | Formalize the 9-method interface as a shared type. |
| New: ClaudeCodeAdapter | Wrap `claude` CLI. Implement 9 methods via hooks/MCP. |
| New: OpenCodeAdapter | Wrap `opencode` server. Implement 9 methods via JSON-RPC. |

---

## 4. Transition strategy

### Phase 0 — Now: pi as sole engine ✅

Everything works. No changes needed. This IS the current state.

### Phase 1 — Formalize the SPI (low effort, high value)

1. Extract `MyaPiApi` → shared `AgentExtensionApi` type (in `@my-agent/core` or new `@my-agent/agent-spi`).
2. Rename `coding-agent` conceptually as `PiCore` (no code move — just mental model).
3. Gateway `createAgentSession` already accepts `extensionFactories` — formalize as `AgentCore.createSession(opts)`.

**Effort**: ~1 day. No behavior change. Just type extraction + rename.

### Phase 2 — Second adapter (prove the SPI)

Add `ClaudeCodeAdapter`:
- `on(event)`: wrap CC hooks (PreToolUse, PostToolUse, Stop, Notification).
- `registerCommand()`: write CC custom command files.
- `registerTool()`: register MCP server.
- `sendUserMessage()`: `claude --print --session-id X "task"`.
- `setModel()`: `--model` flag.

**Effort**: ~3-5 days. Proves the SPI works with a non-pi agent.

### Phase 3 — Multi-engine (the payoff)

Role-subagents can use DIFFERENT engines:

```
spawn-role-subagent(role="coder", engine="claude-code", task="refactor X")
spawn-role-subagent(role="reviewer", engine="pi", task="review Y")
spawn-role-subagent(role="researcher", engine="opencode", task="research Z")
```

Gateway pool manages them uniformly. /agents panel shows mixed-engine tree.
View SPI opens each in its own terminal pane.

**This is the herdr analogy**: herdr manages ANY terminal. mya manages ANY agent.

---

## 5. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Adapter contract too pi-specific | MEDIUM | `MyaPiApi`'s 9 methods are generic (events, tools, commands, model). Verify against CC/OpenCode APIs before formalizing. |
| Claude Code doesn't expose enough hooks | LOW | CC has PreToolUse, PostToolUse, Stop, Notification, SessionStart. Covers status reporting + result capture. |
| Status reporting latency | LOW | CC `Stop` hook fires on completion. OpenCode server events are real-time. |
| Memory injection per-agent | MEDIUM | Memory stays as a gateway-level service. Each adapter reads/writes via HTTP API (not agent-internal). |
| Auth/model management fragmentation | MEDIUM | Each adapter handles its own auth. Gateway doesn't manage models — the engine does. |
| Structured results | LOW | Already broken for pi. Per-adapter capture is no worse. |

---

## 6. Hermes features viability under agent-agnostic model

| Hermes port | Agent-agnostic? | Notes |
|---|---|---|
| **#4 Cron grace-window** | ✅ Yes | Gateway-level catchup. Engine-independent. |
| **#5 Web plugin SDK** | ✅ Yes | Connects to gateway. Engine-independent. |
| **#2 Per-subagent budget** | ⚠️ Adapter | Iteration counting is engine-specific. Pi: agent-loop. CC: token counting. |
| **#3 AST tool registry** | ⚠️ Adapter | Tool registration is engine-specific. But AST analysis itself is agent-agnostic. |
| **Role-subagent** | ✅ Spawn/kill agnostic. ⚠️ Status via adapter. | Core lifecycle works. Status reporting needs adapter. |

---

## 7. Conclusion

**mya is already 49% agent-agnostic by file count, and the remaining 51% is
isolated in one swappable package.** The bridge's extension surface is a 9-method
local interface — not a pi import. The gateway, view SPI, memory, cron, web, and
role-subagent lifecycle are all engine-independent.

**"Use pi for now" is the correct transition.** No architectural debt is incurred
because the coupling is already contained. When a second engine is needed, the
SPI formalization is a ~1-day type extraction, and each adapter is a ~3-5 day
wrapper around the target agent's CLI/hooks/API.

**The herdr analogy holds**: herdr is a terminal multiplexer (manages any terminal
process). mya becomes an **agent multiplexer** (manages any AI agent process).
The infrastructure (gateway, view, pool, panel) is the product. The engine is
pluggable.
