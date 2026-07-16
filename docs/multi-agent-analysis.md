# mya Multi-Agent — Analysis

> How mya manages agents today, what works, and what's broken.

## TL;DR

**Multi-agent is "wired" at the pool level but NOT functional end-to-end.**

The `AgentPool` class supports named agents with per-agent isolation
(agentDir, maxSessions, idleTtlMs). But nothing upstream (gateway, web,
launcher) actually routes to named agents, and nothing downstream (memory,
skills, secrets) is isolated per agent. **In practice, all sessions are
identical — they share everything except the sessionId.**

---

## Architecture (current)

```
┌─────────────────────────────────────────────────────────────────┐
│  Web Dashboard / Launcher TUI                                   │
│                                                                 │
│  POST /pool/acquire  { cwd }          ← NO agentName param      │
│  POST /pool/prompt/:id  { text }      ← NO agentName param      │
│  GET  /pool/status                   ← returns sessions (flat)  │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  Gateway (packages/gateway/src/index.ts)                        │
│                                                                 │
│  poolAcquire?: (cwd: string) => string    ← no agentName        │
│  poolPrompt?: (sessionId, text) => void   ← no agentName        │
│  poolStatus?: () => SessionInfo[]         ← flat list           │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  AgentPool (packages/agent/src/pool.ts)                         │
│                                                                 │
│  ✅ Supports named agents:                                      │
│     acquire(sessionId, agentName?)                              │
│     registerAgent({ name, agentDir, maxSessions })              │
│     Multi-agent via MYA_AGENTS env                              │
│                                                                 │
│  ⚠️ But agentName is NEVER passed by gateway                    │
│     → ALL sessions use default pool                             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  Session Factory (packages/print/src/main.ts)                   │
│                                                                 │
│  createSession(sessionId, cwd, agentDir)                        │
│  → createAgentSession({ cwd, agentDir })                        │
│                                                                 │
│  agentDir defaults to ~/.mya/agent/                             │
│  Named agents CAN have different agentDir                       │
│  BUT: only session storage (JSONL) is isolated                  │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  GLOBAL Singletons (shared-instances.ts)                        │
│                                                                 │
│  ❌ sqliteMemory: ~/.mya/memory/memory.db    (ALL agents share) │
│  ❌ skillStore:   ~/.mya/skills/             (ALL agents share) │
│  ❌ secretStore:  ~/.mya/secrets/            (ALL agents share) │
│  ❌ auditLog:     ~/.mya/audit/              (ALL agents share) │
│  ❌ brain:        ~/.mya/memory/             (ALL agents share) │
│  ❌ wallet:       ~/.mya/wallet/             (ALL agents share) │
│                                                                 │
│  These are created ONCE at module load.                         │
│  Per-agent isolation does NOT exist for these.                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## What EXISTS (code-level)

### 1. AgentPool supports multi-agent

**File:** `packages/agent/src/pool.ts` (227 lines)

```typescript
export interface AgentConfig {
  name: string;           // unique identifier
  agentDir?: string;      // session storage dir
  maxSessions?: number;   // per-agent concurrency
  idleTtlMs?: number;     // per-agent idle timeout
}

// Pool tracks sessions per-agent via composite key: `${agentName}:${sessionId}`
private poolKey(sessionId, agentName?) {
  return agentName ? `${agentName}:${sessionId}` : sessionId;
}
```

**Features implemented:**
- ✅ Named agent registration (`registerAgent`)
- ✅ Per-agent max sessions (`effectiveMaxSessions`)
- ✅ Per-agent idle TTL (`effectiveIdleTtl`)
- ✅ Per-agent LRU eviction (`evictOldest(agentName)`)
- ✅ Per-agent session listing (`list(agentName)`)

### 2. MYA_AGENTS env var

**File:** `packages/print/src/main.ts` → `parseAgentsEnv()`

```bash
# Define named agents via env
MYA_AGENTS='[
  {"name":"coder","agentDir":"~/.mya/agents/coder","maxSessions":4},
  {"name":"researcher","agentDir":"~/.mya/agents/researcher","maxSessions":2}
]' mya web
```

Parsed at gateway startup, passed to `AgentPool({ agents })`.

### 3. Subagent system (within-session)

**File:** `packages/coding-agent/src/core/subagent.ts`

This is **different from multi-agent** — it's delegation WITHIN a single session:

```typescript
const sub = await spawnSubagent(parentSession, {
  goal: "review the auth code",
  allowedTools: ["read", "grep"],
});
// sub.status: "running" | "done" | "failed" | "aborted"
// sub.output: collected text
// sub.abort(): cancel
```

Subagents are tracked per-parent-session and have depth limits.

---

## What's BROKEN (end-to-end gaps)

### Gap 1: Gateway never passes agentName (CRITICAL)

**The pool supports `agentName`, but the gateway API doesn't expose it.**

```typescript
// Gateway interface (packages/gateway/src/index.ts)
poolAcquire?: (cwd: string) => string | Promise<string>;
//                                                    ↑ no agentName!

poolPrompt?: (sessionId: string, text: string) => void;
//                                                      ↑ no agentName!
```

```typescript
// main.ts wiring
poolAcquire: async (cwd: string) => {
  const sessionId = `s-${nowWallclock()...}`;
  await pool.createForCwd(sessionId, cwd);  // ← no agentName!
  return sessionId;
},
```

**Result:** Even if you configure `MYA_AGENTS` with named agents, all sessions
go to the default pool. Named agents are registered but never used.

### Gap 2: No web UI for agent selection (HIGH)

The web dashboard (`packages/web/src/dashboard.ts`) has no agent selector.
Users can't choose which agent to talk to. The "New session" button creates
a default-pool session.

### Gap 3: Memory/skills/secrets are global (HIGH)

`shared-instances.ts` creates singletons at module load:

```typescript
const memoryDir = join(homedir(), ".mya", "memory");  // GLOBAL
const sqliteMemory = new SqliteMemoryManager({
  dbPath: join(homedir(), ".mya", "memory", "memory.db"),  // GLOBAL
});
const skillStore = new SkillStore();
skillStore.discover(join(homedir(), ".mya", "skills"));  // GLOBAL
const secretStore = new SecretStore(...);  // GLOBAL
```

Even if named agents have different `agentDir`, they all share:
- Memory (SQLite DB)
- Skills (skill directory)
- Secrets (credential store)
- Audit log
- Wallet
- Brain

**True agent isolation requires per-agent instances of ALL of these.**

### Gap 4: No agent config file (MEDIUM)

There's no `~/.mya/agents/*.toml` or similar. Agents can only be defined via
the clunky `MYA_AGENTS` env var (JSON in a shell variable). There's no:

```toml
# ~/.mya/agents/coder.toml  ← doesn't exist
[agent]
name = "coder"
model = "MiniMax-M3"
system_prompt_append = "You are a TypeScript expert..."

[memory]
path = "~/.mya/agents/coder/memory.db"  # isolated memory

[skills]
path = "~/.mya/agents/coder/skills/"    # isolated skills
```

### Gap 5: Launcher doesn't show agent names (MEDIUM)

The launcher "Agents" tab shows sessions as a flat list:

```
●  s-abc123 work on turbo cache     running   5 msgs 2m ago
○  s-def456 research rust lsm       idle      3 msgs 5m ago
    └─ review auth code             done
```

It doesn't show which **named agent** each session belongs to (if multi-agent
were enabled).

### Gap 6: No per-agent model/provider (MEDIUM)

All agents use the same `~/.mya/agent/settings.json`:

```json
{
  "defaultProvider": "minimax",
  "defaultModel": "MiniMax-M3"
}
```

There's no way to have:
- Agent "coder" → MiniMax-M3 (for coding)
- Agent "writer" → Claude Opus (for prose)
- Agent "fast" → Haiku (for quick tasks)

### Gap 7: No per-agent system prompt (MEDIUM)

All agents get the same base prompt (from pi) + same mya-bridge injection.
There's no way to give different agents different personalities or instructions.

### Gap 8: No per-agent MCP/tools (LOW)

All agents get the same MCP servers and tool set. Can't restrict "researcher"
to read-only tools while giving "coder" full edit access.

### Gap 9: Subagent tool restriction is prompt-only (LOW)

```typescript
// subagent.ts comment:
// "pi's AgentSession doesn't natively support per-tool restrictions.
//  For now, the restriction is enforced via the goal/prompt."
```

`allowedTools` in subagent options is advisory — not enforced at the tool dispatch
level. A subagent told "only use read+grep" can still call bash/edit.

### Gap 10: No agent lifecycle management (LOW)

No way to:
- Create/delete named agents at runtime
- Pause/resume an agent
- Clone an agent's config
- View agent-specific stats (tokens used, sessions created, etc.)

---

## Comparison with reference systems

| Feature | pi-crew (my_pi) | Claude Code | OpenCode | **mya** |
|---|---|---|---|---|
| Multi-agent pool | ✅ teams + roles | ✅ Agent tool | ❌ single | ✅ pool (not wired) |
| Per-agent config | ✅ team.md | ✅ agent .md | ❌ | ❌ env var only |
| Per-agent memory | ✅ per-worktree | ✅ per-project | ❌ | ❌ global |
| Per-agent model | ✅ per-agent | ✅ per-spawn | ❌ | ❌ global |
| Per-agent tools | ✅ role-based | ✅ per-type | ❌ | ❌ global |
| Subagent depth | ✅ configurable | ✅ unlimited | ❌ | ✅ MAX_DEPTH |
| Agent isolation | ✅ worktree | ✅ subprocess | ❌ | ⚠️ agentDir only |
| Runtime create | ✅ team create | ✅ dynamic | ❌ | ❌ restart only |

**Key difference:** pi-crew and Claude Code treat agents as **first-class entities**
with their own config, memory, model, and tools. mya treats them as **sessions
with different IDs** — everything else is shared.

---

## What "multi-agent" SHOULD look like

```
┌─────────────────────────────────────────────────────────────────┐
│  ~/.mya/                                                        │
│  ├── config.toml              ← global config                   │
│  ├── agents/                  ← per-agent configs                │
│  │   ├── default.toml         ← the default agent               │
│  │   ├── coder.toml           ← coding specialist                │
│  │   ├── researcher.toml      ← research agent                   │
│  │   └── reviewer.toml        ← code review agent                │
│  │                                                              │
│  ├── agents-data/             ← per-agent isolated data          │
│  │   ├── default/             ← same as current ~/.mya/agent/    │
│  │   │   ├── memory.db                                         │
│  │   │   ├── sessions/                                         │
│  │   │   ├── settings.json                                     │
│  │   │   ├── skills/                                           │
│  │   │   └── secrets/                                          │
│  │   ├── coder/               ← fully isolated                  │
│  │   │   ├── memory.db        ← separate memory                 │
│  │   │   ├── sessions/                                          │
│  │   │   ├── settings.json    ← MiniMax-M3 + coding prompt      │
│  │   │   └── skills/          ← coding-specific skills           │
│  │   └── researcher/                                            │
│  │       ├── memory.db        ← separate memory                 │
│  │       ├── settings.json    ← Claude Opus + research prompt    │
│  │       └── skills/          ← research skills                  │
│  │                                                              │
│  └── shared/                  ← cross-agent shared resources     │
│      ├── audit/               ← global audit log                 │
│      └── wallet/              ← global wallet                    │
└─────────────────────────────────────────────────────────────────┘
```

### Agent config file format (proposed)

```toml
# ~/.mya/agents/coder.toml
[agent]
name = "coder"
description = "TypeScript + Rust coding specialist"
model = "MiniMax-M3"
thinking_level = "high"

[prompt]
append = """
You are a coding specialist. Focus on:
- TypeScript 7 and Rust
- Minimal core, no over-engineering
- Always run tests before claiming done
"""

[memory]
path = "~/.mya/agents-data/coder/memory.db"
scope = "agent"  # agent | session | global

[skills]
path = "~/.mya/agents-data/coder/skills/"
load = ["tdd", "lint", "review"]  # only these skills

[tools]
allowed = ["read", "bash", "edit", "write", "grep", "find"]
denied = ["browser_action"]  # coder doesn't need browser

[mcp]
servers = ["filesystem", "github"]  # only these MCP servers
```

---

## Recommendations

### Tier 1: Make existing pool actually work (HIGH impact)

1. **Add agentName to gateway API** — `poolAcquire(cwd, agentName?)`
2. **Web dashboard agent selector** — dropdown to choose agent
3. **Thread agentName through all calls** — acquire, prompt, status, kill

This makes the EXISTING AgentPool code functional. No new architecture needed.

### Tier 2: True isolation (HIGH impact)

4. **Per-agent memory** — `SqliteMemoryManager` per agent, not global
5. **Per-agent skills** — `SkillStore` per agent
6. **Per-agent secrets** — `SecretStore` per agent (or shared with namespace)
7. **Per-agent settings** — model/provider per agent

### Tier 3: Agent config files (MEDIUM impact)

8. **`~/.mya/agents/*.toml`** — replace env var with config files
9. **Per-agent system prompt** — `prompt.append` in config
10. **Per-agent tool whitelist** — enforce `tools.allowed/denied`
11. **Launcher agent column** — show which agent each session uses

### Tier 4: Advanced (LOW priority)

12. **Runtime agent create/delete** — no restart needed
13. **Agent templates** — `mya agent new --template=coder`
14. **Per-agent MCP** — different MCP servers per agent
15. **Subagent tool enforcement** — real ToolPolicy, not prompt-based

---

## File map

```
packages/agent/src/
├── pool.ts              ← AgentPool (multi-agent aware, but upstream doesn't use it)
├── index.ts             ← createAgent, exports
└── subagent.test.ts     ← subagent tests

packages/coding-agent/src/core/
├── subagent.ts          ← spawnSubagent, trackSubagent, MAX_DEPTH
└── agent-session.ts     ← createAgentSession (pi session factory)

packages/print/src/
├── main.ts              ← parseAgentsEnv, gateway wiring (MISSING agentName)
├── launcher.ts          ← Agents tab (MISSING agent name display)
├── shared-instances.ts  ← GLOBAL singletons (NOT per-agent)
└── pi-main.ts           ← TUI entry (single-agent only)

packages/gateway/src/
└── index.ts             ← Gateway API (MISSING agentName param)

packages/web/src/
└── dashboard.ts         ← Web UI (MISSING agent selector)
```

---

## Summary

| Question | Answer |
|---|---|
| Does mya support multiple agents? | Code yes, practice no |
| Is AgentPool multi-agent aware? | ✅ Yes (named agents, per-agent limits) |
| Does the gateway route to named agents? | ❌ No (agentName never passed) |
| Is memory isolated per agent? | ❌ No (global SQLite DB) |
| Is there an agent config file? | ❌ No (env var only) |
| Can users select agents in UI? | ❌ No |
| Is subagent the same as multi-agent? | ❌ No (subagent = delegation within a session) |
| Can different agents use different models? | ❌ No (global settings.json) |

**Bottom line:** The infrastructure exists (`AgentPool`) but the plumbing
(gateway API, web UI, per-agent resources) was never completed. Multi-agent
is a skeleton — the bones are there, but no muscles or skin.
