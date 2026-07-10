# Prompt System (3-tier + compression)

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §5.



## 5. Prompt System (cache-stable 3-tier + compression)

**Three-tier system prompt**, joined ONCE per session, rebuilt only at **tier boundaries** (compression / provider-or-profile swap / skill-write — see the “tier rebuild boundaries” note below) *(source: [hermes-agent](../../hermes-agent/) — the single highest-leverage cache win)*:
```
SystemPrompt = stable (identity, tool/skill guidance, env) 
             ⊕ context (caller msg + discovered context files, injection-scanned)
             ⊕ volatile (memory snapshot, USER.md, timestamp/session/provider line — **day-precision**)
```
- Per-turn user prefix is appended AFTER the cached block — never re-joined into it. *(source: [hermes](../../hermes-agent/) invariant.)*
- **Discovered-file-set (R27-5):** *the discovered-file-set is re-evaluated ONLY at documented tier boundaries; there is NO continuous file-watcher on the context tier. A mid-session `Write` that creates a context file is invisible to the prompt until the next boundary.*
- **Injection scanner** runs threat-pattern detection on every context file; matches → `[BLOCKED: …]` placeholder that never enters the prompt. *(source: [hermes](../../hermes-agent/) + [openhuman](../../openhuman/) `prompt_injection`.)* **Honesty + scope (R27-15): the scanner is defense-in-depth, NOT a security boundary — the REAL control is privilege separation (untrusted context can NEVER raise `active_mode`; [§7 Tools](03-tools-permission.md)/[§14 Security](08-observability-security.md)).** The 64 KiB truncation is removed (scan a sliding window with overlap); TR#39 confusables detection added. Channel messages ([§12 Channels](07-code-channels.md)) MUST pass through `scanInject` with `scope="context"` before entering history.

**Content-aware compression** — two distinct sources (do not conflate):
  - **headroom (reversible end-to-end, per-type over the history live-zone):** per-type compressors `{SmartCrusher (JSON) / Log / Search / Diff / Text}` applied to the **conversation history live-zone (latest user turn)**. **Lossy on the wire, reversible end-to-end via the CCR side-cache** (originals stored under an MD5 hash key, retrieved on demand). *(source: [headroom](../../headroom/) 60-95% token cut.)* **(CC3/R28: the CCR store uses a PER-CONTENT-HASH mutex — concurrent compressions targeting the same hash block on the lock, so two turns compressing the same block never tear the side-cache entry or double-write.)**
  - **claw-code Trident (lossy + structural; NOT per-type, NOT reversible):** a 3-stage compaction of the **conversation message log** — **Supersede** (deletes obsolete file ops by path) → **Collapse** (summarizes short chatty exchanges) → **Cluster** (groups messages by tool/path Jaccard similarity → summary); `compression_ratio` reported.
- **Root data-flow fix (R25-13): both compress CONVERSATION HISTORY only — NOT the system prompt's volatile tier.** Live-zone = latest user turn for headroom; message log for Trident. At the compression boundary the volatile tier (memory snapshot) is **re-snapshotted from memory**; the stable/context tiers are NOT re-derived.
- **Tier rebuild boundaries (R25-16): `markCompressed()` rebuilds the volatile tier only (re-snapshot memory). The stable tier rebuilds on a documented finite set of boundaries — compression, provider/profile swap, AND skill-write (curator archive/create) — the skill-write rebuild re-derives only stable (identity/tools/skills-index), preserving the provider prefix cache up to that point. Context files (context tier) are re-scanned only when the discovered-file set changes.**
- **Hard gate (R25-17): compression ships BEHIND a deterministic-replay drift grader** (the zero-cost, CI-runnable merge-block) — replay a golden `LlmTrace` fixture with vs without compression, diff final responses; `baseline = passRate(uncompressed replay on golden set)`, `ε = 0` (zero tolerance). The live GSM8K/TruthfulQA lm-eval is a **credentialed-tier aspiration** (best-effort when `OPENAI_API_KEY` set), NOT a merge-block gate. Headroom's real eval suite (the inspiration) = GSM8K/TruthfulQA via lm-eval + before/after + LLM-as-judge, reporting **4 benchmarks**: GSM8K ±0.000, **TruthfulQA +0.030**, SQuAD 97% (19% compression), BFCL 97% (32% compression). The zero-cost CCR round-trip + tool-schema-compaction checks remain mandatory in-repo gates; the Rust-vs-Python parity-nightly job is `continue-on-error` (Phase 0). *(source: [headroom](../../headroom/) + mya-eval.)*
- **Byte-faithful JSON** (`preserve_order` + `arbitrary_precision` + `raw_value`) where determinism matters (eval, signing); `raw_value` is load-bearing for byte-range live-zone surgery. *(source: [headroom](../../headroom/) invariant I1.)*
- **Atomic compression (R27-20):** compression is ATOMIC — write the CCR original BEFORE replacing the live-zone block (write-ahead), so a mid-write ENOSPC leaves history uncompressed, not torn. Pre-compression `worth_compressing` refuses blocks whose CCR-original would exceed disk (against `BudgetConfig.resource?.diskBytes`); compression input size is bounded (forward-original above N MB is skipped). A `ResourceExhausted` surfaces as a recoverable `LifecycleError{phase:"resource"}`.

**Concrete 3-tier assembly + drift contract (round 14):**
```ts
// Built ONCE per session; prefix-cached. Rebuild boundaries are TIER-SCOPED (R25-14/R25-16):
//   markCompressed() replaces `volatile` only (re-snapshot memory); the stable tier rebuilds on
//   compression/provider-swap/skill-write; context rescans when the discovered-file set changes.
function assemblePrompt(s: Session): SystemPrompt {
  return { stable:   s.stableTier,             // hash-stable across turns (identity, tools, skills-index)
           context:  scanInject(s.ctxFiles),   // threat-scanned → [BLOCKED] placeholders
           volatile: buildVolatileTier(s.memory.snapshot(), s.userMd, core.time.today()) }; // re-snapshotted (NOT re-derived) at the compression boundary
}
//   NOTE (R25-15): the volatile timestamp is core.time.today()/epochDay() (day-precision by design) —
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
  // R29-4: concrete grade() algorithm:
  //   for each golden g in this.golden:
  //     uncompressed_ok = stringEquals(g.trace.responses.join(), g.expectedAnswer)       // baseline (no compression)
  //     compressed_msgs = c.compress(g.trace.messages)
  //     compressed_ok   = stringEquals(replayResponses(compressed_msgs, g.trace.responses), g.expectedAnswer)
  //     agree = (uncompressed_ok === compressed_ok)                                        // ε=0: compression must not flip the answer
  //   passRate       = count(agree) / golden.length
  //   maxScoreDelta  = 0                                                                  // ε=0 by default
  //   // Tier-0 no-op compressor ⇒ compressed_msgs === messages ⇒ agree always true ⇒ passRate=1.0 trivially.
  // replayResponses = a deterministic MockProvider replay (canned `responses` aligned to `messages`).
  // MERGE BLOCKED unless passRate === 1.0 && maxScoreDelta === 0 (ε=0); Tier-0 no-op compressor passes trivially.
  // live GSM8K/TruthfulQA lm-eval = credentialed-tier ASPIRATION (best-effort when
  // OPENAI_API_KEY set), NOT a merge-block gate.
}
```

- **Tier-0 drift grader stub (R26-F):** the Tier-0 drift grader depends only on the `Compressor` + `LlmTrace` interface stubs (R26-A); concrete compressors are Tier-1 — the grader is shipped with a no-op/identity compressor in Tier 0 and upgraded when Tier-1 compressors land.

**Completeness (R31)** — CORE compression feature folded in from [FEATURE-INVENTORY](../../.learned/FEATURE-INVENTORY.md) Part 1:

| Feature | 1-line | Source |
|---|---|---|
| **CompressionPolicy per-auth-mode** | policy split by provider auth mode (PAYG/OAuth/Subscription): `live_zone_only`, `cache_aligner`, `max_lossy_ratio` — gates how aggressively lossy compression runs | [headroom](../../headroom/crates/headroom-core/src/compression_policy.rs) |

---

## 5.1 System Prompt Content (what goes IN each tier)

> Sourced from leaked prompts ([system_prompts_leaks](../../system_prompts_leaks/)) + reference agents' system-prompt builders. The SPEC specifies the MECHANISM (§5: 3-tier assembly) + now the CONTENT blocks per tier. Literal text is authored at implementation.

### Stable tier (identity + principles + rules — hash-stable across turns)

| Block | Content | Source |
|---|---|---|
| **Identity** | "You are `<name>`, an AI coding/autonomous agent powered by `<model>`. You operate in `<env>`." + product info | [Claude 4.8](../../system_prompts_leaks/Anthropic/Official/2026-05-28-claude-opus-4.8.md) · [Cursor](../../system_prompts_leaks/Cursor/cursor.md) · [opencode](../../system_prompts_leaks/Misc/opencode.md) |
| **Core mandates** | conventions-first; verify library availability; mimic style; idiomatic changes; sparse comments (WHY not WHAT); proactiveness; confirm ambiguity; don't revert unless asked | [opencode](../../system_prompts_leaks/Misc/opencode.md) · [Cursor](../../system_prompts_leaks/Cursor/cursor.md) |
| **Tone & style** | concise/direct (CLI: <3 lines); no chitchat/filler; no emoji unless asked; markdown (monospace); tools for action, text for communication | [opencode](../../system_prompts_leaks/Misc/opencode.md) · [devin](../../system_prompts_leaks/Misc/devin-cli.md) · [Claude](../../system_prompts_leaks/Anthropic/Official/2026-05-28-claude-opus-4.8.md) |
| **Tool calling rules** | specialized tools not shell for file ops; batch independent calls; chain dependent with &&; don't name tools in prose; explain modifying commands | [Cursor](../../system_prompts_leaks/Cursor/cursor.md) · [opencode](../../system_prompts_leaks/Misc/opencode.md) |
| **Code change rules** | read before edit; fix linter errors; prefer edit over create; no narrating comments; no binary/hash generation | [Cursor](../../system_prompts_leaks/Cursor/cursor.md) · [opencode](../../system_prompts_leaks/Misc/opencode.md) |
| **Workflow** | understand (grep/glob/read parallel) → plan → implement (follow conventions) → verify tests (never assume `npm test`) → verify standards (lint/typecheck/build); TDD for bugs | [opencode](../../system_prompts_leaks/Misc/opencode.md) · [devin](../../system_prompts_leaks/Misc/devin-cli.md) |
| **Mode selection** | devin: Normal (full autonomy) vs Plan (explore + ask, no changes until approved). Cursor: Agent Mode (default) + Plan + Debug + Ask. **SPEC:** adopt a Normal/Plan/Debug triad with proactive switching | [devin](../../system_prompts_leaks/Misc/devin-cli.md) · [Cursor](../../system_prompts_leaks/Cursor/cursor.md) |
| **Safety** | destructive ops (rm -rf, DB drops, force-push) need EXPLICIT confirmation; no malicious code; never expose/commit secrets; defensive security only | [devin](../../system_prompts_leaks/Misc/devin-cli.md) · [opencode](../../system_prompts_leaks/Misc/opencode.md) |
| **Git etiquette** | commit only when asked; never update git config; never skip hooks; HEREDOC commit msgs; push only when asked; focus on WHY not WHAT | [devin](../../system_prompts_leaks/Misc/devin-cli.md) · [Cursor](../../system_prompts_leaks/Cursor/cursor.md) |
| **Error recovery** | keep trying approaches; search codebase/docs; ask user as last resort (except auth/config/permission); keep going until resolved | [devin](../../system_prompts_leaks/Misc/devin-cli.md) · [opencode](../../system_prompts_leaks/Misc/opencode.md) |
| **Professional objectivity** | prioritize accuracy over validating beliefs; disagree when necessary; investigate before confirming; accountability without self-abasement | [devin](../../system_prompts_leaks/Misc/devin-cli.md) · [Claude](../../system_prompts_leaks/Anthropic/Official/2026-05-28-claude-opus-4.8.md) |

### Context tier (dynamic, injection-scanned)

| Block | Content | Source |
|---|---|---|
| **Project conventions** | AGENTS.md / CLAUDE.md / SOUL.md / .cursorrules (git-root bounded + subdirectory hints) | [pi](../../pi-coding-agent/) · [hermes](../../hermes-agent/) |
| **Available tools** | tool schemas (progressive disclosure, long-tail via ToolSearch) | [Cursor](../../system_prompts_leaks/Cursor/cursor.md) |
| **Skills index** | name + desc only (full body on invoke); agentskills.io frontmatter | [pi](../../pi-coding-agent/) · [Claude](../../system_prompts_leaks/Anthropic/Official/2026-05-28-claude-opus-4.8.md) `<tool_discovery>` |
| **MCP instructions** | per-server use instructions + tool schema checked before call | [Cursor](../../system_prompts_leaks/Cursor/cursor.md) |
| **Context files** | user-attached / discovered; injection-scanned ([BLOCKED] on match) | SPEC §5 · [hermes](../../hermes-agent/) |

### Volatile tier (per-turn re-snapshot at tier boundaries)

| Block | Content | Source |
|---|---|---|
| **Memory snapshot** | from MemoryManager.snapshot() — working memory + ragfs hits | SPEC §8 |
| **USER.md** | user preferences (style, format, features) | [Claude](../../system_prompts_leaks/Anthropic/Official/2026-05-28-claude-opus-4.8.md) · [hermes](../../hermes-agent/) |
| **Env hints** | cwd, git branch, platform, shell; **day-precision timestamp** (NOT real-time); session ID; provider/model | SPEC §5 R25-15 |
| **Todos** | active task list (TodoWrite) | [Cursor](../../system_prompts_leaks/Cursor/cursor.md) · [devin](../../system_prompts_leaks/Misc/devin-cli.md) |

### Assembly order
```
<stable>  identity → mandates → tone → tool-rules → code-rules → workflow → modes → safety → git → error-recovery → objectivity  </stable>
<context> project-conventions → tools-list → skills-index → mcp-instructions → context-files (all injection-scanned)  </context>
<volatile> memory-snapshot → USER.md → env-hints(day-precision) → todos  </volatile>
```

> **Design note:** The stable tier is a TEMPLATE — literal text is authored per-agent. The SPEC mandates the STRUCTURE (blocks × tier × source) + the MECHANISM (§5: cache-stable, injection-scanned, rebuild at boundaries). The `[system_prompts_leaks](../../system_prompts_leaks/)` repo is the concrete content reference.
