# Hướng B: Shell Thuần — spawn CLI, parse output

> **Coupling:** 🟢 Zero — chỉ spawn binary
> **Agent-agnostic:** ✅ — bất kỳ CLI agent
> **Effort:** 3-5 ngày

## Mô tả

mya spawn agent CLI (pi, claude, opencode, aider) làm subprocess. Giao tiếp qua stdin/stdout. Parse output (JSON stream hoặc text). KHÔNG inject. KHÔNG hook. Agent dùng tools/memory/providers RIÊNG.

## Kiến trúc

```
┌─ mya daemon ─────────────────────────────────────────────┐
│                                                           │
│  spawn("pi", ["--print","--mode","json","prompt"])        │
│  spawn("claude", ["-p","--output-format","stream-json"])  │
│  spawn("opencode", [...])                                 │
│  spawn("aider", [...])                                    │
│                                                           │
│  Mỗi agent:                                               │
│  · stdin ← user message (route từ gateway/channels)       │
│  · stdout → parse JSON/text → AgentEvent                  │
│  · stderr → debug log                                     │
│  · exit → turn_end                                        │
│                                                           │
│  KHÔNG inject extension. KHÔNG hook events.               │
│  Agent chạy native với tools/memory/providers riêng.      │
└───────────────────────────────────────────────────────────┘
```

## Đã chứng minh: ClaudeRuntime

```typescript
// packages/print/src/runtimes/claude.ts — ĐÃ LÀ shell mode
export class ClaudeRuntime implements AgentRuntime {
  async start(opts: StartOpts): Promise<RuntimeSession> {
    // spawn claude CLI as subprocess
    return new ClaudeSession(opts);
  }
}

class ClaudeSession implements RuntimeSession {
  async prompt(text: string): Promise<void> {
    const args = ["-p", "--output-format", "stream-json",
                  "--model", this.modelId, "--continue", "--", text];
    this.child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    // parse JSON lines from stdout → emit AgentEvents
    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      const event = ClaudeEventNormalizer.parseLine(line);
      this.emit(event);
    });
  }
}
```

## Code thay đổi

### BỎ
- `PiInProcessRuntime.createAgentSession()` — xóa
- `mya-bridge` extension injection — xóa
- `@earendil-works/pi-coding-agent` imports — xóa hết
- `@earendil-works/pi-ai` imports — xóa hết (hoặc giữ optional)
- `bindExtensions()` — xóa

### GIỮ
- `ClaudeRuntime` — đã đúng pattern
- `RuntimePool` — giữ (quản lý subprocess sessions)
- `SmartRouter` — giữ (chọn agent nào spawn)
- `PiEventNormalizer` — giữ (parse pi JSON → AgentEvent)
- Gateway, cron, channels, web — giữ nguyên

### THÊM
- `PiSubprocessRuntime` — spawn `pi --print --mode json`, parse JSON
- `OpenCodeRuntime` — spawn `opencode`
- `AiderRuntime` — spawn `aider`
- `AgentSpawnConfig` — { command, args, env, cwd, outputFormat }

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hoàn toàn agent-agnostic | ❌ 26 tools không inject (agent dùng tools riêng) |
| ✅ Zero coupling — pi upgrade độc lập | ❌ Brain memory không hook (agent có memory riêng) |
| ✅ Đơn giản nhất | ❌ Merkle audit không intercept tool calls |
| ✅ Bất kỳ CLI agent | ❌ Role overlay — chỉ spawn args (--model, --role) |
| ✅ Process isolation | ❌ Skills inject — agent tự lo |
| ✅ ClaudeRuntime đã chứng minh | ❌ DreamCycle không chạy trong agent process |

## pi output format (đã verify)

```bash
$ pi --print --mode json --provider mock "say hi"
{"type":"session","id":"019fd0a8-..."}
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"user","content":[...]}}
{"type":"message_end",...}
{"type":"message_start","message":{"role":"assistant","content":"Hi! 👋"}}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hi"}}
{"type":"message_end","usage":{"input":37,"output":6}}
{"type":"turn_end"}
```

PiEventNormalizer đã convert format này → mya AgentEvent.

## Khi nào chọn

- Muốn agent-agnostic thuần
- OK với việc agent dùng tools/memory riêng
- Không cần inject mya's features
- Đơn giản là quản lý sessions + dashboard
