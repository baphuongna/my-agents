# Hướng C: Shell + Extension — subprocess + pi extension từ disk

> **Coupling:** 🟡 pi extension API (public, documented)
> **Agent-agnostic:** ⚠️ — chỉ agents có extension system
> **Effort:** 1-2 tuần

## Mô tả

mya spawn pi làm subprocess (`pi --print --mode json`). Pi tự load mya-bridge extension TỪ DISK (`~/.mya/agent/extensions/mya-bridge/index.js`). Extension chạy TRONG process pi (subprocess), không phải trong process mya. Extension register tools, hook events, nhưng gọi mya daemon qua HTTP khi cần shared state.

## Kiến trúc

```
┌─ mya daemon ─────────────────────────────────────────────┐
│                                                           │
│  spawn("pi", [                                            │
│    "--print","--mode","json",                             │
│    "--agent-dir","~/.mya/agent",  ← pi load ext từ đây   │
│    "prompt"                                               │
│  ])                                                       │
│                                                           │
│  Pi tự load mya-bridge extension từ disk:                 │
│  ~/.mya/agent/extensions/mya-bridge/index.js              │
│                                                           │
│  Gateway API (HTTP):                                      │
│  · POST /memory/recall → Brain query                     │
│  · POST /memory/record → Brain record                    │
│  · POST /audit/log → Merkle append                       │
│  · GET  /skills/active → skill list                      │
│                                                           │
└──────────────┬────────────────────────────────────────────┘
               │ HTTP (subprocess → daemon)
               ▼
┌─ pi subprocess ──────────────────────────────────────────┐
│                                                           │
│  mya-bridge extension (loaded from disk):                 │
│  · register pi tools (pi's own tools)                    │
│  · hook turn_start → POST /audit (HTTP → mya daemon)     │
│  · hook tool_call → POST /audit                           │
│  · memory recall → GET /memory/recall (HTTP)              │
│  · skills inject → GET /skills/active (HTTP)              │
│  · role overlay → apply locally                           │
│                                                           │
│  Extension chạy trong process pi, KHÔNG trong mya daemon │
│  Giao tiếp mya daemon = HTTP calls (không in-memory)     │
└───────────────────────────────────────────────────────────┘
```

## Khác biệt so với A (Platform) và B (Shell)

| | A: Platform | B: Shell | C: Shell+Ext |
|---|---|---|---|
| Pi chạy | In-process (mya daemon) | Subprocess | Subprocess |
| Extension | Inject by mya daemon | Không có | Pi load từ disk |
| Tools | mya injects 26 tools | Pi dùng tools riêng | Extension register + HTTP fallback |
| Memory | In-memory (Brain) | Pi có memory riêng | HTTP API → Brain (in mya daemon) |
| Audit | Hook events directly | Không intercept | Extension hooks → HTTP → daemon |
| Coupling | createAgentSession() | Zero | pi extension API (public) |

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tools/memory/audit vẫn available | ❌ Vẫn cần pi extension system |
| ✅ Process isolation (pi = subprocess) | ❌ HTTP latency (mỗi memory/audit = round-trip) |
| ✅ pi extension API là PUBLIC (documented) | ❌ Extension code phải dual-write (disk + npm) |
| ✅ Agent upgrade độc lập | ❌ Chỉ agents có extension system work |
| ✅ Role overlay vẫn apply được | ❌ Debugging phức tạp (2 processes) |

## Code thay đổi

```typescript
// Thay vì PiInProcessRuntime (inject):
const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
const session = createAgentSession({ extensionFactories: [{ factory: myaBridge }] });

// PiSubprocessWithExtRuntime (shell + disk extension):
const child = spawn("pi", [
  "--print", "--mode", "json",
  "--agent-dir", path.join(homedir(), ".mya/agent"),  // pi loads extensions from here
  prompt,
], { stdio: ["pipe", "pipe", "pipe"] });

// Extension ở ~/.mya/agent/extensions/mya-bridge/index.js
// Tự hook events, gọi mya daemon qua HTTP
```

## Vấn đề latency

Mỗi memory recall / audit log = HTTP round-trip (localhost ~1ms, nhưng vẫn overhead):

```
Extension trong pi subprocess:
  turn_start → fetch("http://localhost:3000/audit", { ... })  ← 1ms
  memory recall → fetch("http://localhost:3000/memory/recall?...")  ← 5ms (Brain query)
  tool_call → fetch("http://localhost:3000/audit", { ... })  ← 1ms
```

So với in-process (0ms — trực tiếp function call).

## Khi nào chọn

- Muốn process isolation NHƯNG vẫn cần tools/memory/audit
- OK với HTTP latency
- Pi extension API đủ ổn định
- Chỉ cần support pi (extension system pi-specific)
