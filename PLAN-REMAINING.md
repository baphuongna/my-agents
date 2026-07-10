# PLAN-REMAINING — Honest Gap Analysis vs SPEC

> Grounded in a full read of all 13 SPEC files (`source/.learned/spec/00→12`) + grep verification of every claim against actual `packages/`+`crates/` source (no comment-only false positives counted).
> **SPEC is authoritative:** `source/.learned/AGENT-SPEC.md` (index) → `spec/00-12`. `SYNTHESIS.md` is superseded by the SPEC.

## Reality check — what "built" actually means

**31 packages · ~8,400 LOC TS + 437 LOC Rust · ~144 tests.** After Steps 1–5
(below), this now covers the core loop + all major SPEC subsystems. The 10
biggest formerly-missing subsystems are CLOSED. Remaining gaps are explicitly
listed in "Still open".

## Steps 1–5 executed (each + 3 review rounds)

| Step | Scope | Closed |
|---|---|---|
| **1** Tier-0 finish | compress→Rust, sigstore gate, §18 invariant audit | natives compress_log/approx_tokens, verifyNativeDeclaration, docs/invariant-audit.md |
| **2a** Tier-1 security | §14.1 Merkle AuditLog, §14.2 Secrets | @my-agent/audit, @my-agent/secrets |
| **2b** §4 R31 completeness | session tree+JSONL+migration, plan-mode todos, message queue, context preflight, cancel protocol | @my-agent/session |
| **2c** §7 path-safety + §6.1 OAuth | lexical/canonical resolver, PKCE loopback | tools/path-safety, ai/oauth |
| **3** Tier-2 gaps | gateway, package host, ACP, cron, GreenContract | @my-agent/gateway, pkg, acp, cron, subagents/green |
| **4** transports | tui (REPL over event bus), rpc (JSON-RPC stdio) | @my-agent/tui, @my-agent/rpc |
| **5** Frontier partials | real approval channel, hindsight→loop, overlay native | @my-agent/approval, agent runHindsight, natives reflink_or_copy |

15 review rounds total (5 steps × 3), each reading actual code. Key finds:
G1 gateway no replay-from-cursor, R1 rpc concurrent-prompt interleave, A1
approval timer-leak, C2 cron once-retry, A2 token ledger no GC.

## Tier labels — corrected

The SPEC §20 roadmap has **Tier 0 / 1 / 2 + Frontier** (build order). `SYNTHESIS.md` has Tier 1/2/3+Frontier (priority; superseded). **There is no "Tier 3" or "Tier 4" in any SPEC doc.** My earlier "Tier 3" (DAP/hindsight/collab/x402) = §20 **Frontier**; my "Tier 4" (real Rust natives) = **completing Tier 0** (natives were a Tier-0 stub). Going forward I use §20's labels only.

What I built maps to §20 as: **most of Tier 0 + most of Tier 1/2 + a few Frontier items** — with several Tier-1/2 systems still missing.

## Section-by-section status (grounded)

Legend: ✅ built · 🟡 partial · ❌ missing · ➖ N/A (Rust-mya-only or out of scope)

| § | Topic | Status | Evidence / gap |
|---|---|---|---|
| §1 | Vision & tenets | ✅ | minimal-core, TS+Rust, typed FSM, pit-of-success, pi-model — all respected |
| §2 | Language stack | 🟡 | TS 7 ✓, Rust 1.97 natives ✓. **Gap:** compression should be Rust (`compress/` crate) — it's TS; no `ast/` tree-sitter crate |
| §3 | Architecture | 🟡 | core/ai/prompts/tools/memory/skills/subagents ✓. **Missing packages/crates:** `gateway/`, `tui/`, `rpc/`, `ast/`, `compress/`. Naming: spec says `extensions/`, I named it `tools/` |
| §4 | Core loop | 🟡 | `runTurn` while-loop, TurnState FSM, budget tree-accounting, LaneBoard, PromptMutex, glossary types ✓. **Missing (R31 completeness):** TodoWrite/plan-mode, message queue (steer/followUp), session JSONL tree+entry-types+migration, context-window preflight, overflow-recovery compaction, unified cancel protocol, ToolSearch/deferrable tools |
| §5 | Prompt | 🟡 | 3-tier assembler, scanInject, DriftGrader (ε=0), §5.1 content blocks, window/summarize compressors ✓. **Missing:** CompressionPolicy per-auth-mode, byte-faithful JSON serializer, CCR side-cache (reversibility), compression-in-Rust |
| §6 | Providers | 🟡 | OpenAI/MiniMax adapters, ProviderRegistry (taint/cooldown), streamWithFallback, council, repair ✓. **Missing:** OAuth/PKCE (§6.1), ~20 provider compat flags, auth-profile pool+failover, prompt_cache_key, provider-prefix routing, context-window preflight |
| §7 | Tools | 🟡 | self-registering registry, 7-step permission pipeline, 9 builtins, hashline **dual-model** (per-line FNV + whole-file tag), Pre/Post hooks ✓. **Missing:** path-safety resolver (lexical vs canonical), file-mutation queue, settings merge+lockfile, BashOperations delegation, bash CommandIntent classifier |
| §8 | Memory | 🟡 | MemoryManager + 6 role IDs + InMemory/FileBackend (durable) ✓. **Missing (Tier-1+):** gbrain BrainEngine/Pages/Chunks/Facts/Takes, 22-phase dream cycle, push-context, 4-arm RRF, ragfs unified-FS router (`memory:// skill:// knowledge:// file://`) |
| §9 | Skills | ✅ | SkillProvenance (4-value), curator, progressive disclosure, agentskills frontmatter |
| §10 | Subagents | 🟡 | InProcessRunner, CoW (file_copy fallback), 6 topologies, budget deriveChild+CC2 refund, DELEGATE_BLOCKED_TOOLS ✓. **Missing:** GreenContract merge gate (§10.2), real overlayfs/reflink backend, AJV resultSchema + bounded repair |
| §11 | Code nav/exec | 🟡 | LSP client (hover/def/refs/diag), DAP client (27 ops), codegraph file-relevance, bidirectional code-exec bridge ✓. **Missing:** LSP-on-write gating, DAP real debug-adapter wiring, fff SearchIndex/BigramFilter/FrecencyDB (Tier-1+) |
| §12 | Channels/gateway | 🟡 | HookRegistry, MCP FSM **partial** (no Quarantine state), scanInject gate ✓. **Missing:** `gateway/` package (HTTP/WS+dashboard), ACP bridge (§12.2), cron scheduler (§12.3), gateway-protocol, per-session LRU+idle-TTL cache |
| §13 | Observability | 🟡 | RuntimeEvent taxonomy (8 kinds), LaneBoard+freshness, ComponentHealth tri-state, core.time ✓. **Missing:** LaneEvent control-plane taxonomy, maybeSpill large-value, readiness 3-phase probes (`/live` `/ready` `/functional`), telemetry export |
| §14 | Security | ❌→🟡 | injection scan (defense-in-depth), permission gate, DELEGATE_BLOCKED ✓. **Missing (large):** **Merkle AuditLog** (§14.1), **Secrets** lifecycle (§14.2: SecretRef+keyring+rotate/revoke), **ApprovalToken ledger** (§14.3), RecoveryRecipe FSM, ProjectTrust, secrets-redaction-before-hash |
| §14b | Crash resilience | 🟡 | napi catch_unwind→NativeResult, no-abort, prompt COW ✓. **Missing:** sigstore+SHA-256 verify for third-party `.node` before dlopen |
| §15 | Eval | 🟡 | ParityHarness, DriftGrader, MockProvider, TestTier ✓. **Missing:** no-egress guard on non-credentialed tests, golden-set modelVersion age gate |
| §16 | Supply chain | 🟡 | `deny.toml`+`audit.toml` config exist ✓. **Missing:** enforced min-release-age gate, lazy-bundle lockfile-strict (`npm ci`), exact-pin policy enforcement |
| §17 | Packages | ❌ | **No package host at all:** PackageManifest, apiVersion intersect-check, sigstore verify, install→verify→register→activate lifecycle — all missing |
| §18 | Invariants | 🟡 | ~15 of 22 invariants enforced in code (budget tree #CC2, no-abort #14, prompt COW #15, tier-rebuild #1, minimal-core #20) ✓. **Needs:** an explicit invariant→enforcer audit map (some are prose-only) |
| §19 | License | ✅ | MIT OR Apache-2.0 dual; OpenViking clean-room respected |
| §20 | Roadmap tiers | — | see "Tier labels" above |
| §21 | Cross-cutting | 🟡 | BudgetConfig wired into loop+subagents ✓. **Missing:** versioning (session-format apiVersion), ResourceBudget enforcement hooks |
| §22 | What it's NOT | ✅ | not pure-Rust, not maximalist, not Python-primary, not a mya-v1 rebrand — all respected |
| §23 | Open questions | — | tracked; some resolved (R30 sandbox), some open (CRDT sync, call-graph) |
| §25 | UI surfaces | ❌ | only `print` (--json/transcript) + `sdk` transports built. **Missing:** `tui/` (Ink/React interactive), web dashboard (needs gateway), desktop (Electron/Tauri), §25.6 wire-envelope formalization. Collab relay = partial §25.4 |

## Still open (honest residual)

| Item | Section | Why deferred |
|---|---|---|
| `ast/` tree-sitter Rust crate | §2/§3 | gate-justified but large; LSP client covers symbol ops today |
| Separate `compress/` crate | §3 | folded into `natives` (noted deviation; one napi crate suffices) |
| gbrain memory richness (BrainEngine/Pages/Chunks/Facts/Takes, 22-phase dream, 4-arm RRF) | §8 R35 | Tier-1+; basic MemoryManager + roles shipped |
| fff SearchIndex/BigramFilter/FrecencyDB | §11 R35 | Tier-1+; native glob/grep shipped |
| Real OS keyring backend for secrets | §14.2 | platform-specific (libsecret/keytar); SecretStore interface + file/env backends shipped, keyring/exec stubbed |
| Full Ink/React TUI (themes/keybindings/slash-commands/OSC) | §25.1 | TuiRepl transport shipped; full UI layers on top |
| Web SPA dashboard + Desktop (Electron/Tauri) | §25.2/§25.3 | gateway HTTP/WS + §25.6 envelope shipped; SPA/native shell not built |
| MLX TTS / multi-agent convergence | Frontier | platform/research-frontier |
| Byte-faithful JSON serializer (general) | §5/§17 | canonicalJson exists in @my-agent/audit; not a shared util yet |
| §4 overflow-recovery compaction, ToolSearch/deferrable tools | §4 R31 | session preflight shipped; these two sub-items deferred |
| Real DAP debug-adapter wiring | §11.2 | DAP client built; needs a live adapter |


## What IS solidly built (don't lose this)

Core loop (§4 while-loop FSM + budget tree + laneboard) · 3-tier prompt + injection + drift grader + §5.1 content (§5) · 9 tools + dual-model hashline + 7-step permission (§7) · providers: OpenAI/MiniMax/council/fallback/registry/repair (§6) · skills provenance+curator (§9) · subagents CoW+6-topo+budget (§10) · LSP+DAP clients + codegraph + code-exec (§11) · MCP FSM + hooks (§12) · RuntimeEvent taxonomy (§13) · eval harness (§15) · workflows sandbox · collab relay · **x402 Frontier** · **real Rust natives** (BLAKE3/glob/grep/MAC, the Tier-0 gate made real) · MiniMax E2E with native tool calling.

## Recommended build order (per §20 dependency constraints)

1. **Tier 0 finish:** `compress/`→Rust, third-party-`.node` sigstore gate (§14b), invariant audit map (§18)
2. **Tier 1 gaps:** §4 R31 completeness (plan-mode, session JSONL, preflight, cancel) · §14.1 Merkle AuditLog · §14.2 Secrets · §6.1 OAuth/PKCE · §7 path-safety+file-mutation-queue
3. **Tier 2 gaps:** `gateway/` + §25.6 wire envelope · §10.2 GreenContract · §12.2 ACP · §12.3 cron · §13 readiness probes · §17 package host
4. **Transports:** `tui/` + `rpc/` (§3/§20)
5. **Frontier (already partial):** hindsight wired into turn loop, real approval channel, real overlay native, MLX TTS, multi-agent convergence
