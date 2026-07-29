# Spec: mya ↔ Herdr Integration (role-subagent orchestration)

> **Status:** DRAFT v2 — CORRECTED. v1 (tmux/zellij matrix) was wrong; herdr IS the multiplexer.
> **Herdr** = `~/source/my-herdr/source-refs/herdr/` (Rust, pkg 0.7.4, protocol v17, herdr.dev) — **"agent multiplexer that lives in your terminal."**
> **Orchestrator** = `~/source/my-herdr/orchestrator/` — a herdr **client** (DAG orchestration + web UI; read-side complete, write-side stubbed).

## 1. What herdr is (the mechanism)

A **terminal multiplexer + agent runtime** (Rust). Hierarchy: **Session → Workspace → Tab → Pane → Agent**. Agent status: `idle | working | blocked | done | unknown`. Exposes:
- **Unix-socket JSON-RPC** (JSON-line over stream) — programmatic control. **"agents can use herdr too — spawn panes, read output, wait on each other."**
- TUI (every agent at a glance) + CLI.

**Socket API methods** (from `orchestrator/docs/HERDR.md` + `herdr-api.schema.json`):

| Method | Params | Returns | Use |
|---|---|---|---|
| `session.snapshot` | — | workspaces/panes/agents + status | full state |
| `session.ping` | — | ok | readiness |
| `workspace.create` | cwd, label | workspace_id | new workspace |
| **`agent.start`** | workspace_id, cwd, name, **argv** | `{agent:{pane_id,name}}` | **launch agent in a pane** |
| `agent.send` | pane_id, text | — | type (no submit) |
| **`pane.send_text`** | pane_id, text (+`\r`) | — | **type + submit (sends a prompt)** |
| **`pane.read`** | pane_id, source(visible/recent/recent_unwrapped) | text | **read output** |
| `events.subscribe` | kinds | pane.closed/exited, workspace/tab.closed | lifecycle (dedicated socket) |

> **Key lesson (from orchestrator debugging):** to actually submit a prompt to an agent, use `pane.send_text` with `\r` — NOT `agent.send` (text lands in prompt input but never triggers).

Socket path: auto-detected via `HERDR_SESSION` env (default `default`) → `/run/user/UID/herdr/default.sock` (or `/tmp/herdr-*.sock`).

## 2. Vision (corrected)

The **parent mya TUI** becomes a **herdr client**: it spawns role-bearing mya instances as **herdr panes/agents**, sends them tasks, reads their output, and waits on them — via herdr's socket API. herdr provides the pane management, the "every agent at a glance" view, detach/reattach, and SSH survival. This unifies mya's **ROLES** (persona) + **subagent delegation** into "role-bearing herdr-managed agents."

```
┌──────────────┐   Unix socket JSON-RPC    ┌──────────┐
│  mya TUI     │ ─── agent.start ─────────►│  herdr   │──► pane: mya --role coder
│  (parent)    │ ◄── pane.read/snapshot ──│  daemon  │──► pane: mya --role reviewer
│  + herdr     │ ─── pane.send_text ──────►│          │──► pane: mya --role researcher
│    tool      │ ◄── events.subscribe ────│          │
└──────────────┘                            └──────────┘
```

## 3. Design

### 3.1 New `--role` startup flag
`mya --role <name>` → set `currentRole = roleRegistry.get(name)` at session start (applies `promptAppend` + `filterToolsForRole` + `modelPrefer` from turn 1). Used as the `argv` for `agent.start`.

### 3.2 New `packages/herdr/` — TS herdr client (mirror of orchestrator's `HerdrAdapter`)
- `HerdrClient` (Unix socket JSON-RPC, JSON-line): `sessionSnapshot()`, `workspaceCreate()`, `agentStart({workspace,cwd,name,argv})`, `paneSendText(paneId, text)`, `paneRead(paneId, source)`, `eventsSubscribe(kinds)`.
- Socket-path resolution: `HERDR_SESSION` env → `/run/user/$UID/herdr/<session>.sock` (fallback `/tmp/herdr-*.sock`); configurable.
- Reference: `orchestrator/crates/orchestrator-core/src/adapter/mod.rs` (the Rust client to port to TS).

### 3.3 mya herdr tool/skill (`packages/print/src/herdr-skill.ts` or a ToolImpl)
A tool + `/herdr` commands the parent agent/user invokes:
- **`spawn-role <role> <goal>`** → `workspaceCreate` (or reuse) + `agentStart({argv:["mya","--role",role], name:role})` → capture `pane_id` → `paneSendText(pane_id, goal+"\r")`. Track `{pane_id, role, goal, status}`.
- **`read <pane_id>`** → `paneRead(pane_id, "recent_unwrapped")`.
- **`status` / `list`** → `sessionSnapshot` → show agents + status (idle/working/blocked/done).
- **`wait <pane_id>`** → poll `paneRead`/status or `eventsSubscribe(pane.exited)`.
- **`stop <pane_id>`** → close pane (herdr CLI/`pane.kill` if available, else `agent.stop`).

### 3.4 TUI surface
- `/spawn-role <role> <goal>` command.
- `/herdr` view: list managed role-subagents (pane_id, role, status) leveraging `session.snapshot`; actions: read, wait, stop, switch-focus (herdr TUI already does "every agent at a glance" — mya can defer viewing to herdr's own TUI, or render a summary).

### 3.5 Orchestrator interplay (optional, Phase 3)
The orchestrator already orchestrates multiple herdr agents via DAG plan YAML (read-side done). mya can be: (a) a **standalone herdr client** (this spec — parent TUI drives role-subagents directly), or (b) an **orchestrated agent** (the orchestrator's `agent.start` launches mya panes per a DAG). The user's vision = (a) primarily; (b) is a future compose layer.

### 3.6 Fallback when herdr isn't running
- If `HERDR_SESSION` unset / socket absent → fall back to the **existing in-process delegate_task** (Path B), optionally role-aware (inject role's promptAppend + tool filter). OR refuse (require herdr). → user choice.

## 4. Phases

- **Phase 1 — herdr client + spawn/read:** `packages/herdr/` TS client (mirror HerdrAdapter: agent.start, pane.send_text, pane.read, session.snapshot) + `--role` flag + `spawn-role/read/status` tool + `/herdr` list. Deliverable: "parent mya spawns role-bearing mya panes in herdr, sends a goal, reads output, sees status." (M)
- **Phase 2 — events + wait + lifecycle:** `events.subscribe` (pane.exited/closed), real-time status updates in the TUI, `wait`/`stop`. (M)
- **Phase 3 — orchestrator compose + rich UX:** DAG compose with the orchestrator; switch-focus to herdr panes; inject follow-up prompts; role-subagent brain/memory sharing (per role.memoryScope). (L)

## 5. Effort, risk, tests
- **Effort:** Phase 1 ≈ M (TS client port from the Rust adapter reference + flag + tool + TUI command). The Rust `HerdrAdapter` is a ready reference — port method-by-method.
- **Risks:** socket-path detection across OSes; JSON-RPC framing (JSON-line + `\n`); `pane.send_text` `\r` submit quirk; herdr protocol version drift (v17 now — pin/probe). Mitigations: mirror the orchestrator's proven detection + framing; version probe on connect.
- **Tests (NO TEST = NO MERGE):** client unit (mock Unix socket, assert JSON-RPC request/response framing per method — mirror `orchestrator/crates/integration/FakeHerdrServer`); socket-path resolution unit (env combos); tool wiring; `--role` flag. Real herdr integration = `[real]`-tier (gated on a herdr session running).

## 6. Open questions
1. Fallback when herdr absent: **role-aware delegate_task (headless)** OR **refuse** (require herdr)?
2. Phase 1 now, or review this corrected spec first?
3. Should mya's herdr client live in a new `packages/herdr/` (clean, reusable) or inside `packages/print` (closer to TUI)?
4. Brain/memory: do role-subagents share the parent's `memory.db` (per role.memoryScope=global), or run isolated (current delegate_task)?
