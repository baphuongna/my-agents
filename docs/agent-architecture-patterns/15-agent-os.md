# Hướng N: Agent OS — mya là platform, agents là apps

> **Coupling:** 🟢 Zero — agents run ON mya, use OS APIs if wanted
> **Agent-agnostic:** ✅ — bất kỳ agent chạy trên OS
> **Effort:** 2-3 tuần

## Mô tả

mya là OPERATING SYSTEM cho agents. Agents là APPLICATIONS chạy trên mya. mya cung cấp: filesystem, process manager, IPC bus, storage, scheduler, network, auth, shell (tools). Agents dùng OS APIs KHI CẦN (opt-in). Agents chạy native nếu không dùng.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                    mya OS Layer                          │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ FS       │ │ Process  │ │ IPC Bus  │ │ Storage  │    │
│  │ manager  │ │ manager  │ │ (message │ │ (Brain + │    │
│  │ (git)    │ │ (spawn/  │ │  queue)  │ │  audit + │    │
│  │          │ │  kill)   │ │          │ │  kanban) │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │Scheduler │ │ Network  │ │ Auth     │ │ Shell    │    │
│  │(cron)    │ │(gateway+ │ │(secrets+ │ │(26 tools │    │
│  │          │ │ channels)│ │ roles)   │ │ shared)  │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│                                                          │
╔══════════════════════════════════════════════════════════╗
║                    Applications                          ║
║                                                          ║
║   ┌──────────┐  ┌──────────┐  ┌──────────┐              ║
║   │   pi     │  │ claude   │  │ opencode │              ║
║   │ (app)    │  │ (app)    │  │ (app)    │              ║
║   │          │  │          │  │          │              ║
║   │ uses OS  │  │ uses OS  │  │ uses OS  │              ║
║   │ APIs:    │  │ APIs:    │  │ APIs:    │              ║
║   │ ·memory  │  │ ·memory  │  │ (native  │              ║
║   │ ·audit   │  │ ·audit   │  │  only)   │              ║
║   │ ·cron    │  │ ·cost    │  │          │              ║
║   │ ·kanban  │  │          │  │          │              ║
║   └──────────┘  └──────────┘  └──────────┘              ║
║                                                          ║
║   Apps CHOOSE which OS APIs to use.                      ║
║   Apps that use nothing = fully independent.             ║
╚══════════════════════════════════════════════════════════╝
```

## OS API surface

```typescript
// mya OS APIs available to agents (via HTTP or SDK)

// Storage API
GET  /os/memory/recall?query=...    → Brain facts
POST /os/memory/record              → record fact
GET  /os/audit/log                  → Merkle audit entries
POST /os/audit/append               → append audit record

// Process API
GET  /os/processes                  → list running agents
POST /os/processes/spawn            → spawn new agent
DEL  /os/processes/:id              → kill agent
GET  /os/processes/:id/status       → agent status

// Scheduler API
GET  /os/cron/jobs                  → list cron jobs
POST /os/cron/jobs                  → create cron job

// IPC API
POST /os/ipc/send                   → send message to agent
GET  /os/ipc/receive                → receive messages

// Shell API (tools)
POST /os/shell/read                 → read file
POST /os/shell/write                → write file
POST /os/shell/bash                 → run command

// Network API
GET  /os/network/status             → gateway/channels status

// Auth API
GET  /os/auth/secrets/:key          → get secret
POST /os/auth/check                 → check permission
```

## Agent SDK (opt-in)

```typescript
// Agents that want OS integration import this SDK
// packages/os-sdk/src/index.ts

export class MyaOS {
  constructor(private apiUrl: string) {}

  async recallMemory(query: string): Promise<Fact[]> {
    const res = await fetch(`${this.apiUrl}/os/memory/recall?query=${encodeURIComponent(query)}`);
    return res.json();
  }

  async recordFact(fact: string): Promise<void> {
    await fetch(`${this.apiUrl}/os/memory/record`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fact }),
    });
  }

  async logAudit(action: string, result: unknown): Promise<void> {
    await fetch(`${this.apiUrl}/os/audit/append`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, result }),
    });
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agents run native (own loop, own tools) | ❌ Complex to build (full OS API surface) |
| ✅ Opt-in integration (use what you want) | ❌ Agents must use SDK (cooperation) |
| ✅ Clear separation (OS vs apps) | ❌ HTTP latency for every OS API call |
| ✅ Any agent works (native = no integration) | ❌ Versioning (OS API must be stable) |
| ✅ Agents can share resources (memory, kanban) | |

## Khi nào chọn

- Muốn mya là platform (not wrapper, not orchestrator)
- Want agents to CHOOSE integration level
- OK building full API surface
- Want clear OS/app separation (like Docker)
