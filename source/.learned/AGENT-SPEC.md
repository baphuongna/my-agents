# AGENT-SPEC — Unified Autonomous/Coding Agent (founding spec)

> **This file is now an INDEX.** The full 947-line spec has been split into focused files under [`spec/`](spec/). Every line of the original — including all R24–R28 fixes — is preserved verbatim there. This page is the entry point + table of contents only.

**Working name:** Unified Agent (rename freely). **Predecessor:** `mya-v1` (archived at [`../mya-v1/`](../mya-v1/)).

> Capstone of the 12-source learning loop (2026-07-10). Synthesizes the best architecture, subsystem, and discipline decisions from **12 reference projects** into one coherent agent design. Quality-optimal; effort explicitly ignored per directive. Source attributions are inline (now real relative links) so every decision is traceable.

## Table of contents — `spec/`

| File | Sections |
|---|---|
| [`spec/00-OVERVIEW.md`](spec/00-OVERVIEW.md) | §1 Vision · §2 Language · §3 Architecture · §19 License · §22 What it's NOT (+ TOC & §→file map) |
| [`spec/01-core-loop.md`](spec/01-core-loop.md) | §4 Core Loop & Turn Lifecycle (TurnState FSM, `runTurn`) |
| [`spec/02-providers.md`](spec/02-providers.md) | §6 Provider Abstraction (ProviderProfile, repair, council) |
| [`spec/03-tools-permission.md`](spec/03-tools-permission.md) | §7 Tool System (registry, 7-step permission pipeline) |
| [`spec/04-prompt-compression.md`](spec/04-prompt-compression.md) | §5 Prompt System (3-tier, compression, drift grader) |
| [`spec/05-memory.md`](spec/05-memory.md) | §8 Memory (roles, MemoryManager, unified context) |
| [`spec/06-skills-subagents.md`](spec/06-skills-subagents.md) | §9 Skills · §10 Subagents & topologies |
| [`spec/07-code-channels.md`](spec/07-code-channels.md) | §11 Code Nav & Execution · §12 Channels & Gateway |
| [`spec/08-observability-security.md`](spec/08-observability-security.md) | §13 Observability · §14 Security · §14b Crash Resilience |
| [`spec/09-eval-supply.md`](spec/09-eval-supply.md) | §15 Eval & Quality Gates · §16 Supply Chain |
| [`spec/10-packages.md`](spec/10-packages.md) | §17 Extension Model (packages) |
| [`spec/11-invariants-roadmap.md`](spec/11-invariants-roadmap.md) | §18 Invariants · §20 Roadmap · §21 Cross-cutting · §23 Open Q · §24 Glossary |
| [`spec/12-ui-surfaces.md`](spec/12-ui-surfaces.md) | §25 UI Surfaces — CLI/TUI · Web dashboard · Desktop (Electron/Tauri) · Realtime collab · Desktop companion · UI↔Runtime event contract |

## Where to look

- **Start here:** [`spec/00-OVERVIEW.md`](spec/00-OVERVIEW.md) — vision, language-stack decision, the workspace architecture map, and the complete **§→file map** for navigation.
- **Cross-references** like `§7` are now markdown links pointing to the correct detail file (the §→file map in the overview is authoritative).
- **Deepdive translation note** (R26-B): the sibling `deepdives/` are Rust/mya-v1 port designs — concept reference only; where a deepdive contradicts this SPEC, the SPEC wins. See the overview.

## Audit trail

- Restructure plan: [`RESTRUCTURE.md`](RESTRUCTURE.md).
- Review/fix history: [`REVIEW-LOG.md`](REVIEW-LOG.md), [`SPEC-FIXES-R24.md`](SPEC-FIXES-R24.md) · [`-R25.md`](SPEC-FIXES-R25.md) · [`-R26.md`](SPEC-FIXES-R26.md) · [`-R27.md`](SPEC-FIXES-R27.md) · [`-R28.md`](SPEC-FIXES-R28.md) — all R24–R28 fixes survive verbatim inside `spec/`.
- Pre-split original (safety copy, no VCS): [`AGENT-SPEC.legacy.md`](AGENT-SPEC.legacy.md). Per-source detail: sibling `<source>.md`; idea map: [`SYNTHESIS.md`](SYNTHESIS.md) (superseded by this SPEC for the successor design).
