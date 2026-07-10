# Core Loop & Turn Lifecycle

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §4.



## 4. Core Agent Loop & Turn Lifecycle

**Typed FSM per turn** *(source: [claw-code](../../claw-code/) `PluginState`, `TaskStatus`, `McpLifecyclePhase`)* — `#[serde(tag="state")]`-style (on `PluginState`; `TaskStatus`/`McpLifecyclePhase` use `rename_all` only) (TS: discriminated union):
```
TurnState = Pending → Streaming → ToolCalls → AwaitingApproval → ToolExec → Aggregating →
            { Completed | Recoverable{retries} | Failed{phase,context,retries} | Cancelled }
```
- Every failure carries `phase + recoverable: boolean + context: Record<string,string> + retries: number` (values are always String). Observers pattern-match; recovery is **bounded `max_retries` (default 3)** — recoverable errors resume up to the cap, then escalate to `Failed`. *(source: [claw-code](../../claw-code/) `McpErrorSurface`; R25-6 reconciles the unlimited-vs-once contradiction — bounded is chosen.)*
- **Partial success is first-class (round 24 — VERIFIED, claw-code `plugin_lifecycle.rs`):** aggregate per-server `ServerHealth { status: Healthy|Degraded|Failed, capabilities, last_error }` → `PluginState` via `from_servers()`: no servers ⇒ `Failed`; no failed/degraded ⇒ `Healthy`; no usable servers ⇒ `Failed`; else `Degraded { healthy_servers, failed_servers }`. **Nuance: a `Degraded` server stays USABLE (kept in `healthy_servers`) — only `Failed` servers are excluded.** `DegradedMode { available_tools, unavailable_tools, reason }` exposes which tools survived — the actionable part for the loop. `startup_event()`/`is_startup_terminal()` map the 8 lifecycle states (`Unconfigured…Stopped`) onto the 3 terminal startup outcomes (`StartupHealthy|StartupDegraded|StartupFailed`) so observers pattern-match on data. *(source: [claw-code](../../claw-code/) `PluginState`/`PluginLifecycle` trait: validate_config/healthcheck/discover/shutdown.)*
- **LaneBoard liveness aggregator:** subagents + cron + channel listeners emit `{observedAt, transportAlive, status}` → board classifies each as `Healthy | Stalled | TransportDead | Unknown | AwaitingHuman` ([§13 LaneFreshness](08-observability-security.md)). One place to ask "who's stuck". *(source: [claw-code](../../claw-code/) `LaneBoard`.)*

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
  // subagent/validation added (R27-10), resource added (R27-20); "sandbox" phase removed (R30
  // sandbox-removal — no sandbox/sandbox sidecar remains to produce it)
  phase: "stream" | "tool" | "provider" | "auth" | "quota" | "memory"
        | "subagent" | "validation" | "resource";
  recoverable: boolean;
  retries: number;                            // R25-6: bounded retry count
  context: Record<string, string>;
  partial?: unknown;                          // R27-10: raw invalid yield for salvage (validation phase)
  cause?: unknown;
};
```

**Core primitives (round 25 — defined ONCE; referenced by the turn loop, [§6 Providers](02-providers.md), [§7 Tools](03-tools-permission.md), [§13 Observability](08-observability-security.md)):**
```ts
type StreamChunk = StreamEvent;                         // §6
interface ToolCall { id: string; name: string; args: unknown }
interface ToolResult { callId: string; ok: boolean; output: unknown; error?: string; degraded?: boolean }
type DegradedResult = { results: ToolResult[]; failedCallIds: string[] }
interface TokenUsage { input: number; output: number; cacheRead?: number; cacheCreation?: number }   // R36: cacheCreation added (provider-telemetry split, ponytail pattern)
type Cost = { usd: number }
interface TurnContext { session: Session; history: History; budget: BudgetConfig; approval: ApprovalChannel; emit: (te: TurnEvent) => void; lane?: { taskId: LaneId; setBlockedOn(b: "approval"|undefined): void }; cancel?: AbortSignal }
type ApprovalChannel = { request(r: ApprovalRequest): Promise<ApprovalDecision> }
interface PermissionContext { override?: "Deny"|"Ask"|"Allow"; tool: string; args: unknown; activeMode: Mode; requiredMode: Mode }
type PermissionDecision = PermissionOutcome;                  // §13 uses PermissionDecision, §7 defines PermissionOutcome
type LifecycleState = TurnState;                              // §13 referenced these undefined
type LaneId = string /* == taskId */;
type LaneStatus = "running"|"idle"|"done"|"failed"|"blocked";
```

**Complete type glossary (round 26 — every referenced name, defined ONCE):**
*(Resolves the ~18 types + 7 helper functions the turn loop and [§6 Providers](02-providers.md)/[§7 Tools](03-tools-permission.md)/[§8 Memory](05-memory.md)/[§13 Observability](08-observability-security.md)/[§15 Eval](09-eval-supply.md)/[§17 Packages](10-packages.md)/[§21 Cross-cutting](11-invariants-roadmap.md) reference but never defined — R26-A; BB-2/BB-3/M-8/M-11/M-12/M-14/M-16/M-17/m-19/m-20/m-26.)*
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
// R29-8: prompt-serialization primitive (invariant #15, §4 tier rebuilds)
interface PromptMutex { withLock<T>(fn: () => T): T; }   // the §15 serialization primitive; tier rebuilds are the sole mutators
// R29-8: auxiliary-provider interface (§9 skill curator / §8 memory side tasks; NEVER touches main prompt cache — invariant #8)
interface AuxiliaryProvider { resolve(): ProviderProfile; health(): ComponentHealth }
// --- Memory (§8) ---
// R27-4: MemoryRole (interface, lifecycle role) is defined in §8; this is the role IDENTIFIER (string).
type MemoryRoleId = "archivist" | "tree" | "diff" | "goals" | "sync" | "working";
interface MemoryQuery { text: string; role?: MemoryRoleId; topK?: number }
interface MemoryHit { id: string; role: MemoryRoleId; content: string; score: number }
interface MemoryEntry { role: MemoryRoleId; content: string; metadata?: Record<string,string> }
interface MemorySnapshot { entries: MemoryHit[]; generatedDay: number }   // day-precision (R25-15)
// R29-8: types referenced from §8 (05-memory.md)
type ScanVerdict = { allowed: true } | { allowed: false; reason: string; matchedPattern?: string };   // ragfs double-scan resolution (R25-18)
interface KnowledgeGraph { entities: { id: string; type: string; name: string }[]; relations: { from: string; to: string; kind: string }[] }   // read-only entity graph; ragfs knowledge:// source (R25-19); R36 fields filled
interface ContextSource { scheme: string; list(q: MemoryQuery): Promise<MemoryHit[]>; read(uri: string): Promise<string>; grep(pattern: string): Promise<MemoryHit[]> }
// --- Observability (§13) ---
type ComponentId = string;
type ComponentHealth = "Healthy" | "Degraded" | "Failed";
// --- Subagents (§10) ---
// R29-6/M2: tool definition interface (§7 registry).
interface Tool { name: string; args: JSONSchema; requiredMode: Mode; allowedToolNames?: string[]; idempotent?: boolean }
//   allowedToolNames?: empty = no constraint; promotion (resolveToolName) requires the resolved name ∈ the set.
type ToolSet = { allowed: string[]; blocked: string[] };
//   R29-6/M3: precedence — `blocked` takes precedence; effective surface = (allowed.empty ? all : allowed) − blocked − DELEGATE_BLOCKED_TOOLS.
//   R29-6/M4: canonical denylist every subagent inherits + config knob to extend:
const DELEGATE_BLOCKED_TOOLS = new Set(["task","delegate","codeExecBridge","spawn","exec","bash"]);
type JSONSchema = import("ajv").JSONSchemaType<unknown>;   // Draft-07; JTD normalized to this (§10)
// R29-8: types referenced from §10 (defined in their home file, 06-skills-subagents.md)
interface SubagentRunner { spawn(s: SubagentSpawn): Promise<SubagentResult>; }   // §10 host; derives child budget + refunds
interface ConflictError { path: string; baseHash: string; childHash: string; parentHash: string; hunks?: {base:[number,number]; child:[number,number]}[] }
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
  resource?: ResourceBudget;                     // R27-12/R27-20: resource budget (disk+heap caps; see ResourceBudget interface below)
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

// R29-1: requiresApproval is SYNC — evaluates steps 1–3 only (denied_tools / deny / hook override) — NO human prompt.
//   Returns the decision + a flag; the human round-trip is a separate async step (R29-1/B1 option a).
//   CC6: steps 1–3 run ONCE and the cached decision is REUSED by runTool (no double eval).
declare function requiresApproval(c: ToolCall, ctx: TurnContext): PermissionDecision & { needsHumanPrompt: boolean };
declare function awaitHumanPrompt(c: ToolCall, ctx: TurnContext): Promise<PermissionDecision>; // §7 step 4 ask-rule round-trip
// R29-1: runTool awaits awaitHumanPrompt for needsHumanPrompt decisions before executing.
declare function runTool(c: ToolCall, decision: PermissionDecision, ctx: TurnContext): Promise<ToolResult>;
// R29-1: prompt-assembly + tier-rebuild helpers (referenced by the turn loop + §5 compression).
declare function assemblePrompt(s: Session): SystemPrompt;
declare function rebuildStableTier(s: Session): void;     // re-derives stable only, under PromptMutex (invariant #15)
declare function rebuildVolatile(s: Session): void;       // re-snapshots volatile only
declare function markCompressed(s: Session): void;        // = compress history + rebuildVolatile, under PromptMutex
declare function buildVolatileTier(snap: MemorySnapshot, userMd: string, day: number): string;   // R29-2: composes MemoryManager.snapshot() with userMd + day
// R29-8: injection scanner (ragfs-deferred for ragfs-sourced files — §5/§8 double-scan resolution). scope: context(default)|wire|direct (R36: widened to match §5/§12 usage)
declare function scanInject(files: string[], scope?: "context"|"wire"|"direct"): string;
declare function compressHistory(history: History): void;   // VM1: §5 compression pass (called on finish:"length"); may throw ResourceExhausted → Recoverable{phase:"resource"} (CC12)
const MAX_ATTEMPTS = 3;                                                          // C10: total attempts INCL. the first try (so 2 retries); renamed from the old stream-retry cap
// --- R29-8: Tier-0 constants (canonical defaults) ---
const MAX_APPROVAL_CHAIN_DEPTH = 3;
const SUBAGENT_SCHEMA_REPAIR_RETRIES = 1;
const MAX_CONCURRENT_SUBAGENTS = 8;
const MAX_DEPTH = 4;
const MAX_TREE_NODES = 64;
const MAX_SIZE = 128;
const IDLE_TTL_SECS = 3600;
const SSE_BUFFER_BYTES = 16*1024*1024;
const maxGoldenAgeDays = 30;
const SYNC_DRAIN_TIMEOUT_S = 5;
const approvalEscalationTimeoutS = 24*3600;

// --- R36: helper types referenced across § but previously undeclared (buildability) ---
declare namespace core.time { function nowWallclock(): number; function nowMonotonic(): number; function today(): number /* epoch-day, day-precision */ }   // invariant #10; replaces bare today()/Date.now()
interface ShellResult { stdout: string; stderr: string; exitCode: number; durationMs: number }   // §23 #7 + Tier-0 shell contract (§20); bash tool returns this
type KnowledgeContextSource = ContextSource & { scheme: "knowledge" };   // ragfs knowledge:// adapter over KnowledgeGraph (R25-19, R36)
declare function stringEquals(a: string, b: string): boolean;   // DriftGrader.grade() helper (§5, R29-4)
// defaultTotal = $5/session, $0.50/turn
```
*After this glossary the [§4 Core Loop](01-core-loop.md) turn-loop pseudocode type-checks: `profiles`, `stream.kind/events`, `computeCost`, `repair`, `aggregate`, `toolTurn`, `budgetError` all resolve. `ProviderProfile` ([§6 Providers](02-providers.md)), `MemoryManager` ([§8 Memory](05-memory.md)), and `StreamEvent` ([§6 Providers](02-providers.md)) are defined once in their home sections and referenced here. R27-1 widens `streamWithFallback`/`repair`/`aggregate` returns; R27-6/R27-20 add `BudgetConfig` tree-accounting + `ResourceBudget`; R27-12 adds `NativeResult`; R27-18 adds `DrainReport`/`WriteResult`/`Durability`.*

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
    // R29-3: cancellation support — check at the top of each iteration.
    if (ctx.cancel?.aborted) return finish({ state: "Cancelled", reason: ctx.cancel.reason ?? "abort" });
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
    //    CC6 (double-eval fix): steps 1–3 decision is computed ONCE by requiresApproval (SYNC); the
    //    ask-rule human prompt runs via awaitHumanPrompt inside runTool — authorize is NEVER re-invoked.
    //    R29-1 (async semantics): requiresApproval is SYNC (steps 1–3 only — no human prompt); it returns
    //    {decision, needsHumanPrompt}. runTool awaits awaitHumanPrompt for needsHumanPrompt decisions.
    //    The human round-trip is a separate async step so non-ask tools launch without waiting for it.
    //    CC5 (false-kill race): before any human prompt, blockedOn:"approval" is set on the heartbeat
    //    ATOMICICALLY BEFORE the AwaitingApproval emit (equivalently the heartbeat reads TurnState
    //    directly) — so an approval-pending lane is never misclassified Stalled and reaped.
    //    CC11 (interleaved launch): ask-tools (which block on human input) launch CONCURRENTLY with the
    //    non-ask batch rather than after it; R26-D human-prompt serialization is preserved by the
    //    ApprovalChannel surfacing ONE prompt at a time, so non-ask latency no longer gates the human.
    //    A Deny does not cancel siblings (each tool decides independently). runTool emits
    //    {kind:"tool";decision;result} per call (no throw on Deny — typed ToolResult). (R25-4d)
    const fresh = calls.filter(c => !doneIds.has(c.id));            // GAP-10: skip already-executed ids
    const decisions = new Map(fresh.map(c => [c.id, requiresApproval(c, ctx)]));  // CC6: sync steps 1–3, cache {decision, needsHumanPrompt}
    const results: ToolResult[] = await Promise.all(fresh.map(async c => {       // CC11: concurrent launch
      const d = decisions.get(c.id)!;
      if (d.needsHumanPrompt) { ctx.lane?.setBlockedOn("approval"); }            // CC5: set blocked BEFORE the prompt
      const final = d.needsHumanPrompt ? await awaitHumanPrompt(c, ctx) : d;     // R29-1: human round-trip for ask-rules only
      if (d.needsHumanPrompt) { ctx.lane?.setBlockedOn(undefined); }             // CC5: clear after the prompt
      return runTool(c, final, ctx);                                             // execute under the (possibly human-confirmed) decision
    }));
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

**Completeness (R31)** — CORE turn/session mechanics folded in from [FEATURE-INVENTORY](../../.learned/FEATURE-INVENTORY.md) Part 1 (load-bearing features a Tier-0/1 builder needs, kept lean — full detail at source):

| Feature | 1-line | Source |
|---|---|---|
| **ToolSearch / deferrable tools** | long-tail tools kept out of the prompt until BM25-queried or `select:`-activated; lazy activation when token budget exceeded | [hermes](../../hermes-agent/tools/tool_search.py) · [claw-code](../../claw-code/src/reference_data/tools_snapshot.json) |
| **TodoWrite / plan-mode** | structured per-session task list (`TodoWrite`) + `EnterPlanMode`/`ExitPlanMode` toggle (worktree-level) — ships as a package | [pi plan-mode](../../pi-coding-agent/examples/extensions/plan-mode/index.ts) |
| **Message queue (steer/followUp/nextTurn)** | queue messages mid-turn; `Alt+Enter` queues, `Alt+Up` restores; typed delivery modes | [pi](../../pi-coding-agent/src/core/agent-session.ts) |
| **`!cmd` / `!!cmd` editor prefixes** | `!` = run + send output to LLM; `!!` = run + exclude from context; per-message `BashExecutionMessage` | [pi](../../pi-coding-agent/src/core/tools/bash.ts) |
| **Overflow-recovery compaction** | on `context_length_exceeded` stop: drop the failed message, compact, retry once | [pi compaction/](../../pi-coding-agent/src/core/compaction/) · [claw-code](../../claw-code/) |
| **Session JSONL tree + entry types** | tree-structured (`id`/`parentId`); entry kinds (message/model_change/compaction/branch_summary/custom/label); v1→v2→v3 migration | [pi](../../pi-coding-agent/src/core/session-manager.ts) · [claw-code](../../claw-code/rust/crates/runtime/src/session.rs) |
| **Context-window preflight** | reject a provider request where est. input+output > `context_window` with a typed error (before the wire call) | [claw-code](../../claw-code/rust/crates/api/src/providers/mod.rs) |
| **Unified cancel protocol** | `CancelReason = user\|timeout\|upstream\|shutdown\|error`; `AbortSignal.any` polyfill; cancellable fetch/delay — enriches `TurnContext.cancel` | [MyAgents](../../MyAgents/src/server/utils/cancellation.ts) |

---
