# PLAN-FEATURES Deep Review v3 — Runtime Flow Verification

> 7 parallel explorers across 2 rounds verified actual code flow, not just file paths
> Date: 2026-07-21
> Focus: Can features ACTUALLY be implemented as described? What's wired vs dead code?

---

## Executive summary

Round 3 dug into **runtime code flow** — how the agent loop, subagent system, permission pipeline, memory, and gateway ACTUALLY work. Found **6 critical runtime discoveries** that change plan assumptions:

| # | Discovery | Impact |
|---|---|---|
| **R3-1** | Subagents **share parent budget** — `deriveChild()` never called | Breaks A1/A2 budget isolation assumption |
| **R3-2** | `maxToolRounds` **not forwarded** from AgentConfig | A1 must wire the pass-through, not just add a field |
| **R3-3** | `DevicePairing`/`WebAuthn`/`VoiceCall` **never wired** in main.ts | H10 "backend done" is FALSE — endpoints return 404 |
| **R3-4** | Channel **inbound polling is dead code** | E1 "8 channels functional" is half-true |
| **R3-5** | **No config.toml** — config scattered across 17 JSON files | D1 `memory.backend = "mem0"` has no config path |
| **R3-6** | `AuxiliaryProvider` type **exists but unused** | G1a has a type to implement — GOOD news |

---

## R3-1. Subagents share parent budget — `deriveChild()` NEVER called

**The most critical finding.** The spec (§21) describes tree-accounted budget: `SubagentRunner` calls `parent.budget.deriveChild(child.total)` at spawn, refunds on completion.

**Actual code** (`packages/agent/src/index.ts:314, 482-493`):
```ts
const budget = config.budget ?? freeBudget();  // ONE budget for entire Agent
// ...
await runTurn({
  session: subSession,
  budget,          // ← SAME budget object, not a derived child!
  // ...
});
```

There is **zero** call to `budget.deriveChild()` or `budget.releasePrecharge()` in `packages/agent/src/index.ts`. Parent and ALL subagents spend against the SAME `BudgetConfig` root.

**Impact on plan**:
- **A1 (IterationBudget)**: Can't just "add iteration dimension to BudgetConfig" — the budget tree isn't even used for subagents. Must FIRST wire `deriveChild`/`releasePrecharge` around subagent lifecycle.
- **A2 (spawn depth)**: No budget isolation means depth + budget must be implemented together.
- **Spec compliance**: This is a **pre-existing spec deviation** (§21 CC2 says child budget derivation is REQUIRED). The plan should include a **prerequisite task**: "Wire deriveChild/releasePrecharge in spawnSubagent".

---

## R3-2. `maxToolRounds` not forwarded from AgentConfig

**Actual code**: `AgentConfig` (agent/src/index.ts:65-103) has **no `maxToolRounds` field**. `startTurn` (line 344-368) calls `runTurn({...})` WITHOUT passing `maxToolRounds`. So the loop ALWAYS uses default `25`.

```ts
// loop.ts:163
const maxRounds = opts.maxToolRounds ?? 25;
```

**Impact on plan**:
- **A1**: Adding iteration budget isn't just "extend BudgetConfig" — must also wire `maxToolRounds` through `AgentConfig` → `startTurn` → `runTurn`. The pass-through doesn't exist.
- **Simpler alternative**: Instead of touching BudgetConfig (core), just add `maxToolRounds?: number` to `AgentConfig` and forward it. ~30 LOC, no core change.

---

## R3-3. DevicePairing/WebAuthn/VoiceCall NEVER WIRED

**Gateway** defines optional callbacks (`devicePairing?`, `webAuthn?`, `voiceCall?`) and endpoints (`/pair/*`, `/auth/webauthn/*`, voice-call WS).

**But `packages/print/src/main.ts` NEVER instantiates them:**
```
grep "devicePairing|DevicePairing|webAuthn|voiceCall" packages/print/src/main.ts → ZERO matches
```

In production, ALL `/pair/*`, `/auth/webauthn/*` endpoints return 404 (handler checks `if (!this.devicePairing) return send(404, ...)`).

**Impact on plan**:
- **H10 (Pairing UI)**: Review v2 said "backend done, UI only". **FALSE** — backend exists but is NOT wired. Must add `new DevicePairing()` + pass to Gateway constructor.
- Same for WebAuthn (H8 auth widget may use it).
- Same for VoiceCall (G1a PTT may build on voice-call infrastructure).

**Fix**: Add to main.ts:
```ts
devicePairing: new DevicePairing(),
webAuthn: new WebAuthnVerifier(),
// voiceCall already has voice-stt.ts, needs wiring
```

---

## R3-4. Channel inbound polling is dead code

All 8 channel adapters implement `receive()` (Telegram long-poll, Discord REST-poll, Slack conversations.history, etc.). **But NO production code calls `receive()`**:
```
grep "ch.receive|channels.receive|\.receive()" packages/gateway/src/ → only test files
```

**What works**:
- ✅ Outbound: `cron` results → `ch.send()`, `/channels/:id/test`, TUI `/channel send`
- ✅ Inbound via **webhook**: `POST /channel/:id/webhook` → `channelRouter.route()`
- ❌ Inbound via **polling**: `receive()` implemented but NEVER called on interval

**Impact on plan**:
- **E1**: "8 channels functional" is half-true. Telegram/Discord/Slack polling is dead. Need a polling loop in `Gateway.start()`:
  ```ts
  setInterval(() => {
    for (const ch of this.channels.list()) {
      if (ch.receive) ch.receive().then(msgs => msgs.forEach(m => this.channelRouter.route(m)));
    }
  }, 5000);
  ```
  ~20 LOC but must handle errors, rate limits, backoff.

---

## R3-5. No config.toml — config scattered across 17 JSON files

**Plan D1 says**: `config: memory.backend = "mem0"` in config.toml.

**Reality**: There is **NO `~/.mya/config.toml`** and no general config loader. Config is scattered:

| File | Purpose |
|---|---|
| `agent/auth.json` | API keys → env |
| `keyrouter.json` | Key rotation |
| `roles/*.json` | Role overlays |
| `agent/cron.json` | Cron jobs |
| `agent/mcp.json` | MCP servers |
| `agent/channels.json` | Channel creds |
| `agent/gw.token` | WS auth token |
| `push-subscriptions.json` | PWA push |
| `webauthn/credentials.json` | WebAuthn |
| `memory/memory.db` | SQLite |
| `memory/brain.jsonl` | Brain persistence |
| `models-tiers.json` | Model routing |
| + 5 more | |

**Impact on plan**:
- **D1**: No config path for `memory.backend`. Must either:
  - (a) Add a `~/.mya/config.json` + loader (new core concern)
  - (b) Extend an existing file (e.g., `agent/mcp.json` pattern)
  - (c) Use env var `MYA_MEMORY_BACKEND=mem0` (simplest)
- **H1 (profiles)**: No profile config path either — same problem.

---

## R3-6. AuxiliaryProvider type EXISTS but unused — GOOD news for G1a

**`packages/core/src/types.ts:207-210`:**
```ts
export interface AuxiliaryProvider {
  resolve(): ProviderProfile;
  health(): ComponentHealth;
}
```

Referenced in comments (council, prompts/compressors) but **never instantiated as a runtime lane**.

**Impact on plan**:
- **G1a (Voice PTT)**: The type exists. Plan can implement `AuxiliaryProvider` for voice turns — separate allocation, never touches main prompt cache (inv #8). This is architecturally correct and the type is ready.
- **A1/A2**: Could use AuxiliaryProvider pattern for subagent side-tasks that shouldn't touch parent cache.

---

## Additional findings (medium impact)

### Gateway has NO router framework

50+ routes are hand-rolled `if (url.pathname === "/...")` blocks in one 1900-line `handleHttp()` method. Adding endpoints is tedious but mechanical. No refactor needed for the plan, but each new endpoint (H1 profiles, H4 PTY, H7 skills CRUD, H9 webhooks) adds to the monolith.

### api.ts only wraps ~15 of ~50 endpoints

Web client (`packages/web/src/lib/api.ts`) has typed wrappers for ~15 endpoints. Many gateway endpoints (`/memory/stats`, `/skills`, `/roles`, `/push/*`, `/pool/*`, all channel/MCP/pairing routes) are NOT wrapped. Each new web feature needs its own API wrapper.

### scanInject only wired in ONE place

Only call site: `packages/prompts/src/assembler.ts:146` for `ctxFiles`. NOT wired into:
- ❌ Channel messages (channel-session.ts:152 pushes raw text)
- ❌ Tool results
- ❌ Voice transcripts
- ❌ Web fetch responses

This is the R27-15 spec violation from v2 — confirmed deeper: it's not just channels, it's ALL external input except prompt context files.

### Memory: Brain vs SQLite are separate systems

- **Brain** (`MemoryManagerImpl` + 13 domains): what the agent loop uses during `runTurn`. In-memory + BrainStore (JSONL) + FileBackend (markdown). This is the ACTIVE memory.
- **SQLite** (`SqliteMemoryManager`): standalone, accessed only via `/memory_recall`, `/memory_record` slash commands (tool surface). NOT the loop's memory path.

**Impact on D1**: Adding "mem0 backend" means implementing `MemoryBackend` interface and registering it in `MemoryManagerImpl.withBrain({ roleBackends: [...] })`. The SQLite system is a peer, not a backend — don't conflate them.

### Permission system IS the full 7-step pipeline

`requiresApproval()` in `packages/tools/src/permission.ts` implements all 7 steps:
1. denied_tools (unconditional)
2. deny rules (pattern-match)
3. hook override
4. ask rules (inviolable)
5. allow/mode
6. escalation prompt
7. else deny

**Impact on C6**: The plan can use existing ask-rule infrastructure. Adding `cron_create(subject:*)` as an ask rule is supported by the existing `parseRule()` + `requiresApproval()` system. No new permission infrastructure needed.

### `allowedTools` is advisory only

`spawnSubagent(goal, { allowedTools })` puts the list in the system prompt text but does NOT filter tool schemas or executor calls. The subagent receives ALL tools.

**Impact on C6**: If agent-created cron jobs should be scoped, the scoping must happen in the cron tool wrapper, not in subagent `allowedTools`.

---

## Updated action items (consolidated v2 + v3)

### CRITICAL — must fix before ANY Sprint starts

| # | Action | LOC | Blocks |
|---|---|---|---|
| **P0** | Wire `scanInject` into `channel-session.ts` | ~15 | E1/E2/E3 |
| **P0** | Wire `deriveChild`/`releasePrecharge` in `spawnSubagent` | ~40 | A1/A2 |
| **P0** | Wire `DevicePairing`/`WebAuthn` in `main.ts` | ~10 | H10/H8 |
| **P0** | Start channel polling loop in `Gateway.start()` | ~20 | E1 inbound |
| **P0** | Add config loading mechanism (env var or config.json) | ~50 | D1/H1 |

### A1 revised approach

**Old plan**: Add iteration dimension to BudgetConfig (core change).

**New plan (simpler)**:
1. Add `maxToolRounds?: number` to `AgentConfig` (agent, not core) — ~5 LOC
2. Forward it in `startTurn` → `runTurn({maxToolRounds: config.maxToolRounds})` — ~3 LOC
3. For subagents: pass `maxToolRounds` in `spawnSubagent` options — ~5 LOC
4. Wire `deriveChild`/`releasePrecharge` so subagent budget is isolated — ~40 LOC
5. Total: ~53 LOC (not ~120). No core change needed.

### Revised LOC estimates (v2 → v3 delta)

| Feature | v2 LOC | v3 LOC | Reason |
|---|---|---|---|
| A1 IterationBudget | 120 | **53** | Simpler: AgentConfig field, not BudgetConfig core change |
| A2 Spawn depth | 120 | **150** | Must add deriveChild wiring (prerequisite) |
| E1 Channels | 430 | **470** | + polling loop (~20) + scanInject (~15) |
| H10 Pairing | 150 | **180** | Must wire DevicePairing in main.ts |
| D1 Memory backends | 280 | **330** | + config loading mechanism |
| H1 Profiles | 1850 | **1900** | + config path for profile selection |

### Sprint 1 revised (prerequisite tasks first)

Before any feature work, fix the 5 P0 items above (~135 LOC total):
1. `scanInject` wiring (~15 LOC)
2. `deriveChild`/`releasePrecharge` in subagent (~40 LOC)
3. `DevicePairing`/`WebAuthn` wiring (~10 LOC)
4. Channel polling loop (~20 LOC)
5. Config loading (~50 LOC)

These are **spec compliance fixes** — they bring the codebase closer to the AGENT-SPEC before adding new features.

---

## What's ACTUALLY real vs stub vs dead code

| System | Status | Evidence |
|---|---|---|
| Agent loop (`runTurn`) | ✅ **Fully functional** | 25-round loop, budget gate, stream retry, tool dispatch |
| Permission pipeline (7-step) | ✅ **Fully functional** | `requiresApproval` + `awaitHumanPrompt` |
| Budget tree accounting | ⚠️ **API exists, not wired** | `deriveChild`/`releasePrecharge` exist but never called |
| Subagent spawning | ⚠️ **Works but isolated poorly** | Shared budget, no depth, advisory tools |
| AuxiliaryProvider | ⚠️ **Type exists, unused** | Ready for G1a implementation |
| Cron scheduler | ✅ **Fully functional** | At-most-once, claim/complete, sweep, validation |
| Memory (Brain system) | ✅ **Fully functional** | 13 domains, dream cycle, retrieval engine |
| Memory (SQLite system) | ⚠️ **Real but tool-surface only** | Not the loop's memory path |
| Keyring/secrets | ✅ **Fully functional** | @napi-rs/keyring, SecretStore, redactor |
| Channels (outbound) | ✅ **Functional** | send() works for all 8 platforms |
| Channels (inbound polling) | ❌ **Dead code** | receive() implemented, never called |
| Channels (inbound webhook) | ✅ **Functional** | POST /channel/:id/webhook |
| scanInject | ⚠️ **Exists, minimally wired** | Only prompt ctxFiles |
| DevicePairing | ❌ **Exists, never wired** | main.ts doesn't instantiate |
| WebAuthn | ❌ **Exists, never wired** | main.ts doesn't instantiate |
| VoiceCall (Twilio) | ❌ **Exists, never wired** | main.ts doesn't instantiate |
| Voice STT (Whisper/Deepgram) | ✅ **Real implementation** | voice-stt.ts (227 LOC) |
| Gateway HTTP routes | ✅ **Functional** | 30+ real, 17 stubs |
| Gateway router | ⚠️ **No framework** | 50+ hand-rolled if blocks |
| Config system | ❌ **No central config** | 17 scattered JSON files |
| Web SPA | ✅ **Functional** | 19 pages, 54 source files |
| Build pipeline | ✅ **Functional** | esbuild + vite |
