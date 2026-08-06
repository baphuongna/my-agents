# Hướng AD: Behavior Tree — game AI decision cho agent

> **Nguồn gốc:** Game AI (Halo 2, 2005; popularized bởi Unreal Engine)
> **Coupling:** 🟡 Tree structure + blackboard
> **Agent-agnostic:** ✅ — nodes gọi bất kỳ agent
> **Effort:** 2-3 tuần

## Nguồn gốc

Behavior Trees emerged từ game AI (Halo 2, 2005). Thay thế Finite State Machines cho AI điều khiển NPC. Mỗi node trả về Success/Failure/Running. Composite nodes (Sequence/Selector/Parallel) điều khiển luồng. Blackboard chia sẻ state.

## Mô tả

Agent decision = Behavior Tree. Root → traverse tree mỗi tick. Sequence: chạy tuần tự, fail nếu 1 node fail. Selector (Fallback): thử node đầu, fallback node sau. Parallel: chạy nhiều node cùng lúc. Leaves = actions (gọi agent, tool, memory).

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                    BEHAVIOR TREE                              │
│                                                              │
│                         ┌────────┐                           │
│                         │ ROOT   │                           │
│                         │Selector│                           │
│                         └───┬────┘                           │
│                    ┌────────┼─────────┐                      │
│                    ▼        ▼         ▼                      │
│             ┌──────────┐ ┌──────┐ ┌────────┐                │
│             │ SEQUENCE │ │ COND │ │ SEQUEN.│                │
│             │ "do work" │ │"auth"│ │"report"│                │
│             └────┬─────┘ └──────┘ └───┬────┘                │
│        ┌─────────┼─────────┐          │                      │
│        ▼         ▼         ▼          ▼                      │
│  ┌─────────┐ ┌──────┐ ┌────────┐ ┌─────────┐                │
│  │ CHECK   │ │ GATHER│ │ RUN    │ │ SEND    │                │
│  │ task    │ │memory │ │ pi     │ │ result  │                │
│  │ exists? │ │ ctx   │ │ agent  │ │ to user │                │
│  └─────────┘ └──────┘ └────────┘ └─────────┘                │
│        │                                        │            │
│   ┌────▼────┐                              ┌─────▼────┐      │
│   │ SELECTOR│                              │ SEQUENCE │      │
│   │ fallback│                              │ "review" │      │
│   └────┬────┘                              └────┬─────┘      │
│    ┌───┴───┐                              ┌─────┼─────┐      │
│    ▼       ▼                              ▼     ▼     ▼      │
│  ┌────┐  ┌────┐                      ┌────┐ ┌────┐ ┌────┐   │
│  │RUN │  │ASK │                      │RUN │ │RUN │ │MERGE│  │
│  │pi  │  │user│                      │clau│ │open│ │    │   │
│  │code│  │    │                      │de  │ │code│ │    │   │
│  └────┘  └────┘                      └────┘ └────┘ └────┘   │
│                                                              │
│  NODE TYPES:                                                 │
│  · Composite: Sequence (tuần tự), Selector (fallback),       │
│                Parallel (song song)                          │
│  · Decorator: Invert, Retry, Timeout, Repeat                 │
│  · Condition: kiểm tra blackboard state                      │
│  · Action: gọi agent/tool (leaf)                             │
│                                                              │
│  BLACKBOARD (shared state):                                  │
│  { task, memory, role, model, lastResult, errors }           │
└──────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
// packages/behavior-tree/src/index.ts
type Status = "success" | "failure" | "running";

interface Node {
  tick(ctx: Blackboard): Status | Promise<Status>;
}

// Composite: Sequence — chạy tuần tự, fail nếu 1 node fail
class Sequence implements Node {
  constructor(private children: Node[]) {}
  async tick(ctx: Blackboard): Promise<Status> {
    for (const child of this.children) {
      const status = await child.tick(ctx);
      if (status !== "success") return status;
    }
    return "success";
  }
}

// Composite: Selector — thử node đầu, fallback node sau
class Selector implements Node {
  constructor(private children: Node[]) {}
  async tick(ctx: Blackboard): Promise<Status> {
    for (const child of this.children) {
      const status = await child.tick(ctx);
      if (status !== "failure") return status;
    }
    return "failure";
  }
}

// Composite: Parallel — chạy song song
class Parallel implements Node {
  constructor(private children: Node[], private policy: "all" | "any") {}
  async tick(ctx: Blackboard): Promise<Status> {
    const results = await Promise.all(this.children.map(c => c.tick(ctx)));
    if (this.policy === "all") return results.every(r => r === "success") ? "success" : "failure";
    return results.some(r => r === "success") ? "success" : "failure";
  }
}

// Decorator: Retry
class Retry implements Node {
  constructor(private child: Node, private maxAttempts: number) {}
  async tick(ctx: Blackboard): Promise<Status> {
    for (let i = 0; i < this.maxAttempts; i++) {
      if (await this.child.tick(ctx) === "success") return "success";
    }
    return "failure";
  }
}

// Action leaf: run agent
class RunAgent implements Node {
  constructor(private agent: string, private getTask: (ctx: Blackboard) => string) {}
  async tick(ctx: Blackboard): Promise<Status> {
    const task = this.getTask(ctx);
    ctx.set("lastAgent", this.agent);
    const result = await spawnAgent(this.agent, task);
    ctx.set("lastResult", result);
    return result.ok ? "success" : "failure";
  }
}

// Condition leaf: check blackboard
class Condition implements Node {
  constructor(private check: (ctx: Blackboard) => boolean) {}
  tick(ctx: Blackboard): Status {
    return this.check(ctx) ? "success" : "failure";
  }
}
```

## Example: coding workflow tree

```
Selector "main"
├─ Sequence "handle-auth-task"
│  ├─ Condition "is auth task?"  (check task type in blackboard)
│  ├─ RunAgent "pi_code"          (implement auth)
│  ├─ RunAgent "claude_review"    (security review)
│  ├─ Sequence "fix-if-issues"
│  │  ├─ Condition "review has issues?"
│  │  ├─ RunAgent "pi_code"       (fix issues)
│  │  └─ RunAgent "claude_review" (re-review)
│  └─ RunAgent "report"           (summarize to user)
└─ Sequence "handle-general-task"
   ├─ RunAgent "pi"               (general coding)
   └─ RunAgent "report"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Modular (nodes tái sử dụng) | ❌ Tree design complexity |
| ✅ Visualizable (tree = documentation) | ❌ Non-deterministic? (NO — deterministic!) |
| ✅ Composability (Sequence/Selector/Parallel) | ❌ Leaf nodes must handle all edge cases |
| ✅ Fallback logic tự nhiên | ❌ Blackboard shared state (coupling) |
| ✅ Real-time control (tick every N ms) | ❌ Can't express complex memory |
| ✅ Game-proven (Halo, Unreal) | |

## Khi nào chọn

- Want structured decision-making (not free-form LLM flow)
- Need fallback logic (try A, fallback B, fallback C)
- Want parallel subtrees (review + test cùng lúc)
- Need retry/timeout decorators (robust execution)
- OK with explicit tree design (not emergent)
