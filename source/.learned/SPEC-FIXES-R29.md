# SPEC-FIXES — Round 29 (Tier-0 readiness + split-induced drift)

> Cold-implementer found 7 BUILD-BLOCKERS + 10 MAJOR (mostly undeclared helpers + unspecified algorithms); cross-file found split-induced duplication/drift. Apply to files under `source/.learned/spec/` (sole ownership of all spec/*.md). Decisions pre-made.

## R29-1 — Declare the missing runTurn helpers + fix async semantics (01-core-loop.md) — B1,B2,B3,M5
Add to the §4 glossary helper-signatures:
```ts
// requiresApproval is SYNC: evaluates steps 1–3 only (denied_tools / deny / hook override) — NO human prompt.
// Returns the decision + a flag; the human round-trip is a separate async step (B1 option a).
declare function requiresApproval(c: ToolCall, ctx: TurnContext): PermissionDecision & { needsHumanPrompt: boolean };
declare function awaitHumanPrompt(c: ToolCall, ctx: TurnContext): Promise<PermissionDecision>; // §7 step 4 ask-rule round-trip
declare function runTool(c: ToolCall, decision: PermissionDecision, ctx: TurnContext): Promise<ToolResult>;
declare function assemblePrompt(s: Session): SystemPrompt;
declare function rebuildStableTier(s: Session): void;     // re-derives stable only, under PromptMutex (invariant #15)
declare function rebuildVolatile(s: Session): void;       // re-snapshots volatile only
declare function markCompressed(s: Session): void;        // = compress history + rebuildVolatile, under PromptMutex
declare function buildVolatileTier(snap: MemorySnapshot, userMd: string, day: number): string;
```
Fix the runTurn partition call to match (sync `requiresApproval`, then `runTool` awaits `awaitHumanPrompt` for `needsHumanPrompt` decisions). Add `lane?: { taskId: LaneId; setBlockedOn(b: "approval"|undefined): void }` to `TurnContext` (M5); set `ctx.lane?.setBlockedOn("approval")` BEFORE the human prompt, clear after.

## R29-2 — Fix the dual `snapshot` definition (B4)
In `04-prompt-compression.md`, replace the free function `snapshot(s.memory, s.userMd, today())` with `buildVolatileTier(s.memory.snapshot(), s.userMd, today())` — `MemoryManager.snapshot()` (zero-arg instance method, §8) is canonical; `buildVolatileTier` composes it with userMd + day.

## R29-3 — Make `Cancelled` first-class (B5)
Add `cancel?: AbortSignal` to `TurnContext`; at the top of the runTurn while-loop, `if (ctx.cancel?.aborted) return finish({ state:"Cancelled", reason: ctx.cancel.reason ?? "abort" });`.

## R29-4 — Specify the DriftGrader `grade()` algorithm (B6) — 04-prompt-compression.md + 09-eval-supply.md
Add a concrete algorithm block:
```
grade(c: Compressor): { passRate; maxScoreDelta }
  for each golden g in this.golden:
    uncompressed_ok = stringEquals(g.trace.responses.join(), g.expectedAnswer)            // baseline (no compression)
    compressed_msgs = c.compress(g.trace.messages)
    compressed_ok   = stringEquals(replayResponses(compressed_msgs, g.trace.responses), g.expectedAnswer)
    agree = (uncompressed_ok === compressed_ok)                                             // ε=0: compression must not flip the answer
  passRate       = count(agree) / golden.length
  maxScoreDelta  = 0                                                                       // ε=0 by default
  // Tier-0 no-op compressor ⇒ compressed_msgs === messages ⇒ agree always true ⇒ passRate=1.0 trivially.
```
`replayResponses` = a deterministic MockProvider replay (canned `responses` aligned to `messages`). State: "merge BLOCKED unless passRate === 1.0 && maxScoreDelta === 0 (ε=0); Tier-0 no-op compressor passes trivially."

## R29-5 — Tier-0 shell fallback contract (B7) — 08-observability-security.md or 11-invariants-roadmap.md
Add: "Phase-0 `shell.exec(cmd: string, opts: { cwd?; env?; timeoutMs? }): Promise<ShellResult>` shells to `/bin/bash -c` behind a `useInProcessShell: false` feature flag. Tier-0 fallback MUST support: argv parsing, basic redirection (`>` `>>` `<` `|`), env allow-list, `cwd` lock to workspace root, path validator rejecting `..`/symlink escapes. A 10-case conformance suite gates it. The Phase-1 vendored brush commit/tag + uutils subset is decided by the §23 #7 spike."

## R29-6 — Tier-0 stubs + allowlists (M1,M2,M3,M4,M10)
- Add a Tier-0 bullet to §20 (11-invariants-roadmap.md): "*ProviderProfile interface stub + one `MockProvider` (canned-replay of `StreamEvent[]` from a golden trace, no network). Concrete provider adapters are Tier-1.*" (M1)
- Add `allowedToolNames?: string[]` to the `Tool` interface (glossary); empty = no constraint; promotion requires the resolved name ∈ the set (M2).
- Document `ToolSet` precedence: "*`blocked` takes precedence; effective surface = `(allowed.empty ? all : allowed) − blocked − DELEGATE_BLOCKED_TOOLS`.*" (M3)
- Enumerate `DELEGATE_BLOCKED_TOOLS`: `const DELEGATE_BLOCKED_TOOLS = new Set(["task","delegate","codeExecBridge","spawn","exec","bash"]);` + a config knob to extend (M4).
- Tier-0 memory stance: "*Tier-0 ships `MemoryManager` as a stub returning an empty `MemorySnapshot`; SQLite + Markdown + Vector backends land in Tier-1 as packages.*" (M10)

## R29-7 — Transport-mode protocol sketches (M6) — 00-OVERVIEW.md or 11-invariants-roadmap.md
Add one line per mode: "*interactive: Ink/React TUI (Ctrl-C abort, Tab cycle, Enter submit). rpc: newline-delimited JSON-RPC 2.0 over stdio (`prompt`/`cancel`/`status`/`heartbeat`). print: one JSON `RuntimeEvent` per stdout line (`--json`) or a human transcript (default). sdk: `new Agent(config).prompt(text, opts?): AsyncIterable<RuntimeEvent>`.*"

## R29-8 — Declare missing types/constants (M7,M8,L1,m1) — 01-core-loop.md glossary + a Tier-0 constants block
Add to glossary: `interface ConflictError { path; baseHash; childHash; parentHash; hunks?: {base:[number,number]; child:[number,number]}[] }`, `type ScanVerdict = { allowed: true } | { allowed: false; reason: string; matchedPattern?: string }`, `interface AuxiliaryProvider { resolve(): ProviderProfile; health(): ComponentHealth }`, `interface SubagentRunner { spawn(s: SubagentSpawn): Promise<SubagentResult>; }`, `interface PromptMutex { withLock<T>(fn: () => T): T; }` (the §15 serialization primitive), `interface KnowledgeGraph { /* read-only entity graph; ragfs knowledge:// source */ }`, `declare function scanInject(files: string[]): string`.
Add a **"Tier-0 constants"** block (canonical defaults): `MAX_ATTEMPTS=3; MAX_APPROVAL_CHAIN_DEPTH=3; SUBAGENT_SCHEMA_REPAIR_RETRIES=1; MAX_CONCURRENT_SUBAGENTS=8; MAX_DEPTH=4; MAX_TREE_NODES=64; MAX_SIZE=128; IDLE_TTL_SECS=3600; SSE_BUFFER_BYTES=16*1024*1024; maxGoldenAgeDays=30; SYNC_DRAIN_TIMEOUT_S=5; approvalEscalationTimeoutS=24*3600; defaultTotal=$5/session, $0.50/turn`.

## R29-9 — Sidecar IPC protocol (M9) — 08-observability-security.md (§14b)
Add: "*sidecar = `child_process.spawn`; IPC = NDJSON over stdin/stdout; death = exit≠0 OR stdout EOF; auto-restart ≤3 with exponential backoff (100ms/500ms/2s); LaneBoard lane id = `native-shell-{pid}`; host wraps `child.on('exit')` into a `NativeResult`.*"

## R29-10 — Collapse the BudgetConfig duplication (cross-file D1,D2) — CRITICAL drift fix
`BudgetConfig` is defined in BOTH `01-core-loop.md` (glossary, with `exhausted()`) AND `11-invariants-roadmap.md:68` (inline, missing `exhausted()`). **Make `01-core-loop.md` glossary the SOLE definition**; in `11-invariants-roadmap.md` replace the inline dup with "*`BudgetConfig` — see [§4 glossary](01-core-loop.md) (R27-6 tree-accounting; atomic root, CC2/CC10/CC13).*". Same for the CC2/CC10/CC13 invariant text duplicated in `06-skills-subagents.md:51-54` → replace with a link. Reconcile `ResourceBudget`: make `BudgetConfig.resource?: ResourceBudget` (link the inline `diskBytes?/heapBytes?` to the `ResourceBudget` interface, remove the duplicate inline fields).

## R29-11 — TOC/title sync (cross-file D3,D4)
- `00-OVERVIEW.md` §5 row: add ", drift grader" to match `AGENT-SPEC.md` index.
- `00-OVERVIEW.md` + `AGENT-SPEC.md` §8 row: change "(roles + manager + ragfs)" → "(roles + manager + unified context)" to match `05-memory.md` body title.

## R29-12 — Linkify orphan §N refs in 10-packages.md (cross-file O1–O6)
Convert the 6 plain-text `§N` refs (lines ~33,39,41,46,48,61) to markdown links: `§10`→`06-skills-subagents.md`, `§23`→`11-invariants-roadmap.md`, `§14`→`08-observability-security.md`.

## R29-13 — Small clarifications (m2,m3,m4,m7,m8)
- `10-packages.md`: rewrite moduleIsolation default — "*if `trusted:true` AND sigstore-verified → in-process (first-party default); else → worker (third-party default).*" (m2)
- `06-skills-subagents.md`: rename `SubagentSpawn.isolation` → `fsIsolation: "isolated"|"shared"` (m3, disambiguate from module isolation).
- `08-observability-security.md`: "*`LaneBoard.entries=[]` ⇒ no active lanes ⇒ overall freshness `Healthy`.*" (m4)
- Document `LaneBoardEntry.freshness` derivation + the `LaneHeartbeat.status`+`transportAlive`+`blockedOn` → `LaneFreshness` mapping (m7).

## NOT defects (keep)
- All file-target links resolve; §→file map consistent; most types single-defined; source links deep-resolve.
