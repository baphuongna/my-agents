# Hướng DD: Declarative Reconcile Loop — mya = K8s controller cho agents

> **Nguồn gốc:** Kubernetes control loop (K8s, 2014)
> **Coupling:** 🟡 Declarative spec + reconcile
> **Agent-agnostic:** ✅ — bất kỳ agent có spec
> **Code sẵn:** ✅ cron scheduler dùng reconcile pattern
> **Effort:** 2-3 tuần

## Nguồn gốc

Kubernetes: users declare **desired state** (yaml spec). K8s controller continuously **reconciles** — compares observed state vs desired state, drives system toward desired. Không event-driven — control loop polls. Tự phục hồi khi drift.

## Mô tả

Agents được khai báo bằng **declarative spec** (giống K8s yaml). mya = controller, liên tục reconcile: đọc desired state, đọc observed state, so sánh, action để hội tụ. Nếu agent crash / config đổi / trạng thái drift → mya tự sửa.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│              DECLARATIVE AGENT SPEC (yaml)                   │
│                                                              │
│  agents.yaml:                                                │
│  ┌────────────────────────────────────────────────────┐      │
│  │ apiVersion: mya/v1                                  │      │
│  │ kind: Agent                                        │      │
│  │ spec:                                              │      │
│  │   command: pi                                      │      │
│  │   args: ["--mode", "rpc"]                          │      │
│  │   model: MiniMax-M3                                │      │
│  │   toolsAllowed: [read, write, edit, bash]          │      │
│  │   replicas: 2          ← muốn 2 phiên bản chạy    │      │
│  │   env:                                             │      │
│  │     OPENAI_BASE_URL: http://localhost:3000/v1      │      │
│  │ ──────────────────────────────────────────────────  │      │
│  │ apiVersion: mya/v1                                  │      │
│  │ kind: CronAgent                                     │      │
│  │ spec:                                              │      │
│  │   schedule: "0 */4 * * *"                          │      │
│  │   prompt: "scan dependencies"                      │      │
│  │   approvalMode: deny                                │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │              mya CONTROLLER (reconcile loop)        │      │
│  │                                                    │      │
│  │  while true:                                       │      │
│  │    desired = readSpec(agents.yaml)                 │      │
│  │    observed = listSessions()                       │      │
│  │    for each agent in desired:                      │      │
│  │      count = observed.count(agent.name)            │      │
│  │      if count < agent.spec.replicas:               │      │
│  │        spawn(agent)          ← scale up            │      │
│  │      if count > agent.spec.replicas:               │      │
│  │        kill(extra)           ← scale down          │      │
│  │      if agent.state != agent.spec.desiredState:    │      │
│  │        apply(agent.spec)     ← reconcile drift     │      │
│  │    sleep(5s)                                       │      │
│  └────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

## mya đã có reconcile trong cron

```typescript
// packages/cron/src/index.ts — CronScheduler.reconcile()
// Gateway calls reconcile() mỗi sweep để pick up external edits.
// Đã là K8s-style reconcile loop — chỉ cần generalize cho agents.

/** Persistence: reconcile to pick up external (CLI) file edits. */
reconcile(loaded: ReadonlyArray<Partial<CronJob> & { id: string }>): void {
  // 1. Compare loaded (desired) vs this.jobs (observed)
  // 2. Add missing jobs
  // 3. Update changed jobs
  // 4. Remove deleted jobs
}
```

## Reconcile loop code

```typescript
// packages/gateway/src/agent-controller.ts (NEW)
class AgentController {
  private desiredSpecs = new Map<string, AgentSpec>();
  private observed = new Map<string, RuntimeSession>();

  async reconcile(): Promise<void> {
    // 1. Read desired specs (agents.yaml + API mutations)
    const desired = await this.readDesiredState();

    // 2. List observed sessions
    const observed = await this.pool.tree();

    // 3. Diff + act
    for (const [name, spec] of desired) {
      const running = observed.filter(s => s.name === name);

      // Scale up
      if (running.length < spec.replicas) {
        for (let i = running.length; i < spec.replicas; i++) {
          await this.pool.acquire({ name, ...spec });
          log(`[controller] scaled up ${name} → ${i + 1} replicas`);
        }
      }

      // Scale down
      if (running.length > spec.replicas) {
        for (let i = spec.replicas; i < running.length; i++) {
          await this.pool.kill(running[i].sessionId);
          log(`[controller] scaled down ${name} → ${i} replicas`);
        }
      }

      // Reconcile drift (model, tools, env changed)
      for (const session of running) {
        if (!matchesSpec(session, spec)) {
          await this.pool.kill(session.sessionId);
          await this.pool.acquire({ name, ...spec });
          log(`[controller] reconciled ${name} (spec drift)`);
        }
      }
    }

    // 4. Kill orphaned sessions (not in desired spec)
    for (const session of observed) {
      if (!desired.has(session.name)) {
        await this.pool.kill(session.sessionId);
        log(`[controller] killed orphan ${session.name}`);
      }
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Self-healing (crash → reconcile respawn) | ❌ Reconcile loop lag (5s poll) |
| ✅ Declarative (yaml = source of truth) | ❌ Loop overhead (constant diffing) |
| ✅ Auto-scaling (replicas) | ❌ Complex (multi-agent state management) |
| ✅ Config drift detection | ❌ Loop may fight with agent self-management |
| ✅ K8s-proven pattern | |
| ✅ Cron scheduler đã chứng minh | |

## Khi nào chọn

- Want self-healing agents (crash → auto-restart)
- Want declarative config (yaml = desired state)
- Need auto-scaling (replicas per agent type)
- Want drift detection (spec vs observed)
- OK with poll-based reconcile (not event-driven)
