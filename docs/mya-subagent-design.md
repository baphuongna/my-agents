# Spec v3 (FINAL): mya role-subagent — clean 2-layer + extensible view SPI

> **Confirmed model (user):** herdr/cmux/tmux are **VIEW-ONLY** (where the spawned mya TUI renders). They are **NOT** in the spawn/track/control logic. The view layer must be an **extensible SPI** so new view tools plug in without core changes. Don't touch the launcher.

## Architecture — two decoupled layers

```
┌──────────────────────────── LOGIC LAYER (mya, mux-agnostic) ────────────────────────────┐
│  Main mya session (TUI)                                                                  │
│   ├─ /agents UI: list spawned role-subagents, track status, open-view, control (kill)    │
│   ├─ spawn-role-subagent(role, task, model):                                             │
│   │     1. gateway /pool/acquire → sessionId                                             │
│   │     2. build argv: mya --gateway-session <id> --role <role> --task <task> --model M  │
│   │     3. view.open(argv)  ──────────────────────┐  (hand-off to view layer)            │
│   │     4. track via gateway /pool/tree (by sessionId)                                  │
│   └─ control: gateway /pool/kill/<id>                                                   │
│                                                                                          │
│   Gateway (existing): /pool/acquire · /pool/tree · /pool/kill · /pool/sessions           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                            │ view.open(argv)
                                            ▼
┌──────────────────────────── VIEW LAYER (SPI, extensible) ───────────────────────────────┐
│  resolveViewBackend() → first backend whose detect()=true (or fallback)                  │
│                                                                                          │
│  interface ViewBackend {                                                                 │
│    id: string                                                                            │
│    detect(): boolean              // am I running inside this env?                       │
│    open({command, title?, cwd?}): ViewHandle     // open a pane/window running command   │
│    focus?(handle): void          // optional: switch view to it ("open to view")         │
│    close?(handle): void          // optional                                              │
│  }                                                                                       │
│                                                                                          │
│  const VIEW_BACKENDS: ViewBackend[] = [                                                  │
│    tmuxBackend, herdrBackend, cmuxBackend?, standaloneTerminalBackend,  /* + future */   │
│  ]                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Principle:** the logic layer never imports a mux. It calls `view.open(argv)` against an interface. Adding wezterm/zellij/screen/i3-split/SSH-detach/… later = push one `ViewBackend` into `VIEW_BACKENDS`. Zero core change.

## Logic layer (gateway-based, launcher-style)

Reuse the **existing gateway `/pool`** surface (the launcher already drives it — we don't modify the launcher, just use the same mechanism from the main session):

| Concern | Mechanism | New? |
|---|---|---|
| Create a role-subagent | `/pool/acquire` `{cwd, role, task, model}` → sessionId | extend acquire to store role/task/model metadata |
| Launch the mya TUI for it | `view.open(["mya","--gateway-session",id,"--role",role,"--task",task,"--model",m])` | new (the hand-off) |
| Track progress | `/pool/tree` (sessions + status) — already returns the tree | reuse (maybe + role/task in payload) |
| List in main UI | `/agents` view reads `/pool/tree`, filters spawned-by-this-session | new UI |
| Control (kill) | `/pool/kill/<id>` (exists) | reuse |
| Open to view | `view.focus(handle)` (view layer) | new |

`mya --role` / `--task` startup flags: set the session's role at start + auto-run the task (so the spawned mya is a role-bearing worker that executes the task). These are the only CLI additions.

## View layer — the extensible SPI

**Interface** (`packages/core/src/view-backend.ts` or `packages/print/src/view/`):
```ts
export interface ViewHandle { readonly backendId: string; readonly ref: string; /* pane/window id */ }
export interface ViewOpenOpts { command: string[]; title?: string; cwd?: string; }
export interface ViewBackend {
  readonly id: string;
  detect(): boolean;
  open(opts: ViewOpenOpts): Promise<ViewHandle>;
  focus?(handle: ViewHandle): Promise<void>;
  close?(handle: ViewHandle): Promise<void>;
}
export const VIEW_BACKENDS: ViewBackend[] = [];
export function resolveViewBackend(): ViewBackend {
  return VIEW_BACKENDS.find((b) => b.detect()) ?? VIEW_BACKENDS[VIEW_BACKENDS.length - 1]!; // last = fallback
}
```

**Backends (ship Phase 1 with these; others plug in later):**

| Backend | detect() | open() |
|---|---|---|
| `tmuxBackend` | `!!process.env.TMUX` | `tmux new-window -n "<title>" "<cmd...>"` |
| `herdrBackend` | `!!(process.env.HERDR_ENV \|\| process.env.HERDR_SOCKET_PATH)` | herdr open a pane running cmd (herdr CLI one-shot — view only; NOT socket agent.start-as-logic) |
| `standaloneTerminalBackend` (fallback) | always (last in registry) | OS-specific new window: macOS `open -na Terminal`/`osascript`; Linux pick `kitty`/`gnome-terminal`/`xterm -e`; Windows `wt -w new` |

> **Future plug-ins (zero core change):** `cmuxBackend` (tmux-like mux for macOS — skipped Phase 1, plug in later), `zellijBackend` (`$ZELLIJ`), `screenBackend` (`$STY`), `weztermBackend` (`wezterm cli spawn`), `sshDetachBackend`, etc. Each = one file + one `VIEW_BACKENDS.push(...)`.

> **herdr boundary (confirmed):** the herdr backend uses the **herdr CLI** (one-shot open-pane command) **only to open a display pane** — the mya TUI renders there. Tracking/control stay in the gateway. herdr's socket `session.snapshot`/`pane.read`/`agent.start` are NOT used for logic — that was the earlier mistake. (Verify herdr has an open-pane CLI; if not, fall back to `standalone`.)

## End-to-end spawn flow
1. User/LLM in main session: `spawn-role-subagent(role="coder", task="refactor X", model="...")`.
2. Logic: `sessionId = gateway.acquire({cwd, role, task, model})`.
3. Logic: `handle = view.open({command:["mya","--gateway-session",sessionId,"--role","coder","--task","refactor X","--model",m], title:"coder"})`.
   - In tmux → a new tmux window opens running that mya (visible immediately).
   - In herdr → a new herdr pane opens running it.
   - Standalone → a new terminal window opens.
4. The spawned mya boots with the coder role + auto-runs the task; it attaches to the gateway session.
5. Main session `/agents` UI reads `/pool/tree` → renders a **TREE (main agent ▸ its role-subagents)**, each node showing {role, task, status}; "open" = `view.focus(handle)`; "kill" = `/pool/kill/<id>`. (Role-subagents are registered as children of the main session so `/pool/tree` nests them — reuse/extend the existing `poolSubagents(sessionId)` parent→child mechanism.)

## Phases
- **Phase 1 — SPI + 3 backends + spawn + UI:** `ViewBackend` interface + registry + resolver; `tmux/herdr/standalone` backends (cmux when clarified); `--role/--task` flags; `spawn-role-subagent` (gateway acquire + view.open + track); `/agents` UI (list/status/open/kill). **No launcher change.** (M)
- **Phase 2 — events + richer status:** gateway pushes status changes (working/blocked/done) to the `/agents` UI reactively; `view.focus` polished per backend. (M)
- **Phase 3 — more backends + niceties:** zellij/screen/wezterm/ssh backends; structured results; sibling coordination. (M, incremental — each backend is independent)

## Tests (NO TEST = NO MERGE)
- `ViewBackend` unit: each backend's `detect()` with env set/unset (template: `tui/terminal-image.test.ts`); `open()` builds the right command (mock `child_process`); resolver picks first-detect / fallback.
- Registry: adding a backend is picked up by resolver (proves extensibility).
- Logic: spawn calls acquire → view.open → tracks via tree (mock gateway + view).
- `--role/--task` flag wiring.
- (Real pane/window creation = `[real]`-tier, gated on the env.)

## Resolved (user)
1. **cmux** = tmux-like mux for macOS → **skipped Phase 1** (future backend). Phase 1 backends = **tmux + herdr(CLI) + standalone** only.
2. `/agents` UI = **tree view** (main agent ▸ subagents), via `/pool/tree`.
3. herdr `open()` = **herdr CLI** (one-shot open-pane), NOT the socket API.

## Implementation hooks (verified)
- Gateway: `poolAcquire` (`/pool/acquire`, gateway/index.ts:1364), `poolSubagents(sessionId)` + `poolStatus` (`/pool/tree`:1692-1700) — parent→child tree mechanism to reuse for role-subagents.
- mya-bridge commands: `pi.registerCommand(name, {…})` + `commandRegistry.register({name,description,handler})` (mya-bridge.ts:155-161,277) — pattern for the `/agents` command.
- main.ts flags: `FLAGS_WITH_VALUE` set (main.ts:253) includes `--gateway-session` — add `--role`/`--task` here.

---

## E2E Verification Status (2026-07-30, real zai/glm LLM)

Verified end-to-end with a real LLM provider (not mock-echo) by spawning the
built binary (`dist/mya.js`) + exercising the full gateway pool lifecycle:

### ✅ Working
- **spawn → done**: `mya --gateway-session <id> --role coder --task "…" --provider zai --model glm-4.5-air` reaches `status=done` (~1.5-3s real LLM call).
- **"working" transient**: `turn_start` fires + POSTs `working` to the gateway (confirmed via instrumentation — it IS reported, just transient on fast turns).
- **/pool/tree nesting**: parent▸child with `depth=1` in the `subagents[]` array (one level; grandchildren appear as top-level nodes with `parentSessionId` — full graph reconstructable, not recursively nested).
- **waitRoleSubagent**: polls `/pool/tree` → resolves terminal status (~3s).
- **kill**: removes session from `/pool/tree` (both running + after-done).
- **concurrent**: 3 subagents, independent status + nesting.
- **/agents panel**: glyph rendering (✓/✗/●) from real `/pool/tree` data.
- **herdr view backend**: opens/verifies/cleans a real herdr pane.
- **CLI flags**: `--gateway-session`, `--role`, `--task` registered in args.ts (no longer "Unknown option").
- **bridge loads**: the mya-bridge extension factory invokes in spawned subagents (fixed: `--provider` was leaking into `positional[]` → print-mode dispatch → bridge bypass).

### ⚠️ Known limitations

**Structured results (summary/keyOutputs) not populated.** `parseDoneResult`
reads `lastAssistantTextCapture`, which stays empty because **`message_end` +
`turn_end` events never fire** for the subagent's turn — only `agent_start` +
`turn_start` reach the extension system. Root cause (traced via instrumentation,
not speculation): the entire event flow is pi code (`pi-agent-src` Agent →
`agent-loop.ts` runLoop → `processEvents` forwards ALL events, no filter), but
`runLoop` does not emit the completion events for this turn. This is an
architectural mismatch in the agent event lifecycle, likely requiring a pi
upstream fix (vendored code — would be overwritten on pi-sync). **Impact**:
the `/agents` panel shows status (done/failed) but no summary/keyOutputs.
Core spawn/track/wait/kill is unaffected.

**`stale-ctx` error** (non-fatal): `"This extension ctx is stale after session
replacement or reload"` appears once per subagent lifecycle. Does not affect
core functionality. Not caused by `--no-session` specifically (appears regardless).

**`messages` count**: `/pool/tree` shows `messages=0` for subagents (the gateway
pool is a registry, not a message store — subagent messages live in their own
session file). Cosmetic.

### Critical bugs found + fixed via E2E (6 static cold-review rounds missed all)
| Commit | Bug | Severity |
|---|---|---|
| `3fbbdb13a` | `--gateway-session` Unknown option → every subagent crashed on startup | CRITICAL |
| `3fbbdb13a` | `--help` missing `--role`/`--task`/`agents` → E2E tests silently skipped (false-green) | HIGH |
| `4dc39940e` | `--provider` (+14 flags) missing from `FLAGS_WITH_VALUE` → positional leak → print mode → bridge bypass → no status reporting | CRITICAL |
| `4dc39940e` | gateway `createAgentSession` silently dropped `extensionFactories` | HIGH |
| `113806fdc` | `main-flags.test.ts` tested a COPY of `FLAGS_WITH_VALUE` (copy-drift / false-green) | MEDIUM |
| `d5bc5eb81` | `/login` freeze — `modelRuntime.login` refresh had no timeout (hung on slow provider) | HIGH |

**Lesson**: static review + unit tests verified CODE; E2E (spawning the real
binary) verified RUNTIME behavior. The 4 most critical bugs were invisible to
unit tests (mocked) + code review (flags LOOKED wired). Both dimensions are
necessary.
