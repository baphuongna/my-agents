# Unified Agent SPEC — Overview

> Unified Agent SPEC — founding spec (capstone of the 12-source learning loop, 2026-07-10). This file is the overview + index; full detail in the sibling files below.




---

## Table of Contents (spec/ files)



| File | Sections |

|---|---|

| [00-OVERVIEW.md](00-OVERVIEW.md) | §1 Vision · §2 Language · §3 Architecture · §19 License · §22 What it's NOT |

| [01-core-loop.md](01-core-loop.md) | §4 Core Loop & Turn Lifecycle |

| [02-providers.md](02-providers.md) | §6 Provider Abstraction |

| [03-tools-permission.md](03-tools-permission.md) | §7 Tool System & Permissions |

| [04-prompt-compression.md](04-prompt-compression.md) | §5 Prompt System (3-tier + compression, drift grader) · §5.1 System Prompt Content |

| [05-memory.md](05-memory.md) | §8 Memory (roles + manager + unified context) |

| [06-skills-subagents.md](06-skills-subagents.md) | §9 Skills · §10 Subagents & Topologies |

| [07-code-channels.md](07-code-channels.md) | §11 Code Nav & Execution · §12 Channels & Gateway |

| [08-observability-security.md](08-observability-security.md) | §13 Observability · §14 Security · §14b Crash Resilience |

| [09-eval-supply.md](09-eval-supply.md) | §15 Eval & Quality Gates · §16 Supply Chain |

| [10-packages.md](10-packages.md) | §17 Extension Model (packages) |

| [11-invariants-roadmap.md](11-invariants-roadmap.md) | §18 Invariants · §20 Roadmap · §21 Cross-cutting · §23 Open Q · §24 Glossary |
| [12-ui-surfaces.md](12-ui-surfaces.md) | §25 UI Surfaces — CLI/TUI · Web · Desktop · Collab · Companion · UI↔Runtime event contract |



### § → file map (for cross-references)



| § | File | | § | File |

|---|---|---|---|---|

| §1 | 00-OVERVIEW | | §13 | 08-observability-security |

| §2 | 00-OVERVIEW | | §14 / §14b | 08-observability-security |

| §3 | 00-OVERVIEW | | §15 | 09-eval-supply |

| §4 | 01-core-loop | | §16 | 09-eval-supply |

| §5 | 04-prompt-compression | | §17 | 10-packages |

| §6 | 02-providers | | §18 | 11-invariants-roadmap |

| §7 | 03-tools-permission | | §19 | 00-OVERVIEW |

| §8 | 05-memory | | §20 | 11-invariants-roadmap |

| §9 | 06-skills-subagents | | §21 | 11-invariants-roadmap |

| §10 | 06-skills-subagents | | §22 | 00-OVERVIEW |

| §11 | 07-code-channels | | §23 | 11-invariants-roadmap |

| §12 | 07-code-channels | | §24 | 11-invariants-roadmap |
| §25 | 12-ui-surfaces | | | |



## 1. Vision & Design Tenets

A **general-purpose autonomous + coding agent** that is: production-grade, long-term-maintainable, fast, safe, and infinitely extensible without forking. Built once, extended by packages.

**Tenets (synthesized, with source):**
1. **Minimal stable core, maximal package edge.** *(source: [pi](../../pi-coding-agent/))* The core is tiny and frozen; every capability (subagents, plan mode, channels, memory backends) is an installable package. Composition over compilation.
2. **TS conductor, Rust engine.** *(source: [oh-my-pi](../../oh-my-pi/))* Agent loop, tools, extensions, UI in TypeScript (iteration speed + npm + AI-SDK-first). Perf/correctness-critical paths (search, AST, crypto, compression) in Rust, bound via napi-rs. The shell runs via the user's `/bin/bash` (no vendoring/sandbox — pi model).
3. **Typed state machines everywhere; events over scraped prose.** *(source: [claw-code](../../claw-code/))* Every lifecycle is a tagged enum; observers pattern-match on data, never parse logs.
4. **The prompt cache is sacred.** *(source: [hermes-agent](../../hermes-agent/))* System prompt built once per session; it rebuilds only at **tier boundaries** (compression / provider-or-profile swap / skill-write). All other mid-conversation mutation is banned. *(R25-16: the boundary set is wider than compression alone — see [§5 Prompt](04-prompt-compression.md).)*
5. **Pit of success.** *(source: [MyAgents](../../MyAgents/))* The wrong thing doesn't compile; one canonical helper per concern, enforced by lints.
6. **Recovery before escalation; partial success is first-class.** *(source: [claw-code](../../claw-code/))* Known failures auto-heal once; components report `Healthy | Degraded | Failed`, never just "up/down".
7. **One core, many transports.** *(source: [pi](../../pi-coding-agent/))* Interactive TUI / one-shot print+JSON / RPC over stdio / embeddable SDK share one core.
8. **Trust-the-environment + permission gate (pi model).** *(source: [openhuman](../../openhuman/) + [hermes-agent](../../hermes-agent/) + [claw-code](../../claw-code/) + [pi](../../pi-coding-agent/))* The agent runs in the user's workspace with their privileges; there is **NO OS-level sandbox/containment** (R30 sandbox-removal). Dangerous operations are controlled by the [§7](03-tools-permission.md) permission gate (mode + deny/ask rules + approval), not by containment. Prompt-injection scan (defense-in-depth), per-surface Merkle audit, content-addressed edits (an edit-correctness feature, not a security boundary), and secrets redaction remain. **Accepted risk:** host exposure exactly like any npm-installed dev tool — the user accepts this (it's the same trust as `npm install -g <anything>`).

---
## 2. Language Stack Decision (the explicit ask)

**Verdict: Hybrid — TypeScript (loop/extension/UI) + Rust (perf/safety natives via napi-rs).** Not pure Rust (mya-v1 lesson: 16-min compiles, slow iteration, AI SDKs land late), not pure TS (openclaw lesson: event-loop stalls, message-loss bugs at scale), not Python (hermes lesson: 27K open issues / 12.8% issue-star ratio — worst maintainability).

> **Toolchain pin:** **TypeScript 7** (the native Go-based compiler — `tsc` rewritten in Go, ~10× faster type-checking/builds vs TS 5/6). This is non-negotiable for Tier 0: the faster `tsc` keeps the edit-build-test loop tight on a TS-primary core, which is the whole reason the loop moved off Rust. The Rust side stays on **stable** + `clippy --all-targets`. Bun is the runtime/TS-loader for dev; the published artifact is ESM consumable by both Bun and Node.

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
| Shell command exec | **TS** (spawns the user's `/bin/bash`/`$SHELL`) | pi model: no sandbox; the [§7](03-tools-permission.md) permission gate is the control. An OPTIONAL future perf/Windows-parity optimization is to vendor `brush`+`uutils` behind a flag — explicitly NOT a security measure |
| AST / tree-sitter parsing, content-hash edits | **Rust** | correctness, no GC pauses |
| Compression hot path, byte-faithful JSON | **Rust** | token-cut throughput, signing determinism |
| Crypto, audit (Merkle) | **Rust** | memory safety on trust boundary |

**When to put something in Rust (not TS) — a strict gate:** only if it satisfies ≥1 of: (a) **trust boundary** (crypto, audit) — safety demands memory-safety + no GC; (b) **hot inner loop** (search over 100k+ files, AST parse, compression) — perf dominates; (c) **determinism** (byte-faithful JSON, signing); (d) **platform parity** (POSIX shell + coreutils for Windows determinism) — justified only when no cross-platform TS equivalent exists and the surface is vendored+frozen. Everything else stays in TS — moving code to Rust "for speed" without one of these just adds a napi serialization tax and a compile bottleneck. *(source: Audit [§3 Architecture](00-OVERVIEW.md)'s crate list against the 4-gate table (C9/R28): `natives`(crypto/ast/fs)=trust-boundary/a+c, `search`=hot-loop/b, `ast`=hot-loop/b, `compress`=hot-loop/b. **R30 sandbox-removal** drops `shell`=trust/a (shell now `/bin/bash`) and `sandbox`=trust/a (sandbox gone); it previously dropped `pi-iso`, an [oh-my-pi](../../oh-my-pi/) concept NOT in this workspace; crypto is part of `natives`.)*)

> **Distribution:** the agent ships as an **npm package** (`npm install -g <agent>` or `npx <agent>`). Rust natives ship as **prebuilt napi binaries via npm `optionalDependencies`** (one per {os,arch}, like `@napi-rs/*`) — **no Rust toolchain is required to install**. The TS core + packages resolve from npm (matches the TS-primary stack + pi's distribution). The Rust core ships as a prebuilt `napi` binary per platform (like oh-my-pi's `pi-natives`), so **package authors never compile Rust** — they consume it as a fast native module from TS.

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
│   ├── natives/              # napi bridge: search, fs, ast, edit-hash, crypto (NO shell/sandbox — R30)
│   ├── search/               # glob + grep (ripgrep-class)
│   ├── ast/                  # tree-sitter parse + content-hash edit engine
│   └── compress/             # content-aware compression (Apache-2.0 algo, parity-tested)
├── docs/  examples/  test/  Dockerfile  Cargo.toml  package.json
```

**Layering rule (enforced by a workspace lint):** `core` depends on nothing in `packages/*` except the `{ai, extensions, memory, prompts}` *interface* packages + `natives`; `crates/*` expose only napi functions to `natives`; transports (`tui/cli/sdk/rpc`) depend on `core`, never the reverse. *(import-direction-acyclic — madge/ESLint-enforced; core has no upward imports; SSOT-preserving.)*

> **Disambiguation:** the "transport" word carries three distinct senses in this SPEC. The **agent transport mode** (`interactive` / `print` / `rpc` / `sdk`) is the user-facing entry point above `core`; the **provider wire** (`auto` / `sse` / `websocket`, [§6 Providers](02-providers.md)) is the streaming protocol `core` speaks to a model provider; and **lane liveness** (`transportAlive`, [§13 Observability](08-observability-security.md)) is the per-lane health flag. The layering rule above governs only sense (a).

**Buildability & boundary contract (round 9):**
- **napi boundary contract (R25-21):** values crossing TS↔Rust are `serde`-serializable values + `Buffer` + **napi `Class` handles for stateful sessions** (Pty/Process — mutation via methods returning owned results; no interior-mutable fields exposed to JS) + `ThreadsafeFunction<T>` for streaming, where `T` is a generated napi object; `Unknown<'env>` permitted only for JS-owned cancellation signals. No raw `*mut`/`Arc<Mutex<_>>` crosses dlopen. Keeps the boundary debuggable + the Rust core independently testable.
- **Streaming backpressure (R25-22):** streaming callbacks use an explicit policy — **lossless streams** (tool-call repair, edit-hash) use `ThreadsafeFunction::Blocking` OR a sequence-numbered `StreamChunk{seq,payload}` the TS side NACKs on gaps; **lossy streams** (TUI render) may use `NonBlocking`. State per-stream which.
- **ABI stamp honesty (R25-23):** the reference (oh-my-pi) uses a **version-semver sentinel** (`__piNativesV{semver}` symbol) that refuses mismatched-release binaries. A full `{rust_core_version, napi_abi}` **ABI stamp is a SPEC-proposed upgrade**, not inherited — see [§23 Open Questions](11-invariants-roadmap.md) open question #6. *(source: [mya-v1](../../mya-v1/) #11 AbiStamp = SPEC proposal.)*
- **Natives release (R25-24):** natives are **independently versionable from core** (separate semver); a natives patch follows the `<patch>` channel and is auto-promoted without a core release. CI matrix = N platforms × M variants (N≈5, x64 ships modern+baseline).
- **Compilation boundary:** Rust changes = napi rebuild + stamp bump (a release concern, not a package-author concern). CI builds the {OS×arch} matrix once per release; `cargo` is never invoked by users or packages.
- **Cycle detection:** a workspace `madge`/ESLint rule fails the build on any import cycle through `core`; foundation crates (config/log/api/spawn) may not depend upward.

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
## 22. What this SPEC deliberately is NOT

- **Not pure-Rust** (mya-v1 lesson: compile times kill iteration). The TS loop is non-negotiable for extension velocity.
- **Not maximalist-by-default** (oh-my-pi ships everything in one binary). The SPEC keeps pi's **minimal core + packages**; oh-my-pi's features become opt-in packages.
- **Not Python-primary** (hermes maintainability data). Python appears only inside the code-exec bridge kernel, never as the host language.
- **Not a rebrand of mya-v1.** It inherits mya-v1's trait-driven multi-crate discipline + channels + gateway, but re-platforms the loop to TS and the engine to a Rust napi core.

---

*Cross-references: per-source detail in sibling `<source>.md`; deep port-designs in `deepdives/0[1-9]*.md`; consolidated idea map in `SYNTHESIS.md`. This SPEC supersedes the mya-v1-specific SYNTHESIS for the successor design.*

**Deepdive translation (R26-B):** the sibling `deepdives/0[1-9]*.md` are Rust/mya-v1 port designs. For this TS-first successor, treat them as **concept reference only**. Translation: Rust `#[serde(tag="state")]` enum → TS discriminated union (literal `state` field); `clippy.toml disallowed-methods` → ESLint `no-restricted-syntax`; `Arc<RwLock<Config>>` → a TS config singleton resolved on demand; Rust modules → TS `packages/*` (or Rust `crates/*` only if they pass the [§2 Language](00-OVERVIEW.md) Rust-gate). Where a deepdive contradicts this SPEC, **the SPEC wins** (esp. [§9 Skills](06-skills-subagents.md) SkillProvenance, which supersedes deepdive #02/#09).
