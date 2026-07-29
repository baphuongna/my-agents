# Spec: Terminal-Multiplexer-Aware Role-Subagent Orchestration

> **Status:** DRAFT spec — awaiting confirmation before implementation.
> **Vision owner:** user. **Author:** session analysis.

## 1. Vision

The parent **mya TUI** (pi InteractiveMode, the default `mya`) can **spawn + manage other mya TUI instances** — each carrying a **role** — **as subagents**, automatically placing each into the most appropriate terminal surface (a multiplexer pane, a tiling-WM window, or a new terminal window) based on auto-detection of the current environment.

Effect: mya becomes a **multi-agent terminal workspace** — e.g. parent spawns a "coder" role-subagent + a "reviewer" role-subagent, each visible in its own pane, orchestrated by the parent.

This **unifies** mya's two multi-agent mechanisms:
- **ROLES** (persona/tool/model/memory overlay — currently an in-session `/role` command).
- **Subagent delegation** (currently `delegate_task` → isolated headless AgentSession, Path B).

A role-subagent = **an interactive mya TUI instance with a role, spawned into a pane, managed by the parent.**

## 2. Current state → gaps

| Need | Current | Gap |
|---|---|---|
| Terminal/multiplexer detection | Partial: `tui/terminal-image.ts` detects tmux/TERM_PROGRAM for image hyperlinks only | No general detector for spawn-targeting |
| `--role` startup flag | ❌ Role only via in-session `/role` (`mya-bridge.ts:277`); `currentRole` defaults to default at start | Need `mya --role <name>` so a spawned pane starts with the role |
| Spawn-process helper | ✅ `child_process.spawn` used widely (launcher, bg-runner, gateway-supervisor) | Reusable |
| Parent↔subagent IPC | ✅ `packages/rpc` (stdio + TCP server) | Can be the management channel |
| Subagent track/kill | ✅ `trackSubagent/listSubagents/killAllSubagents` (Path B) | Reuse pattern; extend to pane-tracked |
| Spawn into a pane/window | ❌ None | **Core new capability** |

## 3. "cmux" / "herdr" clarification (from research)

- **cmux** = a **Chrome DevTools Protocol (CDP) multiplexer** used by the browser tool in THIS repo (`docs/cross-system-web-lookup.md:52`). It manages Chrome tabs via CDP — **NOT a terminal multiplexer**. No terminal detection env vars, no pane-creation CLI. → **Do not include in terminal pane-spawning.** (If the user meant a real terminal mux here, it was likely **zellij** — confirm.)
- **herdr / herder** = **no known terminal tool** by that name. The most likely intended tool is **herbstluftwm (hlwm)** — a manual tiling window manager (name starts "herb-"). Detection: `$XDG_CURRENT_DESKTOP` / `herbstclient` availability; spawn: `herbstclient spawn "kitty mya --role X"`. → **Include herbstluftwm** in the tiling-WM detection. Confirm with user.

## 4. Detection matrix (extensible registry)

**Detection priority** (multiplexer > Wayland compositor > X11 WM > terminal emulator > Windows > fallback), because inside tmux/zellij `$TERM_PROGRAM` still reflects the outer terminal — we want the inner pane, not an outer window.

| Priority | Tool | Detection (env) | Spawn new pane/window running `CMD` |
|---|---|---|---|
| 1 | **tmux** | `$TMUX` | `tmux new-window -n "<role>" "<CMD>"` (or `split-window -h`) |
| 1 | **zellij** | `$ZELLIJ` (or `$ZELLIJ_SESSION_NAME`) | `zellij action new-pane -- "<CMD>"` (zellij ≥0.39; older: new-pane + send-keys) |
| 1 | **GNU screen** | `$STY` | `screen -t "<role>" <CMD>` (within session) |
| 1 | **byobu** | `$BYOBU_TERM` then `$TMUX`/`$STY` for backend | delegate to detected backend (tmux/screen) |
| 2 | **Hyprland** | `$HYPRLAND_INSTANCE_SIGNATURE` | `hyprctl dispatch exec "<CMD>"` |
| 2 | **sway** | `$SWAYSOCK` | `swaymsg exec "<CMD>"` |
| 2 | **i3** | `$I3SOCK` | `i3-msg exec "<CMD>"` |
| 3 | **herbstluftwm** (the likely "herdr") | `$XDG_CURRENT_DESKTOP=herbstluftwm` / `herbstclient` avail | `herbstclient spawn "<CMD>"` |
| 3 | **bspwm** | `$BSPWM_SOCKET` / `bspc` avail | spawn terminal (`st -e <CMD>`); bspwm tiles |
| 4 | **WezTerm** | `$TERM_PROGRAM=WezTerm` | `wezterm cli spawn --new-window -- <CMD>` |
| 4 | **Kitty** | `$TERM_PROGRAM=kitty` | `kitty @ launch --type=window <CMD>` (remote control) or `kitty <CMD>` |
| 4 | **iTerm2** | `$TERM_PROGRAM=iTerm.app` | `osascript` (create window/tab/split with command) |
| 4 | **Apple Terminal** | `$TERM_PROGRAM=Apple_Terminal` | `osascript -e 'tell app "Terminal" to do script "<CMD>"'` |
| 4 | **Alacritty/Ghostty/xterm** | `$TERM_PROGRAM` / `$TERM` | `<emulator> -e <CMD>` (new independent window) |
| 5 | **Windows Terminal** | `$WT_SESSION` | `wt.exe -w new <CMD>` (or `split-pane`) |
| 6 | **Fallback (none)** | — | headless in-process (reuse delegate_task Path B with role applied) |

For WM/compositor spawns, `CMD` = `<terminal-emulator> mya --role <role> …` (pick a terminal: prefer kitty/alacritty/wezterm/xterm by availability).

## 5. Design

### 5.1 New `--role` startup flag
- `mya --role <name>` → at session start, set `currentRole = roleRegistry.get(name)` (instead of default). Applies the role's `promptAppend` + `filterToolsForRole` + `modelPrefer` from the first turn.
- Optional managed-subagent flags: `--parent <sessionId>` + `--goal <task>` → the spawned mya knows it's a managed role-subagent (enables RPC reporting + auto-runs the goal).

### 5.2 Detector (`packages/core/src/term-env.ts` or `print`)
- `detectTerminalEnv(): TerminalEnv` → returns `{ kind, target }` per the matrix.
- Extensible: a `DETECTORS: Detector[]` registry array; each `{ name, detect(): bool, spawn(cmd): SpawnResult }`. Adding a new surface = push a detector. (Lets cmux/herdr/easily extend later.)

### 5.3 Spawn orchestration (`packages/print/src/role-subagent.ts`)
- `spawnRoleSubagent(role: string, goal: string): RoleSubagentHandle`:
  1. Resolve role from `roleRegistry`.
  2. Build CMD = `mya --role <role> --parent <parentId> --goal <goal>`.
  3. `env = detectTerminalEnv()`.
  4. Dispatch to `env.spawn(CMD)`:
     - multiplexer/compositor/WM/emulator → spawn in pane/window; capture pane-id/PID.
     - fallback → headless in-process (delegate_task Path B with role applied).
  5. Track handle `{ id, role, goal, paneOrPid, status, env }` + register with a `RoleSubagentRegistry` (reuse `trackSubagent` pattern).
  6. Return handle.

### 5.4 Management + IPC
- **Track**: registry of spawned role-subagents (id, role, goal, pane/PID, env, status, startedAt).
- **Status**: multiplexer (e.g. `tmux list-panes`) / PID-alive check; or via **RPC** (each role-subagent mya exposes its status on the TCP server; parent polls/subscribes).
- **Output**: role-subagent writes result → parent reads via RPC, or capture via a shared log.
- **Abort**: `tmux kill-pane` / kill PID / RPC abort.
- **TUI surface**:
  - `/spawn-role <role> <goal>` command (or a tool the LLM can call).
  - `/roles-subagents` (or extend `/subagents`) → list view: id, role, goal, pane, status; actions: view-output, abort, (switch-focus-to-pane).

### 5.5 Fallback (no multiplexer)
- Reuse `delegate_task` (Path B) but apply the role: `spawnSubagent` gets a `role` param → inject role's `promptAppend` into the spawned session's systemPrompt + `filterToolsForRole` + `modelPrefer`. Headless, in-process, but role-aware. This also retroactively makes the EXISTING subagent mechanism role-aware (closing the roles/subagent gap even in headless mode).

## 6. Phases

- **Phase 1 — Spawn + track (no IPC):** `--role` flag + detector + spawn into detected surface + registry/track/kill + `/spawn-role` + list view + **fallback (role-aware delegate_task)**. Deliverable: "parent spawns role-bearing mya TUI into a pane (tmux/zellij/WM/terminal) or headless, tracks + kills it." (M effort)
- **Phase 2 — RPC management:** parent ↔ role-subagent IPC (real-time status, output stream, abort, inject follow-up) over `packages/rpc`. Deliverable: parent fully controls role-subagents from inside the TUI. (M)
- **Phase 3 — Rich interaction:** switch-focus to pane (`tmux select-pane`/equivalent), inject prompt, output streaming panel in the TUI. (M)

## 7. Effort, risk, tests

- **Effort:** Phase 1 ≈ M (detector matrix + spawn per env + flag + registry + TUI command + fallback wiring). The detector matrix is the bulk (many envs).
- **Risks:**
  - Env-detection edge cases (nested multiplexers, `$TERM_PROGRAM` leakage inside tmux, Wayland vs X11). Mitigation: priority order + per-env tests + fallback.
  - Spawn-command quoting (CMD with args/spaces). Mitigation: pass as argv array where possible (spawn), shell-quote for tmux/osascript.
  - Cross-platform (macOS osascript vs Linux wmctrl vs Windows wt). Mitigation: per-OS detector branches.
  - zellij <0.39 `new-pane -- CMD` unsupported. Mitigation: version probe / send-keys fallback.
- **Tests (NO TEST = NO MERGE):**
  - detector unit (set/restore env vars; assert kind per env combo) — template: `tui/terminal-image.test.ts`.
  - spawn-command builder unit (per env, assert the argv/string; mock `child_process`).
  - registry/track/kill unit.
  - `--role` flag wiring (role applied at start).
  - fallback (role-aware delegate_task) integration.
  - (Real pane-creation tests are `[real]`-tier, gated on the env being present.)

## 8. Open questions for user

1. Confirm **"cmux"** was a slip (CDP mux, not terminal) — did you mean **zellij** or another real terminal mux?
2. Confirm **"herdr"** = **herbstluftwm (hlwm)**?
3. Role-subagent when no multiplexer: **headless fallback** (role-aware delegate_task) OK, or should it REFUSE to spawn (require a multiplexer)?
4. Scope: implement **Phase 1** now, or design more first?
