# Deep-dive Index — Port Designs for mya

> 7 deep-dive port designs, each: source (cited paths/lines) → mya today → proposed Rust design (real signatures + file paths) → integration → PR-sized migration → effort/risk → open questions. Total **~102 KB** across 7 files. Load is high (load 17 from a concurrent pi-crew test) — load not a blocker (explorers return inline, parent persists).

## At a glance

| # | Deep-dive | Source | Effort | PRs | Risk | Key win |
|---|---|---|---|---|---|---|
| 01 | [ProviderProfile](01-provider-profile.md) | hermes | 🟡 | 8 | 🟢 low | declarative provider metadata; dedupes catalog.rs SSOT violation; setup-wizard UX |
| 02 | [3-tier prompt + skill curator](02-prompt-three-tier-curator.md) | hermes | 🟡 | 12 | 🟡 cache-stable critical | Anthropic prefix-cache across turns; self-improving skills w/ provenance |
| 03 | [Typed FSM + LaneBoard + structured errors](03-typed-fsm-laneboard.md) | claw-code | 🟡 | 11 | 🟢/🟡 | typed lifecycle observability; no log-scraping; partial-success tri-state |
| 04 | [Context compression](04-context-compression.md) | headroom+claw-code | 🔴 | 11 | 🔴 answer-drift | 60-95% token cut; mya-eval gates drift |
| 05 | [Memory roles + MemoryManager](05-memory-roles-manager.md) | openhuman+hermes | 🔴 | ~13 (5 phases) | 🟢 SSOT, 🔴 scope | memory as flagship subsystem; bounded shutdown drain |
| 06 | [ragfs unified context FS](06-ragfs-unified-context.md) | OpenViking | 🔴 | ~10 | 🟡 AGPL clean-room | one URI namespace over memory+skill+knowledge; uniform browse/grep |
| 07 | [Pit-of-success clippy](07-pit-of-success-clippy.md) | MyAgents | 🟢 | 6 (A-F) | 🟢/🟠 apps scope | forbidden patterns → compile-time; AGENTS.md prose→lint |

**Totals**: ~71 PRs across 7 port-designs. None has end-user breaking changes (all additive / opt-in / feature-flagged).

## Suggested execution order (leverage × mya-fit × low-risk-first)

### 🟢 Quick wins first (size:S, days each, zero behavior risk)
1. **#07 pit-of-success clippy** — helpers land (PR A), migrate call sites (B1-B7), flip lint (C). Highest ROI per LOC; converts AGENTS.md prose to compile-time.
2. **#01 ProviderProfile** PR#1-2 — types + macro arm (foundation). Then PR#3 catalog dedupe (deletes the SSOT violation AGENTS.md flags).
3. **#03 FSM/LaneBoard** Step 1-3 — `mya-infra::lifecycle` foundation + heartbeat rename + laneboard-core. Additive, no callers yet.

### 🟡 Core capability (weeks, the big UX/perf wins)
4. **#02 3-tier prompt** PR1-8 — the **single highest-leverage cache win**. mya rebuilds system prompt per-turn today → loses Anthropic prefix cache EVERY turn. Types → scanner → session cache → wire loop. Then PR9-12 skill curator.
5. **#01 ProviderProfile** PR4-8 — aliases collapse + hooks + wizard/doctor UX.
6. **#03 FSM/LaneBoard** Step 4-11 — plugin_lifecycle, cron typed status, health typed, channels FSM, RuntimeAdapter::lane_board, gateway route, observer migration, dashboard.

### 🔴 Strategic / large (months, flagship features)
7. **#04 context compression** — gated by mya-eval `CompressionDriftGrader` (the answer-drift guard). Depend on headroom-core (Apache-2.0) for compressors; reimplement Trident algorithm. Stage serde_json features.
8. **#05 memory roles** — Phase 0-1 (MemoryManager + bounded shutdown) is the quick value; Phases 2-4 (Archivist/Tree/Diff/Goals/Graph/Sync) incremental behind flags.
9. **#06 ragfs unified context** — clean-room (AGPL). Largest; ship skeleton + MarkdownMemoryContextSource first, expand.

## Cross-cutting dependencies between the 7
- **#04 compression ↔ #02 3-tier prompt**: compression is the documented rebuild trigger for the joined prompt. Land #02 PR8 (`session.invalidate()` at compression boundary) BEFORE #04's pipeline integration. They compose: compression mutates volatile tier only.
- **#02 curator ↔ #05 MemoryManager**: both want an "auxiliary provider instance" pattern (curator's LLM pass; memory roles' reflection sub-call). Extract a shared `auxiliary_provider` helper in mya-providers to avoid 2 impls.
- **#03 FSM ↔ #05 MemoryManager**: `MemoryManager::shutdown` bounded drain should emit `ObserverEvent::Lifecycle` (from #03 Step 9) not ad-hoc `record!`.
- **#07 clippy ↔ all**: the `mya-infra::time::now_wallclock/now_monotonic` helper (from #07) is exactly what #03's `LaneBoard::generated_at` and #05's snapshot timestamps should use — land #07 PR A (time helper) early so later ports consume it.
- **#01 ProviderProfile ↔ #02 curator**: curator's `resolve_aux_provider` uses `ProviderRegistry::create(provider_id, model_id)` — add that in #01 PR#3 (registry) so #02 PR#10 (curator LLM pass) consumes it.

## Hard "do NOT" reminders (from the 7 deep-dives)
- **#04**: never ship compression without `CompressionDriftGrader` in CI — answer drift is THE risk. Headroom's whole value = GSM8K ±0.000.
- **#02**: never append `format!("{prefix}\n\n{system_prompt}")` per-turn — kills prefix cache. Per-turn prefix goes AFTER cached system block.
- **#06**: never vendor OpenViking code (AGPLv3). Clean-room from concept only; Apache-2.0 SPDX headers + clean-room notice on every file.
- **#01**: never copy hermes Python idioms 1:1 (`field(default_factory)`→derive Default; `OMIT_TEMPERATURE`→`Option`/bool; `urllib`→`reqwest`).
- **#03/#05**: never cache allowlists/status on handles — resolve via `Arc<RwLock<Config>>` / canonical store on demand (SSOT).
- **#02/#05**: curator/curator-LLM must NEVER touch the main session's prompt cache — auxiliary provider instance only.

## License posture (per source)
| Source | License | Action |
|---|---|---|
| hermes-agent | MIT | reimplement (cite design, don't copy) |
| claw-code | unverified | reimplement algorithm (Trident); verify before any pattern copy |
| headroom | Apache-2.0 | **cargo-dep `headroom-core` (pinned tag) or vendor** — inherits 20-fixture parity gate |
| MyAgents | (check) | reimplement pattern; the clippy.toml shape is generic |
| openhuman | (check) | reimplement role logic against mya Memory trait; never vendor modules |
| OpenViking | **AGPLv3** | clean-room concept only; never look at trait code for design |
| harness | Apache-2.0 | concept (6 topologies) — no code |

## How these were produced
Each deep-dive = 1 background explorer (read-only, no write tool) that read both the source subsystem AND mya's current equivalent (cited paths+lines), then returned the full port-design **inline** for the parent to persist. Pattern proven reliable under host load (explorers return inline even when they can't write; quality high — see the Rust signatures throughout). 3 batches (dd-a/dd-b/dd-c), load-staggered.

## Files
`01-provider-profile.md` · `02-prompt-three-tier-curator.md` · `03-typed-fsm-laneboard.md` · `04-context-compression.md` · `05-memory-roles-manager.md` · `06-ragfs-unified-context.md` · `07-pit-of-success-clippy.md`
