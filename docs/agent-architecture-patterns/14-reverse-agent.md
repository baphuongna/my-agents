# Hướng M: Reverse Agent — mya LÀ agent, agents khác LÀ tools

> **Coupling:** 🟢 Zero — agents là function calls
> **Agent-agnostic:** ✅ — bất kỳ CLI agent
> **Effort:** 1-2 tuần

## Mô tả

mya CÓ agent loop riêng (runTurn). mya NHẬN prompt từ user, LLM thinks, rồi gọi agent khác làm tool. pi/claude/opencode = tools mà mya's LLM chọn khi cần. mya không wrap agent — mya USES agent.

## Kiến trúc

```
                    ┌─────────────────────┐
                    │   mya agent loop    │  ← mya có runTurn() riêng
                    │   (the BRAIN)       │     có LLM riêng
                    │                     │     có context riêng
 User ───────────►  │  LLM thinks:        │
                    │  "need code + review"│
                    │       │             │
                    │  ┌────▼────┐        │
                    │  │ TOOL:   │        │
                    │  │ pi_code │────────┼──► spawn("pi") → code
                    │  │ ()      │◄───────┼──◄ result
                    │  └─────────┘        │
                    │  ┌─────────┐        │
                    │  │ TOOL:   │        │
                    │  │ claude_ │────────┼──► spawn("claude") → review
                    │  │ review()│◄───────┼──◄ result
                    │  └─────────┘        │
                    │       │             │
                    │  aggregate → respond│
                    └─────────┬───────────┘
                              │
                              ▼
                           User
```

## Tool definitions

```typescript
const agentTools: ToolImpl[] = [
  {
    meta: {
      name: "pi_code",
      description: "Spawn pi coding agent to implement code. Use for complex coding tasks.",
      args: {
        type: "object",
        properties: {
          task: { type: "string", description: "What to implement" },
          files: { type: "array", items: { type: "string" }, description: "Context files" },
        },
        required: ["task"],
      },
      requiredMode: "WorkspaceWrite",
    },
    async run(args) {
      const result = await spawnAgent("pi", ["--print", "--mode", "json", args.task]);
      return { callId: "pi_code", ok: true, output: result };
    },
  },
  {
    meta: {
      name: "claude_review",
      description: "Spawn Claude to review code. Use for code review, security analysis.",
      args: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code to review" },
          focus: { type: "string", description: "What to focus on" },
        },
        required: ["code"],
      },
      requiredMode: "AutoApprove",
    },
    async run(args) {
      const result = await spawnAgent("claude", ["-p", `Review: ${args.focus}`, args.code]);
      return { callId: "claude_review", ok: true, output: result };
    },
  },
  {
    meta: {
      name: "opencode_debug",
      description: "Spawn opencode to debug an issue.",
      args: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
      requiredMode: "WorkspaceWrite",
    },
    async run(args) {
      const result = await spawnAgent("opencode", ["debug", args.error]);
      return { callId: "opencode_debug", ok: true, output: result };
    },
  },
];

// Register as mya's tools
const agent = createAgent({
  tools: [...builtinTools, ...agentTools],
  model: "MiniMax-M3",
});
```

## Workflow ví dụ

```
User: "implement authentication module and review it for security"

mya LLM (turn 1):
  "I'll implement auth first, then review it."
  → tool_call: pi_code({ task: "implement JWT authentication module" })

pi subprocess:
  (runs native — own tools, own context, own LLM)
  → returns: "Created auth.ts with JWT validation, login endpoint..."

mya LLM (turn 2):
  "Auth implemented. Now let me review it for security."
  → tool_call: claude_review({
      code: "<auth.ts contents>",
      focus: "security vulnerabilities, OWASP compliance"
    })

claude subprocess:
  (runs native — own reasoning, own security expertise)
  → returns: "Found 2 issues: 1) No rate limiting on login, 2) JWT secret hardcoded..."

mya LLM (turn 3):
  aggregates: "Auth implemented. Security review found 2 issues..."
  → responds to user
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ mya controls workflow (LLM decides delegation) | ❌ Each agent call = full subprocess spawn (slow) |
| ✅ Agents isolated (own context, own budget) | ❌ mya needs own LLM (additional cost) |
| ✅ Any agent as tool (spawn CLI, get result) | ❌ Context not shared (agents start fresh) |
| ✅ No coupling to agent internals | ❌ Result is text (structured data must parse) |
| ✅ Natural composition (code + review + test) | ❌ Latency (sequential agent calls) |
| ✅ mya has full audit (it made every call) | |

## Khác pi-crew

pi-crew cũng spawn subagents. Nhưng pi-crew găm vào pi. Hướng M:
- mya có runTurn() riêng (không cần pi's loop)
- Agents khác là TOOLS (không phải subagents trong pi)
- mya's LLM quyết định khi nào gọi agent nào

## Khi nào chọn

- Muốn mya là primary agent (not wrapper)
- OK với subprocess overhead per agent call
- Want LLM-driven delegation (not hardcoded routing)
- Need composition (code → review → test → deploy)
