# Hướng Q: Transpiler — mya dịch giữa agent formats

> **Coupling:** 🟢 Zero — mya chỉ translate
> **Agent-agnostic:** ✅ — biên dịch sang bất kỳ agent
> **Effort:** 1 tuần

## Mô tả

mya KHÔNG chạy agents. mya DỊCH giữa formats. User viết 1 lần ở mya universal format. mya transpile sang target agent (pi, claude, opencode). mya transpile output ngược lại (agent output → universal event).

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   User writes ONCE in mya universal format:              │
│     task: "implement auth"                               │
│     role: "coder"                                        │
│     tools: [read, write, bash]                           │
│     model: "MiniMax-M3"                                  │
│                                                          │
│   mya TRANSPILES to target agent:                        │
│                                                          │
│   ┌─→ pi:     pi --print --mode json "implement auth"   │
│   │           --model MiniMax-M3                         │
│   │   claude:  claude -p "implement auth"                │
│   │           --model claude-sonnet-4                    │
│   │   opencode: opencode "implement auth"                │
│   │   aider:   aider --msg "implement auth"              │
│   │                                                      │
│   │   And transpiles OUTPUT back:                        │
│   │   pi JSON ─────────────────┐                         │
│   │   claude stream-json ──────┼──► mya universal event  │
│   └─◄opencode text ────────────┘                         │
│                                                          │
│   mya doesn't run agents. mya TRANSLATES.                │
│   Like Babel transpiles JS → different targets.          │
└──────────────────────────────────────────────────────────┘
```

## Universal task format

```typescript
interface UniversalTask {
  // Core
  prompt: string;
  cwd: string;

  // Agent config
  agent: "pi" | "claude" | "opencode" | "aider" | "auto";
  model?: string;
  role?: string;

  // Constraints
  toolsAllowed?: string[];
  maxToolRounds?: number;
  timeout?: number;

  // Output
  outputFormat: "text" | "json" | "stream-json";
}
```

## Transpiler rules

```typescript
// Universal → pi
function toPiArgs(task: UniversalTask): string[] {
  return [
    "--print", "--mode", task.outputFormat === "json" ? "json" : "text",
    ...(task.model ? ["--model", task.model] : []),
    ...(task.role ? ["--append-system-prompt", roleToPrompt(task.role)] : []),
    task.prompt,
  ];
}

// Universal → claude
function toClaudeArgs(task: UniversalTask): string[] {
  return [
    "-p", "--output-format", "stream-json",
    ...(task.model ? ["--model", task.model] : []),
    "--", task.prompt,
  ];
}

// Universal → aider
function toAiderArgs(task: UniversalTask): string[] {
  return ["--msg", task.prompt, ...(task.model ? ["--model", task.model] : [])];
}

// pi JSON output → universal events
function fromPiEvents(line: string): AgentEvent | null {
  const parsed = JSON.parse(line);
  switch (parsed.type) {
    case "turn_start": return { type: "turn_start", sessionId: parsed.sessionId };
    case "message_end": return { type: "message_end", role: parsed.message?.role, content: parsed.message?.content };
    case "message_update":
      if (parsed.assistantMessageEvent?.type === "text_delta")
        return { type: "text_delta", text: parsed.assistantMessageEvent.delta };
      return null;
    case "turn_end": return { type: "turn_end" };
    default: return null;
  }
}

// claude stream-json → universal events
function fromClaudeEvents(line: string): AgentEvent | null {
  const parsed = JSON.parse(line);
  if (parsed.type === "assistant") return { type: "message_end", role: "assistant", content: parsed.message };
  if (parsed.type === "result") return { type: "turn_end", cost: parsed.cost_usd };
  return null;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Write once, run any agent | ❌ Must maintain format adapters |
| ✅ Zero runtime coupling | ❌ Can't use agent-specific features |
| ✅ Easy to add new agent (write adapter) | ❌ Universal format = lowest common denominator |
| ✅ Output normalization (all agents → same event format) | ❌ Lossy translation (agent-specific features lost) |
| ✅ Compare agents (same task → different agents → compare output) | |

## Khi nào chọn

- Muốn compare agents (same task, different engines)
- Want universal format (write once, swap agent)
- OK maintaining format adapters
- Don't need agent-specific features
