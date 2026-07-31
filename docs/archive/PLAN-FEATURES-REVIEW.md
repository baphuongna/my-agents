# PLAN-FEATURES.md — Architectural Review Against Core Spec

> Reviewer: cold-verify against `source/.learned/spec/` (AGENT-SPEC, the authoritative founding spec)
> Date: 2026-07-21
> Verdict: **3 CRITICAL violations, 5 misplacements, 7 missing spec concepts, 4 effort underestimates**

---

## How mya's core actually works (the rules)

| Principle | Spec ref | What it means for features |
|---|---|---|
| **Minimal frozen core** | §00 tenet #1, inv #20 | Core = interfaces + host. Additions to `packages/core/` need a written "why-not-a-package" justification |
| **Core = interfaces; packages = impl** | §17 | Loop depends on traits. Every capability (memory backend, channel, provider, subagent) is a **package** satisfying a core interface |
| **4 extension kinds ONLY** | §17 | Extensions / Skills / Prompt-Templates / Themes. **No "plugin" kind** — there is no dynamic plugin-loading concept |
| **Package lifecycle** | §17 | `install (--ignore-scripts) → verify(apiVersion+sigstore) → register → activate`. Packages are **npm-resolved + pinned** — NOT fetched at runtime |
| **Layering (acyclic)** | §03, inv #19 | Transports (tui/cli/sdk/rpc/gateway) depend on core inward only. Gateway is a transport — it must NOT own business logic |
| **Typed events, not scraping** | inv #11, #17, #18 | Every component emits `RuntimeEvent`. Boot fails on missing `ComponentHealth` registration. Failed tools → `DegradedResult` |
| **Prompt cache sacred** | inv #1, #7, #8, #15 | No mutation except at tier boundaries (compress / provider-swap / skill-write). Side tasks get their OWN auxiliary provider |
| **Rust gate** | §02 | Rust only for: trust boundary / hot loop / determinism / platform parity. Everything else stays TS |
| **5 permission modes** | §07 | `ReadOnly|WorkspaceWrite|DangerFullAccess|Prompt|Allow`. No custom modes. Deny rules first, ask rules inviolable |
| **AGPL ban** | inv #04, §19 | OpenViking = clean-room concept ONLY. `cargo-deny` fails on AGPL |
| **Budget is core + tree-accounted** | §21, `types.ts:448` | `BudgetConfig` in core: `total/spend/deriveChild/releasePrecharge/exhausted`. Iteration budget extends THIS, not a separate system |

---

## 🔴 CRITICAL — must fix before ANY implementation

### C1. D1 OpenViking = AGPL violation (Invariant #4)

**Plan says**: "Built-in adapters: mem0, **openviking**, byterover, supermemory, honcho"

**Spec says** (§19 License, Invariant #4):
> **OpenViking** | **AGPL-3.0** | **clean-room concept ONLY — never read its code for design**
> Never vendor AGPL code (OpenViking). [ENFORCED: CI license scan (`cargo-deny`/`license-checker`) fails on AGPL in the dep graph]

**Fix**: Drop "openviking" from the backend list. If the ragfs unified-context *concept* inspires a backend, it must be a clean-room reimplementation with no code or API-mimicry from OpenViking. Label it explicitly: "ragfs-style backend (clean-room, not OpenViking)".

---

### C2. B1 Runtime npm install violates §17 package lifecycle

**Plan says**: `lazyInstall(manifest, allowlist)`: `MYA_PLUGIN_ALLOWLIST` gate → **npm install at runtime**

**Spec says** (§17):
> Packages are versioned (`semver`) and resolved from npm/git with an **exact-pinned lockfile**.
> Lifecycle: `install (--ignore-scripts) → verify(apiVersion + signature) → register → activate`.
> install runs with `--ignore-scripts` ... arbitrary code does NOT run at install.

The spec model is: user runs `npm install -g @mya/provider-foo` → package is in node_modules → mya discovers it at boot via `jiti` require. There is **no runtime `npm install`**. That's a Hermes pattern (Python pip-at-runtime) that conflicts with the frozen-core + pinned-lockfile model.

**Fix**: Reframe B1 as **provider discovery** (scan `node_modules/@mya/provider-*` + `~/.mya/providers/`), not runtime installation. Users install providers via `npm install` (documented), mya discovers them. The "plugin manifest" becomes a standard `agent-package.json` (§17 `PackageManifest`). No `lazyInstall()`.

---

### C3. "Plugin" terminology doesn't exist in the spec

**Plan says**: "plugin providers" (B1), "plugin channels" (E1), "web plugin slots" (H6)

**Spec says** (§17): **4 extension kinds ONLY**: Extensions / Skills / Prompt-Templates / Themes. There is no "plugin" concept.

In the spec's model:
- Providers are **extensions/packages** that ship a `ProviderProfile` (§6) and satisfy the provider transport interface.
- Channels are **packages** with `ChannelRegistry` link-time registration (§12).
- "Plugin" implies dynamic runtime loading — the spec uses npm-resolved packages loaded via `jiti` (like pi extensions).

**Fix**: Replace all "plugin" terminology with the spec's vocabulary:
- "Plugin provider" → "provider package" / "extension provider"
- "Plugin channel" → "channel adapter package"
- "Web plugin slot" (H6) → already deferred ✅, but if revisited, frame as "extension slot" per §17

---

## 🟠 ARCHITECTURAL MISPLACEMENTS (wrong package)

### M1. H1 Profile system — store should NOT be in gateway

**Plan says**: `packages/gateway/src/profiles.ts`

**Spec says**: Gateway is a **transport** (§12, §25). Transports depend on core inward only (inv #19). Gateway must NOT own business logic — it proxies.

ProviderProfile is a core ai-package concept (§6). A "profile" (identity + model + skills + MCP) is broader than ProviderProfile, but it's still **configuration/business logic**, not transport.

**Fix**: Profile store → new `packages/profiles/` package (clean separation) OR extend `packages/ai/` since ProviderProfile lives there. Gateway endpoints (`GET/POST /profiles/*`) just proxy to the profiles package. The plan's migration step (`~/.mya/` → `~/.mya/profiles/default/`) is a profiles-package concern, not a gateway concern.

---

### M2. A4 Daemon pool — no spec home

**Plan says**: `packages/agent/src/daemon-pool.ts` — spawn N worker processes, keep alive, reuse

**Spec says**: The architecture map (§03) has no "daemon pool" or "process pool" concept. The 4 transport modes are interactive/print/rpc/sdk. The closest existing concept is **MCP server lifecycle** (§12.1 — 11-phase FSM with health/restart).

**Issue**: This is a NEW concept not in the spec. Either:
1. Frame it as extending the MCP `PluginLifecycle` pattern (§12.1) to general process supervision
2. Create a new `packages/proc-pool/` package with a "why-not-a-package" justification
3. Drop it — invariant #12 already says "keep long-lived handles in the runtime struct"; maybe per-process pools aren't needed if handles are reused

**Recommendation**: Defer A4 until there's a concrete perf need. The spec's design already keeps handles alive (inv #12). A daemon pool is an optimization, not a feature gap.

---

### M3. A3 AST tool discovery — Rust gate check needed

**Plan says**: "Use TypeScript compiler API or regex for `@Tool` decorator"

**Spec says** (§02 Rust gate): AST/tree-sitter parsing → Rust (hot inner loop / correctness). BUT §07 says: "Self-registering tool registry with **AST/import discovery** + `check_fn`/`is_available(config)` gate so absent tools cost nothing at schema-emission."

**Analysis**: Tool discovery happens at **boot** (once), not in a hot loop over 100k files. The Rust gate says hot inner loop = ">100k files / AST parse". Boot-time tool scan of a few dozen files doesn't meet the bar. TS is fine.

**Fix**: Keep TS, but note in the plan: "Boot-time discovery (not hot loop) — TS is within the Rust-gate exception. If tool count exceeds ~1000 and scan latency is measurable, move to Rust `crates/ast`."

---

### M4. C6 "cron-manage" mode — doesn't exist in §07

**Plan says**: "Permission gate: `cron-manage` mode (explicit opt-in)"

**Spec says** (§07): 5 modes ONLY: `ReadOnly|WorkspaceWrite|DangerFullAccess|Prompt|Allow`. There is no "cron-manage" mode.

**Fix**: Use the spec's existing permission model:
- Cron creation is a **write** → `WorkspaceWrite` required mode
- Add a deny/ask rule: `cron_create(subject:*)` → ask rule (always prompt) for safety
- Agent-scoped jobs (`agent-*` prefix) → allow rule if `active_mode ≥ WorkspaceWrite`
- Don't invent new modes

---

### M5. D1 "22 memory backends" — massively under-scoped

**Plan says**: L, ~600 LOC for "22 backends"

**Reality**: Each backend has a unique API, auth flow, data model, query semantics. Even 4 backends (mem0 + sqlite + markdown + vector) is ~800-1000 LOC. 22 backends = ~4,000-5,000 LOC.

**Spec says** (§08, §23 Open Q #3): "Memory-backend defaults: local SQLite (structured) + markdown (human-editable) + vector (semantic) — which ship in core-zero vs as packages?" — this is still an OPEN QUESTION.

**Fix**: 
1. Reduce scope to **3-4 priority backends** (SQLite ✓ already done, markdown, vector/embedding, + 1 remote like mem0)
2. The "22 backends" is an aspiration list, not a single deliverable
3. Each backend is a separate **package** satisfying `MemoryBackend` interface — not all bundled in `packages/memory/`

---

## 🟡 MISSING SPEC CONCEPTS (plan doesn't mention)

### S1. ComponentHealth registration (Invariant #17) — MISSING EVERYWHERE

**Spec**: Every component/adapter/tool MUST register and emit `ComponentHealth{Healthy|Degraded|Failed}` via `RuntimeEvent{kind:"health"}`. **Boot fails on any missing registration.**

**Plan gaps**: None of the 42 features mention ComponentHealth. Every new:
- Provider (B1) → register as ComponentHealth
- Channel adapter (E1, E2, E3) → register as ComponentHealth  
- Tool (C1-C6) → `is_available(config)` gate + ComponentHealth
- Daemon pool (A4) → ComponentHealth per worker
- Voice (G1a) → ComponentHealth for STT/TTS pipeline
- Memory backend (D1) → ComponentHealth

**Fix**: Add a line to EVERY feature: "Registers `ComponentHealth`; emits `RuntimeEvent{kind:"health"}` on state change."

---

### S2. Typed RuntimeEvents (Invariant #11, #18) — MISSING

**Spec**: Never derive UI state from scraping stdout. Every lifecycle emits typed `RuntimeEvent`. Failed tool calls → `DegradedResult` / `LifecycleError`.

**Plan gaps**:
- Voice (G1a): needs `RuntimeEvent{kind:"voice";phase:"listening"|"transcribing"|"speaking"}`
- Web terminal (H4): PTY must emit typed events per §25 UI↔Runtime contract, not raw stdout
- Cron agent tools (C6): need typed cron-lifecycle events
- Kanban (C3): task changes need typed events if surfaced in UI

---

### S3. Prompt cache isolation (Invariant #8) — MISSING for voice

**Spec**: Side tasks get their OWN auxiliary provider instance — NEVER touches the main session's prompt cache.

**Plan gap**: Voice mode (G1a) runs an agent turn on transcript. This MUST use an auxiliary provider (§06) or a separate session — not the main session's prompt cache.

---

### S4. Injection scanner (§12 R27-15) — MISSING for channels

**Spec**: Channel messages MUST pass through `scanInject` with `scope="context"` BEFORE entering history.

**Plan gap**: E1/E2/E3 don't mention injection scanning. Every inbound channel message must be scanned.

---

### S5. Budget integration (§21) — MISSING for subagent features

**Spec**: Every subagent derives a child budget. Iteration budget extends `BudgetConfig`.

**Plan gap**: 
- A1 (IterationBudget) must integrate with the EXISTING `BudgetConfig` tree (`total/spend/deriveChild/releasePrecharge`), not be a parallel system
- A2 (spawn depth) interacts with budget — `MAX_DEPTH` already exists in `types.ts:492` (`MAX_TREE_NODES = 64`). Check if depth tracking already exists before adding new.

---

### S6. Time helper (Invariant #10) — MISSING for cron/voice

**Spec**: One injectable `now()` helper (`core.time`/`natives.time`). `Date.now()`/`SystemTime::now()` banned outside the helper.

**Plan gap**: F1-F4 (cron), G1a (voice) — all use time. Must go through `core.time`, not `Date.now()`.

---

### S7. Path-safety resolver (§07 R31) — MISSING for kanban

**Spec**: `resolve_inside_workspace` (write — lexical) vs `resolve_existing_inside_workspace` (read — canonicalize).

**Plan gap**: C3 (Kanban) writes to `~/.mya/kanban.json` — outside workspace. Needs path-safety even for config-dir writes, to prevent traversal via board/task names.

---

## 🟣 EFFORT UNDERESTIMATES

| Feature | Plan LOC | Revised | Why |
|---|---|---|---|
| **D1 Memory backends** | ~600 | **~4,000+** | 22 backends × unique API/auth. Scope to 3-4 = ~1000 |
| **E1 Plugin channels** | ~800 | **~3,000+** | 20+ platforms × unique API/auth/rate-limit. Scope to 5-6 = ~900 |
| **H4 xterm terminal** | ~350 | **~500** | PTY + WebSocket + security + reconnect |
| **G1a Push-to-talk** | ~200 | **~350** | STT backend integration + CLI vs web audio API split |

**Revised grand total**: ~8,510 → **~10,500-11,000 LOC** (if D1/E1 stay full-scope) or **~7,500 LOC** (if D1/E1 scoped to 3-4/5-6)

---

## ✅ CORRECTLY ALIGNED features (no changes needed)

| Feature | Why it's correct |
|---|---|
| **A1 IterationBudget** | Budget is core (§21, `types.ts:448`). Extending `BudgetConfig` with iteration dimension is within core's mandate. ✅ |
| **A5 Recovery FSM** | §14b Crash Resilience covers this. Watchdog = typed-event ComponentHealth pattern. ✅ |
| **B2 MCP OAuth** | §06.1 covers OAuth/PKCE. Gateway endpoint is transport-appropriate. ✅ |
| **C4 OSV check** | Tool extension (§17 kind=extensions). HTTP wrapper. ✅ |
| **C5 Tirith URL safety** | Tool extension. Integrates with existing web security guard. ✅ |
| **F1-F4 Cron** | Cron is §12.3. All use `core.time`. ✅ |
| **G1a Voice PTT** | §21: "STT/TTS/voice as optional packages". ✅ (but needs S3 fix) |
| **H7 Skill editor** | Web UI over existing skills package. ✅ |
| **H8 Auth widget** | Uses existing OAuth (§06.1). ✅ |
| **H9-H14 Web polish** | UI surface (§25). Low-risk. ✅ |
| **I1 Systemd** | Deployment ops, not core. ✅ |
| **J1-J4 Fun/UX** | Pure UX packages. ✅ |

---

## Summary table — action items

| # | Severity | Feature | Action |
|---|---|---|---|
| C1 | 🔴 CRITICAL | D1 | Drop OpenViking from backend list (AGPL) |
| C2 | 🔴 CRITICAL | B1 | Remove runtime npm install — use boot-time discovery |
| C3 | 🔴 CRITICAL | B1/E1 | Replace "plugin" terminology with spec vocabulary |
| M1 | 🟠 HIGH | H1 | Move profile store from gateway → new profiles package or ai/ |
| M2 | 🟠 HIGH | A4 | Defer daemon pool — no spec home; inv #12 covers handle reuse |
| M3 | 🟡 MED | A3 | Note Rust-gate exception (boot-time, not hot loop) |
| M4 | 🟡 MED | C6 | Replace "cron-manage" mode with §07 5-mode + ask rule |
| M5 | 🟡 MED | D1 | Scope 22 backends → 3-4 priority backends |
| S1 | 🟡 MED | ALL | Add ComponentHealth to every new component |
| S2 | 🟡 MED | G1a/H4/C6 | Add typed RuntimeEvents |
| S3 | 🟡 MED | G1a | Voice must use auxiliary provider (inv #8) |
| S4 | 🟡 MED | E1/E2/E3 | Channel messages → scanInject before history |
| S5 | 🟡 MED | A1/A2 | Integrate with existing BudgetConfig tree + MAX_DEPTH |
| S6 | 🟡 LOW | F1-F4/G1a | Use core.time, not Date.now() |
| S7 | 🟡 LOW | C3 | Path-safety for kanban config writes |

---

## Recommendation

**Do not start implementation until C1-C3 are resolved** — they are fundamental architectural conflicts with the spec. M1-M5 should be addressed in the plan revision. S1-S7 should be added as requirements to each feature's implementation steps.

The plan is a good **feature wishlist** but needs a **spec-alignment pass** before becoming an implementation plan.
