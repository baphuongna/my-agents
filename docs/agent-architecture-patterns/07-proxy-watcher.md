# Hướng G: Proxy + Watcher — vỏ ngoài tối ưu

> **Coupling:** 🟢 Zero — proxy ở API level + watcher ở FS level
> **Agent-agnostic:** ✅ — bất kỳ agent hỗ trợ custom endpoint + writes logs
> **Effort:** 1.5 tuần

## Mô tả

Kết hợp Hướng E (LLM Proxy) + Hướng F (File Watcher). mya sits ở 2 layers:
- **API layer (Proxy):** inject memory/skills/roles INTO agent qua system prompt modification
- **FS layer (Watcher):** observe facts/audit/status FROM agent qua session log parsing

Cùng nhau = full bidirectional integration với zero agent coupling.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                    mya daemon (THIN)                             │
│                                                                  │
│  ┌─────────────────────────────────┐  ┌───────────────────────┐ │
│  │        LLM PROXY (into agent)   │  │   FILE WATCHER (from) │ │
│  │                                  │  │                       │ │
│  │  POST /v1/chat/completions       │  │  fs.watch(            │ │
│  │  · memory → system prompt        │  │    ~/.pi/sessions/)   │ │
│  │  · skills → system prompt        │  │  fs.watch(            │ │
│  │  · roles → filter tools array    │  │    ~/.claude/)        │ │
│  │  · forward → real LLM API        │  │                       │ │
│  │  · log tool_calls in response    │  │  Parse new lines:     │ │
│  │  · track cost (tokens)           │  │  · facts ← messages   │ │
│  │                                  │  │  · audit ← tool_calls │ │
│  │  Agent → mya proxy → LLM API     │  │  · status ← turn evts │ │
│  │  Agent thinks mya IS the API    │  │  · cost ← usage       │ │
│  └──────────────┬───────────────────┘  └───────────┬───────────┘ │
│                 │                                   │             │
│  ┌──────────────┴───────────────────────────────────┴───────────┐ │
│  │              SESSION MANAGER                                 │ │
│  │  spawn/kill/status · herdr panes · cron · channels · web     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
╚════════════════════════════╤═════════════════════════════════════╝
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
    ┌──────────┐       ┌──────────┐       ┌──────────┐
    │   pi     │       │ claude   │       │ opencode │
    │          │       │          │       │          │
    │ API→mya  │       │ API→mya  │       │ API→mya  │
    │ proxy    │       │ proxy    │       │ proxy    │
    │          │       │          │       │          │
    │ writes   │       │ writes   │       │ writes   │
    │ sessions │       │ sessions │       │ sessions │
    │ →mya     │       │ →mya     │       │ →mya     │
    │ watches  │       │ watches  │       │ watches  │
    └──────────┘       └──────────┘       └──────────┘
     own TUI            own CLI            own TUI
     own tools          own tools          own tools
     own compaction     own compaction     own compaction
```

## Direction INTO agent (Proxy)

```
Agent → POST /v1/chat/completions { messages, tools, model }
  mya proxy:
    1. Read messages → find system prompt (messages[0])
    2. Inject: "## Memory\n{brain.recall(lastUserMessage)}"
    3. Inject: "## Skills\n{skillStore.active()}"
    4. Filter tools per role (remove "bash" for reviewer)
    5. Forward to real LLM API (https://api.openai.com/v1/...)
    6. Stream response back to agent
    7. Log tool_calls from response → Merkle audit
```

## Direction FROM agent (Watcher)

```
pi writes session.jsonl:
  mya watcher (fs.watch):
    1. New line: {"type":"tool_call","toolName":"edit",...}
       → audit.append({kind:"tool", tool:"edit", ...})
    2. New line: {"type":"message_end","role":"assistant","content":"..."}
       → autoCapture(content) → brain.recordFact(...)
    3. New line: {"type":"turn_start"}
       → statusTracker.setWorking(sessionId)
    4. New line: {"type":"turn_end"}
       → statusTracker.setIdle(sessionId)
    5. New line: {"type":"message_end","usage":{"input":500,"output":120}}
       → costTracker.record(sessionId, usage)
```

## Tại sao kết hợp tốt hơn riêng lẻ

| Tính năng | Chỉ Proxy (E) | Chỉ Watcher (F) | Proxy + Watcher (G) |
|---|---|---|---|
| Memory inject | ✅ system prompt | ❌ | ✅ |
| Memory extract | ✅ parse messages | ✅ parse logs | ✅ (dual source) |
| Audit | ✅ API traffic | ✅ session logs | ✅ (dual source) |
| Roles | ✅ filter tools | ❌ | ✅ |
| Skills | ✅ system prompt | ❌ | ✅ |
| Cost | ✅ token count | ✅ usage logs | ✅ (cross-validate) |
| Status | ⚠️ infer from traffic | ✅ turn events | ✅ |
| Control (abort) | ⚠️ drop connection | ❌ | ⚠️ still limited |

## Code cần thêm

```typescript
// 1. LLM Proxy (packages/gateway/src/llm-proxy.ts)
//    POST /v1/chat/completions — OpenAI-compatible
//    Inject memory/skills/roles, forward, stream back

// 2. Session Watcher (packages/gateway/src/session-watcher.ts)
//    fs.watch pi/claude/opencode session directories
//    Parse new JSONL lines → Brain + Audit + Cost + Status

// 3. Agent Spawn Config (packages/core/src/agent-spawn.ts)
//    { command, args, env: { OPENAI_BASE_URL: "http://localhost:3000/v1" } }
```

## mya KHÔNG cần

```
· createAgentSession()         ← bỏ (spawn thay thế)
· mya-bridge extension         ← bỏ (proxy + watcher thay thế)
· @earendil-works/* imports    ← bỏ hết
· execute tools                ← bỏ (agent tự execute)
· own TUI                      ← bỏ (agent tự có TUI)
· own context compaction       ← bỏ (agent tự compact)
```

## mya CHỈ cần

```
1. LLM Proxy: intercept API → inject memory/skills/roles
2. File Watcher: read session logs → extract facts/audit/status
3. Session Manager: spawn/kill agents
4. Gateway: web dashboard + HTTP API
5. Cron: schedule agent spawns
6. Channels: forward messages to agent stdin
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hoàn toàn agent-agnostic | ❌ Không execute tools (agent tự làm) |
| ✅ Zero coupling (OpenAI-compatible API + FS logs) | ❌ Không control TUI |
| ✅ Memory inject + extract (bidirectional) | ❌ Streaming backpressure complexity |
| ✅ Audit (dual source: API + logs) | ❌ Proxy must parse SSE correctly |
| ✅ Roles (tool filter at API level) | ❌ Format-dependent (pi JSONL ≠ claude) |
| ✅ Skills inject | ❌ Can't abort agent mid-turn (proxy drop = connection error) |
| ✅ Cost tracking (cross-validate) | |
| ✅ Fallback routing | |

## Khi nào chọn

- Muốn "vỏ ngoài" đúng nghĩa: mya wrap agent ở API + FS layers
- OK với agent executing tools riêng
- Muốn memory/skills/audit nhưng KHÔNG inject vào agent internals
- Muốn agent-agnostic hoàn toàn

**Đây là hướng tối ưu cho "vỏ ngoài":** mya kiểm soát đủ để provide value (memory, audit, roles, skills, cost) mà KHÔNG cần biết agent internals.
