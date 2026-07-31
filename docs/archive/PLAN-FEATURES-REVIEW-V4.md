# PLAN-FEATURES Deep Review v4 — Subsystem Infrastructure Verification

> 3 more parallel explorers verified sync, collab, MCP, workflows, pool, approval, build, test, TUI, desktop
> Date: 2026-07-21
> Focus: What subsystems are REAL vs PARTIAL vs DEAD? What blocks feature implementation?

---

## Executive summary

Round 4 dug into **subsystem infrastructure** — sync, collab, MCP, workflows, pool, approval, build, test, lint, TUI, desktop. Found **7 critical discoveries**:

| # | Discovery | Impact |
|---|---|---|
| **R4-1** | MCP has **NO OAuth** — only stdio transport | B2 must build from scratch |
| **R4-2** | Cross-device approval is **BROKEN** — web modal buttons do nothing | H8/permission features blocked |
| **R4-3** | Desktop is **CONTRACT-ONLY stub** — no Tauri/Electron exists | Any desktop feature = build shell first |
| **R4-4** | Sync is **generic KV store** — doesn't sync sessions/memory/config | Multi-device sync is aspirational |
| **R4-5** | Workflows have **CJS/ESM mismatch** — may be broken | `/workflow` command may fail |
| **R4-6** | Missing invariant enforcement: #11, #12, #16 | Spec compliance gaps in CI |
| **R4-7** | TUI is **custom renderer** (not Ink) — 2 themes only | Pet sprites/charms need custom Component subclasses |

---

## R4-1. MCP has NO OAuth — B2 must build from scratch

**Plan B2 says**: "MCP dashboard OAuth — PKCE flow, token store"

**Reality** (`packages/gateway/src/mcp-lifecycle.ts` + `mcp-client.ts`):
- 11-phase FSM EXISTS: Unconfigured→Discovered→Validated→Initializing→Healthy→Degraded→Failed→Restarting→Draining→Stopped→Quarantine
- Transport: **stdio JSON-RPC ONLY**. `McpServerConfig = { id, command, args?, env? }`
- **NO OAuth fields**: no client_id, no redirect_url, no token store, no HTTP/SSE transport
- Health probing, restart, drain: **declarative only** (FSM allows transitions but no code implements auto-restart/health-poll)
- `/mcp/servers/:id/test` route: exists but **no handler** (falls through)
- Gateway endpoints work for list/connect/discover, but discover only reads cached `tools[]` (doesn't re-call `tools/list`)

**Impact on B2**: Must implement:
1. OAuth flow (PKCE — primitives exist in `packages/ai/src/oauth.ts`)
2. HTTP/SSE MCP transport (currently only stdio)
3. Token store wired to `SecretRef{from:"keyring"}`
4. Gateway endpoints `/mcp/oauth/:server/start` + `/callback`
**Revised LOC**: ~90 → **~250** (OAuth + transport + endpoints + token store)

---

## R4-2. Cross-device approval is BROKEN

**Plan assumes**: Permission system works end-to-end (7-step pipeline → web approval)

**Reality**:
- Local approval (`packages/tools/src/approval.ts`): ✅ **WORKS** — `makeApprovalChannel(humanPrompt)`, `cliApprovalChannel()`, 24h timeout, fail-closed deny
- `ApprovalTokenLedger`: ✅ **WORKS** — short-lived scoped single-use tokens
- `requiresApproval()` 7-step pipeline: ✅ **WORKS**
- **Cross-device/web approval**: ❌ **COMPLETELY BROKEN**
  - Web approval modal (`approval-modal.ts`): buttons just `this.parentNode.style.display='none'` — **don't send decision anywhere**
  - Gateway `handleWs()` ignores `approval_decision` messages
  - `main.ts:onWsMessage` only consumes `msg.text` — ignores approval
  - No approval request IDs, no pending-request ledger, no WS/HTTP decision endpoint
  - Hook registry defines `approval_requested`/`approval_decided` names — **never invoked**

**Impact on plan**:
- **H8 (Auth widget)**: Can't do approval flows from web — must add approval relay first
- **C6 (Agent cron tools)**: Cron jobs using ask-rule approval from web → won't get approved (relay broken)
- **Any feature needing web-based approval**: BLOCKED until approval relay is built (~200 LOC)

---

## R4-3. Desktop is CONTRACT-ONLY stub

**Plan I1 mentions**: systemd/cgroup lifecycle (gateway-level)

**Reality** (`packages/desktop/src/index.ts`, ~165 LOC):
- Pure contract: `validateDeepLink(uri)`, `DesktopIpc` class, `verifyUpdate(decl)` (sigstore), `SidecarLifecycle`
- **NO Tauri, NO Electron, NO native shell** — zero rendering code
- The actual Tauri config is in `crates/desktop-shell/` + `crates/desktop-ui/` (Rust crates) — but **not compiled into a runnable app** for this use case
- CI builds `cargo build --workspace` but the desktop shell is skeletal

**Impact**: Any feature that mentions "desktop" needs the actual Tauri shell built first. Not blocking the feature plan (desktop isn't in scope), but worth noting.

---

## R4-4. Sync is generic KV store — doesn't sync anything real

**Reality** (`packages/sync/src/index.ts`):
- LWW + HLC (hybrid logical clock) — NOT CRDT
- `SyncServer` is server-authoritative push/pull over HTTP
- Endpoints: `/sync/state`, `/sync/pull?since=`, `/sync/push` — all functional
- Persistence: `~/.mya/sync/state.json` (0600, 30s heartbeat)
- **BUT**: nothing writes to it automatically
  - Doesn't sync session files
  - Doesn't sync config
  - Doesn't sync Brain/SQLite memory (memory has its OWN sync domain `domains/sync.ts` that attaches HLC to facts, but it's NOT bridged to `SyncServer`)
  - Generic `string→unknown` KV store waiting for explicit writes

**Impact**: Multi-device sync is **aspirational**. The engine works but nothing uses it. Plan features that assume "sync just works" need explicit wiring.

---

## R4-5. Workflows have CJS/ESM format mismatch

**Reality** (`packages/workflows/src/runner.ts`):
- VM path (`runWorkflowSource`): wraps in CommonJS (`var module={exports:{}}`) — requires `module.exports.default`
- Worker path (`worker.ts`): uses dynamic `import()` — expects ESM `export default`
- mya-bridge tool description: says `export default async (ctx) => ...`
- **CONTRADICTION**: VM path treats `export default` as syntax error; worker path treats `module.exports` as undefined
- Tests only check "events array is defined" — can pass on compile failure
- `/workflow <file>` command uses `runWorkflow()` (file-based) — may work if worker path is used, may fail if VM path is used

**Impact**: Workflows may be **silently broken**. Not in feature plan scope but worth noting — if any feature uses workflows, verify the path first.

---

## R4-6. Missing invariant enforcement

**Build agent verified CI invariants.** Confirmed enforced:
- ✅ #4 (AGPL deny) — `cargo deny check`
- ✅ #10 (single time helper) — `scripts/lint.mjs` grep
- ✅ #14 (no process::exit) — `clippy::exit` denied
- ✅ #19 (transports → core only) — `scripts/lint-deps.mjs`
- ✅ #20 (core size budget) — `scripts/lint-core-size.mjs` (1820 baseline + 50)

**MISSING enforcement** (spec-mandated but not in CI):
- ❌ **#5** (drift grader merge-block) — DriftGrader exists but CI only runs mock unit scenarios, NOT a real compressor-replay merge-block
- ❌ **#11** (no child_process in dashboard) — no grep guard
- ❌ **#12** (no `new Provider()` per call) — no grep guard
- ❌ **#16** (OWNERS files per crate) — no OWNERS files exist in `crates/`; no CI scan

**Impact**: Adding features that touch `packages/core/` will pass CI even if they violate invariants #11/#12. The drift grader gap means compression changes won't be merge-blocked. These are pre-existing gaps, not plan-blocking, but new features should respect them manually.

**Key tech fact**: **NO ESLint** — `@typescript-eslint` is incompatible with TS7 (native Go compiler). All linting is grep-based scripts. Adding new lint rules means writing new grep scripts, not ESLint config.

---

## R4-7. TUI architecture — custom renderer, not Ink

**Reality** (`packages/tui/`):
- **Custom Node.js differential renderer** (1715 LOC `TUI` class extends `Container extends Component`)
- NOT Ink, NOT React — custom component system: `Box`, `Editor`, `Markdown`, `Input`, `SelectList`, etc.
- Overlay stack with anchor/percentage positioning, Kitty + iTerm2 image protocol
- **Themes**: only **2 built-in** (`dark.json` + `light.json`) + custom JSON. Web has separate 5 CSS themes (unrelated)
- **Strikethrough**: ✅ Pi-flavored `~~text~~` (not `~text~`)
- **Pet sprites**: ❌ ZERO code (only `Image` component for generic images)
- **Charms**: ❌ ZERO code (no `content/charms.ts`, `content/faces.ts`, etc.)
- **Coding-agent**: vendored pi-mono fork branded "mya" (`piConfig: {name: "mya", configDir: ".mya"}`)

**Impact on plan**:
- **H12 (Pet sprites)**: Must create new `Component` subclasses in `packages/tui/src/components/` — not trivial, custom renderer API
- **H13 (Strikethrough)**: Already exists as `~~text~~`. The `^~~` variant needs adding to `StrictStrikethroughTokenizer`
- **H14 (Charms)**: Must create ambient content component + integrate with InteractiveMode (5904 LOC)
- **J1 (Pets/Petdex)**: TUI component + web page + data model

---

## Additional findings

### AgentPool — no real concurrency control

- `maxSessions: 1000` (effectively unlimited)
- `busy` flag set externally, not by pool
- `release()` deletes map entry but does NOT call `session.abort()`
- `sweepIdle()` exists but no production timer invokes it
- `MYA_MAX_SESSIONS` env documented but NOT read by code
- No semaphore/concurrency queue despite comment claiming "semaphore-bounded"

### Collab — room relay works but isn't bound to sessions

- Rooms: in-memory relay, owner/guest/guest-approval roles, 100-event ring buffer
- WS `?room=X` joins room, `collab-publish`/`collab-snapshot` messages work
- **BUT**: `Gateway.broadcast(sessionId, event)` sends by session, not room. Collab traffic is separate protocol.
- Owner not reassigned on disconnect (bug)
- `/collab/rooms` counts only currently-connected WS subscribers (not persisted rooms)
- No room→agent execution binding

### Memory clarification

Two systems confirmed:
1. **`MemoryManagerImpl`** (Brain + 13 domains + BrainStore JSONL + FileBackend markdown) — what `runTurn` uses for `refresh()`/goals/dream cycle
2. **`SqliteMemoryManager`** (SQLite FTS5 + embeddings) — "the store now" per shared-instances.ts; wired via mya-bridge tools (`/recall`, `/remember`); NOT the loop's memory API

Both exist in `shared-instances.ts`. SQLite is the persistence layer + tool surface. Brain is the in-process API. They're complementary, not conflicting.

---

## Consolidated status matrix (ALL systems verified)

| System | Status | Key Detail |
|---|---|---|
| Agent loop (`runTurn`) | ✅ Functional | 25-round, budget gate, stream retry |
| Permission (7-step) | ✅ Functional | `requiresApproval` + `awaitHumanPrompt` |
| Cross-device approval | ❌ **BROKEN** | Web modal disconnected, no relay |
| Budget tree accounting | ⚠️ API exists, not wired | `deriveChild` never called |
| Subagent spawning | ⚠️ Shared budget, no depth | "One level only" is comment only |
| AuxiliaryProvider | ⚠️ Type exists, unused | Ready for G1a |
| Cron scheduler | ✅ Fully functional | At-most-once, claim/complete/sweep |
| Memory (Brain system) | ✅ Functional | 13 domains, dream cycle, retrieval |
| Memory (SQLite) | ✅ Real, tool-surface | FTS5 + embeddings |
| Keyring/secrets | ✅ Functional | `@napi-rs/keyring`, SecretStore |
| Channels (outbound) | ✅ Functional | All 8 via fetch() |
| Channels (inbound webhook) | ✅ Functional | POST /channel/:id/webhook |
| Channels (inbound polling) | ❌ **DEAD CODE** | receive() never called |
| scanInject | ⚠️ One call site only | Prompt ctxFiles |
| DevicePairing | ❌ Never wired | Endpoints return 404 |
| WebAuthn | ❌ Never wired | Endpoints return 404 |
| VoiceCall (Twilio) | ❌ Never wired | Endpoints return 404 |
| Voice STT | ✅ Real | Whisper + Deepgram |
| MCP lifecycle | ⚠️ Partial | Stdio only, no OAuth, no auto-restart |
| Sync | ⚠️ Partial | Generic KV, nothing auto-synced |
| Collab | ⚠️ Partial | Relay works, no session binding |
| Workflows | ⚠️ Partial | CJS/ESM mismatch, may be broken |
| AgentPool | ⚠️ Partial | No real concurrency, no abort |
| Gateway HTTP | ✅ Functional | 50+ routes, hand-rolled |
| Gateway router | ⚠️ No framework | 50+ if blocks in one method |
| Config system | ❌ No central config | 17 scattered JSON files |
| Web SPA | ✅ Functional | 19 pages, 54 files |
| TUI | ✅ Functional | Custom renderer, 2 themes |
| Desktop | ❌ **CONTRACT STUB** | No native shell |
| Build (tsc -b) | ✅ Working | 25 composite projects |
| Bundle (esbuild) | ✅ Working | Source-resolved, single file |
| Test (vitest) | ✅ Working | 1824/1825 pass, pool=forks |
| Lint | ⚠️ Grep-based | Missing #11, #12, #16 enforcement |
| CI/CD | ✅ Working | Linux+macOS, no Windows |

---

## Updated LOC revisions (v3 → v4)

| Feature | v3 LOC | v4 LOC | Reason |
|---|---|---|---|
| B2 MCP OAuth | 90 | **250** | No OAuth exists, must build transport + flow |
| H8 Auth widget | 200 | **350** | Must also fix approval relay (~150 LOC) |
| E1 Channels | 470 | **490** | + polling loop wiring confirmation |

### New prerequisite task

| # | Action | LOC | Blocks |
|---|---|---|---|
| **P0** | Fix cross-device approval relay (WS + HTTP + pending ledger) | ~200 | H8, C6, any web approval |

---

## 4-round review complete — summary

| Round | Focus | Explorers | Critical findings |
|---|---|---|---|
| **v1** | Spec compliance | Manual | 15 issues: 3 critical (AGPL, runtime install, terminology) |
| **v2** | File paths + LOC | 3 parallel | 6 wrong paths, LOC re-baseline (D1 -720, E1 -470) |
| **v3** | Runtime code flow | 4 parallel | 6 critical: budget sharing, dead code, unwired modules |
| **v4** | Subsystem infrastructure | 3 parallel | 7 critical: MCP no OAuth, approval broken, desktop stub |

**Total: 10 parallel explorers + manual analysis across 4 rounds.**

### All P0 prerequisites (must do before feature work)

| # | Task | LOC | Source |
|---|---|---|---|
| 1 | Wire `scanInject` into channel-session.ts | ~15 | v3 |
| 2 | Wire `deriveChild`/`releasePrecharge` in spawnSubagent | ~40 | v3 |
| 3 | Wire `DevicePairing`/`WebAuthn` in main.ts | ~10 | v3 |
| 4 | Start channel polling loop in Gateway.start() | ~20 | v3 |
| 5 | Add config loading mechanism | ~50 | v3 |
| 6 | Fix cross-device approval relay | ~200 | v4 |
| **Total** | | **~335** | |
