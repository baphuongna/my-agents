# mya Roles Architecture — One Agent, Multiple Roles

> **User insight:** Instead of full multi-agent isolation (separate memory/skills/secrets
> per agent), model it as **one agent wearing different hats**.

## TL;DR

**Roles > Agents for personal use.** This is simpler, shares knowledge across
roles, and matches how pi-crew and Claude Code actually work. A "role" is just:
system prompt overlay + tool whitelist + optional model preference — NOT a
separate entity with isolated state.

---

## Two approaches compared

### Approach A: Full multi-agent (my original proposal)

```
~/.mya/
├── agents-data/
│   ├── coder/          ← fully isolated
│   │   ├── memory.db   ← separate brain
│   │   ├── skills/     ← separate skills
│   │   ├── secrets/    ← separate secrets
│   │   └── settings.json
│   ├── researcher/     ← fully isolated
│   │   ├── memory.db   ← DOESN'T know what coder learned
│   │   └── ...
│   └── reviewer/
```

**Problem:** "researcher" role doesn't know that "coder" already learned your
preferences. Knowledge is siloed. You repeat yourself.

### Approach B: One agent, multiple roles (proposed)

```
~/.mya/
├── memory.db           ← SHARED brain (one knowledge base)
├── skills/             ← SHARED skills
├── secrets/            ← SHARED secrets
├── settings.json       ← base settings
└── roles/              ← lightweight role configs
    ├── default.toml    ← general assistant
    ├── coder.toml      ← coding specialist
    ├── researcher.toml ← research agent
    └── reviewer.toml   ← code reviewer
```

**Benefit:** "researcher" remembers what "coder" learned about your preferences.
One brain, many hats.

---

## Why roles > agents (for personal use)

| Factor | Full multi-agent | Roles (shared brain) |
|---|---|---|
| **Implementation complexity** | High (per-agent SQLite, skills, secrets) | Low (config overlay) |
| **Knowledge sharing** | ❌ Siloed per agent | ✅ Cross-pollination |
| **Memory recall** | Each agent only sees its own | All roles see all memories (filterable by scope) |
| **Config overhead** | Heavy (full data dir per agent) | Light (1 TOML file per role) |
| **Context switching** | Lose all context when switching agents | Retain full context, just change "hat" |
| **Matches pi-crew** | ❌ (pi-crew shares workspace) | ✅ (pi-crew roles share state) |
| **Matches Claude Code** | ❌ (CC agents share workspace) | ✅ (CC agent types share project) |
| **Good for personal use** | ❌ Overkill | ✅ Right-sized |
| **Good for multi-user SaaS** | ✅ Required | ❌ No isolation |

**Key insight:** Claude Code's "agents" (Explore, Plan, general-purpose) are NOT
isolated entities — they're **tool-set profiles** that share the same project
context. pi-crew's roles (explorer, planner, executor) are the same — they share
one workspace, differ only in system prompt + allowed tools.

---

## How pi-crew does it (reference pattern)

**File:** `/home/bom/source/my_pi/pi-crew/src/config/role-tools.ts`

```typescript
export const ROLE_TOOL_CONFIGS: Record<string, RoleToolConfig> = {
  // Explorer - Read-only, no write or execute
  explorer: {
    tools: ["read", "grep", "find", "ls", "glob"],
    excludeTools: ["edit", "write", "bash", "web"],
  },
  // Planner - Read-only planning
  planner: {
    tools: ["read", "grep", "find", "ls", "glob"],
    excludeTools: ["edit", "write", "bash", "web", "ask_question"],
  },
  // Executor - Full access (default)
  executor: {
    // No restrictions - full tool access
  },
  // Reviewer - Read and review, no write
  reviewer: {
    tools: ["read", "grep", "find", "ls", "glob", "bash"],
    excludeTools: ["edit", "write"],
  },
  // Writer - Documentation focused
  writer: {
    tools: ["read", "edit", "write", "ls"],
    excludeTools: ["bash", "web", "ask_question"],
  },
};
```

**Pattern:** Role = tool whitelist/blacklist. No separate memory. No separate
workspace. Just a tool overlay applied at session start.

Claude Code is identical — `Explore` agent has "All tools except Edit, Write",
`general-purpose` has "Tools: *", etc.

---

## Proposed: mya roles architecture

### Role config format

```toml
# ~/.mya/roles/coder.toml
[role]
name = "coder"
description = "TypeScript + Rust coding specialist"

[prompt]
append = """
You are a coding specialist. Focus on:
- TypeScript 7 and Rust via napi-rs
- Minimal core, no over-engineering
- Always run tests before claiming done
- Follow AGENTS.md hard rules
"""

[tools]
# Whitelist: only these tools are available (optional)
allowed = ["read", "bash", "edit", "write", "grep", "find"]
# Blacklist: remove from default set (optional)
denied = ["browser_action"]  # coder doesn't need browser

[model]
prefer = "MiniMax-M3"        # optional model override
thinking = "high"            # optional thinking level

[memory]
scope = "global"             # global | role (filter recall by scope)
# scope="role" → recall only memories tagged with this role name
```

### Role file loading

```
~/.mya/roles/
├── default.toml       ← always exists (fallback)
├── coder.toml
├── researcher.toml
├── reviewer.toml
└── writer.toml
```

At startup:
1. Scan `~/.mya/roles/*.toml`
2. Parse each into `RoleConfig`
3. Register in `RoleRegistry`
4. `default.toml` is the fallback when no role specified

### How a role is applied

```
User selects role "coder" (or `/role coder`)
     │
     ├─ 1. Load coder.toml
     │
     ├─ 2. Apply model override (if specified)
     │     settings.model = "MiniMax-M3"
     │     settings.thinking = "high"
     │
     ├─ 3. Apply tool filter
     │     ToolRegistry.filter({ allowed, denied })
     │     → removes browser_action, keeps read/bash/edit/write
     │
     ├─ 4. Inject role prompt into system prompt
     │     systemPrompt += "\n[role: coder]\n" + role.prompt.append
     │
     ├─ 5. Set memory recall scope (if role-scoped)
     │     recallOptions.scope = "coder"
     │
     └─ Session starts with role overlay applied
```

---

## Memory + roles (the key insight)

**Memory is SHARED, but can be filtered by scope.**

The SQLite schema already has a `scope` column:

```sql
-- working_memory
scope TEXT DEFAULT 'global',

-- episodic_memory  
scope TEXT DEFAULT 'global',

-- Index already exists for scope-based filtering
CREATE INDEX idx_em_scope_imp ON episodic_memory(scope, importance)
```

And recall already supports scope filtering:

```typescript
// sqlite-recall.ts
${options?.scope ? "AND wm.scope = ?" : ""}
```

### Three scoping modes

| Mode | Behavior | Use case |
|---|---|---|
| `scope = "global"` (default) | ALL roles see ALL memories | Personal assistant that remembers everything |
| `scope = "role"` | Only see memories tagged with this role | "work" role doesn't see "personal" role memories |
| `scope = "session"` | Only see current session memories | Ephemeral, throw-away sessions |

### How scope is set on capture

```typescript
// When auto-capturing in a "coder" role session:
autoCapture(text, {
  scope: currentRole.memory.scope === "role" ? currentRole.name : "global"
});
```

**Default: `global`** — all roles share all memories. This is the "one brain"
mode. Switch to `role` scoping only if you want privacy between roles.

---

## Role switching

### Slash command

```
/role coder       ← switch to coder role
/role researcher  ← switch to researcher role
/role default     ← back to general assistant
/role             ← list available roles
```

### Web dashboard

```
┌─────────────────────────────────────────────┐
│  mya · [coder ▾] · session abc123           │
│  ┌───────────────────────────────────────┐  │
│  │  ● coder          TS + Rust specialist │  │
│  │  ○ researcher     web research agent   │  │
│  │  ○ reviewer       code review agent    │  │
│  │  ○ default        general assistant    │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Session-level vs conversation-level

**Option A: Role per session** (recommended)
- Each session has ONE role
- Switching role = new session
- Simple, predictable

**Option B: Role switching mid-conversation**
- Can switch role mid-chat
- More flexible but confusing (memory scope changes mid-conversation)

---

## What roles solve (from the 10 gaps)

| Gap | Full multi-agent fix | Roles fix |
|---|---|---|
| 1. Gateway doesn't route to agents | Pass agentName everywhere | Pass roleName (simpler) |
| 2. No web UI agent selector | Agent dropdown | Role dropdown |
| 3. Memory is global | Per-agent SQLite | ✅ **Already shared — scope filter optional** |
| 4. No agent config files | Per-agent TOML | Role TOML (lighter) |
| 5. Launcher doesn't show agent name | Show agentName | Show roleName |
| 6. No per-agent model | Per-agent settings | Role model override |
| 7. No per-agent system prompt | Per-agent prompt | Role prompt.append |
| 8. No per-agent MCP/tools | Per-agent tool registry | Role tool filter |
| 9. Subagent tool enforcement | Per-agent tools | Role tools (same mechanism) |
| 10. No runtime lifecycle | Create/delete agents | Create/delete roles (just files) |

**Roles solve 9/10 gaps with LESS code than full multi-agent.** Gap 3 (memory
isolation) is intentionally NOT solved — shared memory is the feature.

---

## Default roles (built-in)

```toml
# ~/.mya/roles/default.toml — generated on first run
[role]
name = "default"
description = "General-purpose assistant"
# No tool restrictions, no model override, no prompt append
# This is the "no hat" mode — plain mya
```

Optional built-in roles (user can enable by creating the file):

| Role | Tools | Model | Prompt focus |
|---|---|---|---|
| `coder` | read/bash/edit/write/grep/find | MiniMax-M3 high | TS7 + Rust, minimal core |
| `researcher` | read/bash/web/paid_fetch | Claude Opus | Research, cite sources |
| `reviewer` | read/grep/find (read-only) | MiniMax-M3 high | Code review, security |
| `writer` | read/edit/write | Claude Sonnet | Docs, markdown |
| `explorer` | read/grep/find/ls (read-only) | Haiku fast | Fast codebase scan |

---

## Implementation plan

### Phase 1: Role registry + config loading (core)

```
packages/roles/src/
├── index.ts          ← RoleRegistry, loadRoles()
├── role.ts           ← RoleConfig type, applyRole()
└── role.test.ts      ← tests
```

- Scan `~/.mya/roles/*.toml` at startup
- Parse into `RoleConfig[]`
- `default.toml` auto-generated if missing

### Phase 2: Wire roles into session creation

```typescript
// main.ts — createSession factory
createSession: async (sessionId, cwd, roleName?) => {
  const role = roleRegistry.get(roleName ?? "default");
  const session = await createAgentSession({ cwd, agentDir });
  
  // Apply role overlay
  if (role.tools) applyToolFilter(session, role.tools);
  if (role.model) session.setModel(role.model);
  if (role.prompt.append) injectRolePrompt(session, role);
  
  return session;
}
```

### Phase 3: Role in system prompt

```typescript
// mya-bridge.ts — before_agent_start
if (currentRole && currentRole.prompt.append) {
  parts.push(`\n[role: ${currentRole.name}]\n${currentRole.prompt.append}`);
}
```

### Phase 4: `/role` slash command + launcher column

```
/role coder    ← switch role
/role          ← list roles
```

Launcher "Agents" tab renamed to "Sessions" with a role column.

### Phase 5: Memory scope (optional)

```typescript
// auto-capture: tag memories with current role
autoCapture(text, {
  scope: role.memory.scope === "role" ? role.name : "global"
});

// recall: filter by role scope if configured
recall(query, { scope: role.memory.scope === "role" ? role.name : undefined });
```

---

## What this does NOT solve

| Need | Solution |
|---|---|
| True multi-user isolation | Need full multi-agent (per-user SQLite) |
| Different API keys per agent | Secrets scope (separate from roles) |
| Agents that can't see each other's memories | Use `scope = "role"` (but default is shared) |
| Completely separate agent personalities | This IS what roles provide |

---

## Summary

**User's insight is correct:** For a personal agent, **roles (shared brain +
different hats) is better than agents (isolated brains).**

- **pi-crew** uses roles (explorer/planner/executor share workspace)
- **Claude Code** uses agent types (Explore/Plan/share project context)
- **mya should use roles** (coder/researcher/reviewer share memory)

This solves 9/10 multi-agent gaps with **less code**, **more knowledge sharing**,
and **simpler UX**. The only thing it gives up is hard isolation — which a
personal agent doesn't need.
