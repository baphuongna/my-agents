# SPEC-FIXES — Round 27 (logic + security STRIDE + resilience)

> 5 parallel reviewers found ~44 defects (3 CRITICAL security, 4 CRITICAL resilience, many MAJOR logic bugs). Apply ALL below to `AGENT-SPEC.md`. Sole file owner. Decisions pre-made.

## R27-1 — Rewrite `runTurn()` (§4) — fixes D1-D7,D9,D10,GAP-2,GAP-9,GAP-10
Rewrite the pseudocode to:
- `const stream = await streamWithFallback(...)` (D1: missing await crashed every turn).
- `let usage: TokenUsage = {input:0,output:0}; let cost: Cost = {usd:0};` defaulted (D10); process `usage` BEFORE any `done`-return.
- `ctx.budget.spend(cost)` called on BOTH the Completed path and before each loop continuation (D2/GAP-12: dead budget gate).
- Convert recursion → `while (true) { ...; on no-tool-calls return Completed; after tool-exec: ctx.history.append(...); continue; }` (D4: unbounded stack). Inner **bounded retry**: `for (let retries=0; retries<MAX_RETRIES; retries++)` around the stream section; `continue` on recoverable, escalate to `Failed` at cap (D3).
- Approval partition (D5): `const [askCalls, otherCalls] = partition(calls, c => requiresApproval(c, ctx)); const results = await Promise.all(otherCalls.map(c=>runTool(c,ctx))); for (const c of askCalls) results.push(await runTool(c,ctx));` (ask-tools sequential, others parallel).
- `streamWithFallback` return widens to `{kind:"ok"; profile: ProviderProfile; events: StreamEvent[]; partialCost?: Cost} | {kind:"error"; error}` (D7: attribution + partial cost). On fallback it DISCARDS the failed attempt's partial `calls`/emitted chunks and emits a `Recoverable` naming the rotated profile. On all-profiles-tainted → distinct `AllProvidersDegraded` (not generic Failed). `finish:"length"` MUST run a compression pass BEFORE retrying (couple §5). Partial-stream cost of a user-uninitiated fallback is refunded (not billed). (GAP-2)
- `aggregate(results): ToolResult[] | DegradedResult` — returns `results` when all `ok`, else `{results, failedCallIds}` (D6: dead branch + misreported success). Widen `TurnEvent.ToolExec.result` already `ToolResult[] | DegradedResult` — consistent.
- `repair()` returns `{ok: ToolCall} | {unrepairable; reason}`; unrepairable → synthetic `ToolResult{ok:false,error:"malformed tool_call"}` fed back to the model (GAP-9).
- Retry idempotency (GAP-10): on retry, skip `ToolCall.id`s already in `ToolResult[]`; side-effecting tools declare `idempotent` and the loop refuses to retry non-idempotent ones.

## R27-2 — Permission rank fix (§7) — D8, D9
- `Allow` mode NO LONGER auto-grants `DangerFullAccess`: in step 5, exclude `required_mode === "DangerFullAccess"` from BOTH the `Allow` special-case and the rank comparison → it always escalates to a step-6 prompt. `Allow` = "auto-allow up to WorkspaceWrite; Danger always prompts." (D8 privilege-escalation hole.)
- Document `Prompt` mode = "prompt for writes only; ReadOnly auto-allowed" (D9).

## R27-3 — Skill-write rebuild mechanism (§5/§9) — N1
Add the deferred-trigger mechanism preserving invariant #8: the curator (auxiliary provider) writes ONLY to the skill store + sets a `skillSetDirty: boolean` on shared **session state (not the prompt)**. The **main loop**, at the top of `runTurn` (before the memoized `??=`), checks `session.skillSetDirty`; if set, it calls `rebuildStableTier()` (re-derives `stable` only — identity/tools/skills-index), clears the flag, and preserves the stable⊕context prefix up to that point. The auxiliary provider never touches `session.prompt` (invariant #8 intact). Rename the line-221 comment from "rebuilt only on markCompressed" to the full boundary set.

## R27-4 — MemoryBackend vs MemoryRole split (§8) — N2
Split the interface:
- `MemoryBackend` = read/write STORE interface (`read(query)`, `write(entry: MemoryEntry)`, `durability: Durability`) — for SQLite/Markdown/Qdrant stores.
- `MemoryRole` = lifecycle ROLE interface (`prefetch(store, query)`, `syncTurn(store, ctx)`, `systemPromptBlock(store)`) — the role RECEIVES the canonical store handle and calls role-specific ops THROUGH it (e.g. archivist `syncTurn` → `store.appendTreeLeaf(...)`). Archivist/tree/diff/goals/sync are `MemoryRole`s, NOT `MemoryBackend`s.
- `MemoryManager` owns BOTH `backends: MemoryBackend[]` AND `roles: MemoryRole[]`, and drives `syncTurn` via `syncAll`. Add `appendTreeLeaf`/tree APIs to the store interface so the archivist doesn't bypass the manager.

## R27-5 — Discovered-file-set (§5) — N3
Add: "*The discovered-file-set is re-evaluated ONLY at documented tier boundaries; there is NO continuous file-watcher on the context tier. A mid-session `Write` that creates a context file is invisible to the prompt until the next boundary.*"

## R27-6 — Budget tree-accounting (§21/§10/glossary) — O1, T6, GAP-12, O6
Rework `BudgetConfig`:
```ts
interface BudgetConfig {
  total: number; warningThreshold: number; abortThreshold: number; unlimited: boolean;
  parent?: BudgetConfig;                         // root has none
  remaining(): number;                           // against ROOT total, atomically
  spend(c: Cost): void;                          // REQUIRED (not optional) — atomically increments root counter
  deriveChild(alloc: number): BudgetConfig;      // atomically reserves min(alloc, remaining); pre-charge
  diskBytes?: number; heapBytes?: number;        // R27-12 resource budget
}
```
- SubagentRunner host calls `parent.budget.deriveChild(child.total)` under a lock at spawn (child cannot self-declare); unused delta refunded on child completion.
- Tree-aggregated: every node shares ONE atomic root `spent`; `exhausted()` evaluates against root.
- Hard invariant: a parent with `unlimited:false` MUST NOT spawn `unlimited:true` (type-derived `child.unlimited = parent.unlimited && requested`).
- Add `MAX_DEPTH` + `MAX_TREE_NODES` (not just `MAX_CONCURRENT_SUBAGENTS`).
- Unify field names everywhere (`warningThreshold`/`abortThreshold`) — fix §21 prose to match glossary (O6).
- Mid-stream cost watermark in `streamWithFallback` cancels the stream when cumulative-turn cost > `abortThreshold`.

## R27-7 — CoW merge-back policy (§10) — O2
Replace the misleading "no merge conflicts" with an explicit policy: child yields `{ ok: true; data: unknown; changedPaths?: string[] }`. The parent 3-way-merges using the CoW base snapshot as common ancestor; on conflict → `SubagentResult` becomes `{ ok: false; error: ConflictError }` (child may retry or parent resolves). hashline guards line-level silent overwrite. State: "*file edits are NOT auto-merged silently; conflicts surface as typed errors.*"

## R27-8 — DELEGATE_BLOCKED_TOOLS bridge filter (§10/§11) — O3
Add: "*The code-exec bridge's `callTool(name,args)` is filtered by the SAME `DELEGATE_BLOCKED_TOOLS` as the child's direct toolSurface — blocked names rejected. The bridge kernel process inherits the child's OS sandbox (§14), so `subprocess`/`Bun.spawn` cannot escape blocked capabilities. Restricted children may also drop `codeExecBridge` from their surface entirely.*"

## R27-9 — Hierarchical approval propagation (§10) — O4
Add: "*In `hierarchical` topology a child MUST forward the same `ApprovalChannel` it received. Requests carry `{ chainDepth; originalRequester: LaneId }`. `MAX_APPROVAL_CHAIN_DEPTH` (default 3); exceeding fail-closes to Deny. A child MAY wrap the channel in a delegating proxy that auto-approves a declared subset, never auto-denies.*"

## R27-10 — resultSchema failure recovery (§10) — O5
- Add `"subagent" | "validation"` to `LifecycleError.phase`.
- On schema-validation failure: bounded repair — re-prompt the child with the AJV error path + schema, `SUBAGENT_SCHEMA_REPAIR_RETRIES` (default 1); if still failing → error.
- Add `partial?: unknown` to the error variant (raw invalid yield for salvage).

## R27-11 — Package runtime security (§17) — T1, T2, T8 (CRITICAL)
Rewrite §17 package isolation HONESTLY:
- The static lint ban on `node:fs/net/child_process` is **defense-in-depth ONLY and is bypassable** (eval, dynamic import, globals `Bun.spawn`/`fetch`, transitive deps) — NOT a security boundary. State this explicitly.
- The REAL boundary is **runtime**: Tier-0 ships a **runtime module-load allowlist** (Node `--experimental-policy` / Bun loader hook) intercepting `require`/`import` of `node:*` builtins at runtime for package code; non-allowlisted access refused.
- `register`/`activate` runs top-level module code in-process — this is a code-execution trust boundary (bigger than npm lifecycle scripts). Default `PackageManifest.runtime.isolation`:
  - `in-process` ONLY for **sigstore-signed first-party** packages (`trusted: true` + verified sigstore — resolve §23 #6 first);
  - `worker` (worker_threads, napi proxied via postMessage — pays structured-clone round-trip) for unsigned third-party;
  - `isolated-vm` for max sandbox (CANNOT call napi — packages lose Rust natives).
- Declared `PackageManifest.scripts` run under the §14 seccomp/seatbelt enforcer with a cwd-jail at install time (not "undefined sandbox").
- Remove the implication that in-process packages are safe; the §14 OS sandbox governs TOOL EXEC + install scripts, NOT package module-eval.

## R27-12 — napi native resilience + signature (§14 new subsection + §17 + §23) — T3, GAP-1, GAP-11 (CRITICAL)
Add **§14b "Native Crash & Process Resilience":**
- Every napi entry wraps its body in `std::panic::catch_unwind` → returns typed `NativeResult { Ok(_) | Panic(backtrace) }`; **napi natives MUST NOT `abort!`/`process::exit`** (new invariant #14) — panics propagate as typed errors, never process death.
- Trust-boundary natives (`shell`, `sandbox` enforcers) run in a **subprocess/sidecar** with a `LaneBoard` death signal + bounded auto-restart — a brush segfault becomes a `Failed{phase:"sandbox"}` turn, not a process corpse.
- Third-party `.node` binaries: **sigstore signature + SHA-256 content-hash pinned in the release lockfile** MUST verify BEFORE `dlopen` (resolve §23 #6 as a RELEASE-BLOCKER for third-party `native`). `abiStamp`/`napiVersion` are COMPATIBILITY guards, not security.

## R27-13 — hashline cryptographic tag (§7) — T4
Replace "xxHash32, 4-hex (16-bit)" with: "*content-addressed tag = **BLAKE3, first 16 hex (64-bit minimum)**, AND the patcher ALWAYS verifies `snapshot.text === liveContent` (full-text equality) before applying.*" Document: "*hashline is an **accidental-drift** guard; against an adversary it relies on the full-text equality gate, not the tag.*"

## R27-14 — Tool-call repair audit (§6/§13) — T5
- Add `RuntimeEvent` variant `{kind:"repair"; raw: string; repaired: ToolCall; resolver: string}` emitted whenever `repaired !== raw` → enters the Merkle audit log.
- `resolveToolName` is a **pure deterministic config-declared mapping** (not arbitrary callback); unit-tested for identical-input-identical-output.
- Mandate the role-gate: a tool-call block embedded in a TOOL RESULT (not an assistant turn) is NEVER promoted.

## R27-15 — Injection scanner honesty + scope (§5/§12/§14) — T7
- Document the scanner as **defense-in-depth, NOT a boundary**; the real control is **privilege separation** (untrusted context can never raise `active_mode`).
- Remove the 64 KiB truncation (scan a sliding window with overlap); add TR#39 confusables detection.
- Channel messages (§12) MUST pass through `scanInject` with `scope="context"` before entering history.

## R27-16 — Merkle audit-log scope (§14) — T10
"*The Merkle audit log covers ALL `RuntimeEvent.kind==="tool"` entries (every tool surface, not just MCP writes) PLUS `approval` and `repair` events; channel messages are logged on receipt.*"

## R27-17 — Provider hooks re-scan (§6/§14) — T12
"*`prepare_messages` output is re-scanned by `scanInject` before the wire call; secrets redaction (§14) runs AFTER `prepare_messages`, not only in tool Pre-hooks.*"

## R27-18 — Memory drain durability (§8) — GAP-3
- `syncAll` returns `DrainReport { completed; timedOut; lostWrites: MemoryEntry[] }`; lost writes → `RuntimeEvent{kind:"health",tri:"Degraded"}` + persisted to a crash-recovery journal for replay on next boot.
- Per-backend `Durability { BestEffort, Durable, DurableWithWal }`; `Durable` writes fsync before the drain timer; a WAL/spill-file for the in-flight queue so a 5s-timeout write survives.
- `lostWrites` count surfaced as a LaneBoard/health signal.

## R27-19 — LaneBoard AwaitingHuman (§13) — GAP-5
Add `LaneFreshness = "Healthy" | "Stalled" | "TransportDead" | "Unknown" | "AwaitingHuman"`. A lane whose turn is `AwaitingApproval` classifies as `AwaitingHuman{since, approvalRequest}` — EXEMPT from `Stalled` timeout escalation; reapers MUST NOT kill it without operator action; `approvalEscalationTimeoutS` (default 24h) escalates (notify) rather than discards. `LaneHeartbeat` gains `blockedOn?: "approval"`.

## R27-20 — Disk/OOM resource handling (§5/§8/glossary) — GAP-6
- Add `LifecycleError.phase = "resource"` (recoverable).
- Compression is ATOMIC: write the CCR original BEFORE replacing the live-zone block (write-ahead) — a mid-write ENOSPC leaves history uncompressed, not torn.
- Add `ResourceBudget { diskBytes, heapBytes }` to `BudgetConfig`; pre-compression `worth_compressing` refuses blocks whose CCR-original would exceed disk; bound compression input size (forward-original above N MB).
- `MemoryBackend.write` returns `WriteResult { Ok | Durable | Spilled(pendingCount) | ResourceExhausted }`.

## R27-21 — Golden-set versioning (§5/§15) — GAP-4
Tag every golden fixture `{ modelId; modelVersion; providerProfileHash; recordedAt; goldenSetSchema: "v1" }`. A scheduled job re-records against the LIVE model and flags drift as a health `Degraded`. The merge-block gate FAILS if the golden set's `modelVersion` is older than `maxGoldenAgeDays` (forces regeneration). Pin `expectedAnswer` generation to `--deterministic` + store the seed.

## R27-22 — Auxiliary-provider health (§6/§9/§13) — GAP-7
The auxiliary provider registers as `ComponentHealth` components (`"curator-aux"`, `"memory-reflection-aux"`); a failed `resolve_aux_provider` or failed LLM pass emits `RuntimeEvent{kind:"health",tri:"Degraded"}`. On boot, if `curator.enabled=true` but `auxiliary.curator` is unset/misconfigured → loud startup warning (not silent fallback-to-main, which would violate invariant #8). Add a LaneBoard lane for the curator.

## R27-23 — markCompressed serialization (§5/§18) — GAP-8
`SystemPrompt` is **COW-immutable**: `markCompressed`/`rebuildStableTier`/`rebuildVolatile` each build a new `volatile`/`stable` and atomically swap an `Arc<SystemPrompt>` (readers always see a consistent snapshot). Add invariant #15: "*the prompt struct is COW-immutable; tier rebuilds are the sole mutators and MUST be serialized via typed `PromptMutex` — `markCompressed` never races a reader.*" Add a concurrent-stress test (2 rebuilds + 1 reader) to the drift-gate suite.

## NOT defects (keep)
- knowledge:// second external provider — by-design (R25-20).
- §14 security post-R24, §12 gateway rename — clean.
