# Hướng F: File Watcher — mya = sidecar observer

> **Coupling:** 🟢 Zero — mya chỉ ĐỌC file
> **Agent-agnostic:** ✅ — bất kỳ agent write session logs
> **Effort:** 3-5 ngày

## Mô tả

mya KHÔNG ngồi trong request path. mya watch filesystem — đọc session log files mà agents write. Parse real-time → extract facts → Brain memory, log tool calls → Merkle audit, track status. Reactive observation, zero interception.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ pi process   │  │ claude proc  │  │ opencode proc│       │
│  │ (native)     │  │ (native)     │  │ (native)     │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │ writes          │ writes          │ writes         │
│         ▼                 ▼                 ▼                │
│  ~/.pi/sessions/    ~/.claude/sessions/  ~/.opencode/       │
│  *.jsonl            *.json               *.jsonl             │
│         │                 │                 │                │
│         └────────────────┼─────────────────┘                │
│                          │                                   │
│               ┌──────────▼──────────┐                       │
│               │   mya File Watcher  │                       │
│               │   (fs.watch)        │                       │
│               │                     │                       │
│               │  Parse JSONL lines: │                       │
│               │  · message → facts  │──► Brain memory       │
│               │  · tool_call → log  │──► Merkle audit       │
│               │  · turn_start/end   │──► Status tracking    │
│               │  · usage → cost     │──► Cost report        │
│               │  · git diff → audit │──► Change tracking    │
│               └─────────────────────┘                       │
│                                                              │
│  ZERO agent coupling. mya chỉ ĐỌC file.                     │
│  Agent không biết mya tồn tại.                               │
│  Agent không thay đổi behavior.                              │
└──────────────────────────────────────────────────────────────┘
```

## pi session log format (đã verify)

```jsonl
{"type":"session","id":"019f036f-...","cwd":"/home/bom/source/my-agent"}
{"type":"model_change","provider":"minimax","modelId":"MiniMax-M3"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"fix auth"}]}}
{"type":"message_end","message":{"role":"user",...}}
{"type":"message_start","message":{"role":"assistant","content":[{"type":"text","text":"Let me..."}]}}
{"type":"tool_call","toolName":"read","input":{"path":"auth.ts"},"toolCallId":"call_001"}
{"type":"tool_result","toolName":"read","output":"...","toolCallId":"call_001"}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"The bug is..."}}
{"type":"message_end","usage":{"input":500,"output":120,"cost":{"total":0.002}}}
{"type":"turn_end"}
```

## Code cần thêm

```typescript
// packages/gateway/src/session-watcher.ts (NEW)
import { watch } from "node:fs";

class SessionWatcher {
  constructor(private brain: Brain, private audit: AuditLog) {}

  watchSessionDir(dir: string) {
    // Watch pi session directory
    watch(dir, { recursive: true }, (event, filename) => {
      if (filename?.endsWith(".jsonl")) {
        this.parseNewLines(path.join(dir, filename));
      }
    });
  }

  private async parseNewLines(file: string) {
    const newLines = this.readSinceLastOffset(file);
    for (const line of newLines) {
      const event = JSON.parse(line);
      switch (event.type) {
        case "tool_call":
          this.audit.append({ kind: "tool", tool: event.toolName, input: event.input });
          break;
        case "message_end":
          if (event.message?.role === "assistant") {
            // autoCapture: extract facts from assistant response
            const facts = autoCapture(event.message.content);
            for (const f of facts) await this.brain.recordFact(f);
          }
          if (event.usage) {
            costTracker.record(event.usage);
          }
          break;
        case "turn_start":
          statusTracker.setWorking(event.sessionId);
          break;
        case "turn_end":
          statusTracker.setIdle(event.sessionId);
          break;
      }
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero coupling — chỉ đọc file | ❌ Không inject được gì (read-only) |
| ✅ Agent không biết mya tồn tại | ❌ Real-time but delayed (file write latency) |
| ✅ Hoàn toàn agent-agnostic | ❌ Mất memory inject (agent không nhận mya's context) |
| ✅ No protocol needed | ❌ Mất skills inject |
| ✅ Reactive (auto-detect changes) | ❌ Mất role overlay |
| ✅ Crash-safe (re-read file) | ❌ Format phụ thuộc agent (pi JSONL ≠ claude JSON) |
| ✅ Historical replay (read từ đầu) | ❌ Can't control agent (abort, compact) |

## Khác biệt so với LLM Proxy (Hướng E)

| | E: LLM Proxy | F: File Watcher |
|---|---|---|
| Direction | INTO agent (inject) + FROM agent (observe) | FROM agent only (observe) |
| Can inject | ✅ Memory, skills, roles | ❌ Read-only |
| Can observe | ✅ Via API traffic | ✅ Via file logs |
| Coupling | Zero (API endpoint) | Zero (file read) |
| Combined | **Hướng G: Proxy + Watcher** = best of both | |

## Khi nào chọn

- Muốn observation thuần (audit, memory extraction, cost tracking)
- Không cần inject gì vào agent
- Agent write session logs (pi, claude đều write)
- Muốn historical replay (re-read logs from beginning)
