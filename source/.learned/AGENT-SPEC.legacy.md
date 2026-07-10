# AGENT-SPEC — Unified Autonomous/Coding Agent (founding spec)

> **Capstone** of the 12-source learning loop (2026-07-10). Synthesizes the best architecture, subsystem, and discipline decisions from **12 reference projects** into one coherent agent design. Quality-optimal; effort explicitly ignored per directive. Source attributions are inline so every decision is traceable.
>
> Working name: **Unified Agent** (rename freely). Predecessor: `mya-v1` (archived at `source/mya-v1/`).

## Sources synthesized (12)
| # | Source | Lang | ⭐ | Primary contribution to this SPEC |
|---|---|---|---|---|
| 1 | openclaw | TS | 382K | tool-call repair, gateway-protocol/net-policy split, supply-chain age-gate |
| 2 | hermes-agent | Py | 212K | 3-tier cache-stable prompt, ProviderProfile, skill curator, lazy-deps, memory manager, hook registry |
| 3 | claw-code | Rust | 194K | typed FSMs, LaneBoard, structured lifecycle errors, Trident compaction, permission model, mock parity, lean binary |
| 4 | headroom | Rust/Py | 58K | content-aware compression, byte-faithful JSON, parity-test crate |
| 5 | openhuman | Rust | 34K | memory roles (archivist/tree/diff/goals), codegraph, council, Rhai scripting, plan_review |
| 6 | OpenViking | Py | 26K | ragfs unified context FS (architecture only — **AGPL, clean-room**) |
| 7 | pi-coding-agent | TS | 69K | **minimal core + package ecosystem**, 4 integration modes, versioned session format (JSONL, v1→v3) |
| 8 | oh-my-pi | TS+Rust | 17K | **TS-loop + Rust-natives hybrid**, worktree subagents, hashline edits, code-exec bridge, advisor model |
| 9 | MyAgents | TS+Rust | 0.8K | pit-of-success clippy wrappers, sandbox patterns |
| 10 | harness | catalog | 8.3K | 6 multi-agent topology vocabulary |
| 11 | Awesome-…-Papers | catalog | — | research-validated frontier (shared state, convergence) |
| 12 | mya-v1 (self) | Rust | — | trait-driven multi-crate workspace, channels, hardware, gateway |

---

## 1. Vision & Design Tenets

A **general-purpose autonomous + coding agent** that is: production-grade, long-term-maintainable, fast, safe, and infinitely extensible without forking. Built once, extended by packages.

**Tenets (synthesized, with source):**
1. **Minimal stable core, maximal package edge.** *(pi)* The core is tiny and frozen; every capability (subagents, plan mode, channels, memory backends) is an installable package. Composition over compilation.
2. **TS conductor, Rust engine.** *(oh-my-pi)* Agent loop, tools, extensions, UI in TypeScript (iteration speed + npm + AI-SDK-first). Perf/safety-critical paths (search, shell, AST, crypto, sandbox, compression) in Rust, bound via napi-rs.
3. **Typed state machines everywhere; events over scraped prose.** *(claw-code)* Every lifecycle is a tagged enum; observers pattern-match on data, never parse logs.
4. **The prompt cache is sacred.** *(hermes-agent)* System prompt built once per session; it rebuilds only at **tier boundaries** (compression / provider-or-profile swap / skill-write). All other mid-conversation mutation is banned. *(R25-16: the boundary set is wider than compression alone — see §5.)*
5. **Pit of success.** *(MyAgents)* The wrong thing doesn't compile; one canonical helper per concern, enforced by lints.
6. **Recovery before escalation; partial success is first-class.** *(claw-code)* Known failures auto-heal once; components report `Healthy | Degraded | Failed`, never just "up/down".
7. **One core, many transports.** *(pi)* Interactive TUI / one-shot print+JSON / RPC over stdio / embeddable SDK share one core.
8. **Security as architecture, not a feature.** *(openhuman + hermes-agent + claw-code)* Prompt-injection scan, per-surface audit, sandboxed in-process shell, content-addressed edits, byte-stable signing.

---

## 2. Language Stack Decision (the explicit ask)

**Verdict: Hybrid — TypeScript (loop/extension/UI) + Rust (perf/safety natives via napi-rs).** Not pure Rust (mya-v1 lesson: 16-min compiles, slow iteration, AI SDKs land late), not pure TS (openclaw lesson: event-loop stalls, message-loss bugs at scale), not Python (hermes lesson: 27K open issues / 12.8% issue-star ratio — worst maintainability).

**Evidence table** *(issue/star ratio = maintainability proxy; verified live 2026-07-10)*:
| Stack | Exemplar | Issue/⭐ | Lesson |
|---|---|---|---|
| Pure TS (minimal core) | **pi (69K)** | **0.08%** | a *minimal* TS core is as maintainable as the best Rust — a small frozen surface beats language choice |
| Pure TS (maximalist) | openclaw (382K) | 1.6% | huge community, but event-loop stall + message-loss bugs at scale |
| Pure Python | hermes (212K) | **12.8%** | ML-first ecosystem, but drowns in issues at scale |
| Pure Rust | claw-code (194K) | **0.01%** | best maintainability, community *rejects* Python rewrite; but slow compile |
| TS+Rust maximalist | oh-my-pi (17K) | 3.9% | validates the Rust-natives layer, but maximalist features raise the ratio — warns against bloat |

**Key insight:** maintainability tracks **minimal-core discipline** more than language — pi (pure TS) matches claw-code (pure Rust). The hybrid choice is therefore justified on **perf + safety + ecosystem-velocity**, *not* on a maintainability claim. The SPEC's own tenet #1 (minimal core) is the real quality driver; the TS+Rust split is an *engineering* optimization layered on top.

**Division of labor:**
| Concern | Language | Why |
|---|---|---|
| Agent loop, turn lifecycle, orchestration | **TS** | iteration speed, async ergonomics |
| Tool definitions, dispatch, schemas (Zod) | **TS** | rapid tool authoring |
| Extensions/Skills/Prompt-Templates/Themes (packages) | **TS** | package ecosystem |
| Provider adapters, streaming | **TS** | AI SDKs land here first |
| UI: TUI (Ink/React), CLI, web dashboard | **TS** | React/Vite ecosystem |
| File search (glob/grep/ripgrep), FS walk | **Rust** (napi) | perf on large repos |
| Sandboxed in-process shell (vendored brush + uutils) | **Rust** | security, determinism, Windows parity |
| AST / tree-sitter parsing, content-hash edits | **Rust** | correctness, no GC pauses |
| Compression hot path, byte-faithful JSON | **Rust** | token-cut throughput, signing determinism |
| Crypto, audit (Merkle), sandbox enforcers | **Rust** | memory safety on trust boundary |

**When to put something in Rust (not TS) — a strict gate:** only if it satisfies ≥1 of: (a) **trust boundary** (sandbox, crypto, audit, path validation, env sanitization) — safety demands memory-safety + no GC; (b) **hot inner loop** (search over 100k+ files, AST parse, compression) — perf dominates; (c) **determinism** (byte-faithful JSON, signing); (d) **platform parity** (POSIX shell + coreutils for Windows determinism) — justified only when no cross-platform TS equivalent exists and the surface is vendored+frozen. Everything else stays in TS — moving code to Rust "for speed" without one of these just adds a napi serialization tax and a compile bottleneck. *(Audit §3's crate list against the 4-gate table (C9/R28): `natives`(crypto/ast/fs)=trust-boundary/a+c, `shell`=trust/a, `search`=hot-loop/b, `ast`=hot-loop/b, `compress`=hot-loop/b, `sandbox`=trust/a — dropped `pi-iso`, an oh-my-pi concept NOT in this workspace; crypto is part of `natives`.)*)

> The Rust core ships as a prebuilt `napi` binary per platform (like oh-my-pi's `pi-natives`), so **package authors never compile Rust** — they consume it as a fast native module from TS.

---

## 3. Architecture (workspace map)

```
agent/                        # monorepo (TS workspaces + Rust workspace)
├── packages/                 # TypeScript (Bun/Node)
│   ├── core/                 # THE minimal core: loop, session, FSM, config, RPC, SDK
│   ├── ai/                   # provider abstraction + ProviderProfile registry
│   ├── extensions/           # tool host + built-in tool set (calls Rust natives)
│   ├── prompts/              # 3-tier prompt assembler + injection scanner
│   ├── memory/               # MemoryManager + role adapters
│   ├── skills/               # provenance + curator + progressive disclosure
│   ├── subagents/            # worktree isolation + typed results + topologies
│   ├── channels/             # multi-platform gateway adapters (packages)
│   ├── gateway/              # HTTP/WS gateway + dashboard
│   ├── tui/ cli/ sdk/ rpc/   # the 4 transport modes — interactive (TUI) · print (--json flag) · rpc (stdio JSON-RPC) · sdk (embedded lib)
│   └── eval/                 # mock parity + drift grader harness
├── crates/                   # Rust (napi → TS) — the engine
│   ├── natives/              # napi bridge: search, fs, ast, shell, edit-hash, crypto
│   ├── shell/                # vendored brush (POSIX shell) + uutils coreutils
│   ├── search/               # glob + grep (ripgrep-class)
│   ├── ast/                  # tree-sitter parse + content-hash edit engine
│   ├── compress/             # content-aware compression (Apache-2.0 algo, parity-tested)
│   └── sandbox/              # OS sandbox enforcers (seccomp/seatbelt/AppContainer)
├── docs/  examples/  test/  Dockerfile  Cargo.toml  package.json
```

**Layering rule (enforced by a workspace lint):** `core` depends on nothing in `packages/*` except the `{ai, extensions, memory, prompts}` *interface* packages + `natives`; `crates/*` expose only napi functions to `natives`; transports (`tui/cli/sdk/rpc`) depend on `core`, never the reverse. *(import-direction-acyclic — madge/ESLint-enforced; core has no upward imports; SSOT-preserving.)*

**Buildability & boundary contract (round 9):**
- **napi boundary contract (R25-21):** values crossing TS↔Rust are `serde`-serializable values + `Buffer` + **napi `Class` handles for stateful sessions** (Shell/Pty/Process — mutation via methods returning owned results; no interior-mutable fields exposed to JS) + `ThreadsafeFunction<T>` for streaming, where `T` is a generated napi object; `Unknown<'env>` permitted only for JS-owned cancellation signals. No raw `*mut`/`Arc<Mutex<_>>` crosses dlopen. Keeps the boundary debuggable + the Rust core independently testable.
- **Streaming backpressure (R25-22):** streaming callbacks use an explicit policy — **lossless streams** (tool-call repair, edit-hash) use `ThreadsafeFunction::Blocking` OR a sequence-numbered `StreamChunk{seq,payload}` the TS side NACKs on gaps; **lossy streams** (TUI render) may use `NonBlocking`. State per-stream which.
- **ABI stamp honesty (R25-23):** the reference (oh-my-pi) uses a **version-semver sentinel** (`__piNativesV{semver}` symbol) that refuses mismatched-release binaries. A full `{rust_core_version, napi_abi}` **ABI stamp is a SPEC-proposed upgrade**, not inherited — see §23 open question #6. *(mya-v1 #11 AbiStamp = SPEC proposal.)*
- **Natives release (R25-24):** natives are **independently versionable from core** (separate semver); a natives patch follows the `<patch>` channel and is auto-promoted without a core release. CI matrix = N platforms × M variants (N≈5, x64 ships modern+baseline).
- **Compilation boundary:** Rust changes = napi rebuild + stamp bump (a release concern, not a package-author concern). CI builds the {OS×arch} matrix once per release; `cargo` is never invoked by users or packages.
- **Cycle detection:** a workspace `madge`/ESLint rule fails the build on any import cycle through `core`; foundation crates (config/log/api/spawn) may not depend upward.

---

## 4. Core Agent Loop & Turn Lifecycle

**Typed FSM per turn** *(claw-code `PluginState`, `TaskStatus`, `McpLifecyclePhase`)* — `#[serde(tag="state")]`-style (on `PluginState`; `TaskStatus`/`McpLifecyclePhase` use `rename_all` only) (TS: discriminated union):
```
TurnState = Pending → Streaming → ToolCalls → AwaitingApproval → ToolExec → Aggregating →
            { Completed | Recoverable{retries} | Failed{phase,context,retries} | Cancelled }
```
- Every failure carries `phase + recoverable: boolean + context: Record<string,string> + retries: number` (values are always String). Observers pattern-match; recovery is **bounded `max_retries` (default 3)** — recoverable errors resume up to the cap, then escalate to `Failed`. *(claw-code `McpErrorSurface`; R25-6 reconciles the unlimited-vs-once contradiction — bounded is chosen.)*
- **Partial success is first-class (round 24 — VERIFIED, claw-code `plugin_lifecycle.rs`):** aggregate per-server `ServerHealth { status: Healthy|Degraded|Failed, capabilities, last_error }` → `PluginState` via `from_servers()`: no servers ⇒ `Failed`; no failed/degraded ⇒ `Healthy`; no usable servers ⇒ `Failed`; else `Degraded { healthy_servers, failed_servers }`. **Nuance: a `Degraded` server stays USABLE (kept in `healthy_servers`) — only `Failed` servers are excluded.** `DegradedMode { available_tools, unavailable_tools, reason }` exposes which tools survived — the actionable part for the loop. `startup_event()`/`is_startup_terminal()` map the 8 lifecycle states (`Unconfigured…Stopped`) onto the 3 terminal startup outcomes (`StartupHealthy|StartupDegraded|StartupFailed`) so observers pattern-match on data. *(claw-code `PluginState`/`PluginLifecycle` trait: validate_config/healthcheck/discover/shutdown.)*
- **LaneBoard liveness aggregator:** subagents + cron + channel listeners emit `{observed_at, transport_alive, status}` → board classifies each as `Healthy | Stalled | TransportDead | Unknown`. One place to ask "who's stuck". *(claw-code `LaneBoard`.)*

**Concrete core types (round 5 — discriminated unions, not prose):**
```ts
// Pending/Aggregating are internal-only (not emitted to observers) — they exist as
// turn-internal scheduling states, not observable TurnEvent variants; emitting them
// would leak implementation churn onto the event bus. *(R25-7.)*
type TurnEvent =
  | { state: "Streaming";  chunk: StreamChunk }
  | { state: "ToolCalls";  calls: ToolCall[] }
  | { state: "AwaitingApproval"; call: ToolCall; prompt: ApprovalRequest }   // R25-5: hook-Allow→ask-human round-trip is observable (§7 step 4, invariant #13)
  | { state: "ToolExec";    result: ToolResult[] | DegradedResult }
  | { state: "Completed";  usage: TokenUsage; cost: Cost }
  | { state: "Recoverable"; error: LifecycleError }                          // R25-6: recoverable error variant (bounded retries)
  | { state: "Failed";     error: LifecycleError }
  | { state: "Cancelled";  reason: string };

type LifecycleError = {
  // canonical phase vocabulary (referenced from §6 fallback skip rule); auth/quota added (R25-9);
  // subagent/validation added (R27-10), resource added (R27-20)
  phase: "stream" | "tool" | "provider" | "auth" | "quota" | "sandbox" | "memory"
        | "subagent" | "validation" | "resource";
  recoverable: boolean;
  retries: number;                            // R25-6: bounded retry count
  context: Record<string, string>;
  partial?: unknown;                          // R27-10: raw invalid yield for salvage (validation phase)
  cause?: unknown;
};
```

**Core primitives (round 25 — defined ONCE; referenced by the turn loop, §6, §7, §13):**
```ts
type StreamChunk = StreamEvent;                         // §6
interface ToolCall { id: string; name: string; args: unknown }
interface ToolResult { callId: string; ok: boolean; output: unknown; error?: string; degraded?: boolean }
type DegradedResult = { results: ToolResult[]; failedCallIds: string[] }
interface TokenUsage { input: number; output: number; cacheRead?: number }
type Cost = { usd: number }
interface TurnContext { session: Session; history: History; budget: BudgetConfig; approval: ApprovalChannel; emit: (te: TurnEvent) => void }
type ApprovalChannel = { request(r: ApprovalRequest): Promise<ApprovalDecision> }
interface PermissionContext { override?: "Deny"|"Ask"|"Allow"; tool: string; args: unknown; activeMode: Mode; requiredMode: Mode }
type PermissionDecision = PermissionOutcome;                  // §13 uses PermissionDecision, §7 defines PermissionOutcome
type LifecycleState = TurnState;                              // §13 referenced these undefined
type LaneId = string /* == taskId */;
type LaneStatus = "running"|"idle"|"done"|"failed"|"blocked";
```

**Complete type glossary (round 26 — every referenced name, defined ONCE):**
*(Resolves the ~18 types + 7 helper functions the turn loop and §6/§7/§8/§13/§15/§17/§21 reference but never defined — R26-A; BB-2/BB-3/M-8/M-11/M-12/M-14/M-16/M-17/m-19/m-20/m-26.)*
```ts
// --- Permission (§7) ---
type Mode = "ReadOnly" | "WorkspaceWrite" | "DangerFullAccess" | "Prompt" | "Allow";
const MODE_RANK: Record<Mode, number> = { ReadOnly:0, Prompt:1, WorkspaceWrite:2, DangerFullAccess:3, Allow:4 }; // §7 step-5 "active ≥ required" uses this ordering
type PermissionOutcome = { outcome: "Allow" } | { outcome: "Deny"; reason: string };
interface ApprovalRequest { call: ToolCall; reason: string; currentMode: Mode; requiredMode: Mode }
type ApprovalDecision = { decision: "Allow" } | { decision: "Deny"; reason: string };
// --- Session / prompt (§5) ---
interface SystemPrompt { stable: string; context: string; volatile: string }
interface Session { profiles: ProviderProfile[]; stableTier: string; ctxFiles: string[]; memory: MemoryManager; userMd: string; prompt?: SystemPrompt; history: History; skillSetDirty: boolean }
interface History { append(entry: unknown): void }
// --- Memory (§8) ---
// R27-4: MemoryRole (interface, lifecycle role) is defined in §8; this is the role IDENTIFIER (string).
type MemoryRoleId = "archivist" | "tree" | "diff" | "goals" | "sync" | "working";
interface MemoryQuery { text: string; role?: MemoryRoleId; topK?: number }
interface MemoryHit { id: string; role: MemoryRoleId; content: string; score: number }
interface MemoryEntry { role: MemoryRoleId; content: string; metadata?: Record<string,string> }
interface MemorySnapshot { entries: MemoryHit[]; generatedDay: number }   // day-precision (R25-15)
interface ContextSource { scheme: string; list(q: MemoryQuery): Promise<MemoryHit[]>; read(uri: string): Promise<string>; grep(pattern: string): Promise<MemoryHit[]> }
// --- Observability (§13) ---
type ComponentId = string;
type ComponentHealth = "Healthy" | "Degraded" | "Failed";
// --- Subagents (§10) ---
type ToolSet = { allowed: string[]; blocked: string[] };
type JSONSchema = import("ajv").JSONSchemaType<unknown>;   // Draft-07; JTD normalized to this (§10)
// --- Compression / eval (§5/§15) ---
interface Compressor { compress(history: unknown[]): unknown[]; ratio(): number }   // Tier-0 interface stub; impls are Tier-1
interface LlmTrace { messages: unknown[]; responses: string[] }
interface MockResponse { id: string; body: unknown }
interface BehaviorStep { kind: "tool_call" | "state"; expect: unknown }
// --- Budget (§21) ---
// R27-6: tree-accounting. `spend` is REQUIRED (not optional); every node shares ONE atomic
//   root `spent`; `remaining()`/`exhausted()` evaluate against the ROOT total atomically.
//   `deriveChild(alloc)` atomically reserves min(alloc, remaining) and pre-charges; unused delta
//   refunded on child completion. child.unlimited = parent.unlimited && requested (type-derived)
//   so a limited parent can NEVER spawn an unlimited child.
//   CC2 (orphaned budget on child crash): "completion" = ANY terminal state (Completed|Failed|Cancelled);
//     the SubagentRunner completion handler ALWAYS computes refund = alloc - child.spent and credits
//     root — crashed children (§14b) refund too, so a child death never orphans its pre-charge.
//   CC13 (concurrent-turn overspend): `spend` uses an atomic compare-and-swap that REJECTS a spend
//     breaching `abortThreshold` (returns false / surfaces BudgetExhausted); each turn may instead
//     `deriveChild` its own slice. Bounds concurrent-turn overspend against the shared root.
interface BudgetConfig {
  total: number; warningThreshold: number; abortThreshold: number; unlimited: boolean;
  parent?: BudgetConfig;                         // root has none
  remaining(): number;                           // against ROOT total, atomically
  spend(c: Cost): boolean;                       // CC13: atomic CAS — REQUIRED; rejects a spend breaching abortThreshold (returns false)
  deriveChild(alloc: number): BudgetConfig;      // atomically reserves min(alloc, remaining); pre-charge (CC10: locks the PARENT node only)
  releasePrecharge(childId: string): number;     // CC2: refund alloc - child.spent to root on ANY terminal state (incl. crash); returns credited delta
  exhausted(): boolean;                           // remaining() <= 0 (evaluated against root)
  diskBytes?: number; heapBytes?: number;         // R27-12/R27-20: resource budget (ResourceBudget)
}
// --- Extensions (§17) ---
interface ExtensionAPI { registerTool(t: unknown): void; on(e: string, h: (...a: unknown[]) => void): void; /* deliberately limited — no fs/net/child_process */ }
// --- Turn-loop helper signatures (§4) --- (R27-1 widened returns)
// streamWithFallback: tries ProviderProfile[] in order; SKIPS auth/quota-tainted ones; widens its
//   return to carry the surviving profile + partial cost (D7 attribution). finish:"length" runs a
//   compression pass (§5) BEFORE retrying. Partial-stream cost of a USER-UNINITIATED fallback is
//   refunded (not billed). All-profiles-tainted => AllProvidersDegraded (not generic Failed).
//   CC8 (encapsulation invariant): streamWithFallback COLLECTS stream events into its return value
//   (`events: StreamEvent[]`) — streaming callbacks NEVER emit directly to the RuntimeEvent bus;
//   ONLY the turn loop's emit() feeds observers. This prevents ghost events from a failed/abandoned
//   profile (a tainted profile's partial stream is never observed).
declare function streamWithFallback(
  profiles: ProviderProfile[], prompt: SystemPrompt, history: History
): Promise<
  | { kind: "ok"; profile: ProviderProfile; events: StreamEvent[]; partialCost?: Cost }
  | { kind: "error"; error: LifecycleError }
>;
declare function computeCost(u: TokenUsage): Cost;
// repair() returns the repaired call OR a typed unrepairable (R27-1/GAP-9): an unrepairable call
//   is fed back to the model as a synthetic ToolResult{ok:false,error:"malformed tool_call"}.
declare function repair(call: ToolCall): { ok: ToolCall } | { unrepairable: true; reason: string };
// aggregate() returns the full ToolResult[] when all ok, else DegradedResult naming failedCallIds (R27-1/D6).
declare function aggregate(results: ToolResult[]): ToolResult[] | DegradedResult;
declare function toolTurn(calls: ToolCall[], results: ToolResult[]): unknown;
declare const budgetError: LifecycleError;
// --- Cross-cutting result types referenced from §8/§14/§14b/§17/§21 (R27-1/R27-6/R27-12/R27-18/R27-20) ---
// ResourceBudget (R27-20): disk + heap caps, surfaced on BudgetConfig.
interface ResourceBudget { diskBytes: number; heapBytes: number }
// Durability (R27-18): per-backend write durability class.
type Durability = "BestEffort" | "Durable" | "DurableWithWal";
// WriteResult (R27-18/R27-20): MemoryBackend.write return.
type WriteResult = { Ok: true } | { Durable: true } | { Spilled: { pendingCount: number } } | { ResourceExhausted: true };
// DrainReport (R27-18): syncAll return — lost writes journaled for crash-recovery replay.
interface DrainReport { completed: number; timedOut: number; lostWrites: MemoryEntry[] }
// NativeResult (R27-12): every napi entry returns a typed result; panics never kill the process.
type NativeResult<T> = { Ok: T } | { Panic: { backtrace: string } };

declare function requiresApproval(c: ToolCall, ctx: TurnContext): PermissionDecision;   // CC6: runs the FULL 7-step authorize pipeline ONCE (incl. human prompt for ask-rules) and returns the cached decision; runTool/authorize REUSE it (no double eval)
declare function compressHistory(history: History): void;   // VM1: §5 compression pass (called on finish:"length"); may throw ResourceExhausted → Recoverable{phase:"resource"} (CC12)
const MAX_ATTEMPTS = 3;                                                          // C10: total attempts INCL. the first try (so 2 retries); renamed from the old stream-retry cap
```
*After this glossary the §4 turn-loop pseudocode type-checks: `profiles`, `stream.kind/events`, `computeCost`, `repair`, `aggregate`, `toolTurn`, `budgetError` all resolve. `ProviderProfile` (§6), `MemoryManager` (§8), and `StreamEvent` (§6) are defined once in their home sections and referenced here. R27-1 widens `streamWithFallback`/`repair`/`aggregate` returns; R27-6/R27-20 add `BudgetConfig` tree-accounting + `ResourceBudget`; R27-12 adds `NativeResult`; R27-18 adds `DrainReport`/`WriteResult`/`Durability`.*

**The turn loop (round 25 — the heart, in pseudocode):**
```ts
async function runTurn(ctx: TurnContext): Promise<TurnEvent> {
  // ctx.emit(te) wraps te into {kind:"turn";e:te} on the RuntimeEvent bus (§13) (R25-4e).
  // finish() emits + returns a terminal TurnEvent (Failed/Completed/Recoverable).
  const emit = ctx.emit;
  const finish = (te: TurnEvent): TurnEvent => { emit(te); return te; };

  // R27-3: skill-write rebuild. The curator (auxiliary provider) writes ONLY to the skill store
  //   + sets skillSetDirty on shared SESSION STATE (never the prompt — invariant #8 intact).
  //   The MAIN LOOP checks skillSetDirty INSIDE the while-loop (CC9: before prompt memoization,
  //   not once at runTurn top — closes the TOCTOU where a skill write lands between a top-of-runTurn
  //   check and the first assembly); if set, it rebuilds the stable tier ONLY
  //   (identity/tools/skills-index), clears the flag, and preserves the stable⊕context prefix cache
  //   up to that point.

  // loop until a turn produces no tool calls (R27-1/D4: while-loop replaces unbounded recursion).
  //   R27-1/GAP-10: idempotency — on retry, skip ToolCall.ids already in ToolResult[]; side-effecting
  //   tools declare `idempotent` and the loop refuses to retry non-idempotent ones.
  let doneIds = new Set<string>();   // ToolCall.id already executed this runTurn (idempotency guard)
  while (true) {
    // 1. budget gate (§21/R27-6) — abort before spending (remaining() evaluates against the ROOT).
    if (ctx.budget.exhausted()) return finish({ state: "Failed", error: budgetError });
    //    CC9: skillSetDirty check moved INSIDE the loop (before prompt memoization) — a skill write
    //    that lands mid-turn is seen on the NEXT iteration, never skipped by a stale top-of-runTurn check.
    if (ctx.session.skillSetDirty) rebuildStableTier(ctx.session);  // re-derives `stable` only; clears skillSetDirty; atomically swaps
    // 2. assemble the cache-stable prompt ONCE (rebuilt only at tier boundaries) (§5/R27-16).
    //    R27-23: SystemPrompt is COW-immutable; tier rebuilds are the sole mutators, serialized via PromptMutex.
    const prompt = ctx.session.prompt ??= assemblePrompt(ctx.session);   // memoized per session
    // 3. stream w/ fallback chain + tool-call repair (§6). streamWithFallback tries ProviderProfile[]
    //    in order, SKIPS auth/quota-tainted ones, and returns a tagged
    //    `{kind:"ok"; profile; events; partialCost?} | {kind:"error"; error}` (§6). (R25-4b / R27-1 D7)
    //    D1: the call is AWAITED (the missing await crashed every turn). D3: bounded inner retry wraps
    //    the stream section — `continue` on recoverable, escalate to Failed at the cap. finish:"length"
    //    runs a compression pass (§5) BEFORE retrying.
    let calls: ToolCall[] = [];
    let usage: TokenUsage = { input: 0, output: 0 };   // D10: defaulted (never uninitialized)
    let cost: Cost = { usd: 0 };                       // D10: defaulted
    for (let retries = 0; retries < MAX_ATTEMPTS; retries++) {            // C10: MAX_ATTEMPTS = total attempts incl. first try (so 2 retries)
      const stream = await streamWithFallback(ctx.session.profiles, prompt, ctx.history); // D1: AWAIT
      if (stream.kind === "error") {
        // R27-1/D3: recoverable → continue (retry next profile); non-recoverable/all-tainted → Failed.
        if (!stream.error.recoverable) return finish({ state: "Failed", error: stream.error });
        if (retries === MAX_ATTEMPTS - 1) return finish({ state: "Failed", error: stream.error }); // cap → escalate
        continue;                                       // recoverable: bounded retry of the stream section
      }
      // (partialCost of a user-UNINITIATED fallback is refunded — not billed: R27-1/GAP-2)
      // CC1: lengthHit tracks finish:"length" so the for-retries loop RE-ENTERS (the old `break` here
      //   wrongly exited the retry loop, so the compressed-history retry NEVER ran). `break` now fires
      //   ONLY on a successful (non-length) stream.
      let lengthHit = false;                            // CC1: set on finish:"length"; checked after the for-each
      for (const ev of stream.events) {
        if (ev.kind === "text" || ev.kind === "tool_call")
          emit({ state: "Streaming", chunk: ev });                // typed event (§13)
        if (ev.kind === "usage") { usage = ev.usage; cost = computeCost(usage); } // R25-4a — BEFORE done-returns (D10)
        if (ev.kind === "tool_call") {
          const r = repair(ev.call);                 // R27-1: repair() returns {ok} | {unrepairable}
          if ("ok" in r) calls.push(r.ok);
          else {                                       // GAP-9: unrepairable → synthetic ToolResult fed back
            calls.push(ev.call);                      // keep the id so the model sees the failure
            ctx.history.append(toolTurn([ev.call],
              [{ callId: ev.call.id, ok: false, output: null, error: "malformed tool_call" }]));
          }
        }
        if (ev.kind === "done") {                                 // R25-4c: branch on finish
          if (ev.finish === "error")
            return finish({ state: "Failed", error: { phase: "provider", recoverable: false, retries: 0, context: {} } });
          if (ev.finish === "length") {                            // couple §5: compress BEFORE retrying
            try {                                                  // CC12: ResourceExhausted → Recoverable{phase:"resource"}
              compressHistory(ctx.history);                        // run the compression pass (§5), then re-enter below
            } catch (e) {
              return finish({ state: "Recoverable",
                error: { phase: "resource", recoverable: true, retries, context: { cause: String(e) } } });
            }
            lengthHit = true;                                      // CC1: flag set; do NOT break — fall through
          }
        }
      }
      if (lengthHit) continue;                                   // CC1: finish:"length" → re-enter the retry loop (compressed history)
      break;                                                     // successful (non-length) stream section: exit retry loop
    }
    // no tool calls → Completed. R27-1/D2 + GAP-12: spend() called on the Completed path (dead budget gate fixed).
    if (calls.length === 0) {
      ctx.budget.spend(cost);                                    // REQUIRED spend (R27-6) on the Completed path (CC13: atomic CAS; a breach-reject surfaces BudgetExhausted — terminal here)
      return finish({ state: "Completed", usage, cost });
    }
    // 4. execute tools under the 7-step permission pipeline (§7); partial-success ok.
    //    R27-1/GAP-10 idempotency: skip ToolCall.ids already executed this runTurn (dedupe re-emitted
    //    calls); side-effecting tools declare `idempotent` and the loop refuses to RETRY non-idempotent ones.
    //    CC6 (double-eval fix): each call's full PermissionDecision is computed ONCE by requiresApproval
    //    (the 7-step pipeline, including the human prompt for ask-rules, runs once); runTool/authorize
    //    REUSE the cached decision — authorize is NEVER re-invoked inside runTool.
    //    CC5 (false-kill race): before any human prompt, blockedOn:"approval" is set on the heartbeat
    //    ATOMICICALLY BEFORE the AwaitingApproval emit (equivalently the heartbeat reads TurnState
    //    directly) — so an approval-pending lane is never misclassified Stalled and reaped.
    //    CC11 (interleaved launch): ask-tools (which block on human input) launch CONCURRENTLY with the
    //    non-ask batch rather than after it; R26-D human-prompt serialization is preserved by the
    //    ApprovalChannel surfacing ONE prompt at a time, so non-ask latency no longer gates the human.
    //    A Deny does not cancel siblings (each tool decides independently). runTool emits
    //    {kind:"tool";decision;result} per call (no throw on Deny — typed ToolResult). (R25-4d)
    const fresh = calls.filter(c => !doneIds.has(c.id));            // GAP-10: skip already-executed ids
    const decisions = new Map(fresh.map(c => [c.id, requiresApproval(c, ctx)]));  // CC6: evaluate once, cache full decision
    const results: ToolResult[] = await Promise.all(fresh.map(c => runTool(c, decisions.get(c.id)!, ctx)));  // CC11: concurrent launch (ask-tools block on human in parallel)
    // R27-1/D6: aggregate() returns the full ToolResult[] when all ok, else DegradedResult naming
    //   failedCallIds (the dead branch + misreported-success bugs are fixed). TurnEvent.ToolExec.result
    //   is already ToolResult[] | DegradedResult — consistent.
    emit({ state: "ToolExec", result: aggregate(results) });
    // record executed ids for the idempotency guard (GAP-10)
    for (const c of fresh) doneIds.add(c.id);
    // 5. append results to history; loop back for the next provider turn (while-loop, not recursion).
    ctx.history.append(toolTurn(calls, results));
    ctx.budget.spend(cost);                                      // D2/GAP-12: spend BEFORE each loop continuation (CC13: atomic CAS; a breach-reject is caught by the next-iteration budget gate)
    // (loop continues; budget is re-checked at the top of the next iteration)
  }
}
// Recovery is bounded MAX_ATTEMPTS=3 around the stream section (§4, R25-6 / R27-1 D3); the outer loop is
// a while-loop (unbounded recursion removed — D4). Every step emits a typed RuntimeEvent (§13);
// failures carry LifecycleError. Budget is tree-accounted (R27-6): every node shares one atomic root.
```

---

## 5. Prompt System (cache-stable 3-tier + compression)

**Three-tier system prompt**, joined ONCE per session, rebuilt only at **tier boundaries** (compression / provider-or-profile swap / skill-write — see the “tier rebuild boundaries” note below) *(hermes-agent — the single highest-leverage cache win)*:
```
SystemPrompt = stable (identity, tool/skill guidance, env) 
             ⊕ context (caller msg + discovered context files, injection-scanned)
             ⊕ volatile (memory snapshot, USER.md, timestamp/session/provider line — **day-precision**)
```
- Per-turn user prefix is appended AFTER the cached block — never re-joined into it. *(hermes invariant.)*
- **Discovered-file-set (R27-5):** *the discovered-file-set is re-evaluated ONLY at documented tier boundaries; there is NO continuous file-watcher on the context tier. A mid-session `Write` that creates a context file is invisible to the prompt until the next boundary.*
- **Injection scanner** runs threat-pattern detection on every context file; matches → `[BLOCKED: …]` placeholder that never enters the prompt. *(hermes + openhuman `prompt_injection`.)* **Honesty + scope (R27-15): the scanner is defense-in-depth, NOT a security boundary — the REAL control is privilege separation (untrusted context can NEVER raise `active_mode`; §7/§14).** The 64 KiB truncation is removed (scan a sliding window with overlap); TR#39 confusables detection added. Channel messages (§12) MUST pass through `scanInject` with `scope="context"` before entering history.

**Content-aware compression** — two distinct sources (do not conflate):
  - **headroom (reversible end-to-end, per-type over the history live-zone):** per-type compressors `{SmartCrusher (JSON) / Log / Search / Diff / Text}` applied to the **conversation history live-zone (latest user turn)**. **Lossy on the wire, reversible end-to-end via the CCR side-cache** (originals stored under an MD5 hash key, retrieved on demand). *(headroom 60-95% token cut.)* **(CC3/R28: the CCR store uses a PER-CONTENT-HASH mutex — concurrent compressions targeting the same hash block on the lock, so two turns compressing the same block never tear the side-cache entry or double-write.)**
  - **claw-code Trident (lossy + structural; NOT per-type, NOT reversible):** a 3-stage compaction of the **conversation message log** — **Supersede** (deletes obsolete file ops by path) → **Collapse** (summarizes short chatty exchanges) → **Cluster** (groups messages by tool/path Jaccard similarity → summary); `compression_ratio` reported.
- **Root data-flow fix (R25-13): both compress CONVERSATION HISTORY only — NOT the system prompt's volatile tier.** Live-zone = latest user turn for headroom; message log for Trident. At the compression boundary the volatile tier (memory snapshot) is **re-snapshotted from memory**; the stable/context tiers are NOT re-derived.
- **Tier rebuild boundaries (R25-16): `markCompressed()` rebuilds the volatile tier only (re-snapshot memory). The stable tier rebuilds on a documented finite set of boundaries — compression, provider/profile swap, AND skill-write (curator archive/create) — the skill-write rebuild re-derives only stable (identity/tools/skills-index), preserving the provider prefix cache up to that point. Context files (context tier) are re-scanned only when the discovered-file set changes.**
- **Hard gate (R25-17): compression ships BEHIND a deterministic-replay drift grader** (the zero-cost, CI-runnable merge-block) — replay a golden `LlmTrace` fixture with vs without compression, diff final responses; `baseline = passRate(uncompressed replay on golden set)`, `ε = 0` (zero tolerance). The live GSM8K/TruthfulQA lm-eval is a **credentialed-tier aspiration** (best-effort when `OPENAI_API_KEY` set), NOT a merge-block gate. Headroom's real eval suite (the inspiration) = GSM8K/TruthfulQA via lm-eval + before/after + LLM-as-judge, reporting **4 benchmarks**: GSM8K ±0.000, **TruthfulQA +0.030**, SQuAD 97% (19% compression), BFCL 97% (32% compression). The zero-cost CCR round-trip + tool-schema-compaction checks remain mandatory in-repo gates; the Rust-vs-Python parity-nightly job is `continue-on-error` (Phase 0). *(headroom + mya-eval.)*
- **Byte-faithful JSON** (`preserve_order` + `arbitrary_precision` + `raw_value`) where determinism matters (eval, signing); `raw_value` is load-bearing for byte-range live-zone surgery. *(headroom invariant I1.)*
- **Atomic compression (R27-20):** compression is ATOMIC — write the CCR original BEFORE replacing the live-zone block (write-ahead), so a mid-write ENOSPC leaves history uncompressed, not torn. Pre-compression `worth_compressing` refuses blocks whose CCR-original would exceed disk (against `BudgetConfig.diskBytes`); compression input size is bounded (forward-original above N MB is skipped). A `ResourceExhausted` surfaces as a recoverable `LifecycleError{phase:"resource"}`.

**Concrete 3-tier assembly + drift contract (round 14):**
```ts
// Built ONCE per session; prefix-cached. Rebuild boundaries are TIER-SCOPED (R25-14/R25-16):
//   markCompressed() replaces `volatile` only (re-snapshot memory); the stable tier rebuilds on
//   compression/provider-swap/skill-write; context rescans when the discovered-file set changes.
function assemblePrompt(s: Session): SystemPrompt {
  return { stable:   s.stableTier,             // hash-stable across turns (identity, tools, skills-index)
           context:  scanInject(s.ctxFiles),   // threat-scanned → [BLOCKED] placeholders
           volatile: snapshot(s.memory, s.userMd, today()) }; // re-snapshotted (NOT re-derived) at the compression boundary
}
//   NOTE (R25-15): the volatile timestamp is today()/epochDay() (day-precision by design) —
//   finer granularity invalidates the prefix cache every turn (hermes PR #20451).
//   markCompressed() is a SELECTIVE per-tier mutation (R25-14): it only REPLACES
//   `prompt.volatile` (re-snapshot memory) — it does NOT re-call assemblePrompt()
//   (which would re-scan context files and invalidate the stable⊕context prefix cache).
//   R27-23: SystemPrompt is COW-immutable — markCompressed/rebuildStableTier/rebuildVolatile each
//   build a NEW volatile/stable and atomically swap an Arc<SystemPrompt> (readers always see a
//   consistent snapshot). Tier rebuilds are the SOLE mutators and MUST be serialized via a typed
//   PromptMutex — markCompressed never races a reader (invariant #15). A concurrent-stress test
//   (2 rebuilds + 1 reader) is part of the drift-gate suite.
// DriftGrader contract (deterministic-replay — the zero-cost, CI-runnable merge-block; R25-17):
interface DriftGrader {
  // R27-21: every golden fixture is versioned + tagged; a scheduled job re-records against the LIVE
  //   model and flags drift as a health Degraded. The merge-block gate FAILS if the golden set's
  //   modelVersion is older than maxGoldenAgeDays (forces regeneration). expectedAnswer generation
  //   is pinned to --deterministic + the stored seed.
  golden: { trace: LlmTrace; expectedAnswer: string;
            modelId: string; modelVersion: string; providerProfileHash: string;
            recordedAt: number; goldenSetSchema: "v1" }[];   // recorded LlmTrace fixtures
  grade(c: Compressor): { passRate: number; maxScoreDelta: number };
  // replay a golden trace with vs without compression, diff final responses.
  // baseline = passRate(uncompressed replay on the golden set); ε = 0 (zero tolerance).
  // MERGE BLOCKED unless passRate >= baseline && maxScoreDelta <= ε.
  // live GSM8K/TruthfulQA lm-eval = credentialed-tier ASPIRATION (best-effort when
  // OPENAI_API_KEY set), NOT a merge-block gate.
}
```

- **Tier-0 drift grader stub (R26-F):** the Tier-0 drift grader depends only on the `Compressor` + `LlmTrace` interface stubs (R26-A); concrete compressors are Tier-1 — the grader is shipped with a no-op/identity compressor in Tier 0 and upgraded when Tier-1 compressors land.

---

## 6. Provider Abstraction

**Declarative `ProviderProfile`** *(hermes-agent `providers/base.py`)* — a typed metadata record paired with the provider transport:
```
ProviderProfile = { aliases[], api_mode, base_url, auth_type, env_vars[],
                    supports_vision, fallback_models[], models_url,
                    hooks: { prepare_messages, build_extra_body, fetch_models } }
```
- New provider = register ONE profile (not a 6-file change). Readable by config at build time → setup wizard / `doctor` UX. *(hermes ProviderProfile.)*
- **Tool-call repair pipeline** ahead of dispatch: `stream-normalize → grammar/payload parse → promote` (3 stages; no Zod — validation is against an `allowedToolNames` allowlist). *(openclaw.)* Robust against model malformation. **Repair audit (R27-14): `resolveToolName` is a pure deterministic config-declared mapping (not an arbitrary callback), unit-tested for identical-input-identical-output. A tool-call block embedded in a TOOL RESULT (not an assistant turn) is NEVER promoted (role-gate). Whenever `repaired !== raw` a `RuntimeEvent{kind:"repair"; raw; repaired; resolver}` is emitted and enters the Merkle audit log (§14).**
- **Optional council provider archetype:** fan-out to N models → vote/aggregate for high-stakes turns. *(openhuman `model_council`.)*
- **Auxiliary provider instance** for side tasks (skill curator LLM pass, memory reflection) — NEVER touches the main session's prompt cache. *(hermes + deepdive #02/#05 shared helper.)* **Auxiliary health (R27-22): the auxiliary provider registers as `ComponentHealth` components (`"curator-aux"`, `"memory-reflection-aux"`); a failed `resolve_aux_provider` or failed LLM pass emits `RuntimeEvent{kind:"health";tri:"Degraded"}`. On boot, if `curator.enabled=true` but `auxiliary.curator` is unset/misconfigured → a loud startup WARNING (NOT a silent fallback-to-main, which would violate invariant #8). A LaneBoard lane is registered for the curator.**

**Concrete provider pipeline (round 10):**
```ts
type StreamEvent =
  | { kind: "text";      delta: string }
  | { kind: "tool_call"; call: ToolCall }    // may be partial/malformed → repair
  | { kind: "usage";     usage: TokenUsage }
  | { kind: "done";      finish: "stop"|"length"|"tool"|"error" };
// Fallback chain: ProviderProfile[] tried in order on recoverable error;
//   a provider is SKIPPED (not retried) if its last error phase = "auth"|"quota".
//   R27-1/D7: streamWithFallback widens its return to carry the surviving profile + partial cost;
//   finish:"length" runs a compression pass (§5) BEFORE retrying; a user-UNINITIATED fallback's
//   partial cost is refunded. All-profiles-tainted => AllProvidersDegraded (not generic Failed).
//   A mid-stream cost watermark cancels the stream when cumulative-turn cost > abortThreshold (R27-6).
//   CC8/R28 (encapsulation invariant): streaming callbacks COLLECT into the return value (`events`),
//   NEVER emit directly to the RuntimeEvent bus — only the turn loop's emit() feeds observers; this
//   prevents ghost events from a failed/abandoned profile (a tainted profile's partial stream is unobserved).
// Repair stages applied to each partial tool_call before promotion:
//   stream-normalize → grammar/payload parse → promote (3 stages; no Zod —
//   validation is against an `allowedToolNames` allowlist).
//   R27-14: resolveToolName is a pure deterministic config-declared mapping; repair emits an audit
//   event when repaired !== raw; a tool-call block in a TOOL RESULT is never promoted (role-gate).
// Provider hooks re-scan (R27-17): `prepare_messages` output is re-scanned by `scanInject` before the
//   wire call; secrets redaction (§14) runs AFTER `prepare_messages`, not only in tool Pre-hooks.
```

---

## 7. Tool System

- **Self-registering tool registry** with AST/import discovery + `check_fn`/`is_available(config)` gate so absent tools cost nothing at schema-emission. *(hermes `tools/registry.py`.)*
- **5-mode permission model** *(claw-code `permissions.rs`)*: `ReadOnly | WorkspaceWrite | DangerFullAccess | Prompt | Allow`, layered with per-tool requirements + allow/deny/ask rule lists + hook overrides + an **unconditional `denied_tools` list checked first** (production creds always denied, even in danger mode).
  - **SSOT rule:** `allowed_users`/`denied_tools` resolved on demand via `Arc<RwLock<Config>>` closure — **never cached in tool/channel handles**. *(hermes bug class + AGENTS.md.)*
  - **Permission evaluation order (round 24 — VERIFIED against claw-code `permissions.rs::authorize_with_context`):** first-match-wins, top-down:
    1. **`denied_tools`** (config-level, unconditional — prod creds never run, even in DangerFullAccess)
    2. **deny rules** (pattern-match tool + arg-subject)
    3. **hook override** (`PermissionContext.override`): `Deny`→deny · `Ask`→prompt · `Allow`→falls through **but still respects ask rules** (see invariant #13)
    4. **ask rules** → prompt via `ApprovalChannel` (explicit handle, never parent stdin) — **inviolable**
    5. **allow/mode**: an allow-rule matches, OR (`active_mode is Allow` AND `required_mode !== "DangerFullAccess"`), OR (`active_mode ≥ tool.required_mode` AND `required_mode !== "DangerFullAccess"`) → allow. **(R27-2/D8: `DangerFullAccess` is EXCLUDED from BOTH the `Allow` special-case AND the rank comparison — it ALWAYS escalates to a step-6 prompt. `Allow` = "auto-allow up to WorkspaceWrite; Danger always prompts" — closes the privilege-escalation hole.)**
    6. **escalation prompt**: `Prompt` mode, or a `WorkspaceWrite→DangerFullAccess` gap, or `required_mode === "DangerFullAccess"` (always, even in `Allow`) → prompt. **(R27-2/D9: `Prompt` mode = "prompt for writes only; ReadOnly auto-allowed".)**
    7. else **deny**
    Result: `PermissionOutcome = Allow | Deny { reason }` (NOT `Ask`/`Mutate` — a prompt resolves to Allow/Deny; input-mutation is a separate hook concern). Rule grammar: `tool(subject:*)` (prefix) / `tool(exact)`; arg-subject extracted from JSON keys `command|path|file_path|filePath|notebook_path|notebookPath|url|pattern|code|message` (**10 keys**). All tool/rule names normalized to lowercase. *(claw-code `permissions.rs`, round 24 deep-read.)*
     **CC7/R28 (hook ordering):** hooks in the pipeline are AWAITED before the next step evaluates — async hook results (e.g. a Pre-hook that sets `override` or redacts args) are fully applied before the ask-rule match (step 4) reads them, so a pending hook can never be skipped by a racing rule decision.
  - **Concurrent-approval serialization (R26-D):** tools requiring approval (an `ask` rule matches, or hook `Ask`) execute **SEQUENTIALLY** — pulled OUT of the §4 `Promise.all` batch; each emits `AwaitingApproval` and blocks until `ApprovalChannel.request()` resolves. Non-approval tools run in parallel. A `Deny` does not cancel sibling pending calls (each tool decides independently).
- **Bash validation = composable pure functions** over argv: each guard returns `Allow | Block{reason} | Warn{msg}`; policy composes them. `CommandIntent` classifier (ReadOnly/Write/Destructive/Network/ProcessMgmt/...). *(claw-code `bash_validation.rs` 6 submodules.)*
- **Sandboxed in-process shell** (vendored `brush` POSIX shell + uutils coreutils in Rust) instead of shelling to `/bin/bash` → security, determinism, Windows parity. *(oh-my-pi `pi-shell`.)*
- **Pre/Post/Failure hooks** with the input-mutation + abort-signal + permission-override triad (e.g., "auto-redact secrets in `Write` inputs"). *(claw-code `hooks.rs`.)*
- **Content-addressed edits (hashline):** a **content-addressed tag = BLAKE3, first 16 hex (64-bit minimum)** for file-version binding + line-number anchors. **(R27-13/T4: replaces the old xxHash32/4-hex.) The patcher ALWAYS verifies `snapshot.text === liveContent` (full-text equality) before applying — hashline is an accidental-drift guard; against an adversary it relies on the full-text equality gate, not the tag.** A stale tag rejects the edit → concurrent agents can't silently clobber divergent buffers. *(oh-my-pi `hashline`.)*

---

## 8. Memory (roles + manager + unified context)

Memory is a **flagship subsystem**, not a backend list. *(openhuman + hermes.)*

**Named roles** *(openhuman)* beyond backends:
- `archivist` — **conversation→tree-leaf bridge**: strips tool-call noise from chat turns and appends the cleaned markdown as a single leaf into a memory tree. No curation/decay/promotion (inactivity-triggered, runs on **auxiliary** provider).
- `tree` — hierarchical context.
- `diff` — change tracking over time.
- `goals` — **user goal-list manager** (CRUD + LLM reflection agent maintaining `MEMORY_GOALS.md`); not a retrieval key.
- `sync` — **upstream-source ingestion** pipelines (Composio connectors / workspace file-watch / MCP servers) pulling external data into the memory store; no CRDT/device-replication (see §23 #5).
- `working` — ephemeral per-turn working set (the context the loop assembles for the current turn; not persisted). *(C4/R28.)*

**Single `MemoryManager` integration point** *(hermes)* — the ONLY place the loop touches memory: owns BOTH `MemoryBackend[]` (stores) AND `MemoryRole[]` (lifecycle roles) (R27-4), enforces **one-external-provider rule** (governs `MemoryBackend` only — ragfs is a read-only aggregation layer; its constituent sources (skills, knowledge, files) may use independent providers; prevents schema bloat), drains in-flight sync within a bounded timeout on shutdown (`SYNC_DRAIN_TIMEOUT_S`), exposes `prefetch_all`/`sync_all` (driving `syncTurn` via `syncAll`). No background memory fork touches the main session's prompt cache.

**Unified context FS (ragfs)** *(OpenViking — architecture only, AGPL clean-room)* — one URI namespace over memory + skills + knowledge + files; uniform `list/read/grep` everywhere. `ContextSource` trait router + `StaticContextSource`. *(mya-v1 `mya-context-fs` already implements the skeleton.)*
- **Double-scan resolution (R25-18): ragfs is the authoritative scanner.** `scan-on-read` returns a typed `ScanVerdict`; the prompt assembler's `scanInject` (§5) defers to the ragfs verdict for ragfs-sourced files and only rescans direct-FS (non-ragfs) context files — no redundant double-scan.
- **`knowledge://<doc>` URI (R25-19):** a read-only `KnowledgeContextSource` over a `KnowledgeGraph`; writes stay on the `Knowledge` tool, not ragfs.

**Concrete memory interface (round 11 — R27-4 backend/role split + R27-18 drain durability):**
```ts
// R27-4: MemoryBackend = read/write STORE interface (SQLite/Markdown/Qdrant). Tree APIs (appendTreeLeaf,
//   …) live HERE so the archivist doesn't bypass the manager.
//   CC4/R28: a backend uses INTERNAL locking so concurrent reads/writes are safe; MemoryManager.syncAll
//   holds a `drainLock` that blocks prefetchAll until the drain completes or times out (no prefetch
//   races a draining shutdown).
interface MemoryBackend {
  read(query: MemoryQuery): Promise<MemoryHit[]>;
  write(entry: MemoryEntry): Promise<WriteResult>;        // R27-18/R27-20: typed result (Ok|Durable|Spilled|ResourceExhausted)
  durability: Durability;                                  // R27-18: BestEffort|Durable|DurableWithWal
  appendTreeLeaf?(path: string, md: string): Promise<WriteResult>;  // tree store API for archivist
}
// R27-4: MemoryRole = lifecycle ROLE interface. A role RECEIVES the canonical store handle and calls
//   role-specific ops THROUGH it (e.g. archivist syncTurn → store.appendTreeLeaf). Archivist/tree/
//   diff/goals/sync are MemoryRoles, NOT MemoryBackends.
interface MemoryRole {
  prefetch(store: MemoryBackend, query: MemoryQuery): Promise<void>;
  syncTurn(store: MemoryBackend, ctx: TurnContext): Promise<void>;
  systemPromptBlock(store: MemoryBackend): string;
}
interface MemoryManager {                  // the ONLY integration point the loop uses
  backends: MemoryBackend[];               // R27-4: stores
  roles: MemoryRole[];                     // R27-4: lifecycle roles
  prefetchAll(ctx: TurnContext): Promise<void>;   // CC4: blocks on drainLock if a syncAll drain is in flight
  snapshot(): MemorySnapshot;              // feeds the *volatile* prompt tier only
  // R27-18: syncAll returns a DrainReport; lost writes → health Degraded + persisted to a
  //   crash-recovery journal for replay on next boot. Durable writes fsync before the drain timer;
  //   a WAL/spill-file for the in-flight queue so a 5s-timeout write survives.
  syncAll(deadlineS = 5): Promise<DrainReport>;   // bounded shutdown drain; lostWrites.count → LaneBoard/health
  // one-external-provider rule: addBackend() refuses a 2nd external backend
}
// ragfs URI scheme:  memory://<role>/<id>   skill://<name>   knowledge://<doc>   file://<path>
//   — uniform list/read/grep via ContextSource; injection-scanned on read.
```

---

## 9. Skills (provenance + curator + progressive disclosure)

- **`SkillProvenance`** enum gating edits: `Bundled | HubInstalled | UserCreated | AgentCreated` — **SPEC-proposed enhancement** over hermes's 3-value runtime `provenance()` function returning `'hub' | 'bundled' | 'agent'` (a separate ContextVar tags background-review writes). *(hermes + mya-v1 `skills/provenance.rs`.)*

```ts
// C6/R28: every other enum has a type block — SkillProvenance defined here, referenced by §9/§17.
type SkillProvenance = "Bundled" | "HubInstalled" | "UserCreated" | "AgentCreated";
```
- **Progressive disclosure:** index emits only `name + description` frontmatter; full SKILL.md loaded on invoke. Adopt the `agentskills.io` frontmatter standard for cross-tool compat. *(hermes + pi-coding-agent.)*
- **`SkillCurator` task** — inactivity-triggered, runs as a separate handle on an **auxiliary provider chain** (preserve main prompt cache). Strict invariants: touches agent-created **and bundled built-in** skills (when `prune_builtins` is on, the default; hub-installed/external are off-limits), **archive-not-delete**, pinned skills bypass all auto-transitions. *(hermes `agent/curator.py`.)*
- **Supersession note (R26-C):** *SPEC §9 supersedes deepdive #02's `curator_can_archive()` (which allowed only `AgentCreated`) and deepdive #09's 3-variant `SkillProvenance` — the SPEC's 4-value enum + built-in curation (R24-F17/F18) is authoritative.*

---

## 10. Subagents & Multi-agent Topologies

- **Copy-on-write overlay-isolated subagents returning schema-validated objects** *(oh-my-pi `task`)* — each worker gets an isolated overlay (overlayfs/APFS-reflink/btrfs/ZFS via `pi-natives` `IsoBackendKind`; `git worktree` is one backend option) + own tool surface; the final yield is a **JSON-Schema/JTD-validated object** (JTD normalized to JSON Schema, AJV-class validator; Zod appears only in tests/examples) the parent reads directly. No prose parsing, no orphaned edits. **(R27-7/O2: file edits are NOT auto-merged silently — see the CoW merge-back policy below.)**
- **CoW merge-back policy (R27-7/O2):** the child yields `{ ok: true; data: unknown; changedPaths?: string[] }`. The parent 3-way-merges using the CoW base snapshot as common ancestor; on conflict → `SubagentResult` becomes `{ ok: false; error: ConflictError }` (child may retry, or the parent resolves). hashline (§7) guards line-level silent overwrite. *Conflicts surface as typed errors — there is no silent cross-buffer merge.*
- **Subagent isolation:** a hard `DELEGATE_BLOCKED_TOOLS` denylist every child inherits; `HumanApproval` routed through an explicit `ApprovalChannel` handle passed at spawn — **never parent-stdin-resolved** (avoids deadlock). *(hermes `delegate_tool.py`.)* **Bridge filter (R27-8/O3): the code-exec bridge's `callTool(name,args)` is filtered by the SAME `DELEGATE_BLOCKED_TOOLS` as the child's direct toolSurface — blocked names rejected. The bridge kernel process inherits the child's OS sandbox (§14), so `subprocess`/`Bun.spawn` cannot escape blocked capabilities. Restricted children may also drop `codeExecBridge` from their surface entirely.**
- **Hierarchical approval propagation (R27-9/O4):** in `hierarchical` topology a child MUST forward the same `ApprovalChannel` it received. Requests carry `{ chainDepth; originalRequester: LaneId }`. `MAX_APPROVAL_CHAIN_DEPTH` (default 3); exceeding fail-closes to Deny. A child MAY wrap the channel in a delegating proxy that auto-approves a declared subset, never auto-denies.**
- **6 declarable topologies** *(harness catalog, research-validated)*: Pipeline / Fan-out-Fan-in / Expert Pool / Producer-Reviewer / Supervisor / Hierarchical Delegation — as a `TeamTopology` enum; cron/SOP/skills declare which shape. *(openhuman `model_council` = Expert Pool variant.)*
- **Optional advisor lane** per turn + hindsight review (automated advisor/critic = **oh-my-pi advisor lane**); plus an **interactive human-in-the-loop plan-approval gate** — `plan_review` (openhuman) parks the live turn on `PlanReviewGate` until the user decides Approve/Reject/Revise (10-min TTL, fail-closed Reject); NOT an automated critic.

**Concrete subagent protocol (round 13):**
```ts
type TeamTopology = "pipeline" | "fanout-fanin" | "expert-pool"
                   | "producer-reviewer" | "supervisor" | "hierarchical";
interface SubagentSpawn {
  topology: TeamTopology;
  isolation: "isolated" | "shared";   // isolated = CoW overlay (overlayfs/reflink/btrfs/ZFS; git worktree = one option) (default)
  toolSurface: ToolSet;               // own surface; DELEGATE_BLOCKED_TOOLS always removed
  approval: ApprovalChannel;          // explicit handle — parent stdin unreachable by type
  resultSchema: JSONSchema;           // worker MUST yield a schema-valid object (JTD→JSON-Schema, AJV)
  budget: BudgetConfig;               // own budget; child cannot exceed parent's remainder
}
type SubagentResult =
  | { ok: true;  data: unknown; changedPaths?: string[] }  // validated by resultSchema (R27-7)
  | { ok: false; error: LifecycleError };                   // a merge conflict ⇒ LifecycleError{phase:"subagent", cause: ConflictError} (R27-7)
// R27-7: CoW-overlay-isolation ⇒ no orphaned edits; file edits are NOT auto-merged silently — the
//   parent 3-way-merges against the CoW base; conflicts surface as {ok:false; error: ConflictError}
//   (a typed LifecycleError whose `cause` carries the ConflictError detail). schema-validated yield
//   ⇒ parent reads structured data, never prose. *(oh-my-pi `task`.)*
// R27-6: budget = parent.budget.deriveChild(child.total) under a lock at spawn (child cannot
//   self-declare); unused delta refunded on completion. child.unlimited = parent.unlimited && requested.
//   MAX_DEPTH + MAX_TREE_NODES bound the budget tree (not just MAX_CONCURRENT_SUBAGENTS).
//   CC2 (orphaned budget): "completion" = ANY terminal state (Completed|Failed|Cancelled); the
//     SubagentRunner ALWAYS refunds alloc - child.spent via releasePrecharge — a crashed child (§14b)
//     refunds too, so no pre-charge is ever orphaned.
//   CC10 (hierarchical-spawn deadlock): deriveChild locks the PARENT node ONLY (never root); the lock
//     hierarchy follows the tree root→child→grandchild, so holding a parent lock never blocks a child's
//     spawn (no hierarchical-spawn deadlock).
// R27-10: on schema-validation failure — bounded repair: re-prompt the child with the AJV error path
//   + schema, SUBAGENT_SCHEMA_REPAIR_RETRIES (default 1); if still failing → error. LifecycleError.phase
//   gains "subagent"|"validation"; the error variant carries `partial` (raw invalid yield for salvage).
```

---

## 11. Code Navigation & Execution

- **LSP format + diagnostics surfaced as opt-in post-write feedback** (`lsp.formatOnWrite`/`lsp.diagnosticsOnWrite`); the write always succeeds — diagnostics are an appended notice, NOT a gate. LSP is force-disabled for eval/subagent turns (cold-start cost). The **real DAP debugger** (drive/time-travel) IS first-class. *(oh-my-pi.)*
- **`codegraph`** **content-addressed file-relevance search** (BM25 + structural-doc embeddings + reciprocal-rank fusion) returning **ranked file paths** — NOT a symbol/ref/call-graph (a tree-sitter call-graph is a *future* upgrade, §23 #1); codegraph = file-relevance ranking only; symbol/ref/call-graph is deferred. *(openhuman.)*
- **Bidirectional code-execution bridge:** persistent Python + Bun worker kernels that call **back into the agent's own tools** (read/search/task) over loopback. Agent never leaves the cell. *(oh-my-pi §01.)*

---

## 12. Channels & Gateway

- **Multi-platform gateway** around one loop, plugin-friendly `ChannelRegistry` (trait + link-time registration) with `check_fn`/`validate_config`/`setup_fn` split so the gateway decides "is this configured?" without booting the adapter. *(hermes `platform_registry`.)*
- **Per-channel access control** via resolver closure over `Arc<RwLock<Config>>` (never cached allowlists). *(hermes SSOT rule, cross-confirmed.)* **(R27-15: channel messages MUST pass through `scanInject` with `scope="context"` BEFORE entering history — the injection scanner is the gateway's context-intake gate, defense-in-depth.)**
- **Per-session runtime cache with LRU + idle-TTL eviction** (`MAX_SIZE`, `IDLE_TTL_SECS`), flushing underlying Provider/Channel/Tool handles on eviction (not just the ref); bounded SSE buffer (~16 MiB). *(hermes gateway `run.py`.)*
- **`HookRegistry` as the unified extension primitive** — one registry: user hooks (`~/.agent/hooks/<name>/HOOK.yaml` (**uppercase**) + Python `handler.py`, loaded via importlib — **never WASM**) via HookRegistry (**no shipped built-ins yet**: `_register_builtin_hooks()` is empty; scale-to-zero/memory-monitor are **separate gateway subsystem modules**, not hook-registry entries); errors never block. *(hermes `hooks.py`.)* For the new agent, WASM handlers are a SPEC aspiration (clearly marked), not inherited from hermes.
- **Gateway control-plane protocol** as a separate extracted crate (`gateway-protocol`) — sessions/channels/cron/config/tools/skills/terminals/agents/nodes (includes multi-agent messages, but is broader than agent-to-agent); protocol ≠ server. *(openclaw + mya-v1 `mya-gateway-protocol`.)*

---

## 13. Observability

- **Typed lifecycle events** emit on every FSM transition → dashboards/observers consume data, not logs. *(claw-code tenet #2.)*
- **LaneBoard** + **structured error surfaces** (phase + recoverable + context) as the operational liveness source. *(claw-code.)*
- **ComponentHealth tri-state** (`Healthy | Degraded | Failed`) on every plugin/channel/MCP/cron. *(mya-v1 `mya-api::health`.)*
- **Telemetry export** (opt-in) + **openOSS session sharing** flywheel for eval data. *(pi-coding-agent `pi-share-hf`.)*
- **Single time helper** (`core.time.now()` in TS / `now_wallclock`+`now_monotonic` in Rust natives) — never duplicate `SystemTime::now()…` across files; injectable for tests. *(claw-code `now_secs` anti-pattern + mya-v1 #07.)*

**Concrete liveness API (round 5):**
```ts
type LaneFreshness = "Healthy" | "Stalled" | "TransportDead" | "Unknown" | "AwaitingHuman";  // R27-19: AwaitingHuman added
interface LaneHeartbeat { observedAt: number; transportAlive: boolean; status: LaneStatus; blockedOn?: "approval"; }  // R27-19: blockedOn; status: LaneStatus (typed enum, §4 Core primitives; R26-H)
interface LaneBoardEntry { taskId: string; prompt: string; status: LaneStatus; teamId: string; heartbeat: LaneHeartbeat; freshness: LaneFreshness; }  // lane identity (task_id) lives HERE, not on the heartbeat
interface LaneBoard { generatedAt: number; entries: LaneBoardEntry[]; }  // entries are LaneBoardEntry[], NOT LaneHeartbeat[]; LaneBoard also has generated_at
// freshness is NOT a per-laneId method — it is per-heartbeat and en masse:
//   LaneHeartbeat::freshnessAt(now, stalledAfterS) → LaneFreshness   (per-heartbeat)
//   TaskRegistry::laneBoardAt(now, stalledAfterS) → LaneBoard        (en masse)
// `now` is injected (single time helper) — never reads the clock inline
// R27-19: a lane whose turn is AwaitingApproval classifies as AwaitingHuman{since, approvalRequest}
//   — EXEMPT from Stalled timeout escalation; reapers MUST NOT kill it without operator action;
//   approvalEscalationTimeoutS (default 24h) escalates (notify) rather than discards.
//   CC5/R28 (false-kill race): the turn sets blockedOn:"approval" on the heartbeat ATOMICICALLY BEFORE
//   emitting AwaitingApproval (or the heartbeat reads TurnState directly), so there is no window in
//   which an approval-pending lane reads as Stalled and gets reaped before the emit lands.
```

**Event taxonomy (round 15) — every emit is one of:**
```ts
type RuntimeEvent =
  | { kind: "turn";      e: TurnEvent }
  | { kind: "lifecycle"; lane: LaneId; state: LifecycleState }   // FSM transitions
  | { kind: "approval";  stage: "requested" | "decided"; call: ToolCall }   // R25-5: hook-Allow→ask-human round-trip observable (§7 step 4, invariant #13)
  | { kind: "tool";      decision: PermissionDecision; result: ToolResult }   // C2: PER-CALL event — result is a single ToolResult; the batch DegradedResult lives only on TurnEvent.ToolExec (§4)
  | { kind: "repair";    raw: string; repaired: ToolCall; resolver: string }   // R27-14: repair audit — emitted when repaired !== raw (enters Merkle log)
  | { kind: "budget";    level: "warn" | "exhausted"; spent: Cost }
  | { kind: "health";    component: ComponentId; tri: ComponentHealth };
// R27-16: the Merkle audit log covers ALL RuntimeEvent.kind==="tool" entries (every tool surface,
//   not just MCP writes) PLUS approval and repair events; channel messages are logged on receipt.
// Telemetry export = opt-in sampled projection of RuntimeEvent (secrets/PII redacted per §14).
```

---

## 14. Security

- **Prompt-injection scan** on every context file before injection (`[BLOCKED]` placeholder). *(hermes + openhuman `prompt_injection`.)*
- **Per-surface audit:** MCP tool calls audited separately from tool calls separately from channel messages; **Merkle/append-only audit log (mya-v1)** — openhuman's `mcp_audit` is a **plain SQLite table, MCP-write-tools-only, NOT Merkle/append-only**. *(openhuman `mcp_audit` (SQLite) + mya-v1 (Merkle).)* **(R27-16/T10: the Merkle audit log covers ALL `RuntimeEvent.kind==="tool"` entries (every tool surface, not just MCP writes) PLUS `approval` and `repair` events; channel messages are logged on receipt.)**
- **Sandbox enforcers** in Rust (seccomp/seatbelt/AppContainer) for tool exec *(claw-code/openhuman `cwd_jail`; oh-my-pi has **none** — its isolation = in-process brush shell + CoW overlay `pi-iso`)*. **Sandboxed in-process shell** *reduces but does not eliminate* external-process execution: the vendored brush + uutils builtins cut the common case, but non-builtin commands still spawn external binaries (incl. `/bin/sh`); the `exec` builtin is disabled. *(claw-code/openhuman + oh-my-pi `pi-shell`.)*
- **Content-addressed edits** prevent silent multi-agent clobbering. *(oh-my-pi hashline.)*
- **Subagent isolation** (blocked-tools denylist + explicit approval channel). *(hermes.)*
- **Secrets redaction** via Pre-tool hook (auto-redact in `Write`/`bash` inputs). *(claw-code hooks.)*
- **Rate-limiting & abuse protection (round 6):** per-identity (channel user / API key / session) token + cost budgets at the gateway; hard ceiling on concurrent subagents (`MAX_CONCURRENT_SUBAGENTS`) and per-run cost (§21 `BudgetConfig`) to bound runaway spend and DoS. *(openclaw perf + mya-v1 hardware caps.)*
- **Secret management lifecycle (round 6 — partly SPEC-proposed):** secrets live in the OS keyring (or a sealed `0600` file), never in config TOML or env-as-default; a `secrets` package provides `get/rotate/revoke`; the audit log stores only a hash/redacted form — **this lifecycle is the SPEC's own proposal**. oh-my-pi's real `secrets` package is a **prompt/output redactor** (`SecretObfuscator`: obfuscate/redact via plain/regex patterns from `.omp/secrets.yml`); no OS-keyring, no lifecycle. *(oh-my-pi `secrets` redaction + claw-code path validation.)*
- **PII handling (round 6 — SPEC-proposed):** a configurable PII redactor in the injection-scanner pipeline (regex + dictionary) scrubs PII before provider calls and before audit-log write; per-jurisdiction retention on memory — **this is the SPEC's proposal**. openhuman's real privacy posture is **hash-based audit logging (sha256 of prompts)**, NOT a PII redactor. *(SPEC proposal + openhuman hash-audit + hermes scan.)*
- **Sandbox escape prevention (round 6):** a reduced env allow-list + `cwd` jail + a path validator rejecting `..`/symlink escapes BEFORE exec, and the enforcer drops capabilities (seccomp/seatbelt) so even a panic can't reach the host FS — **claw-code/openhuman `cwd_jail`** (NOT oh-my-pi: its `pi-shell` has no env allow-list — the only env filtering is a **deny-list in the Python eval runtime**, a different component — and `cwd` is settable, not locked). *(claw-code sandbox + openhuman `cwd_jail`.)*
- **Injection-scanner honesty (R27-15/T7):** the prompt-injection scanner is **defense-in-depth, NOT a security boundary** — the real control is **privilege separation** (untrusted context can never raise `active_mode`, §7). The 64 KiB truncation is removed (sliding window with overlap); TR#39 confusables detection added; secrets redaction runs AFTER `prepare_messages` (§6, R27-17), not only in tool Pre-hooks. *(hermes + openhuman `prompt_injection`.)*

### 14b. Native Crash & Process Resilience

*(R27-12 — T3, GAP-1, GAP-11 — CRITICAL.)* Native code (Rust napi, vendored shell, third-party `.node`) is a **process-fault** trust boundary: a single segfault/abort must NOT kill the agent. Resilience is architecturally separated from the §14 OS sandbox (which governs tool exec + install scripts, not module-eval).

- **No-abort invariant (#14):** every napi entry wraps its body in `std::panic::catch_unwind` and returns a typed `NativeResult<T> { Ok(_) | Panic(backtrace) }`. **napi natives MUST NOT `abort!`/`process::exit`** — panics propagate as typed errors, never process death. *(new invariant #14, §18.)*
- **Sidecar for trust-boundary natives:** trust-boundary natives (`shell`, `sandbox` enforcers) run in a **subprocess/sidecar** with a `LaneBoard` death signal + bounded auto-restart — a brush segfault becomes a `Failed{phase:"sandbox"}` turn, not a process corpse. The host observes the sidecar via the `NativeResult` channel.
- **Third-party `.node` binaries:** a **sigstore signature + SHA-256 content-hash pinned in the release lockfile** MUST verify BEFORE `dlopen` (resolves §23 #6 as a **RELEASE-BLOCKER** for third-party `native`). `abiStamp`/`napiVersion` are **compatibility** guards, not security.
- **Prompt COW-immunity (#15):** the prompt struct is COW-immutable + serialized (invariant #15, §5/R27-23) so a native crash mid-turn never tears a reader-visible `SystemPrompt`.

---

## 15. Eval & Quality Gates

- **Mock parity harness:** deterministic mock provider + scripted scenario JSON + request-level behavioral diff. *(claw-code `mock_parity_scenarios.json` + `run_mock_parity_diff.py`.)*
- **Drift gate (R25-17):** compression ships BEHIND a **deterministic-replay drift grader** (the zero-cost, CI-runnable merge-block — replay a golden `LlmTrace` with vs without compression, diff final responses; `ε = 0`). The live GSM8K/TruthfulQA lm-eval (headroom's real eval suite = GSM8K/TruthfulQA via lm-eval + before/after + LLM-as-judge) is a **credentialed-tier aspiration**, NOT a merge-block gate — never ship compression without the deterministic-replay gate. *(headroom + mya-v1 #04.)*
- **Parity-test crate** for any reference algorithm reimplemented (golden fixtures) — caveat: `headroom-parity` has **3 of 7 comparators still `todo!` stubs (Phase 0)**; only Diff/Tokenizer/SmartCrusher/ContentDetector are real. *(headroom `headroom-parity`.)*
- **Test classification** unit/integration/credentialed + **no-egress guard** on non-credentialed tests. *(claw-code + MyAgents.)*
- **Deterministic `MockProvider`** with replay + `TestTier`. *(mya-v1 `mya-eval::mock`.)*

**Concrete eval shapes (round 16):**
```ts
// Mock-parity scenario = deterministic replay + behavioral diff
interface ParityScenario {
  name: string;                       // "streaming_text" | "write_denied" | "auto_compact" ...
  mockResponses: MockResponse[];      // canned provider replies
  steps: BehaviorStep[];              // expected tool calls / state transitions
  assert: "exact" | "subset";          // diff mode
}
type TestTier = "unit" | "integration" | "credentialed";
// CI runs unit+integration; credentialed = opt-in. no-egress guard: a fence FAILS if any
// network call fires outside the credentialed tier. *(claw-code + MyAgents.)*
```

---

## 16. Supply Chain

- **Min-release-age gate** (refuse deps younger than N days) + transitive `[patch]`/overrides for known-bad transitives. *(openclaw `minimumReleaseAge` + hermes.)*
- **Exact-pin** runtime deps (no floats); deliberate hardening (cf. May-2026 Mini Shai-Hulud worm). *(hermes.)*
- **Lazy, vetted feature bundles** with a hardcoded allowlist + writable target + **resolution appended-last** so core can never be shadowed; refuse on version-sentinel mismatch (the inherited enforcer; full ABI stamp = SPEC proposal, §23 #6). *(hermes `lazy_deps.py` + mya-v1 #11.)*
- **`cargo-deny` / `npm audit`** in CI; root `deny.toml` canonical. *(mya-v1 #18.)*
- **Tension resolved — lazy runtime installs vs exact-pin hardening (round 8):** lazy feature bundles (install-on-first-use) introduce *new code at runtime*, which conflicts with exact-pinning. Resolution: the lazy allow-list is **version-pinned in the lockfile at release time** (the bundle's *version* is fixed; only its *materialization* is lazy), install target is **appended-last** to resolution, and any install off the pinned version is refused. Fail-open (feature unavailable) never means fail-open-on-supply-chain. *(hermes `lazy_deps` + openclaw age-gate, reconciled.)*
- **Supply-chain hole 1 — lazy transitive closure (R25-26):** the **release lockfile must include the full transitive closure of every lazy bundle** (generated via `npm install --package-lock-only` with all bundles present); runtime materialization is **lockfile-strict (`npm ci`)** — never `npm install`. This closes the gap where a lazy bundle's transitives are unresolved at release time.

---

## 17. Extension Model (packages)

*(pi-coding-agent philosophy)* **Four** extension kinds, each an installable npm/git **package**:
| Kind | What it adds | Example |
|---|---|---|
| **Extensions** | new tool(s) / commands / events / UI (Extensions subsume tools + commands + events + UI) | a `database_query` tool |
| **Skills** | progressive-disclosure knowledge | a `refactor-database` skill |
| **Prompt Templates** | system-prompt tiers / roles | a `code-reviewer` role |
| **Themes** | TUI/visual | a color theme |

> The 4 runtime modes — interactive (TUI) · print (--json flag) · rpc (stdio JSON-RPC) · sdk (embedded lib) — are **built-in**, not a package kind.

- **Core = interfaces + host; packages = implementations.** The frozen core defines *traits/interfaces* (`MemoryBackend`, `Tool`, `ChannelAdapter`, `SkillSource`, `SubagentRunner`, `Hook`) + the *host* that loads/registers/schedules them. Every concrete capability (a specific memory backend, a Telegram channel, a plan-mode) ships as a **package** that satisfies a core interface. This resolves the core-vs-package tension: the loop depends only on interfaces, so "memory is a package" and "the loop touches memory only via `MemoryManager`" are both true. *(pi core/host + hermes single-integration-point, unified.)*
- Packages register at install time; **core stays frozen**. Subagents, plan-mode, memory backends, channels = all packages, not core. *(pi "deliberate omission".)*
- Packages consume the **Rust natives** as a prebuilt napi module — no Rust compilation for package authors.

**Package manifest (round 17):**
```ts
// Every package ships an `agent-package.json` (skills use SKILL.md frontmatter) declaring its kind:
interface PackageManifest {
  name: string; version: semver;         // pinned in the user lockfile
  kind: ("extensions"|"skills"|"prompt-templates"|"themes")[];
  apiVersion: string;                    // must intersect core's supported range or refuse-load
  provides: { tools?: string[]; skills?: string[] };
  permissions?: { tools?: string[]; egress?: string[] };  // advisory intent declarations
  // R27-11: module-isolation tiers (C5/R28: field renamed `isolation`→`moduleIsolation` to
  //   disambiguate from §10's CoW FILESYSTEM `isolation`). default = "worker" for unsigned third-party;
  //   "in-process" ONLY for sigstore-signed first-party (trusted:true + verified sigstore); "isolated-vm"
  //   for max sandbox (CANNOT call napi — packages lose Rust natives).
  runtime?: { moduleIsolation: "in-process" | "worker" | "isolated-vm"; trusted?: boolean };
  // R27-12/T3: prebuilt napi binary declaration. abiStamp/napiVersion are COMPATIBILITY guards; the
  //   SECURITY gate is sigstore signature + SHA-256 content-hash pinned in the release lockfile,
  //   verified BEFORE dlopen (RELEASE-BLOCKER for third-party native, §23 #6).
  native?: { abiStamp: string; napiVersion: number; sigstore: true; contentHash: string };
  scripts?: string[];                  // R27-11: install-time scripts run under the §14 seccomp/seatbelt enforcer with a cwd-jail AFTER verify
}
// Lifecycle (R25-27): install (--ignore-scripts) → verify(apiVersion + signature) → register → (lazy) activate.
//   install runs with --ignore-scripts (npm preinstall/postinstall/prepare disabled by default —
//   arbitrary code does NOT run at install). A package requiring install-time scripts must declare
//   them in PackageManifest.scripts; they execute inside the §14 OS sandbox (seccomp/seatbelt + cwd-jail)
//   AFTER verification — not an undefined sandbox.
//   verify(apiVersion + signature) — signature scheme = sigstore (resolves §23 #6; for third-party native
//   it is a RELEASE-BLOCKER per R27-12). (R25-30 widened)
// Isolation honesty (R27-11 — T1/T2/T8, CRITICAL): the static lint ban on import "node:fs" /
//   "node:child_process" / "node:net" in package code is DEFENSE-IN-DEPTH ONLY and is BYPASSABLE
//   (eval, dynamic import, globals Bun.spawn/fetch, transitive deps) — it is NOT a security boundary.
//   The REAL boundary is RUNTIME: Tier-0 ships a runtime module-load allowlist (Node --experimental-policy /
//   Bun loader hook) intercepting require/import of node:* builtins at runtime for package code;
//   non-allowlisted access is refused.
//   `register`/`activate` runs top-level module code IN-PROCESS — this is a code-execution trust boundary
//   (BIGGER than npm lifecycle scripts). Default moduleIsolation (R27-11 — C5 field name):
//     • in-process   ONLY for sigstore-signed first-party packages (trusted:true + verified sigstore);
//     • worker       (worker_threads; napi proxied via postMessage — pays a structured-clone round-trip) for unsigned third-party;
//     • isolated-vm  for max sandbox (CANNOT call napi — packages lose Rust natives).
//   The §14 OS sandbox governs TOOL EXEC + install scripts, NOT package module-eval — do not imply in-process
//   packages are safe. permissions.egress/permissions.tools are advisory intent declarations (the runtime
//   load allowlist + the worker/isolated-vm tier are the enforced controls). deny-by-default egress;
//   never another package's internals nor FS outside its data dir.
```
- **Third-party napi policy (R25-29 / R27-12):** a package MAY ship a prebuilt napi binary under `<pkg>/native/<platform>-<arch>.node` IFF it declares `native:{abiStamp,napiVersion,sigstore,contentHash}`, the host verifies the **sigstore signature + SHA-256 content-hash pinned in the release lockfile BEFORE `dlopen`** (RELEASE-BLOCKER for third-party `native`), verifies the stamp against its supported `napi_abi` range at load, and the user's config explicitly enables native packages (deny-by-default). Every napi entry wraps its body in `catch_unwind` returning `NativeResult` (§14b) — natives MUST NOT `abort!`/`process::exit`. Perf-critical packages that can't meet this MUST degrade to TS with a documented perf cliff.
- **Dependency rule (workspace-lint-enforced):** `core` depends on the `{ai, extensions, memory, prompts}` *interface* packages + `natives`; packages (impl) depend inward on core, never the reverse — `core` NEVER depends on `channels`/`gateway`/`skills`/`subagents`/`memory-backends` impl packages; the dependency arrow always points inward to core. *(import-direction-acyclic — madge/ESLint-enforced; core has no upward imports; SSOT-preserving.)*

---

## 18. Hard Invariants ("do NOT") — each with an enforcer

> An invariant without an enforcer is a wish. Each rule below carries a concrete enforcement mechanism (lint / test / CI gate / type-level constraint), added round 19.

1. **Never mutate past context / swap toolsets / rebuild the system prompt mid-conversation** except at a **tier boundary** (compression / provider-or-profile swap / skill-write). *[ENFORCED: unit test diffs the system-prompt hash across turns — any mutation outside the boundary set fails the test.]* *(hermes; R25-16 widens the carve-out from “compression” to the full boundary set.)*
2. **Never cache allowlists/`denied_tools`** in handles — resolve on demand via config. *[ENFORCED: ESLint rule banning allowlist fields on channel/tool/handle classes; resolver closure only.]* *(claw-code `denied_tools`/permissions)*
3. **Never propagate parent stdin/file-handle ownership to subagents** — route via explicit `ApprovalChannel`. *[ENFORCED: the `SubagentSpawn` type makes parent-stdin unreachable (no field for it); compiler rejects.]* *(hermes deadlock)*
4. **Never vendor AGPL code** (OpenViking). *[ENFORCED: CI license scan (`cargo-deny`/`license-checker`) fails on AGPL in the dep graph; clean-room files carry SPDX + notice.]*
5. **Never ship compression without the drift gate in CI.** *[ENFORCED: the **merge-block gate** = the deterministic-replay drift grader (zero-cost, CI-runnable — replay a golden `LlmTrace` with vs without compression, diff final responses; `ε = 0`); accuracy lm-eval (GSM8K/TruthfulQA) = best-effort aspiration, NOT a merge block. The mandatory in-repo gates are the zero-cost CCR round-trip + tool-schema-compaction checks; the live GSM8K eval skips green without `OPENAI_API_KEY`; the Rust-vs-Python parity-nightly job is `continue-on-error` (Phase 0).]* *(headroom + R25-17/R25-32.)*
6. **Never stub-then-replace** a field. *[ENFORCED: `@typescript-eslint/no-explicit-any` as error + code-review checklist for `as unknown as T` casts.]* *(SPEC proposal, R25-31.)*
7. **Never append per-turn prefix into the cached system block.** *[ENFORCED: same hash-diff test as #1; the prompt assembler is append-only-outside-cache by construction.]* *(hermes)*
8. **Never let an auxiliary/side task touch the main session's prompt cache.** *[ENFORCED: `AuxiliaryProvider` type has no handle to the main session; the auxiliary instance is a separate allocation, statically unreachable.]* *(hermes + deepdive #02/#05)*
9. **Prefer the in-process Rust shell** over shelling to `/bin/bash`/external binaries for untrusted exec. *[ENFORCED: lint banning `child_process.exec`/`spawn('bash'|'sh', …)` outside the `natives.shell` wrapper — though non-builtin commands still spawn external binaries (incl. `/bin/sh`); the `exec` builtin is disabled.]* *(oh-my-pi)*
10. **Never duplicate the time/now pattern** across files — one injectable helper. *[ENFORCED: lint banning `Date.now()`/`SystemTime::now()` outside `natives.time`/`core.time`.]* *(claw-code)*
11. **Never derive UI/dashboard state from scraping stdout/stderr**. *[ENFORCED: dashboard/transport packages may not import `child_process` stdout; they import the typed-event stream instead (import-rule).]* *(claw-code tenet #6, round 7.)*
12. **Never spawn a fresh runtime/HTTP client per tool call or per turn** — keep long-lived handles in the runtime struct. *[ENFORCED: lint banning `new Provider()`/`new Client()` outside the runtime constructor.]* *(hermes `asyncio.run` anti-pattern, round 7.)*
13. **Never let any hook/override bypass an `ask` rule** — `ask` rules are inviolable; even a hook `Allow` must still prompt when an `ask` rule matches. *[ENFORCED: `authorize()` hard-codes ask-rule-after-hook-Allow; the `hook_allow_still_respects_ask_rules` unit test asserts it.]* *(claw-code `permissions.rs`, round 24 deep-read.)*
14. **Never `abort!`/`process::exit` across the napi boundary** — native panics propagate as typed `NativeResult{Panic}` errors, never process death. *[ENFORCED: every napi entry body is wrapped in `std::panic::catch_unwind`; a Rust lint `clippy::exit` + a custom `no-abort` lint refuse `process::exit`/`abort!` in `crates/natives`; trust-boundary natives run in a sidecar (§14b).]* *(R27-12.)*
15. **The prompt struct is COW-immutable; tier rebuilds are the sole mutators and MUST be serialized.** *[ENFORCED: `SystemPrompt` rebuilds (`markCompressed`/`rebuildStableTier`/`rebuildVolatile`) each build a new tier and atomically swap an `Arc<SystemPrompt>` under a typed `PromptMutex`; a concurrent-stress test (2 rebuilds + 1 reader) in the drift-gate suite asserts `markCompressed` never races a reader.]* *(R27-23.)*

---

## 19. License Posture

| Source | License | Action |
|---|---|---|
| hermes-agent, claw-code, openhuman, MyAgents | MIT/Apache | reimplement design (cite, don't copy) |
| headroom | Apache-2.0 | **depend on `headroom-core` (pinned) or vendor** — inherits parity gate |
| oh-my-pi, pi-coding-agent | MIT | reimplement pattern |
| **OpenViking** | **AGPL-3.0** | **clean-room concept ONLY — never read its code for design** |
| harness (topologies) | Apache-2.0 | concept, no code |

---

## 20. Roadmap Tiers (leverage × quality, effort ignored)

**Tier 0 — Foundations (ship first, unblock everything):**
- Minimal TS `core` + 4 transport modes — interactive (TUI) · print (--json flag) · rpc (stdio JSON-RPC) · sdk (embedded lib). *(pi)*
- Rust `natives` napi package: search (glob/grep), fs, ast, edit-hash, sandboxed shell (vendored brush). *(oh-my-pi)*
- Pit-of-success lint wrappers + single time helper. *(MyAgents #07)*
- Typed FSM + LaneBoard + ComponentHealth tri-state. *(claw-code #03/#14/#15)*
- Byte-faithful JSON + supply-chain age-gate. *(headroom #17, openclaw #18)*
- **Accuracy-preservation gate** (deterministic-replay drift grader — zero-cost; GSM8K subset when API key available). The Tier-0 grader depends only on the `Compressor` + `LlmTrace` interface stubs (R26-A); concrete compressors are Tier-1 — the grader ships with a no-op/identity compressor in Tier 0 and upgrades when Tier-1 compressors land. *(headroom #4, §15, R25-33, R26-F.)*

**Tier 1 — Core capability (the big UX/perf wins):**
- 3-tier cache-stable prompt + injection scanner. *(hermes #1)*
- ProviderProfile registry + tool-call repair. *(hermes #5, openclaw #7)*
- Content-aware compression BEHIND the drift grader. *(headroom #4)*
- MemoryManager + memory roles (archivist/tree/diff) + ragfs. *(openhuman #6, OpenViking)*
- CoW-overlay-isolated subagents + JSON-Schema/JTD-validated returns + 6 topologies. *(oh-my-pi, harness)*
- Mock parity harness. *(claw-code #16)*

**Tier 2 — Flagship / differentiation:**
- Skill curator + provenance + progressive disclosure. *(hermes #8)*
- LSP-on-write + DAP debugger + codegraph (file-relevance ranking only; symbol/ref/call-graph deferred — §23 #1). *(oh-my-pi, openhuman)*
- Bidirectional code-exec bridge (Python/Bun → tools). *(oh-my-pi §01)*
- Council provider + advisor/hindsight model lane. *(openhuman, oh-my-pi)*
- Channels gateway + hook registry + gateway control-plane protocol crate. *(hermes, openclaw)*
- **Embedded scripting workflows** (language TBD per §23 #2 — Rhai or JS/TS sandbox). *(openhuman, R25-34.)*

**Frontier (research-aligned):** multi-agent shared-state convergence; x402 micropayments + wallet; on-device MLX TTS; collaboration relay. *(Papers, openhuman, oh-my-pi)*

**Dependency order & cross-links (round 18 — true build order, not just leverage):**
- **Hard sequence:** §2 Rust-gate → §3 architecture (napi boundary + core interfaces) → §5 3-tier prompt → **only then** §5 compression (compression rebuilds the prompt; landing it before the cache-stable prompt is wasted). *(deepdive #02↔#04 dependency.)*
- **Shared helper, built once:** the **auxiliary-provider** instance (§6) is consumed by BOTH the skill curator (§9) and memory roles (§8) — extract it in Tier 1 so Tier 2 doesn't reimplement it twice. *(deepdive #02↔#05.)*
- **FSM + LaneBoard + event taxonomy (Tier 0) before every subsystem** — memory drain, cron, channels all emit `RuntimeEvent` (§13); land the taxonomy before the emitters.
- **Drift grader (Tier 0 eval) gates compression (Tier 1)** — never invert.
- **Cross-cutting (§21) threads through all tiers:** `BudgetConfig` wires into §4 turn loop + §10 subagent budget; versioning wires into §21 session-format + §17 `apiVersion`.

---

## 21. Cross-cutting Concerns (the completeness gap)

*(Added round 1 — concerns no single source owned, but every production agent must specify.)*

**Cost & budget.** Per-turn + per-session + per-run token/cost accounting (input/output/compression-saved), surfaced as typed events. Budgets are **first-class** and **tree-accounted (R27-6): `BudgetConfig { total, warningThreshold=0.8·total, abortThreshold=0.95·total, unlimited, parent?, remaining(), spend(), deriveChild(), releasePrecharge(), diskBytes?, heapBytes? }`** — field names unified to `warningThreshold`/`abortThreshold` to match the glossary (O6). Every node shares ONE atomic root `spent`; `remaining()`/`exhausted()` evaluate against the ROOT total. `spend()` is REQUIRED (not optional) and is called on the Completed path AND before each loop continuation (§4, R27-1/D2). The `SubagentRunner` host calls `parent.budget.deriveChild(child.total)` under a lock at spawn (child cannot self-declare); unused delta refunded on completion; `child.unlimited = parent.unlimited && requested` (a limited parent can NEVER spawn an unlimited child). The tree is bounded by `MAX_DEPTH` + `MAX_TREE_NODES` (not just `MAX_CONCURRENT_SUBAGENTS`). A mid-stream cost watermark in `streamWithFallback` cancels the stream when cumulative-turn cost > `abortThreshold`. The loop checks budget before each provider call and emits `BudgetWarning`/`BudgetExhausted` → graceful abort with partial result. *(mya-v1 `cost` + pi-crew `budgetTotal` pattern; R27-6.)* **(CC2/R28: "completion" = ANY terminal state `Completed|Failed|Cancelled`; the `SubagentRunner` ALWAYS refunds `alloc - child.spent` via `releasePrecharge(childId)` — a crashed child (§14b) refunds too, so no pre-charge is ever orphaned. CC13/R28: `spend()` is an atomic compare-and-swap that REJECTS a spend breaching `abortThreshold`, bounding concurrent-turn overspend against the shared root. CC10/R28: `deriveChild` locks the PARENT node only; lock hierarchy root→child→grandchild — holding a parent lock never blocks a child's spawn.)**

**Versioning & migration.** Two versioned schemas with automated, type-safe migrations: **session format** (`session.v{N}` + `session-manager.ts` migrations: `CURRENT_SESSION_VERSION=3`, `migrateV1ToV2`, `migrateV2ToV3`) and **config schema** (`config.v{N}` + a migration registry that refuses to boot on an unknown future version rather than guessing). Note: pi's separate `src/migrations.ts` holds **side-effectful filesystem** startup migrations (auth moves, sessions relocation, commands→prompts, tools→bin) — NOT the session-format migrations and NOT pure. Session/config migrations are pure functions, unit-tested, one-directional. *(pi `src/core/session-manager.ts` + mya-v1 type-safe migration.)*

**Updates & distribution.** Agent self-update channel (opt-in, signed releases); packages are versioned (`semver`) and resolved from npm/git with an exact-pinned lockfile. `agent doctor` verifies install integrity (napi binary matches, no shadowed core).

**Deployment & packaging.** Rust `natives` ship as **prebuilt napi binaries per {OS,arch}** (no toolchain for users); a slim Docker image (distroless) for gateway/sandboxed runs; the 4 transport modes — interactive (TUI) · print (--json flag) · rpc (stdio JSON-RPC) · sdk (embedded lib) — map to: `interactive`→native binary, `print`→CI, `rpc`→sidecar, `sdk`→embedded lib. *(oh-my-pi napi prebuilt + hermes multi-process.)*

**Multimodal I/O.** Providers declare `supports_vision`; the read surface ingests images/PDFs → structured markdown (arxiv/GitHub/SO) *(oh-my-pi §08/§12)*; STT/TTS/voice as **optional packages** (on-device MLX TTS as a frontier package). Images in tool results are content-addressed like text edits.

**Internationalization & accessibility.** Prompts and UI are i18n-capable (message catalog, not string literals) so the agent can localize identity/guidance; TUI and web dashboard meet keyboard-nav + screen-reader baselines (WCAG 2.1 AA for the dashboard).

**Reproducibility.** A `--deterministic` mode pins model+seed+temperature+byte-faithful JSON for replayable evals; combined with the `MockProvider`, any session can be byte-replayed. Every eval gate runs in this mode.

---

## 22. What this SPEC deliberately is NOT

- **Not pure-Rust** (mya-v1 lesson: compile times kill iteration). The TS loop is non-negotiable for extension velocity.
- **Not maximalist-by-default** (oh-my-pi ships everything in one binary). The SPEC keeps pi's **minimal core + packages**; oh-my-pi's features become opt-in packages.
- **Not Python-primary** (hermes maintainability data). Python appears only inside the code-exec bridge kernel, never as the host language.
- **Not a rebrand of mya-v1.** It inherits mya-v1's trait-driven multi-crate discipline + channels + gateway, but re-platforms the loop to TS and the engine to a Rust napi core.

---

## 23. Open Questions (explicitly undecided — honest about what this SPEC does NOT nail down)

A founding spec that pretends to decide everything is lying. These remain open, to be resolved by a spike before implementation:
1. **codegraph: build a symbol/ref/call-graph on top of today's file-relevance search?** openhuman is file-search (BM25 + structural-doc embeddings + reciprocal-rank fusion) today; a tree-sitter call-graph is a *future* upgrade; mya-v1 used external LSP. Spike: measure query latency + maintenance cost of each. *(affects §11 + Tier 2.)*
2. **Embedded scripting: Rhai (openhuman, sandboxed-by-design but niche) vs a JS/TS sandbox (reuses ecosystem) vs none?** Deferred to the automation-surface spike. *(§10/Tier 2.)*
3. **Memory-backend defaults:** local SQLite (structured) + markdown (human-editable) + vector (semantic) — which ship in core-zero vs as packages? *(§8.)*
4. **Council/advisor model: always-on (doubles cost) vs on-demand (adds latency)?** oh-my-pi watches every turn; gate behind a per-session flag. *(§6/§10.)*
5. **Multi-device `sync` transport:** CRDT, last-writer-wins, or server-authoritative? *(§8 frontier.)*
6. **Package signing:** sigstore, npm provenance, or a custom scheme? §17's `verify(signature)` needs a concrete signer. *(§16/§17.)* **(R27-12 RESOLUTION: sigstore is the chosen scheme; for third-party `native` it is a RELEASE-BLOCKER — the sigstore signature + SHA-256 content-hash pinned in the release lockfile MUST verify BEFORE `dlopen`. `abiStamp`/`napiVersion` are compatibility guards, not security. The open remainder = sigstore for non-native packages, which may track npm provenance.)** *(C7/R28: partially resolved — sigstore for third-party NATIVE packages = release-blocker; non-native package signing still open.)*
7. **Shell vendoring spike:** which `brush` commit/tag + which uutils subset? napi signatures (e.g. `shell.exec(cmd, opts): Promise<ShellResult>`)? Phase-0 fallback = shell to `/bin/bash` behind a feature flag while vendoring lands. (Blocks the Tier-0 `crates/shell` estimate.)

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
| **ABI stamp** | SPEC-proposed `{rust_core_version, napi_abi}` tag; mismatch = refuse-load (inherited enforcer = version-semver sentinel; full stamp = SPEC upgrade, §23 #6) | mya-v1 #11 / SPEC proposal |
| **DELEGATE_BLOCKED_TOOLS** | hard tool denylist every subagent inherits | hermes |
| **Footprint Ladder** | "how to add capability" ranking (extend → cmd → tool → plugin → MCP → core) | hermes |

---

*Cross-references: per-source detail in sibling `<source>.md`; deep port-designs in `deepdives/0[1-9]*.md`; consolidated idea map in `SYNTHESIS.md`. This SPEC supersedes the mya-v1-specific SYNTHESIS for the successor design.*

**Deepdive translation (R26-B):** the sibling `deepdives/0[1-9]*.md` are Rust/mya-v1 port designs. For this TS-first successor, treat them as **concept reference only**. Translation: Rust `#[serde(tag="state")]` enum → TS discriminated union (literal `state` field); `clippy.toml disallowed-methods` → ESLint `no-restricted-syntax`; `Arc<RwLock<Config>>` → a TS config singleton resolved on demand; Rust modules → TS `packages/*` (or Rust `crates/*` only if they pass the §2 Rust-gate). Where a deepdive contradicts this SPEC, **the SPEC wins** (esp. §9 SkillProvenance, which supersedes deepdive #02/#09).
