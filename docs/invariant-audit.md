# Invariant Audit Map (§18)

> Maps each of the 20 SPEC invariants (`spec/11-invariants-roadmap.md` §18) to its **enforcer** in the actual codebase. Honest status: ✅ enforced in code · 🟡 partial (mechanism exists, enforcer gap) · ❌ enforcer missing.
> Generated after a full SPEC read + grep verification (see `PLAN-REMAINING.md`).

| # | Invariant (short) | Status | Enforcer in code / gap |
|---|---|---|---|
| 1 | No mid-conversation prompt mutation except at tier boundary | 🟡 | `assemblePrompt` memoized per-session (`packages/core/src/loop.ts`); `PromptMutex` exists. **Gap:** no hash-diff unit test asserting stability across turns |
| 2 | Never cache allowlists/`denied_tools` in handles | 🟡 | permission resolves via `TurnContext` per-call (`packages/tools/src/permission.ts`). **Gap:** no ESLint rule banning allowlist fields on handle classes |
| 3 | Never propagate parent stdin to subagents | ✅ | `SubagentSpawn` type takes an explicit `ApprovalChannel`; parent stdin is unreachable by type (`packages/subagents`) |
| 4 | Never vendor AGPL code | 🟡 | `deny.toml` (cargo-deny) bans AGPL/GPL/LGPL/EUPL/SSPL/BUSL licenses at `packages/../deny.toml`. **Gap:** cargo-deny is not installed in CI yet; OpenViking kept clean-room (no code read). (`cargo audit` needs no config; run via CI, not a tracked file.) |
| 5 | Never ship compression without the drift gate | ✅ | `DriftGrader` (ε=0) + `identityCompressor` baseline (`packages/prompts/src/drift.ts`); compressors ship behind it |
| 6 | Never stub-then-replace a field | 🟡 | TS strict mode + discriminated unions throughout. **Gap:** no formal `no-explicit-any` error + review checklist |
| 7 | Never append per-turn prefix into the cached system block | ✅ | `assemblePrompt` returns the 3 joined tiers; per-turn user msg is appended by the loop, never re-joined |
| 8 | Never let auxiliary/side task touch the main prompt cache | 🟡 | `AuxiliaryProvider` type is a separate profile; `summarizeCompressor` uses a separate provider. **Gap:** no static-unreachability assertion |
| 9 | Shell via `/bin/bash` directly; no sandbox | ✅ | `bashTool` spawns `/bin/bash -c`/`$SHELL`, no sandbox code path (`packages/tools/src/builtin.ts`) |
| 10 | Never duplicate the time helper | ❌ | `core.time` (TS) + `natives.now_*` (Rust) are the sole sources, BUT `Date.now()` is used in **39 sites across 19 packages** outside `core.time` (incl. the audit path `tools/dispatch.ts` + `secrets`). **Gap (systemic):** no lint; the invariant is actively violated. Phase-2 remediation: inject `nowWallclock` everywhere. |
| 11 | Never derive UI state from scraping stdout | ✅ | `RuntimeEvent` typed bus; all 4 transports (`tui`/`rpc`/`sdk`/`print`) consume events, none import `child_process`. **Gap:** no ESLint rule enforcing the import ban. |
| 12 | Never spawn a fresh client per call/turn | 🟡 | `ProviderRegistry` holds long-lived profiles. **Gap:** no lint banning `new Provider()` outside runtime construction |
| 13 | Never let a hook bypass an `ask` rule | 🟡 | `HookRegistry` exists BUT is never invoked in the dispatch path; the permission pipeline is only **3 of 7 steps** (no deny/ask/allow rules, no rule grammar) and `guessActiveMode` is a stub returning `Prompt`. **Gap:** wire hooks + finish the 7-step pipeline (Phase 4). |
| 14 | Never `abort!`/`process::exit` across napi | ✅ | `#![deny(clippy::exit)]` + every entry wrapped in `catch_unwind`→typed Error (`crates/natives/src/lib.rs`) |
| 15 | Prompt COW-immutable; serialized tier rebuilds | 🟡 | `PromptMutex.withLock` serializes rebuilds. **Gap:** no `Arc<SystemPrompt>`-equivalent atomic swap stress test |
| 16 | Every `crates/*` must justify a Rust gate | 🟡 | `natives` justifies all 4 gates (BLAKE3=trust, glob/grep=hot-loop, time=determinism). **Gap:** no `OWNERS` file per crate + no CI scan |
| 17 | Every component emits `ComponentHealth` on state change | 🟡 | `ComponentHealth` type + `RuntimeEvent{kind:"health"}` exist; some components emit. **Gap:** not all components emit; no boot registry scan |
| 18 | Failed tool calls surface as `DegradedResult`/`LifecycleError` | ✅ | `aggregate()` returns `DegradedResult{failedCallIds}` (`packages/tools/src/dispatch.ts`) |
| 19 | Transports depend on `core` only; no cross-transport imports | ✅ | all 4 transports (`tui`/`rpc`/`sdk`/`print`) depend on `core` only; none import each other or `child_process`. **Gap:** no `madge --circular` CI rule (paper-only in AGENTS.md). |
| 20 | Adding to `packages/core/` requires a why-not-a-package justification | ❌ | **No PR template / CI grep gate.** Open gap |

## Summary

- **✅ Enforced:** 6 (#3, #5, #7, #9, #14, #18)
- **🟡 Partial:** 13 (mechanism exists; the *automated enforcer* is the gap — mostly lint/CI/test assertions)
- **❌ Missing:** 1 (#20 — core-size gate)

The pattern: the **design** of most invariants is realized in code, but the **automated enforcement** (lint rules, CI scans, stress/diff tests) is largely absent. Closing these is mostly test/lint work, not redesign.
