# Hướng I: pi RPC Bridge — pi đã có 33 commands

> **Coupling:** 🟢 Zero — JSON-RPC over stdio, KHÔNG import @earendil-works/*
> **Agent-agnostic:** ⚠️ — pi-specific (nhưng pi là open-source CLI)
> **Code sẵn:** ✅ pi đã có RPC mode, verify work
> **Effort:** 3-5 ngày

## Mô tả

pi đã có `--mode rpc` — JSON-RPC protocol over stdio với 33 commands. mya spawn `pi --mode rpc` làm subprocess, gửi commands qua stdin, nhận events qua stdout. Zero `@earendil-works/*` imports. Pi chạy native với own TUI, own tools, own context.

## Đã verify: pi RPC hoạt động

```bash
$ echo '{"type":"prompt","id":"test1","message":"say pong"}' | pi --mode rpc

{"id":"test1","type":"response","command":"prompt","success":true}
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"say pong"}]}}
{"type":"message_end",...}
{"type":"message_start","message":{"role":"assistant",...}}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"pong"}}
{"type":"message_end",...}
{"type":"turn_end"}
```

## 33 RPC commands (đã verify)

### Task control
| Command | Thay thế mya-bridge hook |
|---|---|
| `prompt` | `sendUserMessage()` — gửi message |
| `steer` | Interject during generation |
| `follow_up` | Follow-up message |
| `abort` | `signal/abort` — hủy turn hiện tại |
| `new_session` | Tạo session mới |
| `switch_session` | Đổi session |
| `clone` | Clone session |
| `fork` | Fork session |

### Model control
| Command | Thay thế |
|---|---|
| `set_model` | SmartRouter model override |
| `cycle_model` | Cycle through models |
| `get_available_models` | List models |
| `set_thinking_level` | Thinking config |
| `cycle_thinking_level` | Cycle thinking |
| `get_available_thinking_levels` | List thinking levels |

### Context management
| Command | Thay thế |
|---|---|
| `compact` | Idle-compaction trigger |
| `set_auto_compaction` | Toggle auto-compaction |
| `get_state` | Status reporting |
| `get_messages` | autoCapture (đọc conversation) |
| `get_session_stats` | Cost tracking |
| `get_last_assistant_text` | Read last response |

### Execution
| Command | Thay thế |
|---|---|
| `bash` | Remote shell exec (NEW — mya-bridge không có) |
| `abort_bash` | Hủy shell command |
| `set_auto_retry` | Toggle auto-retry |
| `abort_retry` | Hủy retry |

### Introspection
| Command | Mục đích |
|---|---|
| `get_tree` | Session tree |
| `get_entries` | Session entries |
| `get_fork_messages` | Fork messages |
| `get_commands` | Available commands |
| `set_session_name` | Name session |
| `export_html` | Export session as HTML |

## Events streamed back

| Event | Thay thế mya-bridge hook |
|---|---|
| `agent_start` | — |
| `turn_start` | `pi.on('turn_start')` → status "working" |
| `turn_end` | `pi.on('turn_end')` → status "idle" |
| `message_start` (user) | — |
| `message_end` (user) | — |
| `message_start` (assistant) | — |
| `message_update` (text_delta) | `pi.on('text_delta')` → stream to web |
| `message_end` (assistant) | `pi.on('message_end')` → autoCapture |
| `tool_call` (in session events) | `pi.on('tool_call')` → Merkle audit |
| `tool_result` | `pi.on('tool_result')` → audit |
| `extension_ui_request` | select/confirm/input dialogs |
| `extension_error` | Error reporting |

## RPC covers 80% của mya-bridge

```
✅ Thay thế ĐƯỢC (80%):
  · prompt ← sendUserMessage (auto-task inject)
  · abort ← signal/abort chain
  · set_model ← SmartRouter model override
  · set_thinking_level ← thinking config
  · compact ← idle-compaction trigger
  · get_state ← status reporting
  · get_messages ← autoCapture
  · get_session_stats ← cost tracking
  · new_session/clone ← subagent spawning
  · bash ← remote shell (NEW capability!)
  · turn_start/end events ← status + audit hooks
  · tool_call/result events ← Merkle audit
  · message events ← autoCapture
  · extension_ui_request ← dialogs

❌ KHÔNG thay thế ĐƯỢC (20%):
  · registerTool (26 mya tools) — RPC không có tool registration
  · registerCommand (/slash commands) — RPC không có
  · registerShortcut — RPC không có
  · setActiveTools (role filter) — RPC không có tool filtering
```

## Code cần thêm

```typescript
// packages/print/src/runtimes/pi-rpc-runtime.ts (NEW)
import { spawn, type ChildProcess } from "node:child_process";
import { AgentRuntime, RuntimeSession, AgentEvent } from "@my-agent/core";

export class PiRpcRuntime implements AgentRuntime {
  readonly runtimeType = "pi-rpc";
  readonly displayName = "pi (RPC subprocess)";

  isAvailable(): boolean {
    try { spawnSync("pi", ["--version"]); return true; }
    catch { return false; }
  }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    const child = spawn("pi", ["--mode", "rpc", "--agent-dir", opts.agentDir], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts.cwd,
      env: opts.env,
    });
    return new PiRpcSession(child, opts);
  }

  async listModels(): Promise<ModelInfo[]> {
    // Send get_available_models command, parse response
  }

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: false, // RPC mode is headless
      hasHeadless: true,
      supportsTools: true,
      supportsResume: true,
      supportsCompaction: true,
      supportsImages: true,
      supportsThinking: true,
      execution: "subprocess",
      maxContextWindow: 200_000,
      injectionMethod: "rpc",
    };
  }
}

class PiRpcSession implements RuntimeSession {
  private child: ChildProcess;
  private cmdId = 0;
  private pending = new Map<string, { resolve: Function; reject: Function }>();

  constructor(child: ChildProcess, private opts: StartOpts) {
    this.child = child;
    // Parse JSON lines from stdout
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => this.handleLine(JSON.parse(line)));
  }

  private handleLine(msg: any) {
    if (msg.type === "response" && msg.id) {
      // Command response
      const p = this.pending.get(msg.id);
      if (p) { this.pending.delete(msg.id); msg.success ? p.resolve(msg.data) : p.reject(msg.error); }
    } else {
      // Agent event — emit to subscribers
      this.emit(this.normalizeEvent(msg));
    }
  }

  private async send(type: string, params?: any): Promise<any> {
    const id = `cmd-${++this.cmdId}`;
    this.child.stdin.write(JSON.stringify({ type, id, ...params }) + "\n");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async prompt(text: string): Promise<void> {
    await this.send("prompt", { message: text });
  }

  async abort(): Promise<void> {
    await this.send("abort");
  }

  async setModel(model: { id: string; provider?: string }): Promise<void> {
    await this.send("set_model", { provider: model.provider, modelId: model.id });
  }

  async compact(): Promise<CompactionResult> {
    return this.send("compact");
  }

  getState(): SessionState {
    // Could send get_state, but for simplicity return cached
    return this.cachedState;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero @earendil-works/* imports | ❌ Không inject mya's 26 tools |
| ✅ Pi chạy subprocess (isolated) | ❌ Không inject /slash commands |
| ✅ 33 RPC commands (verify work) | ❌ Không filter tools per role |
| ✅ Events stream real-time | ❌ RPC mode là headless (không TUI) |
| ✅ get_messages = autoCapture | ❌ Pi extension UI cần client handle |
| ✅ get_session_stats = cost tracking | |
| ✅ bash command (remote shell!) | |
| ✅ compact/abort/set_model control | |

## Khi nào chọn

- Muốn thoát createAgentSession() coupling
- OK với việc pi dùng tools riêng (không inject mya's 26)
- Pi là open-source CLI (install qua npm)
- Cần control pi headless (cron, background, gateway)
- Nhanh nhất (3-5 ngày, pi đã có RPC sẵn)

## So sánh với A (Platform)

```typescript
// HIỆN TẠI (Hướng A — inject):
const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
const session = createAgentSession({
  extensionFactories: [{ name: "mya-bridge", factory: myaBridge }],
});
// ← GẤN VÀO PI internal API → mỗi version pi đổi API là vỡ. RPC = black-box, bền hơn.

// HƯỚNG R (RPC bridge):
const child = spawn("pi", ["--mode", "rpc"]);
child.stdin.write(JSON.stringify({ type: "prompt", id: "t1", message: "fix auth" }));
// ← CHỈ SPAWN BINARY. Zero coupling. Pi là black box.
```
