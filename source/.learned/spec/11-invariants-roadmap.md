# Invariants, Roadmap & Glossary

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §18 · §20 · §21 · §23 · §24.



## 18. Hard Invariants ("do NOT") — each with an enforcer

> An invariant without an enforcer is a wish. Each rule below carries a concrete enforcement mechanism (lint / test / CI gate / type-level constraint), added round 19.

1. **Never mutate past context / swap toolsets / rebuild the system prompt mid-conversation** except at a **tier boundary** (compression / provider-or-profile swap / skill-write). *[ENFORCED: unit test diffs the system-prompt hash across turns — any mutation outside the boundary set fails the test.]* *(source: [hermes](../../hermes-agent/); R25-16 widens the carve-out from “compression” to the full boundary set.)*
2. **Never cache allowlists/`denied_tools`** in handles — resolve on demand via config. *[ENFORCED: ESLint rule banning allowlist fields on channel/tool/handle classes; resolver closure only.]* *(source: [claw-code](../../claw-code/) `denied_tools`/permissions)*
3. **Never propagate parent stdin/file-handle ownership to subagents** — route via explicit `ApprovalChannel`. *[ENFORCED: the `SubagentSpawn` type makes parent-stdin unreachable (no field for it); compiler rejects.]* *(source: [hermes](../../hermes-agent/) deadlock)*
4. **Never vendor AGPL code** (OpenViking). *[ENFORCED: CI license scan (`cargo-deny`/`license-checker`) fails on AGPL in the dep graph; clean-room files carry SPDX + notice.]*
5. **Never ship compression without the drift gate in CI.** *[ENFORCED: the **merge-block gate** = the deterministic-replay drift grader (zero-cost, CI-runnable — replay a golden `LlmTrace` with vs without compression, diff final responses; `ε = 0`); accuracy lm-eval (GSM8K/TruthfulQA) = best-effort aspiration, NOT a merge block. The mandatory in-repo gates are the zero-cost CCR round-trip + tool-schema-compaction checks; the live GSM8K eval skips green without `OPENAI_API_KEY`; the Rust-vs-Python parity-nightly job is `continue-on-error` (Phase 0).]* *(source: [headroom](../../headroom/) + R25-17/R25-32.)*
6. **Never stub-then-replace** a field. *[ENFORCED: `@typescript-eslint/no-explicit-any` as error + code-review checklist for `as unknown as T` casts.]* *(SPEC proposal, R25-31.)*
7. **Never append per-turn prefix into the cached system block.** *[ENFORCED: same hash-diff test as #1; the prompt assembler is append-only-outside-cache by construction.]* *(source: [hermes](../../hermes-agent/))*
8. **Never let an auxiliary/side task touch the main session's prompt cache.** *[ENFORCED: `AuxiliaryProvider` type has no handle to the main session; the auxiliary instance is a separate allocation, statically unreachable.]* *(source: [hermes](../../hermes-agent/) + deepdive #02/#05)*
9. **Shell via the user's `/bin/bash` directly; NO sandbox/containment** (pi model, R30 inversion). The agent executes shell commands via the user's shell (`/bin/bash`/`$SHELL`); there is **no sandbox/containment**. The [§7](03-tools-permission.md) permission gate (mode + deny/ask rules + approval) is the sole control over whether a command runs. *[ENFORCED: the shell tool has no sandboxing code path — it spawns `/bin/bash -c`/`$SHELL`; the permission decision is the only gate. (R30 inverts the prior R24 #9 which mandated the in-process brush shell.)* *(source: [pi](../../pi-coding-agent/); [oh-my-pi](../../oh-my-pi/) brush shell vendoring deferred/optional — perf/Windows-parity only.)*
10. **Never duplicate the time/now pattern** across files — one injectable helper. *[ENFORCED: lint banning `Date.now()`/`SystemTime::now()` outside `natives.time`/`core.time`.]* *(source: [claw-code](../../claw-code/))*
11. **Never derive UI/dashboard state from scraping stdout/stderr**. *[ENFORCED: dashboard/transport packages may not import `child_process` stdout; they import the typed-event stream instead (import-rule).]* *(source: [claw-code](../../claw-code/) tenet #6, round 7.)*
12. **Never spawn a fresh runtime/HTTP client per tool call or per turn** — keep long-lived handles in the runtime struct. *[ENFORCED: lint banning `new Provider()`/`new Client()` outside the runtime constructor.]* *(source: [hermes](../../hermes-agent/) `asyncio.run` anti-pattern, round 7.)*
13. **Never let any hook/override bypass an `ask` rule** — `ask` rules are inviolable; even a hook `Allow` must still prompt when an `ask` rule matches. *[ENFORCED: `authorize()` hard-codes ask-rule-after-hook-Allow; the `hook_allow_still_respects_ask_rules` unit test asserts it.]* *(source: [claw-code](../../claw-code/) [`permissions.rs`](../../claw-code/rust/crates/runtime/src/permissions.rs), round 24 deep-read.)*
14. **Never `abort!`/`process::exit` across the napi boundary** — native panics propagate as typed `NativeResult{Panic}` errors, never process death. *[ENFORCED (best-effort, R30): every napi entry body is wrapped in `std::panic::catch_unwind`; a Rust lint `clippy::exit` + a custom `no-abort` lint refuse `process::exit`/`abort!` in `crates/natives`. This is cheap in-process robustness with no process overhead. R30 sandbox-removal DROPS the prior "trust-boundary natives run in a sidecar" enforcement claim — natives run in-process; a crash kills the process (accepted, [§14b Crash Resilience](08-observability-security.md)).]* *(R27-12.)*
15. **The prompt struct is COW-immutable; tier rebuilds are the sole mutators and MUST be serialized.** *[ENFORCED: `SystemPrompt` rebuilds (`markCompressed`/`rebuildStableTier`/`rebuildVolatile`) each build a new tier and atomically swap an `Arc<SystemPrompt>` under a typed `PromptMutex`; a concurrent-stress test (2 rebuilds + 1 reader) in the drift-gate suite asserts `markCompressed` never races a reader.]* *(R27-23.)*
16. **Every `crates/*` crate must justify ≥1 of the 4 Rust gates** (trust boundary / hot loop / determinism / platform parity — [§2 Language](00-OVERVIEW.md)). *[ENFORCED: each crate carries an `OWNERS` file listing which gate(s) it satisfies; CI scans `crates/*` and fails on missing `OWNERS` or on a crate with no listed gate. Cross-reference: the [§2 Language](00-OVERVIEW.md) Rust-gate prose.]* *(R36 / tenet #2.)*
17. **Every component / adapter / tool MUST register and emit `ComponentHealth` via `RuntimeEvent{kind:"health"}` on state change.** *[ENFORCED: at boot a registry scan walks the registered components and fails boot on any missing `ComponentHealth` registration; runtime state changes emit a typed `RuntimeEvent` so observers never scrape logs.]* *(tenet #6; cf. invariant #11.)*
18. **Failed tool calls must surface as `DegradedResult` / `LifecycleError` — never silent.** *[ENFORCED: `aggregate()` returns the full tool-result set + a `failedCallIds: string[]` list (R27-1/D6); a unit test asserts that every `ToolResult.ok === false` appears in `failedCallIds`, and that the loop never swallows a failed call by omission.]* *(tenet #6; cf. R27-1.)*
19. **Transports (`tui` / `cli` / `sdk` / `rpc`) depend on `core` only; cross-transport imports are forbidden.** *[ENFORCED: `madge --circular` import-direction-acyclic rule over the `packages/{tui,cli,sdk,rpc}` set; the build fails on any cross-transport import or on a reverse import from `core` into a transport.]* *(tenet #7; reinforces the [§3 Architecture](00-OVERVIEW.md) layering rule.)*
20. **Adding code to `packages/core/` requires a written "why-not-a-package" justification.** *[ENFORCED: PR template carries a `why-not-a-package` field; missing or empty field blocks merge. CI greps the diff for changes under `packages/core/` and fails on absent justification.]* *(tenet #1; R36.)*

---
## 20. Roadmap Tiers (leverage × quality, effort ignored)

**Tier 0 — Foundations (ship first, unblock everything):**
- Minimal TS `core` + 4 transport modes — interactive (TUI) · print (--json flag) · rpc (stdio JSON-RPC) · sdk (embedded lib). *(source: [pi](../../pi-coding-agent/))*
- Rust `natives` napi package: search (glob/grep), fs, ast, edit-hash. **Shell = the user's `/bin/bash`** (no vendoring, no sandbox — pi model, R30). *(source: [oh-my-pi](../../oh-my-pi/) for the natives layer; shell posture from [pi](../../pi-coding-agent/))*
- Pit-of-success lint wrappers + single time helper. *(source: [MyAgents](../../MyAgents/) #07)*
- Typed FSM + LaneBoard + ComponentHealth tri-state. *(source: [claw-code](../../claw-code/) #03/#14/#15)*
- Byte-faithful JSON + supply-chain age-gate. *(source: [headroom](../../headroom/) #17, [openclaw](../../openclaw/) #18)*
- **Accuracy-preservation gate** (deterministic-replay drift grader — zero-cost; GSM8K subset when API key available). The Tier-0 grader depends only on the `Compressor` + `LlmTrace` interface stubs (R26-A); concrete compressors are Tier-1 — the grader ships with a no-op/identity compressor in Tier 0 and upgrades when Tier-1 compressors land. *(source: [headroom](../../headroom/) #4, [§15 Eval](09-eval-supply.md), R25-33, R26-F.)*
- **ProviderProfile interface stub + one `MockProvider`** (R29-6/M1): canned-replay of `StreamEvent[]` from a golden trace, no network. Concrete provider adapters are Tier-1.
- **Tier-0 memory stance** (R29-6/M10): `MemoryManager` ships as a stub returning an empty `MemorySnapshot`; SQLite + Markdown + Vector backends land in Tier-1 as packages.
- **Transport-mode protocol sketches** (R29-7): *interactive: Ink/React TUI (Ctrl-C abort, Tab cycle, Enter submit). rpc: newline-delimited JSON-RPC 2.0 over stdio (`prompt`/`cancel`/`status`/`heartbeat`). print: one JSON `RuntimeEvent` per stdout line (`--json`) or a human transcript (default). sdk: `new Agent(config).prompt(text, opts?): AsyncIterable<RuntimeEvent>`.*
- **Tier-0 shell contract** (R29-5, simplified by R30 sandbox-removal): `shell.exec(cmd: string, opts: { cwd?; env?; timeoutMs? }): Promise<ShellResult>` executes via the user's `/bin/bash -c` / `$SHELL` **directly** — no sandbox, no in-process vendoring (the prior `useInProcessShell` feature flag and the cwd-lock/env-allow-list/path-validator hardening are dropped: pi model). A 10-case conformance suite gates it. Vendoring `brush`+`uutils` is deferred/optional (perf/Windows-parity only, [§23 Open Questions](11-invariants-roadmap.md) #7 RESOLVED).

**Tier 1 — Core capability (the big UX/perf wins):**
- 3-tier cache-stable prompt + injection scanner. *(source: [hermes](../../hermes-agent/) #1)*
- ProviderProfile registry + tool-call repair. *(source: [hermes](../../hermes-agent/) #5, [openclaw](../../openclaw/) #7)*
- Content-aware compression BEHIND the drift grader. *(source: [headroom](../../headroom/) #4)*
- MemoryManager + memory roles (archivist/tree/diff) + ragfs. *(source: [openhuman](../../openhuman/) #6, [OpenViking](../../OpenViking/))*
- CoW-overlay-isolated subagents + JSON-Schema/JTD-validated returns + 6 topologies. *(source: [oh-my-pi](../../oh-my-pi/), [harness](../../harness/))*
- Mock parity harness. *(source: [claw-code](../../claw-code/) #16)*

**Tier 2 — Flagship / differentiation:**
- Skill curator + provenance + progressive disclosure. *(source: [hermes](../../hermes-agent/) #8)*
- LSP-on-write + DAP debugger + codegraph (file-relevance ranking only; symbol/ref/call-graph deferred — [§23 Open Questions](11-invariants-roadmap.md) #1). *(source: [oh-my-pi](../../oh-my-pi/), [openhuman](../../openhuman/))*
- Bidirectional code-exec bridge (Python/Bun → tools). *(source: [oh-my-pi](../../oh-my-pi/) §01)*
- Council provider + advisor/hindsight model lane. *(source: [openhuman](../../openhuman/), [oh-my-pi](../../oh-my-pi/))*
- Channels gateway + hook registry + gateway control-plane protocol crate. *(source: [hermes](../../hermes-agent/), [openclaw](../../openclaw/))*
- **Embedded scripting workflows** (language TBD per [§23 Open Questions](11-invariants-roadmap.md) #2 — Rhai or JS/TS sandbox). *(source: [openhuman](../../openhuman/), R25-34.)*

**Frontier (research-aligned):** multi-agent shared-state convergence; x402 micropayments + wallet; on-device MLX TTS; collaboration relay. *(source: Papers, [openhuman](../../openhuman/), [oh-my-pi](../../oh-my-pi/))*

**Dependency order & cross-links (round 18 — true build order, not just leverage):**
- **Hard sequence:** [§2 Language](00-OVERVIEW.md) Rust-gate → [§3 Architecture](00-OVERVIEW.md) architecture (napi boundary + core interfaces) → [§5 Prompt](04-prompt-compression.md) 3-tier prompt → **only then** [§5 Prompt](04-prompt-compression.md) compression (compression rebuilds the prompt; landing it before the cache-stable prompt is wasted). *(deepdive #02↔#04 dependency.)*
- **Shared helper, built once:** the **auxiliary-provider** instance ([§6 Providers](02-providers.md)) is consumed by BOTH the skill curator ([§9 Skills](06-skills-subagents.md)) and memory roles ([§8 Memory](05-memory.md)) — extract it in Tier 1 so Tier 2 doesn't reimplement it twice. *(deepdive #02↔#05.)*
- **FSM + LaneBoard + event taxonomy (Tier 0) before every subsystem** — memory drain, cron, channels all emit `RuntimeEvent` ([§13 Observability](08-observability-security.md)); land the taxonomy before the emitters.
- **Drift grader (Tier 0 eval) gates compression (Tier 1)** — never invert.
- **Cross-cutting ([§21 Cross-cutting](11-invariants-roadmap.md)) threads through all tiers:** `BudgetConfig` wires into [§4 Core Loop](01-core-loop.md) turn loop + [§10 Subagents](06-skills-subagents.md) subagent budget; versioning wires into [§21 Cross-cutting](11-invariants-roadmap.md) session-format + [§17 Packages](10-packages.md) `apiVersion`.

---
## 21. Cross-cutting Concerns (the completeness gap)

*(Added round 1 — concerns no single source owned, but every production agent must specify.)*

**Cost & budget.** Per-turn + per-session + per-run token/cost accounting (input/output/compression-saved), surfaced as typed events. Budgets are **first-class** and **tree-accounted (R27-6)** — `BudgetConfig` is defined in the [§4 glossary](01-core-loop.md) as the SOLE definition (R27-6 tree-accounting; atomic root, CC2/CC10/CC13). Every node shares ONE atomic root `spent`; `remaining()`/`exhausted()` evaluate against the ROOT total. `spend()` is REQUIRED (not optional) and is called on the Completed path AND before each loop continuation ([§4 Core Loop](01-core-loop.md), R27-1/D2). The `SubagentRunner` host calls `parent.budget.deriveChild(child.total)` under a lock at spawn (child cannot self-declare); unused delta refunded on completion; `child.unlimited = parent.unlimited && requested` (a limited parent can NEVER spawn an unlimited child). The tree is bounded by `MAX_DEPTH` + `MAX_TREE_NODES` (not just `MAX_CONCURRENT_SUBAGENTS`). A mid-stream cost watermark in `streamWithFallback` cancels the stream when cumulative-turn cost > `abortThreshold`. The loop checks budget before each provider call and emits `BudgetWarning`/`BudgetExhausted` → graceful abort with partial result. *(source: [mya-v1](../../mya-v1/) `cost` + pi-crew `budgetTotal` pattern; R27-6.)* **(CC2/R28: "completion" = ANY terminal state `Completed|Failed|Cancelled`; the `SubagentRunner` ALWAYS refunds `alloc - child.spent` via `releasePrecharge(childId)` — a crashed child ([§14b Crash Resilience](08-observability-security.md)) refunds too, so no pre-charge is ever orphaned. CC13/R28: `spend()` is an atomic compare-and-swap that REJECTS a spend breaching `abortThreshold`, bounding concurrent-turn overspend against the shared root. CC10/R28: `deriveChild` locks the PARENT node only; lock hierarchy root→child→grandchild — holding a parent lock never blocks a child's spawn.)**

**Versioning & migration.** Two versioned schemas with automated, type-safe migrations: **session format** (`session.v{N}` + `session-manager.ts` migrations: `CURRENT_SESSION_VERSION=3`, `migrateV1ToV2`, `migrateV2ToV3`) and **config schema** (`config.v{N}` + a migration registry that refuses to boot on an unknown future version rather than guessing). Note: pi's separate `src/migrations.ts` holds **side-effectful filesystem** startup migrations (auth moves, sessions relocation, commands→prompts, tools→bin) — NOT the session-format migrations and NOT pure. Session/config migrations are pure functions, unit-tested, one-directional. *(source: [pi](../../pi-coding-agent/) `src/core/session-manager.ts` + [mya-v1](../../mya-v1/) type-safe migration.)*

**Updates & distribution.** Agent self-update channel (opt-in, signed releases); packages are versioned (`semver`) and resolved from npm/git with an exact-pinned lockfile. `agent doctor` verifies install integrity (napi binary matches, no shadowed core).

**Distribution & deployment.** The agent ships as an **npm package** — `npm install -g <agent>` or `npx <agent>` — with the TS core + packages resolving from npm; Rust `natives` ship as **prebuilt napi binaries via npm `optionalDependencies` per {os,arch}** (like `@napi-rs/*`; no Rust toolchain for users). A slim Docker image (distroless) for gateway/containerized runs; the 4 transport modes — interactive (TUI) · print (--json flag) · rpc (stdio JSON-RPC) · sdk (embedded lib) — map to: `interactive`→native binary, `print`→CI, `rpc`→sidecar, `sdk`→embedded lib. *(source: [oh-my-pi](../../oh-my-pi/) napi prebuilt + [hermes](../../hermes-agent/) multi-process + [pi](../../pi-coding-agent/) npm distribution.)*

**Multimodal I/O.** Providers declare `supports_vision`; the read surface ingests images/PDFs → structured markdown (arxiv/GitHub/SO) *(source: [oh-my-pi](../../oh-my-pi/) §08/§12)*; STT/TTS/voice as **optional packages** (on-device MLX TTS as a frontier package). Images in tool results are content-addressed like text edits.

**Internationalization & accessibility.** Prompts and UI are i18n-capable (message catalog, not string literals) so the agent can localize identity/guidance; TUI and web dashboard meet keyboard-nav + screen-reader baselines (WCAG 2.1 AA for the dashboard).

**Reproducibility.** A `--deterministic` mode pins model+seed+temperature+byte-faithful JSON for replayable evals; combined with the `MockProvider`, any session can be byte-replayed. Every eval gate runs in this mode.

---
## 23. Open Questions (explicitly undecided — honest about what this SPEC does NOT nail down)

A founding spec that pretends to decide everything is lying. These remain open, to be resolved by a spike before implementation:
1. **codegraph: build a symbol/ref/call-graph on top of today's file-relevance search?** openhuman is file-search (BM25 + structural-doc embeddings + reciprocal-rank fusion) today; a tree-sitter call-graph is a *future* upgrade; mya-v1 used external LSP. Spike: measure query latency + maintenance cost of each. *(affects [§11 Code Nav](07-code-channels.md) + Tier 2.)*
2. **Embedded scripting: Rhai (openhuman, sandboxed-by-design but niche) vs a JS/TS sandbox (reuses ecosystem) vs none?** Deferred to the automation-surface spike. *([§10 Subagents](06-skills-subagents.md)/Tier 2.)*
3. **Memory-backend defaults:** local SQLite (structured) + markdown (human-editable) + vector (semantic) — which ship in core-zero vs as packages? *([§8 Memory](05-memory.md).)*
4. **Council/advisor model: always-on (doubles cost) vs on-demand (adds latency)?** oh-my-pi watches every turn; gate behind a per-session flag. *([§6 Providers](02-providers.md)/[§10 Subagents](06-skills-subagents.md).)*
5. **Multi-device `sync` transport:** CRDT, last-writer-wins, or server-authoritative? *([§8 Memory](05-memory.md) frontier.)*
6. **Package signing:** sigstore, npm provenance, or a custom scheme? [§17 Packages](10-packages.md)'s `verify(signature)` needs a concrete signer. *([§16 Supply Chain](09-eval-supply.md)/[§17 Packages](10-packages.md).)* **(R27-12 RESOLUTION: sigstore is the chosen scheme; for third-party `native` it is a RELEASE-BLOCKER — the sigstore signature + SHA-256 content-hash pinned in the release lockfile MUST verify BEFORE `dlopen`. `abiStamp`/`napiVersion` are compatibility guards, not security. The open remainder = sigstore for non-native packages, which may track npm provenance.)** *(C7/R28: partially resolved — sigstore for third-party NATIVE packages = release-blocker; non-native package signing still open.)*
7. **Shell vendoring spike:** which `brush` commit/tag + which uutils subset? **RESOLVED by the R30 pi-model decision: shell = `/bin/bash` directly; vendoring `brush`/uutils is deferred/optional (perf/Windows-parity only, NOT Tier 0).** This unblocks the Tier-0 estimate (no `crates/shell` crate). The napi signatures question (`shell.exec(cmd, opts): Promise<ShellResult>`) stays as the thin wrapper around `/bin/bash -c`.

---
## 24. Glossary (terms used throughout)

| Term | Meaning | Source |
|---|---|---|
| **ragfs** | unified context FS — one URI namespace over memory/skills/knowledge/files | OpenViking |
| **hashline** | content-addressed edit (BLAKE3 16-hex content tag for version binding + line anchors; full-text equality gate before apply — R27-13) | oh-my-pi |
| **LaneBoard** | liveness aggregator classifying workers Healthy/Stalled/TransportDead/Unknown/AwaitingHuman (R27-19; C8/R28 adds Unknown) | claw-code |
| **Trident** | 3-stage compaction (Supersede→Collapse→Cluster) | claw-code |
| **ProviderProfile** | declarative provider metadata record (auth/endpoints/hooks) | hermes |
| **auxiliary provider** | separate provider instance for side tasks; never touches the main prompt cache | hermes |
| **progressive disclosure** | skill index shows name+desc only; full body loaded on invoke | Anthropic/hermes/pi |
| **drift grader** | deterministic-replay drift grader (the zero-cost, CI-runnable merge-block; live GSM8K lm-eval = credentialed-tier aspiration) | SPEC (headroom pattern) |
| **ABI stamp** | SPEC-proposed `{rust_core_version, napi_abi}` tag; mismatch = refuse-load (inherited enforcer = version-semver sentinel; full stamp = SPEC upgrade, [§23 Open Questions](11-invariants-roadmap.md) #6) | mya-v1 #11 / SPEC proposal |
| **DELEGATE_BLOCKED_TOOLS** | hard tool denylist every subagent inherits | hermes |
| **Footprint Ladder** | "how to add capability" ranking (extend → cmd → tool → plugin → MCP → core) | hermes |
| **Mode** | permission-mode enum (`ReadOnly` \| `WorkspaceWrite` \| `DangerFullAccess` \| `Prompt` \| `Allow`) — the [§7](03-tools-permission.md) decision axis. **NOT** a UI filter or approval prompt; it is the policy stance the permission gate resolves against | SPEC (R36) |
| **transport** | overloaded term with three distinct senses: (a) **agent transport mode** — `interactive` (TUI) / `print` (--json) / `rpc` (stdio JSON-RPC) / `sdk` (embedded lib), see [§3 Architecture](00-OVERVIEW.md); (b) **provider wire** — `auto` / `sse` / `websocket`, see [§6 Providers](02-providers.md); (c) **lane liveness** — `transportAlive` flag on a lane, see [§13 Observability](08-observability-security.md). Disambiguate by context | SPEC |
| **subagent vs child** | a **subagent** is the spawned entity (constructed with its own prompt + budget handle at spawn time); a **child** is the runtime role that node plays inside the budget tree. Every child is a subagent, but the converse is not necessarily true — a subagent may run rootless / detached from the budget tree | SPEC (R27-6, R36) |
| **BrainEngine / Page / Chunk / Fact / Take / Trajectory** | Tier-1+ memory vocabulary (R36, [§8 Memory](05-memory.md)): `BrainEngine` orchestrates retrieval; `Page` is a logical doc; `Chunk` is an indexed span; `Fact` is an extracted claim; `Take` is a retrieved unit; `Trajectory` is the per-session event sequence replay | SPEC (R36) |
| **SearchIndex / BigramFilter / FrecencyDB** | Tier-1+ code-nav machinery (R36, [§11 Code Nav](07-code-channels.md)): `SearchIndex` is the persistent inverted index; `BigramFilter` is the membership prefilter; `FrecencyDB` ranks hits by frequency + recency | SPEC (R36) |
| **ShellResult** | `shell.exec(cmd, opts): Promise<ShellResult>` return shape — `{ stdout, stderr, exitCode, durationMs, timedOut }`. Thin wrapper over `/bin/bash -c` / `$SHELL` (R30, pi model) | SPEC (R29-5) |
| **GreenContract** | the binding that a test/eval gate has actually run and reported green (CI artifact + log). Used to refuse claims of "it works" without an attached contract | SPEC |
| **CancelReason** | typed enum on `cancel()` / `CancelToken`: `UserRequest` / `BudgetExhausted` / `Timeout` / `ParentAbort` / `LaneDead`. Distinguishes user-initiated from policy-initiated cancellations | SPEC |
| **CompressionPolicy** | the declarative selector for which compression pass runs on a given tier boundary (`Identity` \| `Truncate` \| `Cluster` \| `Full`). Bound to `ProviderProfile` so policy changes invalidate the cache-stable tier | SPEC ([§5 Prompt](04-prompt-compression.md)) |
| **TimeHelper** | the single injectable `now(): number` / `monotonic(): number` helper referenced in invariant #10. One canonical implementation per runtime (`natives.time` for Rust, `core.time` for TS); all other call sites go through the helper | SPEC (claw-code) |

---

## Completeness (R35) — ponytail harness-integration patterns

> Folded from [ponytail](../../ponytail/) (⚠️ NOT a token counter — it's a YAGNI prompt-injection plugin; but its **harness-integration patterns** are valuable for §21 budget + §5 compression).

| Pattern | 1-line | Source |
|---|---|---|
| **Subagent ruleset re-injection** | ponytail re-injects its mode ruleset (`getPonytailInstructions(mode)`) into every spawned subagent via SubagentStart / `before_agent_start` hook (parent-only SessionStart never reaches children); gate by `agent_type` regex. **SPEC adaptation:** same mechanism to re-inject `BudgetConfig` into every budget-tree child | [ponytail hooks/ponytail-subagent.js](../../ponytail/hooks/ponytail-subagent.js) · [ponytail-instructions.js](../../ponytail/hooks/ponytail-instructions.js) |
| **Mode flag-file → statusline** | ponytail writes `~/.claude/.ponytail-active` flag-file → shell statusline paints `[PONYTAIL]` (green) or `[PONYTAIL:ULTRA]` (amber for lite/full/ultra mode); cheap, host-agnostic. **SPEC adaptation (aspiration):** same pattern for `BudgetConfig` tiers — `[BUDGET:OK]`/`[BUDGET:WARN]`/`[BUDGET:ABORT]` is a SPEC design, NOT what ponytail ships | [ponytail hooks/ponytail-statusline.sh](../../ponytail/hooks/ponytail-statusline.sh) |
| **Never-block hook contract** | every hook has `setTimeout(1000).unref()` + `stdin.on('error')` fallback → a stuck hook NEVER freezes the session (issue #443) | [ponytail hooks/ponytail-mode-tracker.js](../../ponytail/hooks/ponytail-mode-tracker.js) |
| **Provider-telemetry, not estimation** | consume `usage`/`cost` from the provider API directly; split `cache_read_input_tokens` + `cache_creation_input_tokens` from raw `prompt_tokens` so prompt-cache ROI is auditable | [ponytail benchmarks/agentic/run.py](../../ponytail/benchmarks/agentic/run.py) |
| **Comment-as-debt-ledger** | ponytail harvests `(#|//) ?ponytail:` source-comment markers (each names a deferred shortcut + ceiling + upgrade trigger) via `grep -rnE`; tags `no-trigger` rows as rot risks. **SPEC adaptation (aspiration):** mirror with a SPEC-internal `# spec-budget:` marker convention for §5 compression deferrals — this marker does NOT exist in ponytail | [ponytail skills/ponytail-debt/SKILL.md](../../ponytail/skills/ponytail-debt/SKILL.md) |
| **XDG + Windows config cascade** | `XDG_CONFIG_HOME → ~/.config/... → %APPDATA%\...` for BudgetConfig storage; BOM-tolerant JSON.parse for Windows | [ponytail hooks/ponytail-config.js](../../ponytail/hooks/ponytail-config.js) |
| **Honesty fence** | never print a per-session savings number the baseline doesn't support (ponytail's rule for benchmark claims; applies to SPEC dashboard cost display) | [ponytail skills/ponytail-gain/SKILL.md](../../ponytail/skills/ponytail-gain/SKILL.md) |

> **⚠️ Honesty note:** ponytail is NOT a token-counting or budget-enforcement tool. It has NO tiktoken, NO estimator, NO USD calculator, NO budget tree. It is a YAGNI prompt-injection plugin. The patterns above are its **harness-integration mechanics** (how it hooks into agent loops across 20+ harnesses), NOT token-management logic. The SPEC's §21 BudgetConfig (tree-accounting, spend/deriveChild) remains the authoritative budget design; ponytail contributes the integration patterns (subagent re-injection, statusline, never-block hook, provider-telemetry split).
