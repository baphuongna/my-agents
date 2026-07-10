# SPEC-FIXES — Round 26 (buildability + R25-verify)

> From the adversarial buildability review (8 BUILD-BLOCKERS + 12 MAJOR + 8 MINOR) + R25 verifier residuals. The headline finding: the SPEC references ~18 types and 7 helper functions that are NEVER defined, so it is not actually transcribable to code. Apply all below to `AGENT-SPEC.md`. Sole file owner.

## R26-A — Add a "Complete type glossary" block (resolves ~15 defects at once)
Insert a new code block in §4 (after the existing Core-primitives block, before the turn loop) titled **"Complete type glossary (round 26 — every referenced name, defined ONCE)"** defining:
```ts
// --- Permission (§7) ---
type Mode = "ReadOnly" | "WorkspaceWrite" | "DangerFullAccess" | "Prompt" | "Allow";
const MODE_RANK: Record<Mode, number> = { ReadOnly:0, Prompt:1, WorkspaceWrite:2, DangerFullAccess:3, Allow:4 }; // §7 step-5 "active ≥ required" uses this ordering
type PermissionOutcome = { outcome: "Allow" } | { outcome: "Deny"; reason: string };
interface ApprovalRequest { call: ToolCall; reason: string; currentMode: Mode; requiredMode: Mode }
type ApprovalDecision = { decision: "Allow" } | { decision: "Deny"; reason: string };
// --- Session / prompt (§5) ---
interface SystemPrompt { stable: string; context: string; volatile: string }
interface Session { profiles: ProviderProfile[]; stableTier: string; ctxFiles: string[]; memory: MemoryManager; userMd: string; prompt?: SystemPrompt; history: History }
interface History { append(entry: unknown): void }
// --- Memory (§8) ---
type MemoryRole = "archivist" | "tree" | "diff" | "goals" | "sync" | "working";
interface MemoryQuery { text: string; role?: MemoryRole; topK?: number }
interface MemoryHit { id: string; role: MemoryRole; content: string; score: number }
interface MemoryEntry { role: MemoryRole; content: string; metadata?: Record<string,string> }
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
interface BudgetConfig { total: number; warningThreshold: number; abortThreshold: number; unlimited: boolean; exhausted(): boolean; spend?(c: Cost): void }
// --- Extensions (§17) ---
interface ExtensionAPI { registerTool(t: unknown): void; on(e: string, h: (...a: unknown[]) => void): void; /* deliberately limited — no fs/net/child_process */ }
// --- Turn-loop helper signatures (§4) ---
declare function streamWithFallback(profiles: ProviderProfile[], prompt: SystemPrompt, history: History): Promise<{ kind:"ok"; events: StreamEvent[] } | { kind:"error"; error: LifecycleError }>;
declare function computeCost(u: TokenUsage): Cost;
declare function repair(call: ToolCall): ToolCall;            // §6 3-stage: stream-normalize→grammar/payload parse→promote
declare function aggregate(results: ToolResult[]): DegradedResult;
declare function toolTurn(calls: ToolCall[], results: ToolResult[]): unknown;
declare const budgetError: LifecycleError;
```
After adding, the §4 turn-loop pseudocode now type-checks (profiles, stream.kind/events, computeCost, repair, aggregate, toolTurn, budgetError all defined). *(Resolves BB-2, BB-3, M-8, M-11, M-12, M-14, M-17, m-19, m-20, m-26, M-16 final.)*

## R26-B — Deepdive translation note (BB-1)
Add a note near the §20 roadmap (or the cross-ref footer): **"Deepdive translation:** the sibling `deepdives/0[1-9]*.md` are Rust/mya-v1 port designs. For this TS-first successor, treat them as **concept reference only**. Translation: Rust `#[serde(tag="state")]` enum → TS discriminated union (literal `state` field); `clippy.toml disallowed-methods` → ESLint `no-restricted-syntax`; `Arc<RwLock<Config>>` → a TS config singleton resolved on demand; Rust modules → TS `packages/*` (or Rust `crates/*` only if they pass the §2 Rust-gate). Where a deepdive contradicts this SPEC, **the SPEC wins** (esp. §9 SkillProvenance, which supersedes deepdive #02/#09)."

## R26-C — Fix the cross-ref glob (M-13) + deepdive supersession (M-9/M-10)
- Footer: `deepdives/0[1-7]*.md` → **`deepdives/0[1-9]*.md`**.
- Add to §9 (skills): "*SPEC §9 supersedes deepdive #02's `curator_can_archive()` (which allowed only `AgentCreated`) and deepdive #09's 3-variant `SkillProvenance` — the SPEC's 4-value enum + built-in curation (R24-F17/F18) is authoritative.*"

## R26-D — Concurrent-approval serialization (BB-6)
Add to §4 (after the `Promise.all` line) and §7 step 5: **"Tools requiring approval (an `ask` rule matches, or hook `Ask`) execute SEQUENTIALLY — pulled OUT of the `Promise.all` batch; each emits `AwaitingApproval` and blocks until `ApprovalChannel.request()` resolves. Non-approval tools run in parallel. A `Deny` does not cancel sibling pending calls (each tool decides independently)."**

## R26-E — Canonicalize the 4 transport modes (M-7)
Every mention (§3 workspace map comment, §17, §20 Tier-0, §21 deployment) must read the SAME canonical set: **`interactive` (TUI) · `print` (one-shot stdout, `--json` flag toggles JSON vs text) · `rpc` (stdio JSON-RPC server) · `sdk` (embeddable library)**. Fix §17 (which currently lists interactive/print/json/rpc, dropping SDK and splitting print/json) to the canonical 4.

## R26-F — Drift-grader Tier-0 interface stub (BB-4)
In §5 DriftGrader + §20 Tier-0 bullet, add: "*the Tier-0 drift grader depends only on the `Compressor` + `LlmTrace` interface stubs (R26-A); concrete compressors are Tier-1 — the grader is shipped with a no-op/identity compressor in Tier 0 and upgraded when Tier-1 compressors land.*"

## R26-G — Shell-vendoring spike (BB-5)
Add to §23 Open Questions: "**Shell vendoring spike:** which `brush` commit/tag + which uutils subset? napi signatures (e.g. `shell.exec(cmd, opts): Promise<ShellResult>`)? Phase-0 fallback = shell to `/bin/bash` behind a feature flag while vendoring lands. (Blocks the Tier-0 `crates/shell` estimate.)"

## R26-H — Small prose/code fixes
- **M-15:** §18 invariant #6 enforcer → "*[ENFORCED: `@typescript-eslint/no-explicit-any` as error + code-review checklist for `as unknown as T` casts.]*" (drop "surviving past construction" — not expressible; TS has no `Stub<T>` convention.)
- **M-18:** "(§7 step 5, invariant #13)" → **"(§7 step 4, invariant #13)"** in BOTH locations (§4 AwaitingApproval comment + §13) — hook-Allow→ask is steps 3→4.
- **m-23:** §13 time helper → "*Single time helper (`core.time.now()` in TS / `now_wallclock`+`now_monotonic` in Rust natives)*".
- **m-25:** §3 workspace map — rename `packages/tools/`→`packages/extensions/` and `packages/prompts/` stays (or add note: "*dir names are implementation-level; `PackageManifest.kind` is canonical*"). Pick: rename to `extensions/` for consistency with §17.
- **M-11:** §13 `LaneHeartbeat.status: String` and `LaneBoardEntry.status: String` → `status: LaneStatus` (LaneStatus now defined in R26-A glossary).

## NOT defects (keep / already fixed)
- R25-4 streamWithFallback wrapper — being finalized by R26-A glossary.
- §14 security, §12 gateway rename — clean.
- m-22 (Pending/Aggregating internal) — already commented.
- m-21 (compression Rust ChatMessage vs TS History) — acknowledged as Tier-1 boundary; note in §5: "*compression may run in Rust (napi, history serialized) or TS; the napi history-serialization boundary is a Tier-1 detail.*"
