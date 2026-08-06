# Hướng V: Entity-Component-System (ECS) — agent = entity + components

> **Nguồn gốc:** Game Engine Architecture (Unity DOTS, Bevy ECS)
> **Coupling:** 🟡 Component queries (not direct calls)
> **Agent-agnostic:** ⚠️ — agents must be decomposed into components
> **Effort:** 2-3 tuần

## Nguồn gốc

ECS emerged trong game engine design (late 2000s). Hiện là standard cho AAA game engines: Unity DOTS, Unreal Mass Entity, Bevy (Rust). Data-Oriented Design movement.

**Tham chiếu:**
- Nystrom, R. (2014). *Game Programming Patterns*. (Component pattern)
- Bevy ECS: bevyengine.org/learn/book/ecs
- Gregory, J. (2018). *Game Engine Architecture*, 3rd ed.

## Mô tả

Agent KHÔNG phải class, KHÔNG phải process, KHÔNG phải session. Agent = **entity ID + bag of data components.** Behavior = **Systems** (pure functions over component queries). Cùng entity có thể gain/lose components runtime.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────────┐
│                    ECS AGENT ARCHITECTURE                         │
│                                                                   │
│  ENTITIES (just IDs, no behavior):                                │
│  Entity-001  Entity-007  Entity-008  Entity-009                  │
│                                                                   │
│  COMPONENTS (pure data, attached to entities):                    │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ FilesystemTools { read:true, write:["src/"], bash:1 }   │     │
│  │ ProviderProfile { model:"MiniMax-M3" }                   │     │
│  │ TaskGoal { desc:"fix auth", priority:3 }                 │     │
│  │ MemoryScope { domain:"project", ttl:86400000 }           │     │
│  │ ExecutionBudget { maxToolRounds:25 }                     │     │
│  │ CronSchedule { cron:"0 */4 * * *" }                      │     │
│  │ ChannelBinding { platform:"slack" }                      │     │
│  │ SubagentParent { parentId:Entity-001, depth:1 }          │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  SYSTEMS (pure functions over component queries):                 │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ System: ExecuteTurn                                       │     │
│  │   Query: (TaskGoal, ProviderProfile, ExecutionBudget)    │     │
│  │   For each entity matching → runTurn()                    │     │
│  │                                                           │     │
│  │ System: EnforcePermissions                               │     │
│  │   Query: (FilesystemTools) → validate tool access        │     │
│  │                                                           │     │
│  │ System: ConsolidateMemory                                │     │
│  │   Query: (MemoryScope) WHERE scope="project" → dreamCycle│     │
│  │                                                           │     │
│  │ System: ScheduleCron                                     │     │
│  │   Query: (CronSchedule, TaskGoal) → fire if due          │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  "Coder agent" = Entity-007 + {FilesystemTools,                  │
│                  ProviderProfile, TaskGoal, Budget}              │
│                                                                   │
│  Muốn thêm channel? Add ChannelBinding component.                │
│  Muốn read-only? Remove FilesystemTools.write.                   │
│  Không subclass, không restart, không protocol.                  │
└──────────────────────────────────────────────────────────────────┘
```

## Agent composition

```
// Coder agent
Entity-007:
  - FilesystemTools { read: true, write: ["src/"], bash: 1 }
  - ProviderProfile { model: "MiniMax-M3", provider: "minimax" }
  - TaskGoal { description: "refactor auth module", priority: 3 }
  - ExecutionBudget { maxToolRounds: 25, maxTokens: 100000 }
  - MemoryScope { domain: "project", ttl: 86400000 }

// Reviewer agent
Entity-008:
  - FilesystemTools { read: true, write: [], bash: 0 }  // read-only!
  - ProviderProfile { model: "claude-opus-4", provider: "anthropic" }
  - CodeReviewBrain { system: "You are a code reviewer..." }
  - ExecutionBudget { maxToolRounds: 10 }

// Cron agent
Entity-009:
  - CronSchedule { cron: "0 */4 * * *", graceMs: 30000 }
  - TaskGoal { description: "scan dependencies for vulnerabilities" }
  - ProviderProfile { model: "MiniMax-M3" }
```

## Runtime mutation

```typescript
// Give reviewer temporary write access (reviewer was read-only)
ecs.updateComponent(entity-008, FilesystemTools, { read: true, write: ["src/temp/"], bash: 0 });

// Make coder agent also a cron agent
ecs.addComponent(entity-007, CronSchedule, { cron: "0 9 * * 1" });

// Remove bash access from coder (incident response)
ecs.updateComponent(entity-007, FilesystemTools, { read: true, write: ["src/"], bash: 0 });
```

## Systems (behavior)

```typescript
// System: ExecuteTurn — processes all entities with TaskGoal + Provider + Budget
function systemExecuteTurn(ecs: ECS) {
  const entities = ecs.query(TaskGoal, ProviderProfile, ExecutionBudget)
    .filter(e => !e.has(Active)); // not already running

  for (const entity of entities) {
    const goal = entity.get(TaskGoal);
    const provider = entity.get(ProviderProfile);
    const budget = entity.get(ExecutionBudget);

    if (budget.maxToolRounds > 0 && goal.status === "pending") {
      entity.add(Active, { startedAt: nowWallclock() });
      // Spawn agent subprocess OR run in-process
      runAgent(entity.id, goal, provider, budget);
    }
  }
}

// System: EnforcePermissions — validates tool access
function systemEnforcePermissions(ecs: ECS) {
  for (const entity of ecs.query(FilesystemTools)) {
    const tools = entity.get(FilesystemTools);
    if (tools.bash > 0) {
      // Check role allows bash
      const role = entity.get(RoleComponent);
      if (role?.name === "reviewer" && !role.allowBash) {
        tools.bash = 0; // Remove bash access
      }
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Extreme composability (add/remove components) | ❌ Cognitive load (no clear "agent" abstraction) |
| ✅ Data-oriented performance (cache-friendly) | ❌ Indirection ("what does Entity-007 do?") |
| ✅ Natural parallelism (disjoint component sets) | ❌ No encapsulation (any System reads any component) |
| ✅ Runtime mutability (no restart needed) | ❌ Debugging (which System corrupted data?) |
| ✅ Testable (each System = pure function) | ❌ Overkill for simple cases |

## Khác mọi pattern

| Pattern | Core Assumption | ECS |
|---|---|---|
| Wrapper | Wraps one agent | No wrapping — components added/removed |
| Orchestrator | Orchestrator owns lifecycle | Systems don't "own" entities — they query |
| Platform | Fixed APIs | No fixed API — Systems define behavior |
| Proxy | Intercepts calls | No interception — data shared directly |

**Fundamental shift:** behavior is NOT a property of agents — it's a property of Systems that query over agents.

## Khi nào chọn

- Want maximum composability (mix/match capabilities)
- Want data-oriented architecture (performance)
- Need runtime mutation (add/remove capabilities dynamically)
- OK with indirection (behavior scattered across Systems)
- Building a platform where "agent type" is fluid
