# PLAN-REMAINING — Honest Gap Analysis vs SPEC (updated post-Phase 13)

> Grounded in a full read of all 13 SPEC files (`source/.learned/spec/00→12`) + grep verification.
> **SPEC is authoritative:** `source/.learned/AGENT-SPEC.md` (index) → `spec/00-12`.

## Reality check — current state

**40 packages + 3 crates · ~14k LOC TS + ~700 LOC Rust · 212 committed tests (27 suites, vitest) · 27 remediation commits.**
All major SPEC subsystems are built, tested, and wired into the turn loop.
Every CRITICAL/HIGH from 12 review rounds (Phases 5-13) is closed.

## Section-by-section status (post-Phase 13)

Legend: ✅ built + tested · 🟡 partial (core works, spec extras missing) · ❌ missing

| § | Topic | Status | Current state |
|---|---|---|---|
| §1 | Vision & tenets | ✅ | minimal-core, TS+Rust, typed FSM, pit-of-success, pi-model |
| §2 | Language stack | 🟡 | TS 7 ✓, Rust 1.97 natives ✓. Compression in Rust (compress_log native). tree-sitter AST in natives ✓ |
| §3 | Architecture | 🟡 | 40 packages ✓. Spec says `extensions/`; named `tools/` (documented). No separate `ast/`/`compress/` crates (folded into `natives`) |
| §4 | Core loop | ✅ | runTurn FSM complete: bounded retry (MAX_ATTEMPTS=3) + length→compress + Recoverable + skillSetDirty + doneIds idempotency + real computeCost (20-model pricing) + StreamEvent.finish + repair wired into dispatch. Assistant response appended to history (Phase 13 fix). Async turn lock (Phase 13). |
| §5 | Prompt | 🟡 | 3-tier assembler, scanInject, DriftGrader, overflowRecovery, window/summarize/native compressors ✓. **Gap:** CCR side-cache (reversibility), CompressionPolicy per-auth-mode, Trident 3-stage compaction |
| §6 | Providers | 🟡 | OpenAI/MiniMax (real SSE + native tool-calling), ProviderRegistry (taint/cooldown), streamWithFallback, council, repair (wired into dispatch), OAuth/PKCE ✓. **Gap:** ~20 compat flags, auth-profile pool+failover, prompt_cache_key, provider-prefix routing, resolveToolName mapping |
| §7 | Tools | ✅ | **Full 7-step permission pipeline** (Phase 5a): denied_tools → deny rules → hook override → ask rules → allow/mode → DangerFullAccess escalation → deny. Rule grammar `tool(subject:*)`. Pre/post hooks (CC7 awaited). R26-D concurrent-approval serialization. HookRegistry wired into dispatch. 10 builtins + paid_fetch. Path-safety (lexical write / canonical read). Bash env secret-filter. LSP-on-write diagnostics. |
| §8 | Memory | ✅ | MemoryManagerImpl + roles (ArchivistRole + GoalsRole) + manager drain (syncAll with ctx plumbing) + one-external-provider rule ✓. **Brain: 10/22 dream-cycle phases** (lint, backlinks, purge, extract_facts, embed, orphans, schemaSuggest, resolveSymbolEdges, conversationFactsBackfill, consolidate) ✓. **4-arm RRF** (BM25 + substring + vector + graph) ✓. **ragfs** (memory:// + knowledge:// with scan-on-read wired end-to-end) ✓. TypedGraph (entity graph + BFS) ✓. MemoryContextSource (exact-id lookup) ✓. **Agent drives all of this** via runDreamCycle (fire-and-forget after each turn). |
| §9 | Skills | 🟡 | SkillStore (load/index/suggest + progressive disclosure) ✓. **Gap:** SkillCurator (archive-not-delete/prune_builtins/pin), SkillProvenance wrong type |
| §10 | Subagents | ✅ | InProcessRunner + resultSchema validation (JSON-Schema) + verifyGreen wired + MAX_APPROVAL_CHAIN_DEPTH enforced + CoW mergeBack (3-way, atomic, binary-safe) + spawn↔workspace wiring (isolated sandbox + merge on yield) ✓. 6 topologies. Budget deriveChild+releasePrecharge. |
| §11 | Code nav/exec | ✅ | LSP client + LSP-on-write (post-write diagnostics, not a gate) ✓. DAP client (14 ops, true DAP shape) + DAP `debug` tool (14 commands) + DAP-server (canned stub) ✓. codegraph (regex import-relevance). code-exec bridge (worker_threads kill). fff SearchIndex/BigramFilter/FrecencyDB in @my-agent/search ✓. **Gap:** DAP live adapter (vscode-js-debug standalone — env limitation) |
| §12 | Channels/gateway | ✅ | HookRegistry (frozen payload, wired into dispatch via pre/post hooks) ✓. MCP FSM 11-phase + Quarantine + adjacency ✓. Gateway (HTTP+WS+per-session replay+Origin+CSP+loopback) ✓. Gateway control-plane (ControlPlane + HandleLruCache + REST routes) ✓. ACP triple-gate ✓. Cron atomic-claim+lease ✓. |
| §13 | Observability | ✅ | RuntimeEvent taxonomy ✓. maybeSpill (large-value → ~/.my-agent/refs, content-addressed, integrity-checked, TTL sweep) ✓. TelemetrySink (deterministic counter-sampling, bounded ring-buffer, no payload leakage) ✓. 3-phase readiness probes ✓. **Gap:** LaneEvent control-plane taxonomy |
| §14 | Security | ✅ | Merkle AuditLog (real recompute verify C1, redact-before-hash) ✓. Secrets (fail-closed resolve + structural redactor H2) ✓. ApprovalToken ledger ✓. RecoveryRecipe FSM (6 scenarios, bounded, Unknown + aborted) ✓. ProjectTrust (user-owned store, self-elevation-proof, fail-safe) ✓. Permission gate + DELEGATE_BLOCKED (case-insensitive) ✓. Audit wired into dispatch ✓. **Gap:** durable audit persistence, sealed-file age encryption |
| §14b | Crash resilience | ✅ | napi catch_unwind→NativeResult, no-abort, prompt COW, third-party .node sigstore gate (fail-closed) ✓ |
| §15 | Eval | 🟡 | ParityHarness, DriftGrader, MockProvider ✓. **Gap:** tier-mismatch, no-egress guard, golden-set age gate |
| §16 | Supply chain | 🟡 | deny.toml (cargo-deny AGPL ban) ✓. sigstore signing/verify (fail-closed) + npm provenance ✓. CI workflow (lint+build+test+clippy) ✓. **Gap:** min-release-age gate, exact-pin enforcement |
| §17 | Packages | 🟡 | PackageHost (verify→register→activate), apiVersion all-digits (F8), sigstore gate ✓. **Gap:** requireProvenance defaults off |
| §18 | Invariants | ✅ | #10 enforced (nowWallclock everywhere + lint guard + vitest guard). #19 enforced (lint:deps grep cross-transport check). CI workflow runs lint+build+test+clippy. See `docs/invariant-audit.md`. |
| §19 | License | ✅ | MIT OR Apache-2.0 dual; deny.toml bans copyleft |
| §21 | Cross-cutting | 🟡 | BudgetConfig wired + real computeCost ✓. **Gap:** session-format apiVersion, ResourceBudget hooks |
| §25 | UI surfaces | 🟡 | All 4 transports (print/sdk/tui+rpc) + gateway+web (SPA) + desktop (Tauri) ✓. **Gap:** session-cookie+CSRF, tray/overlay, desktop UI stub, collab E2E+CRDT |

## Remediation arc (Phases 1→13 — all DONE)

1. **Phase 1** (honesty): 43 committed tests + real deny.toml + de-staled PLAN ✓
2. **Phase 2** (invariant #10): 39 Date.now → nowWallclock + guard test ✓
3. **Phase 3** (runTurn FSM): bounded retry + length→compress + Recoverable + idempotency + real computeCost ✓
4. **Phase 4** (gates): §10 subagent gates + DAP debug tool + LSP-on-write ✓
5. **Phase 5** (subsystems): §7 7-step permission + §8 MemoryRole + §10 CoW mergeBack + §12 gateway control-plane ✓
6. **Phase 6** (residuals): §10 CoW runner wiring + lint gating + §14.3 RecoveryRecipe+ProjectTrust ✓
7. **Phase 7** (memory stack): maybeSpill + RRF retrieval + ragfs unified-context-FS ✓
8. **Phase 8** (telemetry + vector): TelemetrySink + vector arm + dream-cycle backlinks/purge ✓
9. **Phase 9** (knowledge graph): TypedGraph + graphArm + knowledge:// source + scanner bridge ✓
10. **Phase 10** (dream-cycle): extract_facts + embed + createRagfs factory ✓
11. **Phase 11** (5 more phases): lint + orphans + schemaSuggest + resolveSymbolEdges + conversationFactsBackfill + agent Brain/ragfs wiring ✓
12. **Phase 12** (drive): Brain+ragfs+roles driven by turn loop (runDreamCycle) + MemoryContextSource ✓
13. **Phase 13** (integration tests + hardening): agent integration tests + 2 CRITICAL fixes (assistant history + syncAll ctx) + fire-and-forget + turn lock ✓

## Still open (env-limited / blocked / spec-extras)

| Item | Section | Blocker |
|---|---|---|
| DAP live adapter | §11.2 | vscode-js-debug standalone hangs in this env (client + DAP-server pipeline built + tested 7/7) |
| 12 LLM-driven dream-cycle phases | §8 | Need a model in the loop (synthesize, grade_takes, calibration, skillopt, etc.) |
| no-explicit-any ESLint | §2/§18 | @typescript-eslint parser incompatible with TS 7 native Go compiler |
| SkillCurator | §9 | archive-not-delete/prune_builtins/pin (medium effort, not yet built) |
| GoalsRole prompt rendering | §8 | systemPromptBlock exists but never called from the prompt assembler (cross-package wiring gap) |
| CCR side-cache + Trident compaction | §5 | Reversibility for lossy compression (large) |
| Provider compat flags | §6 | ~20 per-profile capability toggles |
| Durable audit persistence | §14 | In-memory only (needs SQLite/file backend) |
| Session-cookie + CSRF | §25.2 | Gateway serves headers only (no cookie mechanism) |
| Collab E2E + CRDT | §25.4 | Relay is event-broadcast only (no encryption/state-merge) |
| Performance: backfill O(N²) | §8 | conversationFactsBackfill scans entire history each turn (needs incremental index) |
| Performance: backlinks no cache | §8 | brain.backlinks() recomputes O(n×regex) every turn |
| Eval no-egress guard | §15 | Network fence for non-credentialed tier |

## What IS solidly built (don't lose this)

**Core loop** (§4 FSM + bounded retry + length→compress + Recoverable + idempotency + real computeCost + StreamEvent.finish + repair + assistant-history + turn-lock) · **Permission** (§7 full 7-step pipeline + rule grammar + hooks + R26-D serialization + DangerFullAccess escalation) · **Memory** (§8 10/22 dream-cycle phases + 4-arm RRF + ragfs scan-on-read + TypedGraph + MemoryContextSource + runDreamCycle driving) · **Subagents** (§10 CoW mergeBack + resultSchema + verifyGreen + chain-depth) · **Code nav** (§11 DAP debug tool + LSP-on-write + codegraph + code-exec) · **Gateway** (§12 HTTP+WS+control-plane+LRU) · **Security** (§14 Merkle audit + secrets + RecoveryRecipe + ProjectTrust user-owned) · **Telemetry** (§13 maybeSpill + TelemetrySink) · **Tools** (10 builtins + path-safety + bash env filter) · **Providers** (OpenAI/MiniMax/council/fallback/OAuth) · **CI** (lint + build + test + clippy) · **212 tests** · **Rust natives** (BLAKE3/glob/grep/compress/AST/reflink).
