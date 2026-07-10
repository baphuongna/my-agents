# Learning Loop — Reference Codebase Study for mya

**Source:** `/home/bom/source/my-agent/source/` — 9 reference agent/harness projects (~1.7 GB).
**Goal:** Extract patterns / architecture / techniques to develop **mya** (autonomous Rust agent runtime).
**Started:** 2026-07-06. **Status:** ✅ COMPLETE — 9/9 studied. See **`SYNTHESIS.md`** for the consolidated roadmap.

## How to STOP
Say **"stop"** / "dừng" in chat, **OR** `touch /home/bom/source/my-agent/source/.learned/STOP`

## Projects
| # | Project | Stack | Status | Output |
|---|---------|-------|--------|--------|
| 1 | openclaw | TS/Node pnpm | ✅ | `openclaw.md` |
| 2 | openhuman | Rust | ✅ | `openhuman.md` |
| 3 | headroom | Rust (+Py) | ✅ | `headroom.md` |
| 4 | OpenViking | Rust+C++ | ✅ | `OpenViking.md` |
| 5 | claw-code | Rust | ✅ | `claw-code.md` |
| 6 | MyAgents | TS+Rust (Tauri) | ✅ | `MyAgents.md` |
| 7 | harness | plugin (md) | ✅ | `harness.md` |
| 8 | Awesome-...-Papers | paper list | ✅ | `Awesome-Code-as-Agent-Harness-Papers.md` |
| 9 | hermes-agent | Python | ✅ | `hermes-agent.md` |

## Cross-project synthesis (consolidated themes — what mya should adopt)
1. **Typed FSMs + structured error surfaces everywhere** (claw-code 11-phase MCP FSM + `LaneBoard`). Replace ad-hoc enums/logs with `#[serde(tag="state")]` + `phase`/`recoverable`/`context`.
2. **Pit-of-success lint wrappers** (MyAgents) — convert AGENTS.md "forbidden patterns" into `clippy::disallowed_methods` so the wrong call won't compile.
3. **Memory as a flagship subsystem with named roles** (openhuman archivist/tree/diff/goals/sync) + **unified context FS** (OpenViking ragfs). mya is backend-rich but role-poor & fragmented.
4. **Context compression** (headroom 60-95% token cut) + **staged compaction** (claw-code Trident) → directly reduce mya's measured token cost.
5. **6 multi-agent topologies** (harness: Pipeline/Fan-out/Expert-Pool/Producer-Reviewer/Supervisor/Hierarchical) — research-validated (Papers survey). Formalize as mya `TeamTopology`.
6. **Lean/headless binary split** (claw-code `claw-analog`) → `mya-headless` for CI/automation.
7. **Tool-call repair pipeline** (openclaw) + **dual-binary** + **mock parity harness** (claw-code) for deterministic eval.
8. **Supply-chain hygiene** (openclaw `minimumReleaseAge` + overrides) + **byte-faithful serde_json** (`preserve_order`+`arbitrary_precision`, headroom).
9. **Architecture decomposition** (openclaw: `gateway-protocol`/`net-policy`/`acp` as separate core crates).
10. **"Code as harness" framing** (Papers survey) — position mya as a *stateful, executable, inspectable harness*; use the survey taxonomy as a capability self-assessment.
11. **Multi-agent shared-state** (Papers: Shared-Harness Sync/Representation/Convergence) — the open frontier; invest in mya's distributed-nodes + subagent task store.
12. ⚠️ **License caution**: OpenViking = AGPLv3 → study architecture, never vendor code.

_(deeper per-theme docs can be generated from the individual `<project>.md` files)_
