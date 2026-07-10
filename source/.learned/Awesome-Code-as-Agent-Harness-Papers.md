# Awesome-Code-as-Agent-Harness-Papers — Learnings for mya

> Studied 2026-07-08. **Not a codebase — a curated paper list** accompanying the survey **"Code as Agent Harness: Toward Executable, Verifiable, and Stateful Agent Systems"** (Ning et al., UIUC, arXiv:2605.18747, 2026). Source: `/home/bom/source/my-agent/source/Awesome-Code-as-Agent-Harness-Papers`.

## TL;DR (what it is, why it matters)
This is the **awesome-list for exactly what mya is** — an *agent harness*. Its value is a **research-grade taxonomy of agent-harness capabilities** that doubles as a **self-assessment / roadmap framework for mya**. "Code as harness" = code is no longer just a generated artifact; it is the *executable, inspectable, stateful medium* through which agents reason, act, model environments, take feedback, and coordinate. mya is a harness implementation → use this taxonomy to locate gaps and prioritize.

## The taxonomy (the asset) — with mya gap analysis

### 🧩 Harness Interface (how code faces the agent)
| Branch | Meaning | mya today | Gap / opportunity |
|---|---|---|---|
| **Code for Reasoning** | code-as-scratchpad / chain-of-thought in executable form | agent loop + extended thinking | consider **executable reasoning traces** (code the agent runs to verify its own steps) |
| **Code for Acting** | code = the action surface (tool calls, scripts) | tools + shell + WASM + (openhuman idea) embedded Python/JS | add **embedded scripting** (Rhai/Python/JS) so actions are code, not just tool names |
| **Code for Environment Modeling** | agent writes code that *models/simulates* the environment | none explicit | a mya tool that lets agents build runnable env models (sandbox sims) |

### 🛠️ Harness Mechanisms
| Branch | mya today | Gap / opportunity |
|---|---|---|
| **Planning for Code Agents** | SOP + plan_review idea | adopt **plan-critic** + structured plan representation (claw-code `green_contract`) |
| **Memory & Context Engineering** | 8 backends + pipeline | big cluster — validates openhuman **memory roles** + headroom **compression**; mya memory is backend-rich but strategy-poor |
| **Tool Usage for Code Agents** | ~80 tools + MCP | strong; add **tool-call repair** (openclaw) + **dynamic tool synthesis** |
| **Feedback-Guided Iterative Debugging** | `mya-eval` replay | expand eval into a **live feedback loop** (agent runs → observes failure → repairs) — pairs with tool-call-repair |

### 👥 Scaling the Harness (multi-agent) — most relevant to mya's subagents/delegation
| Branch | mya today | Gap / opportunity |
|---|---|---|
| **Functional Role Specialization** | subagents inherit identity | formalize **named roles** (harness 6 topologies) |
| **Interaction Modes** | delegate / send_message_to_peer | expand interaction primitives |
| **Workflow Topology** | pi-crew team workflows | **adopt the 6 topologies** (Pipeline/Fan-out-Fan-in/Expert Pool/Producer-Reviewer/Supervisor/Hierarchical) as first-class — *academically validated by this survey* |
| **Execution Feedback Integration** | partial (observer events) | feed child-agent results back into parent planning |
| **Shared-Harness Synchronization** | distributed nodes (basic) | **multi-agent shared state** is a frontier — mya's distributed-nodes + peer-groups are early |
| **Shared Harness Representation** | none explicit | a canonical shared workspace/state representation across agents |
| **Harness-State Convergence** | none | consistency models for multi-agent harness state |

### 🚀 Applications (markets mya could target)
Code Assistants · GUI/OS Agents · Autonomous Embodied Agents (→ mya's robot-kit + hardware!) · Scientific Discovery · **Agent Personalization** (→ mya's personal-assistant lane).

## Notable patterns & techniques (from the taxonomy, for mya)

1. **"Code as harness" framing itself.** Positioning mya as a *stateful, executable, inspectable harness* (not "a chatbot with tools") aligns with the research frontier and justifies mya's trait-driven, audited, sandboxed design. Use this language in mya docs/vision.

2. **Workflow Topology section validates the harness-6 topologies.** The survey catalogs multi-agent workflow topologies as a research area — adopting Pipeline/Fan-out-Fan-in/Expert Pool/Producer-Reviewer/Supervisor/Hierarchical in mya is both practically useful *and* research-aligned.

3. **"Shared-Harness Synchronization / Representation / Convergence"** = the open frontier for multi-agent systems. → mya's `distributed nodes` + `peer_groups` + subagent task store are early seeds; this signals where to invest for multi-agent correctness.

4. **Memory & Context Engineering is its own mechanism cluster.** Reinforces openhuman (memory roles) + headroom (compression) + OpenViking (unified context) findings: **memory/context is a first-class research area** — mya should treat it as a flagship subsystem, not a backend detail.

5. **Feedback-Guided Iterative Debugging** → pair `mya-eval` with a runtime feedback loop (agent self-repairs on failure) and openclaw's tool-call-repair.

## Top ideas worth adopting (prioritized)
1. **Use this taxonomy as mya's capability self-assessment + roadmap** — score each cell (Interface/Mechanism/Scaling/Application) and prioritize the gaps.
2. **Multi-agent shared-state investment** (Shared-Harness Sync/Representation/Convergence) — the frontier; build on mya's distributed-nodes + subagent task store.
3. **Executable reasoning + embedded scripting** (Code-for-Reasoning / Code-for-Acting) — Rhai/Python/JS in-process (also from openhuman).
4. **Adopt the workflow-topology vocabulary** (research-validated) for mya teams.
5. **Reframe mya vision as a "stateful executable agent harness"** (survey language).

## Gotchas
- It's a paper *index*, not implementations — borrow the **taxonomy and directions**, not code.
- arXiv:2605.18747 (2026) — recent; some cited work is preprint; validate before depending on specifics.
- Survey scope is broad; not every cell applies to mya's "personal assistant" focus (e.g., scientific-discovery tooling).

## Key reference files
- `README.md` (79 KB — the full taxonomy + paper links per branch)
- `figs/overview.png` (framework diagram), `TODO.md`, `MISSING_URLS.md`
- Survey: `arXiv:2605.18747` — "Code as Agent Harness: Toward Executable, Verifiable, and Stateful Agent Systems"

## Scope note
Did not enumerate individual papers (hundreds). The **taxonomy structure** (captured above) is the actionable asset for mya. A deeper pass could extract the top 5 papers per mya-relevant branch (Memory/Context, Workflow Topology, Shared-Harness) for specific techniques.
