# openhuman — Learnings for mya

> Studied 2026-07-06. **Architecture + feature-surface pass** (openhuman is a ~4,300-file single Rust crate with ~130 domain modules; this pass maps the feature surface + calls out adoptable concepts). Source: `/home/bom/source/my-agent/source/openhuman`.

## TL;DR
**OpenHuman** (tinyhumansai, v0.58.11, "early beta") is a **Rust, local-first "personal AI super-intelligence"** — positioned as *"a brain that remembers everything, a fantastic orchestrator, a deep researcher."* Single large crate (`openhuman_core`, bin `openhuman-core`) with **~130 feature modules** under `src/openhuman/`. It is the **most feature-dense** reference in the set and a direct conceptual rival to mya. Highest-density source of *feature + product ideas* in the whole `source/` collection.

## Architecture overview
- **One big crate** (not a workspace): `src/{api,bin,core,rpc,openhuman}`. `src/openhuman/<domain>/` = ~130 feature modules. `src/core/` = CLI/dispatch/jsonrpc/runtime/observability. `src/api/` = REST + socket + jwt. `src/rpc/`.
- **Runs on `tinyagents`** (agent runtime) + **`tinyflows`** (host-agnostic workflow engine: typed node graph → validate → compile → run) + **`tinyplace`** (tiny.place A2A social-network SDK).
- **Bins reveal ops tools:** `slack-backfill`, `gmail-backfill-3d` (historical ingest), `memory-tree-init-smoke`, `inference-probe`, `harness-subagent-audit`, `test-mcp-stub`.
- Native via `fastlane/` (mobile), `app/`, `packages/` (TS front-end?), `vendor/` (vendored submodules).

## Notable patterns & techniques

1. **Memory as a full subsystem with specialized ROLES** — not just backends. Modules: `memory_archivist` (curates/prunes), `memory_diff` (tracks changes over time), `memory_goals` (goal-tagged memories), `memory_tree` (hierarchical), `memory_sync` (multi-device), `memory_graph` (entity graph), `memory_queue`, `memory_sources`, `memory_entities`, `memory_conversations`, `memory_search`, `memory_tools`. → **mya has 8 backends + a processing pipeline, but no "archivist" (active curation), no "diff" (change tracking), no "goals" (goal-oriented retrieval), no "tree" (hierarchy), no "sync" (multi-device).** Adopting named memory roles — especially **archivist** (auto-curate/decay/promote) and **memory_tree** (hierarchical context) — would materially deepen mya's memory story.

2. **Three workflow systems, incl. embedded scripting.** `tinyflows` (typed node-graph: validate → compile → run), `flows` (domain flows), and **`rhai_workflows`** (Rhai embedded scripting language). → **mya has cron + SOP + routines but no user-scriptable workflow engine.** A **Rhai (or similar) embedded scripting layer** lets end-users author automations safely in-process (Rhai is sandboxed by design) — a strong differentiator vs mya's config-only automation.

3. **`model_council` + `council_registry`** — multiple models deliberate / vote / cross-check on a task. → mya routes to a single provider per turn (with fallback). A **"council" provider archetype** (fan-out to N models → aggregate/vote) would add a deliberation mode, useful for high-stakes decisions. (Note: pi-crew already has a `council` skill — productize the pattern in mya itself.)

4. **`subconscious` + `subconscious_triggers`** — persistent background processing kicked by triggers, framed as the agent's "subconscious." → mya has `heartbeat` + `routines`; reframing/organizing background autonomous work as a **trigger-driven "subconscious"** (event-triggered, not just polled) is a compelling UX/mental-model. Adopt trigger-based activation.

5. **`codegraph`** — an in-process codebase semantic graph. → **mya has no native code-indexing** (relies on external LSP via the pi-langsrv *skill*). A built-in `codegraph` (symbols/refs/call-graph) would make mya self-sufficient for code tasks without external tooling.

6. **Embedded language runtimes: `runtime_python`, `runtime_python_server`, `javascript`.** In-process Python + JS execution. → mya's code execution is shell-only (`shell` tool) + WASM plugins. An **in-process Python/JS tool** (sandboxed) is a frequent user ask and would broaden mya's automation surface.

7. **`plan_review`** — review/critique an agent's plan *before* execution. → mya has SOP approval gates (human approves steps), but not an **automated plan-critic** (an agent reviews another agent's plan). A plan-review pass (critic agent) before risky execution improves safety.

8. **`prompt_injection` as a dedicated module** (+ `security/audit.rs`, `mcp_audit`, `cwd_jail`, `sandbox`). → mya has `PromptGuard` + 5 sandboxes + Merkle audit. openhuman's decomposition (separate `prompt_injection` module, `mcp_audit` for MCP tool calls specifically) is worth mirroring: **per-surface audit** (MCP calls audited separately).

9. **`screen_intelligence`** — active screen understanding (not just a screenshot). → mya has a `screenshot` tool; a **screen-intelligence** layer (OCR + layout + semantic regions) enables GUI automation mya currently lacks.

10. **`wallet` + `web3` + `x402`** — on-chain wallet, web3, and **x402** (HTTP micropayment protocol). → mya has **Verifiable Intent (SD-JWT)** for autonomous payments; openhuman pairs it with a real **wallet + x402 micropayments**. If mya pursues autonomous payments, x402 (pay-per-HTTP-request) is the emerging standard to track.

11. **`meet` + `meet_agent` + `agent_meetings`** — the agent joins/runs meetings. `recall_calendar` — calendar-keyed memory recall. `people` — contact/entity CRM. → mya has no calendar/people/meeting surfaces. These are a coherent **"personal-assistant daily-life"** feature cluster mya could grow into.

12. **`composio` + `integrations/tools`** — Composio (unified SaaS actions) as a first-class integration layer. → mya already has Composio (good parity).

13. **Backfill bins (`slack-backfill`, `gmail-backfill-3d`)** — historical ingestion into memory. → mya has email/gmail/Slack channels but no **"ingest history into memory"** utility. A backfill-to-memory capability is valuable for onboarding ("remember my past Slack").

## Top ideas worth adopting (prioritized)
1. **Memory roles: `archivist` (auto-curate/decay) + `memory_tree` (hierarchy) + `memory_diff` (change tracking).** Biggest delta vs mya's memory.
2. **Embedded-scripting workflows (Rhai).** User-authorable, sandboxed automations — fills the gap between cron/SOP and full code.
3. **`codegraph`** in-process code semantic graph — makes mya self-sufficient for code tasks.
4. **`model_council`** provider archetype (multi-model deliberation/voting).
5. **Trigger-driven "subconscious"** (event-activated background processing) + **`plan_review`** (automated plan critic) — safety + autonomy UX.

## Differences vs mya
| Axis | openhuman | mya |
|---|---|---|
| Structure | 1 huge crate, ~130 modules | 18-crate workspace, trait-driven |
| Memory | many named roles (archivist/tree/diff/goals/sync) | 8 backends + pipeline, fewer roles |
| Workflows | tinyflows + Rhai scripting | cron + SOP + routines (no scripting) |
| Multi-model | council (deliberation) | single-provider + fallback |
| Code intel | native `codegraph` | external LSP (skill) |
| Embed runtimes | Python + JS in-process | shell + WASM |
| Mobile | fastlane (iOS/Android) | Tauri desktop + TUI |
| Payments | wallet + web3 + x402 | Verifiable Intent (SD-JWT) |
| Maturity | "early beta", v0.58 | v0.0.1 experimental |

mya's **trait-driven multi-crate** design is cleaner/more extensible than openhuman's monolithic crate; openhuman wins on **feature breadth + memory depth**. Borrow the feature ideas, keep mya's architecture.

## Gotchas / anti-patterns to avoid
- **Monolithic single crate with ~130 modules** = hard to navigate/test in isolation; compile times suffer. mya's crate-per-concern is superior — don't collapse it.
- "Early beta" + 130 modules = likely uneven maturity; treat each idea as inspiration to validate, not proven design.

## Key reference files
- `README.md` (feature headings: 🧠 brain / 🕸️ orchestrator / 🔬 researcher / 🧍 human-private), `Cargo.toml`
- `src/openhuman/{memory_archivist,memory_tree,memory_diff,memory_goals,memory_sync}/`
- `src/openhuman/{tinyflows,rhai_workflows,flows}/`
- `src/openhuman/{model_council,council_registry,subconscious,subconscious_triggers}/`
- `src/openhuman/{codegraph,runtime_python,runtime_python_server,javascript,plan_review}/`
- `src/bin/{slack_backfill,gmail_backfill_3d,harness_subagent_audit}.rs`

## Scope note (skipped)
Did not read individual module source (agent loop, tinyflows compiler, memory_archivist internals, Rhai bindings). A follow-up pass on **memory_archivist + memory_tree** and **rhai_workflows** would yield concrete implementation patterns if mya adopts ideas #1/#2.
