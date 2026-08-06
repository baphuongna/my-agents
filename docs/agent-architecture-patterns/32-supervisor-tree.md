# Hướng AF: Supervisor Tree — Erlang OTP hierarchy

> **Nguồn gốc:** Erlang OTP (Ericsson, 1986). Joe Armstrong's "Let it crash" philosophy.
> **Coupling:** 🟡 Supervisor hierarchy + restart strategies
> **Agent-agnostic:** ✅ — bất kỳ process
> **Effort:** 2-3 tuần

## Nguồn gốc

Erlang OTP: supervisors quản lý processes. Supervisors watch children, restart khi crash theo strategy (one-for-one, one-for-all, rest-for-one). "Let it crash" — don't write defensive code, let supervisor restart. Isolation boundaries: 1 process crash không ảnh hưởng hệ khác.

## Mô tả

mya = supervisor tree. Root supervisor quản lý subsystem supervisors (agent supervisor, memory supervisor, cron supervisor). Mỗi subsystem supervisor quản lý worker processes (pi sessions, memory writer, cron workers). Crash ở worker → subsystem supervisor restart. Crash ở subsystem → root supervisor restart subsystem.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                 SUPERVISOR TREE (OTP-style)                  │
│                                                              │
│                      ┌──────────────┐                        │
│                      │ ROOT         │                        │
│                      │ SUPERVISOR   │                        │
│                      │              │                        │
│                      │ strategy:    │                        │
│                      │ one-for-one  │                        │
│                      └───┬──────┬───┘                        │
│                          │      │                            │
│              ┌───────────┘      └──────────┐                 │
│              ▼                             ▼                 │
│   ┌────────────────────┐      ┌────────────────────┐         │
│   │ AGENT SUPERVISOR   │      │ SERVICE SUPERVISOR │         │
│   │                    │      │                    │         │
│   │ watches:           │      │ watches:           │         │
│   │ · pi sessions      │      │ · memory writer    │         │
│   │ · claude sessions  │      │ · cron sweeper     │         │
│   │ · subagents        │      │ · channel poller   │         │
│   │                    │      │ · sync server      │         │
│   │ strategy:          │      │                    │         │
│   │ one-for-one        │      │ strategy:          │         │
│   │ (restart only      │      │ rest-for-one       │         │
│   │  crashed agent)    │      │ (restart dependent │         │
│   └──────┬───────┬─────┘      │  services too)     │         │
│          │       │            └────────────────────┘         │
│          ▼       ▼                                           │
│    ┌────────┐ ┌────────┐                                     │
│    │ pi-1   │ │ claude │                                     │
│    │ worker │ │ worker │                                     │
│    └────────┘ └────────┘                                     │
│                                                              │
│  RESTART STRATEGIES:                                         │
│  · one-for-one: chỉ restart child crash                      │
│  · one-for-all: restart ALL children khi 1 crash             │
│  · rest-for-one: restart crashed + các child SAU nó          │
│  · simple-one-for-one: dynamic children (spawn/kill)         │
│                                                              │
│  LET IT CRASH:                                               │
│  Worker crash → supervisor restart nhanh chóng.              │
│  Không cần try-catch defensive code trong worker.            │
└──────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
// packages/supervisor/src/index.ts
type RestartStrategy = "one-for-one" | "one-for-all" | "rest-for-one";

interface SupervisorSpec {
  name: string;
  strategy: RestartStrategy;
  maxRestarts: number;       // Max restarts in window
  windowMs: number;          // Time window
  children: ChildSpec[];
}

interface ChildSpec {
  id: string;
  start: () => Promise<Worker>;
  restartDelay?: number;
}

class Supervisor {
  private children = new Map<string, Worker>();
  private restarts: number[] = [];  // timestamps of restarts

  constructor(private spec: SupervisorSpec) {}

  async start(): Promise<void> {
    for (const child of this.spec.children) {
      await this.startChild(child);
    }
  }

  private async startChild(spec: ChildSpec): Promise<void> {
    const worker = await spec.start();
    this.children.set(spec.id, worker);

    // Watch for crash
    worker.on("crash", async (err) => {
      log(`[supervisor:${this.spec.name}] ${spec.id} crashed: ${err.message}`);
      await this.handleCrash(spec);
    });
  }

  private async handleCrash(spec: ChildSpec): Promise<void> {
    // Rate limit: max restarts in window
    const now = Date.now();
    this.restarts.push(now);
    this.restarts = this.restarts.filter(t => now - t < this.spec.windowMs);

    if (this.restarts.length > this.spec.maxRestarts) {
      log(`[supervisor:${this.spec.name}] too many restarts — giving up on ${spec.id}`);
      return;  // Escalate to parent supervisor
    }

    // Strategy: restart affected children
    switch (this.spec.strategy) {
      case "one-for-one":
        await this.startChild(spec);  // restart only crashed
        break;
      case "one-for-all":
        for (const [id, childSpec] of this.spec.children) {
          await this.stopChild(id);
          await this.startChild(childSpec);
        }
        break;
      case "rest-for-one":
        const idx = this.spec.children.findIndex(c => c.id === spec.id);
        for (let i = idx; i < this.spec.children.length; i++) {
          await this.stopChild(this.spec.children[i].id);
          await this.startChild(this.spec.children[i]);
        }
        break;
    }
  }
}

// Example tree
const root = new Supervisor({
  name: "root",
  strategy: "one-for-one",
  maxRestarts: 5, windowMs: 60000,
  children: [
    { id: "agents", start: async () => new AgentSupervisor({ maxSessions: 1000 }).start() },
    { id: "services", start: async () => new ServiceSupervisor().start() },
    { id: "gateway", start: async () => new Gateway().start() },
  ],
});
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fault tolerance (supervisors auto-restart) | ❌ Complex hierarchy design |
| ✅ Isolation (1 crash ≠ whole system down) | ❌ Restart storms (crashed worker keeps crashing) |
| ✅ "Let it crash" (simpler worker code) | ❌ State loss on restart (in-memory state gone) |
| ✅ Clean shutdown (tree order) | ❌ Debugging (which supervisor restarted what) |
| ✅ Proven in telecom (99.999% uptime) | |

## Khi nào chọn

- Production reliability (uptime critical)
- Many worker processes (agents, cron, channels)
- Want crash isolation (1 agent crash ≠ gateway down)
- Want automatic restart (no manual intervention)
- Building long-running daemon (mya serve)
