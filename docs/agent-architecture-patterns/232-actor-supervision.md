# Hướng HX: Actor Supervision — cây giám sát, restart strategy, crash isolation

> **Nguồn gốc:** Erlang/OTP supervision trees (erlang.org); zylos.ai "Supervisor Trees and Fault Tolerance for AI Agent Systems" (2026); Akka/Pekko actors; Actix (Rust)
> **Coupling:** 🟡 — agent chạy trong supervision tree
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (32 supervisor-tree sẵn — cần generalize)
> **Effort:** 1-2 tuần

## Nguồn gốc

Erlang/OTP (1986): **"let it crash"** — process crash là normal, supervisor restart. Supervision tree: hierarchical arrangement of supervisors → workers. erlang.org: "A supervisor can restart a worker if something goes wrong." Restart strategies: **one-for-one** (restart chỉ process chết), **one-for-all** (restart tất cả anh em), **rest-for-one** (restart process chết + những gì start sau nó). zylos.ai (2026): "How Erlang/OTP's proven supervision model translates to resilient AI agent runtimes — covering strategies, Rust implementations." Actix (Rust): manual restart strategies + cascade handling. Medium: "supervision tree patterns that make systems bulletproof."

## Mô tả

mya actor supervision: mỗi agent session = actor trong supervision tree. Supervisor monitor agent, restart khi crash theo strategy. **One-for-one**: 1 agent crash → restart chỉ agent đó. **One-for-all**: 1 agent crash → restart tất cả agent cùng cấp (state dependent). **Rest-for-one**: agent crash → restart nó + agent dependent. "Let it crash" philosophy: không try-catch mọi thứ — để crash, supervisor recover — đơn giản + robust.

## Kiến trúc

```
  ┌────────────────────────────────────────────────────────┐
  │              ROOT SUPERVISOR (mya-gateway)             │
  │                                                        │
  │  ┌──────────────────────────────────────────────────┐ │
  │  │  SESSION SUPERVISOR (one-for-one)                │ │
  │  │                                                  │ │
  │  │  ┌────────┐ ┌────────┐ ┌────────┐                │ │
  │  │  │AGENT A │ │AGENT B │ │AGENT C │  ← workers     │ │
  │  │  │(coder) │ │(review)│ │(verify)│                │ │
  │  │  └───┬────┘ └────────┘ └────────┘                │ │
  │  │      │ CRASH!                                   │ │
  │  │      ▼                                          │ │
  │  │  ┌────────┐  ← restart (one-for-one)            │ │
  │  │  │AGENT A │  only A restarts                    │ │
  │  │  │(fresh) │                                    │ │
  │  │  └────────┘                                    │ │
  │  └──────────────────────────────────────────────────┘ │
  │                                                        │
  │  ┌──────────────────────────────────────────────────┐ │
  │  │  TOOL SUPERVISOR (rest-for-one)                  │ │
  │  │                                                  │ │
  │  │  [DB pool] → [HTTP client] → [MCP client]        │ │
  │  │  DB crash → restart DB + HTTP + MCP (dependent)  │ │
  │  └──────────────────────────────────────────────────┘ │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 32 supervisor-tree — Erlang OTP pattern (documented!)
// ✅ 26 actor-model — actor pattern (documented!)
// ✅ packages/agent/src/pool.ts — session pool (restart logic)
// ✅ 203 retry-loops — retry on failure
// ✅ 42 circuit-breaker — stop on repeated failure
// ✅ gateway health/readiness — liveness probe

// ❌ THIẾU: formal supervision tree (hierarchical restart)
// ❌ THIẾU: restart strategies (one-for-one / one-for-all / rest-for-one)
// ❌ THIẾU: max-restart-intensity (too many restarts → escalate)
// ❌ THIẾU: child spec (start/stop/restart hooks)
```

## Implementation

```typescript
// packages/supervisor/src/index.ts (NEW)
type RestartStrategy = "one_for_one" | "one_for_all" | "rest_for_one";

interface ChildSpec {
  name: string;
  start: () => Promise<AgentHandle>;
  restart: "permanent" | "temporary" | "transient";
}

class Supervisor {
  private children = new Map<string, { spec: ChildSpec; handle: AgentHandle; index: number }>();

  constructor(private strategy: RestartStrategy, private maxRestarts = 3, private withinMs = 5000) {}

  async startChild(spec: ChildSpec): Promise<void> {
    const handle = await spec.start();
    handle.onError = (err) => this.onChildExit(spec.name, err);
    this.children.set(spec.name, { spec, handle, index: this.children.size });
  }

  private async onChildExit(name: string, err: Error): Promise<void> {
    console.error(`[supervisor] ${name} crashed: ${err.message}`);

    switch (this.strategy) {
      case "one_for_one":
        await this.restart(name);
        break;
      case "one_for_all":
        for (const child of this.children.values()) await this.restart(child.spec.name);
        break;
      case "rest_for_one": {
        const crashed = this.children.get(name)!;
        for (const child of this.children.values()) {
          if (child.index >= crashed.index) await this.restart(child.spec.name);
        }
        break;
      }
    }
  }

  private async restart(name: string): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;
    if (child.spec.restart === "temporary") return; // don't restart temporary
    child.handle = await child.spec.start();
    child.handle.onError = (err) => this.onChildExit(name, err);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ "Let it crash" — đơn giản + robust (Erlang 40 năm) | ❌ Restart strategy complexity |
| ✅ Crash isolation (1 agent crash không hạ gateway) | ❌ State loss (restart = fresh state) |
| ✅ Auto-recovery (supervisor restart) | ❌ Restart storm (cascading crashes) |
| ✅ Hierarchical (escalate lên supervisor cấp trên) | ❌ max-restart-intensity tuning |
| ✅ 32 supervisor-tree đã document | |

## Khác các hướng gần

| | 26 Actor Model | 32 Supervisor Tree | HX: Actor Supervision |
|---|---|---|---|
| Mục | Concurrency | Restart strategy | **Hierarchical tree + crash isolation** |
| Crash | Actor dies | Supervisor restarts | **Escalate if too many** |
| Strategy | Per-actor | 3 strategies | **Tree-structured strategies** |

## Khi nào chọn

- Agent hay crash (LLM timeout, tool fail, OOM)
- Cần auto-recovery (supervisor restart)
- 1 agent crash không được hạ toàn bộ gateway
- OK với state loss (restart = fresh) hoặc có checkpoint (45)
