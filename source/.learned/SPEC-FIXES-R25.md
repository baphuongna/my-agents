# SPEC-FIXES — Round 25 (5 parallel design-scrutiny reviewers)

> Apply EVERY fix below to `AGENT-SPEC.md`. Sole file owner. These fix defects in the SPEC author's OWN design (not source attributions) — design decisions are already made in each fix; apply mechanically. ~33 consolidated fixes from ~49 reported defects.

## §2 (Rust-gate)
- R25-1. Add a 4th Rust-gate clause: "(d) **platform parity** (POSIX shell + coreutils for Windows determinism) — justified only when no cross-platform TS equivalent exists and the surface is vendored+frozen." Remove the unverified assertion "oh-my-pi's `pi-*` crates all pass this test"; replace with "audit §3's crate list against the 4-gate table (pi-iso=parity/d, vendored uutils=parity/d, search/ast/shell/crypto=b/a/c)."

## §3 (layering) + §17 (dependency rule)
- R25-2. Fix the layering contradiction (core calls MemoryManager every turn but was forbidden from depending on memory). Amend §3 layering rule + §17 dependency-rule to a SINGLE consistent permitted set: **"`core` depends on the `{ai, tools, memory, prompts}` *interface* packages + `natives`; packages (impl) depend inward on core, never the reverse."** (Add `memory` to the permitted interface set everywhere it appears.)
- R25-3. Replace "*(orphan-rule-safe + SSOT-preserving.)*" and "*(orphan-rule + SSOT preserving.)*" → **"*(import-direction-acyclic — madge/ESLint-enforced; core has no upward imports; SSOT-preserving.)*"** (orphan-rule is a Rust-coherence concept, misapplied to a TS import lint).

## §4 (turn loop — significant rework)
- R25-4. Rewrite the `runTurn()` pseudocode so it actually composes §6/§7/§13: (a) capture `usage`/`cost` from `StreamEvent.usage` (`let usage: TokenUsage; let cost: Cost;` + `if (ev.kind==="usage"){usage=ev.usage; cost=computeCost(usage);}`); (b) replace bare `provider.stream(...)` with `streamWithFallback(profiles, prompt, history)` that tries `ProviderProfile[]` in order, SKIPS auth/quota-tainted ones, and returns `StreamEvent[] | LifecycleError` (emit `Failed` on error); (c) branch on terminal `StreamEvent.done.finish`: `"error"`→`Failed{phase:"provider"}`, `"length"`→recoverable retry/Failed; (d) per-tool: `runTool` calls §7 `authorize()` and emits `{kind:"tool";decision;result}` per call (no throw on Deny — returns a typed ToolResult); `aggregate()` returns `DegradedResult` iff any errored; emit aggregate `ToolExec` TurnEvent with `ToolResult[]`; (e) `emit(te)` wraps into `{kind:"turn";e:te}` on the RuntimeEvent bus; emit on Failed/Completed returns too. Fix "6-step" → "**7-step** permission pipeline".
- R25-5. Add `AwaitingApproval{call; prompt}` to `TurnState`/`TurnEvent`, and extend `RuntimeEvent` with `{kind:"approval"; stage:"requested"|"decided"; call}` — so the hook-Allow→ask human round-trip (§7 step 5, invariant #13) is observable (tenet #3).
- R25-6. Retry policy: change `Recoverable(retry)` to `Recoverable{retries}`, add `retries: number` to `LifecycleError`, add a `Recoverable` `TurnEvent` variant. State: "bounded `max_retries` (default 3); recoverable errors resume up to the cap, then escalate." (Reconciles the unlimited-vs-once contradiction — pick bounded.)
- R25-7. Either add `Pending`/`Aggregating` `TurnEvent` variants OR mark them "internal-only (not emitted to observers)" with rationale.

## §4 type definitions (consolidate undefined primitives)
- R25-8. Add a **"Core primitives"** block in §4 defining every referenced-but-undefined type ONCE: `type StreamChunk = StreamEvent;` `interface ToolCall{id;name;args}` `interface ToolResult{callId;ok;output;error?;degraded?:boolean}` `type DegradedResult = { results: ToolResult[]; failedCallIds: string[] }` `interface TokenUsage{input;output;cacheRead?}` `type Cost = { usd: number }` `interface TurnContext{session;history;budget;approval;emit}` `type ApprovalChannel = { request(r: ApprovalRequest): Promise<ApprovalDecision> }` `interface PermissionContext{override?:"Deny"|"Ask"|"Allow"; tool; args; activeMode; requiredMode}`.
- R25-9. Extend `LifecycleError.phase` to include auth/quota: `"stream"|"tool"|"provider"|"auth"|"quota"|"sandbox"|"memory"` and state this is the canonical phase vocabulary (referenced from §6 fallback skip rule).
- R25-10. `type PermissionDecision = PermissionOutcome;` alias (§13 uses `PermissionDecision`, §7 defines `PermissionOutcome`).
- R25-11. `type LifecycleState = TurnState;` and `type LaneId = string /* == taskId */;` and `type LaneStatus = "running"|"idle"|"done"|"failed"|"blocked";` (§13 referenced these undefined).
- R25-12. Widen §13 `RuntimeEvent.tool.result` to `ToolResult | DegradedResult` (matches §4).

## §5 (prompt + compression — root data-flow fix)
- R25-13. **Root fix:** headroom + Trident compress **CONVERSATION HISTORY** only — NOT the system prompt's volatile tier. The volatile tier (memory snapshot) is **rebuilt (re-snapshotted)** at the compression boundary. Reword: "Both compress conversation history (live-zone = latest user turn for headroom; message log for Trident). At the compression boundary the volatile tier is re-snapshotted from memory; the stable/context tiers are NOT re-derived."
- R25-14. Fix cache-invalidation: `markCompressed()` must only **replace `prompt.volatile`** (re-snapshot memory), NOT re-call `assemblePrompt()` (which would re-scan context files and invalidate the stable⊕context prefix cache). State: "compression is a **selective per-tier mutation** — only `volatile` is replaced; `stable`/`context` are untouched, preserving the provider prefix cache."
- R25-15. Replace `now()` in the volatile tier with `today()`/`epochDay()` (day-precision). Add note: "timestamp is **day-precision by design** — finer granularity invalidates the prefix cache every turn (hermes PR #20451)."
- R25-16. Curator/skill-write staleness: declare **skill-write as an additional documented rebuild boundary** for the stable tier (alongside compression, provider/profile swap) — OR constrain curator to session boundaries. Pick: "skill-write (curator archive/create) is a documented stable-tier rebuild boundary; the rebuild re-derives only stable (identity/tools/skills-index), preserving the provider prefix up to that point."
- R25-17. **Drift gate** — replace the live-GSM8K gate with the **deterministic-replay drift grader** (zero-cost, CI-runnable): replay a golden `LlmTrace` fixture with vs without compression, diff final responses. `baseline = passRate(uncompressed replay on golden set)`, `ε = 0` (zero tolerance). Mark live GSM8K/TruthfulQA lm-eval as **credentialed-tier aspiration** (best-effort when `OPENAI_API_KEY` set), NOT a merge-block gate. Update §5 `DriftGrader` contract, §15, §18 #5, and §20 to name the **deterministic-replay** gate as the merge-block, with GSM8K as aspiration.

## §8 (memory + ragfs)
- R25-18. Double-scan resolution: make **ragfs the authoritative scanner** (scan-on-read returns a typed `ScanVerdict`); the prompt assembler's `scanInject` defers to the ragfs verdict for ragfs-sourced files and only rescans direct-FS (non-ragfs) context files. Remove the implication of redundant double-scan.
- R25-19. `knowledge://` URI: add a definition — "`knowledge://<doc>` → read-only `KnowledgeContextSource` over a `KnowledgeGraph`; writes stay on the `Knowledge` tool, not ragfs." (Removes the dangling URI.)
- R25-20. One-external-provider rule scope: state explicitly "The one-external-provider rule governs `MemoryBackend` only. ragfs is a read-only aggregation layer; its constituent sources (skills, knowledge, files) may use independent providers."

## §9 (napi boundary — critical honesty)
- R25-21. Rewrite the napi boundary contract (the "no class instances / pure transforms" claim is FALSE per oh-my-pi's real exports). New: "napi boundary = `serde`-serializable values + `Buffer` + **napi `Class` handles for stateful sessions** (Shell/Pty/Process — mutation via methods returning owned results; no interior-mutable fields exposed to JS) + `ThreadsafeFunction<T>` for streaming, where `T` is a generated napi object; `Unknown<'env>` permitted only for JS-owned cancellation signals. No raw `*mut`/`Arc<Mutex<_>>` crosses dlopen."
- R25-22. Streaming backpressure: "Streaming callbacks use an explicit policy: **lossless streams** (tool-call repair, edit-hash) use `ThreadsafeFunction::Blocking` OR a sequence-numbered `StreamChunk{seq,payload}` the TS side NACKs on gaps; **lossy streams** (TUI render) may use `NonBlocking`. State per-stream which."
- R25-23. ABI stamp honesty: downgrade — "the reference (oh-my-pi) uses a **version-semver sentinel** (`__piNativesV{semver}` symbol) that refuses mismatched-release binaries. A full `{rust_core_version, napi_abi}` **ABI stamp is a SPEC-proposed upgrade**, not inherited — see §23 open question." Update §16/§18 references accordingly (version sentinel is the inherited enforcer; ABI stamp = SPEC proposal).
- R25-24. Natives release: add "natives are **independently versionable from core** (separate semver); a natives patch follows the `<patch>` channel and is auto-promoted without a core release. CI matrix = N platforms × M variants (state N≈5, x64 ships modern+baseline)."

## §11 (codegraph framing)
- R25-25. Rename §11 "Code Intelligence & Execution" → "**Code Navigation & Execution**"; add to the Tier-2 roadmap bullet: "codegraph = file-relevance ranking only; symbol/ref/call-graph is deferred (§23 #1)."

## §16 + §17 (supply-chain + packages — critical)
- R25-26. Supply-chain hole 1 (lazy transitive): add to §16 "the **release lockfile must include the full transitive closure of every lazy bundle** (generated via `npm install --package-lock-only` with all bundles present); runtime materialization is **lockfile-strict (`npm ci`)** — never `npm install`."
- R25-27. Supply-chain hole 2 (npm lifecycle scripts): add to §17 lifecycle "install runs with **`--ignore-scripts`** (npm `preinstall`/`postinstall`/`prepare` disabled by default — arbitrary code does NOT run at install). A package requiring install-time scripts must declare them in `PackageManifest.scripts`; they execute inside the sandbox AFTER verification."
- R25-28. Package sandbox honesty (the big one): packages are **in-process TS with capability-passing** (option c) — NOT a VM sandbox. Reword §17: "Package code runs **in-process** with a deliberately-limited `ExtensionAPI` (capability-passing); a **bundler/lint allowlist bans `import "node:fs"/"node:child_process"/"node:net"`** in package code. `permissions.egress`/`permissions.tools` are **advisory intent declarations** for in-process packages (not runtime-enforced in TS); the real OS sandbox lives at the **tool-execution** layer (§7 shell, §14 seccomp). `PackageManifest.runtime.isolation: "in-process"` (default, honest) — a future `worker`/`isolated-vm` tier would enforce at cost (every napi call pays a structured-clone round-trip; isolated-vm cannot call napi)."
- R25-29. Third-party napi policy: add to §17 "A package MAY ship a prebuilt napi binary under `<pkg>/native/<platform>-<arch>.node` IFF it declares `native:{abiStamp,napiVersion}`, the host verifies the stamp against its supported `napi_abi` range at load, it is sigstore-signed (§23 #6), and the user's config explicitly enables native packages (deny-by-default). Perf-critical packages that can't meet this MUST degrade to TS with a documented perf cliff."
- R25-30. Signing caveat: §17 lifecycle "verify(apiVersion + **signature**)" → "verify(apiVersion + signature) — **signature scheme TBD (§23 #6); until resolved, verify enforces `apiVersion` only**."

## §18 (invariant enforcers — honesty)
- R25-31. Invariant #6 (`no_dangling_stub`): downgrade — TS has no `Stub<T>` convention. Reword: "[ENFORCED: **code-review checklist** (TS has no `Stub<T>` type); a lint additionally flags `any`-typed fields and `as unknown as T` casts surviving past construction. `Option<T>` → `T | undefined`.]" (Drop the false lint-mechanism; replace with the real review+lint combo.)
- R25-32. Align §18 #5 with §20 + R25-17: the **merge-block gate** = deterministic-replay drift grader (zero-cost); accuracy lm-eval = best-effort aspiration. Remove the §20-vs-§18 contradiction.

## §20 (roadmap consistency)
- R25-33. Add to Tier 0 a bullet: "**Accuracy-preservation gate** (deterministic-replay drift grader — zero-cost; GSM8K subset when API key available). *(headroom #4, §15)*."
- R25-34. Soften Tier-2 "Rhai embedded scripting workflows" → "**Embedded scripting workflows** (language TBD per §23 #2 — Rhai or JS/TS sandbox). *(openhuman)*" (don't commit to Rhai while §23 #2 is open).

## NOT defects (keep)
- All §14 security claims post-R24 (clean per SRE reviewer).
- §12 gateway-control-plane rename (complete within SPEC).
- §18 #2/#3/#8/#9/#10/#11/#12/#13 enforcers (feasible/clean).
- §23 #1/#3/#4/#5 genuinely open.
