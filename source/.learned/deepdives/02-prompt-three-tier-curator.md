# Deep-dive: Three-tier cache-stable prompt + skill curator → port to mya

> Source: hermes-agent `agent/{system_prompt,prompt_builder,curator,auxiliary_client}.py` + `tools/{skill_provenance,skill_manager_tool}.py` (MIT — reimplement, don't copy). mya integration design.

## Source design (hermes-agent)
### 1. Three-tier prompt assembly (`agent/system_prompt.py` + `prompt_builder.py`)
Three ordered tiers joined once with `"\n\n"`, cached on `agent._cached_system_prompt` for the whole session. Only rebuild = `invalidate_system_prompt()` (called from compression boundary). `build_system_prompt_parts → {"stable","context","volatile"}`; single concatenation at `system_prompt.py:425-431`.
- **stable**: SOUL/IDENTITY, tool-use/parallel-tool-call/MEMORY/SKILLS/SESSION guidance, model-family operational guidance, skills index, env/platform hints, coding-context. Changes only on profile/model/skill-write.
- **context**: caller `system_message` + project-context files (AGENTS.md/.cursorrules/SOUL.md). Ephemeral excluded (injected at API-call time only).
- **volatile**: MEMORY.md snapshot, USER.md, external-memory block, **day-precision** date line (+ session/model/provider). Day-precision on purpose — minute precision invalidates prefix-cache at every boundary (PR #20451).

### 2. Cache-stable invariant
Whole system prompt = **one cached block**; "never rebuilds or reinjects parts mid-session" (`system_prompt.py:402-410`). `OMIT_TEMPERATURE` sentinel (Kimi/Moonshot manage server-side). Anthropic transport already pins `cache_control: ephemeral` on system block — hermes relies on byte-stability.

### 3. Context-file injection scanner (`prompt_builder.py:43-65`)
`_scan_context_content(content, filename)` calls `threat_patterns.scan_for_threats(content, scope="context")`; on match returns `[BLOCKED: {filename} contained potential prompt injection ({findings}). Content not loaded.]` — actual content never reaches prompt. Uses `"context"` scope (strict scopes like SSH-backdoor skipped for cloned-repo files). **Scanner on the way INTO the prompt**, not runtime.

### 4. Skill curator — lifecycle + provenance + auxiliary-fork (`agent/curator.py` + `tools/skill_*`)
`maybe_run_curator(idle_for_seconds, on_summary)`: best-effort, gates = `curator.enabled` + `paused` + `interval_hours` (default 7d, first run deferred) + `min_idle_hours` (default 2h).
**Two-stage**: (1) **deterministic `apply_automatic_transitions`** — pure prune: skips pinned + cron-referenced + never-used-grace-floor (use_count==0 not archived before `stale_after_days`); transitions `active→stale` @30d, `active|stale→archived` @90d, reactivates on activity. (2) **LLM umbrella pass** (`run_curator_review`) only if `curator.consolidate=true` (default OFF) — forks separate `AIAgent` on `auxiliary.curator.{provider,model}`.
**Provenance gating**: `tools/skill_provenance.py` — `_write_origin: ContextVar` (default "foreground"); `set_current_write_origin("background_review")` by the review fork. Curator walks only `agent_created=true` skills.
**Auxiliary-client fork**: `_resolve_review_runtime` precedence `auxiliary.curator` → legacy → main model; redirects stdout→/dev/null; `aux_interrupt_protection` marks curator LLM call NOT user-interruptible.
**Pinned bypass + never-delete**: `_pinned_guard` (refuses delete on pinned), `_background_review_write_guard` (refuses autonomous writes to external/hub/bundled/protected-builtin + pinned), `_curator_consolidation_delete_guard` (fail-closed: LLM may delete only if declared `absorbed_into=<umbrella>`; bare prune refused #29912). During curator, `_delete_skill` routes through `archive_skill()` (recoverable) not `rmtree`.
**Structured-output reconciliation**: fenced YAML `## Structured summary (required)` + `consolidations/prunings`; `_extract_absorbed_into_declarations(tool_calls)` is authoritative (3-way merge: model-declared → YAML → heuristic).
**State**: `.curator_state` JSON (last_run_at/duration/summary/paused/run_count); reports under `~/.hermes/logs/curator/`.

## mya today
### System-prompt assembly — **two parallel builders, both monolithic, neither tier-separated, neither cached**
- `crates/mya-runtime/src/agent/system_prompt.rs:142-330` — `build_system_prompt_with_mode_and_autonomy()` (canonical, called from loop_.rs:653,3075 + orchestrator); flat String, 9 numbered sections, no tier struct, no cache, no volatile/context distinction.
- `crates/mya-runtime/src/agent/prompt.rs` — `SystemPromptBuilder` + `PromptSection` trait (section-based, not tier-based).
**Rebuild cadence = PER-TURN, not cached**: `build_system_prompt_for_turn()` at loop_.rs:1644,1739,1855,2410,3074 (inside REPL + every turn). `base_system_prompt.clone()` at loop_.rs:1695 is closest to cache-stable (session snapshot of initial prompt) but rebuilt per-turn for active iteration, survives compression boundary (wrong).
**Missing for cache-stability**: no `(stable,context,volatile)` struct; no `JoinedPrompt`/`CachedSystemPrompt` wrapper; ephemeral content concatenated per-turn at loop_.rs:680,3136 via `format!("{prefix}\n\n{system_prompt}")` — **defeats Anthropic prefix-cache** (prefix hash changes per turn); `DateTimeSection` day-precision good but mixed inline.

### Prompt-cache transport — **already in place at provider layer**
- `crates/mya-providers/src/anthropic.rs:127,137,144,163,193,314,326,346,368,374,608-614` — pins `cache_control: ephemeral()` on system blocks + last tool def + last tool-result.
- `openrouter.rs:70,357-361` — `cache_control:{"type":"ephemeral"}` on system msg.
- `compatible.rs:891-904,5799-5875,6897-6957` — parses `prompt_cache_hit_tokens`/`cached_tokens` → `cached_input_tokens` surfaced to runtime (loop_.rs:13199,13477,13699).
**Transport ready; assembly layer not.** 3-tier is what lets cache-control marker land on stable prefix.

### Skill provenance + lifecycle — **partial**
- `SkillOrigin` enum (`skills/service.rs:30-43`): `Workspace|OpenSkills|Plugin(String)|Bundle(String)` (derived from tags+location). `EffectiveSkill`, `EffectiveSkillSet`, `RemoveMode::{Archive,Purge}` (Archive already wired — move to `<install>/shared/skills/_deleted/`). `SkillDropReason`. `ForgeMetadata` (SkillForge `[forge]` table — integrator's provenance, canonical). `SkillForge` scout→evaluate→integrate (external discovery, NOT lifecycle).
- **Missing**: no `SkillProvenance` Bundled|HubInstalled|UserCreated|AgentCreated (SkillOrigin answers "where on disk?" not "human or agent wrote it?"); no `is_agent_created`/sidecar; no lifecycle states (active/stale/archived); no `pinned`/`is_protected_builtin`; no `SkillCurator` task; no write-origin `ContextVar` (mya-spawn doesn't propagate write-origin); no `_background_review_read_before_write` guard.

### Injection scanning — **exists, not wired into prompt assembly**
`crates/mya-runtime/src/security/prompt_guard.rs` — `PromptGuard` `scan → GuardResult{Safe,Suspicious(Vec,f64),Blocked(String)}`, 6 categories (system-override, role-confusion, tool-injection, secret-extraction, command-injection, jailbreak), `GuardAction{Warn,Block,Sanitize}`, `with_config(action,sensitivity)`. Consumed by `ingress.rs` + `external_content.rs` — **NOT by `build_system_prompt*` for context files** (silent passthrough).

## Proposed design for mya
### 1. Three-tier `SystemPrompt` struct
**New file `crates/mya-runtime/src/agent/system_prompt_v2.rs`** (sibling, not replacement — `system_prompt.rs` stays until deprecation):
```rust
#[derive(Debug, Clone)]
pub struct SystemPrompt { pub stable: String, pub context: String, pub volatile: String }
impl SystemPrompt {
    pub fn join(&self) -> String { /* "\n\n".join non-empty trimmed tiers; byte-stable */ }
}
pub struct JoinedSystemPrompt(pub Arc<str>);  // session-lifetime byte-stable handle
```
Each tier = heap `String` (may mutate one tier at compression without invalidating others). Separator `"\n\n"` intentional.

### 2. Context-file injection scanner
**New file `crates/mya-runtime/src/security/context_scanner.rs`** (pure helper, composes existing `PromptGuard`):
```rust
pub enum ContextScanVerdict { Clean, Blocked { findings: Vec<String>, path: String } }
pub enum ContextScannerMode { #[default] Strict, Wide }   // Wide = future threat_patterns taxonomy
pub struct ContextFileScanner { guard: PromptGuard, mode: ContextScannerMode }
impl ContextFileScanner {
    pub fn new(mode) -> Self { Self { guard: PromptGuard::with_config(GuardAction::Block, 0.5), mode } }
    pub fn scan(&self, content:&str, path:&Path) -> ContextScanVerdict { /* Blocked|Suspicious → placeholder */ }
    pub fn placeholder(path:&str, findings:&[String]) -> String { format!("[BLOCKED: {path} contained potential prompt injection ({}). Content not loaded.]", findings.join(", ")) }
}
```
Default `Strict` (zero new patterns/deps — reuses PromptGuard). `Wide` = follow-up (hermes threat_patterns). `build_context_tier` runs each context file through scanner; `Clean`→inject, `Blocked`→placeholder.

### 3. Cache-stable invariant — `Session::joined_prompt`
**New `crates/mya-runtime/src/agent/session.rs`**:
```rust
pub struct Session {
    joined_prompt: parking_lot::RwLock<Option<JoinedSystemPrompt>>,
    joined_epoch_day: AtomicI32,   // day-rollover = one invalidation/24h
}
impl Session {
    pub fn joined_prompt(&self, ctx, scanner) -> Result<Arc<str>> {
        // fast path: cache hit + same day → return Arc clone
        // slow path: build_system_prompt_v2 → Arc<str> → store
    }
    pub fn invalidate(&self) { /* compressor calls after successful compression */ }
}
```
**SSOT-safe**: `joined_prompt` is a materialized view (AGENTS.md allows on-demand cached views); each tier resolved at use-time from canonical source (config, identity files, memory backend, system clock); epoch-day = single-source "today". Anthropic transport already wraps system block in `cache_control: ephemeral` — joined `Arc<str>` gives stable byte sequence for prefix cache. Document invariant: "joined prompt MUST be byte-stable; per-turn prefix goes AFTER cached system block, not before."

### 4. Skill provenance enum + lifecycle (sidecar, NOT field on Skill — SSOT)
**New `crates/mya-runtime/src/skills/provenance.rs`**:
```rust
pub enum SkillProvenance { Bundled, HubInstalled, UserCreated, AgentCreated }
impl SkillProvenance { pub fn curator_can_archive(self) -> bool { matches!(self, AgentCreated) } }
pub enum SkillLifecycle { Active, Stale, Archived }
#[derive(Serialize,Deserialize)] pub struct SkillProvenanceRecord { provenance, lifecycle, pinned:bool, last_used_at:Option<String>, created_at:String }
pub const PROVENANCE_SIDECAR: &str = ".provenance.json";   // <skill_dir>/.provenance.json, atomic write
pub fn read_provenance(skill_dir) -> SkillProvenanceRecord { /* resolver, default UserCreated/Active */ }
pub fn write_provenance(skill_dir, rec) -> io::Result<()>
```
Wired into `EffectiveSkill` (provenance/lifecycle/pinned populated from sidecar at load). SkillManager `provenance_gate(action, skill_dir)`: refuse Bundled/HubInstalled mutations; refuse delete on pinned; route AgentCreated delete through `RemoveMode::Archive`.

### 5. Skill curator — deterministic prune + optional LLM pass on auxiliary provider
**New `crates/mya-runtime/src/skills/curator.rs`**:
```rust
pub struct CuratorConfig { enabled:true, interval_hours:168, min_idle_seconds:7200, stale_after_days:30, archive_after_days:90, consolidate:false, auxiliary_provider:Option, auxiliary_model:Option }
pub struct CuratorState { last_run_at, last_run_summary, paused, run_count }   // <data_dir>/state/curator.json
pub struct Curator { config, state, aux_provider:Option<Arc<dyn ModelProvider>>, summary_tx }
impl Curator {
    pub async fn maybe_run(&self, idle_for:Duration, skills_root:&Path) -> Result<Option<String>>  // gates + 2 stages
    fn apply_automatic_transitions(&self, skills_root) -> Result<AutoTransitionReport>  // pure prune: pinned/cron/never-used bypass, archive-not-delete
    async fn run_llm_pass(&self, aux, skills_root) -> Result<Option<String>>  // only if consolidate=true
}
```
Invariants (all from hermes): only `AgentCreated` walked; pinned/cron-referenced always skipped; never-used grace floor `stale_after_days`; archive via `RemoveMode::Archive` (never Purge); LLM pass on **auxiliary provider instance** (different from main → no cache collision; not inserted into foreground `history[]`). `resolve_aux_provider` precedence: `auxiliary.curator` → main.

### 6. Write-origin task-local (mya equivalent of hermes ContextVar)
**New `crates/mya-runtime/src/skills/write_origin.rs`**:
```rust
task_local! { pub static WRITE_ORIGIN: WriteOrigin; }
pub enum WriteOrigin { Foreground, BackgroundCurator }
pub async fn scope<R>(origin, fut) -> R;  pub fn current() -> WriteOrigin;
```
Curator's `mya-spawn` future started with `WRITE_ORIGIN::scope(BackgroundCurator, …)`; `SkillManager::create_skill` reads `current()` to set provenance sidecar.

## Integration points
| Crate/File | Change |
|---|---|
| `mya-api` (new `agent.rs` + `skill.rs`) | `SystemPrompt`, `JoinedSystemPrompt`, `SkillProvenance`, `SkillLifecycle`, `SkillProvenanceRecord` (pure data) |
| `mya-runtime/src/agent/system_prompt_v2.rs` | new — `build_system_prompt_v2(ctx, scanner)` 3-tier builder |
| `mya-runtime/src/agent/session.rs` | new — `joined_prompt()` Arc<str> cache (epoch-day fast path) |
| `mya-runtime/src/agent/loop_.rs` | replace per-iteration `build_system_prompt_for_turn` (1644/1739/1855/2410/3074) with `session.joined_prompt()`; add `session.invalidate()` at compression boundary |
| `mya-runtime/src/security/context_scanner.rs` | new — `ContextFileScanner` |
| `mya-runtime/src/skills/{provenance,write_origin,curator}.rs` | new |
| `mya-runtime/src/skills/service.rs` | extend `EffectiveSkill` with provenance/lifecycle/pinned from sidecar |
| `mya-runtime/src/skills/skill_tool.rs` | `provenance_gate` |
| `mya-runtime/src/agent/agent.rs` | `from_config` seeds joined_prompt once; `rebuild_system_prompt_for_dispatcher`(2095) → `session.invalidate()` |
| `mya-config` schema | `[security] context_scanner_mode`; `[skills.curator]` (enabled/interval/min_idle/stale/archive/consolidate/auxiliary_*) |
| `mya-providers` | **no change** (cache_control plumbing already present) |
| xtask (optional) | `migrate skill-provenance` backfill sidecar |
| Fluent | new keys (`skills-curator-archived-summary`, banner around `[BLOCKED:…]`) |

**Breaking changes: NONE.** `build_system_prompt_with_mode_and_autonomy` stays; `system_prompt_v2` parallel path; Memory/SkillOrigin traits unchanged.

## Migration / implementation steps (12 PRs, ~2,260 LOC, serial)
1. **PR1 S** — types only (SystemPrompt/JoinedSystemPrompt/SkillProvenance/SkillLifecycle/SkillProvenanceRecord). ~150 LOC.
2. **PR2 S** — `context_scanner.rs` (compose PromptGuard, default Strict). ~120 LOC.
3. **PR3 M** — provenance sidecar + `service.rs` extension + `xtask migrate` backfill. ~200 LOC.
4. **PR4 XS** — `write_origin.rs` task_local. ~60 LOC.
5. **PR5 M** — SkillManager `provenance_gate` (refuse Bundled/HubInstalled/pinned-delete; AgentCreated→Archive). ~180 LOC.
6. **PR6 M** — `system_prompt_v2.rs` builder (reuse 9 section renderers). ~250 LOC.
7. **PR7 M** — `Session::joined_prompt` cache + wire loop_.rs call sites. ~200 LOC.
8. **PR8 XS** — compressor `session.invalidate()` at compression boundary. ~50 LOC.
9. **PR9 M** — deterministic curator (`apply_automatic_transitions` only, no LLM). ~400 LOC.
10. **PR10 M** — curator LLM pass + `resolve_aux_provider` (behind `consolidate=true`). ~500 LOC.
11. **PR11 S** — config schema + xtask. ~150 LOC.
12. **PR12 S** — docs (`docs/book/src/agents/prompt-cache-stability.md`, `docs/book/src/skills/curator.md`) + CHANGELOG.

## Effort & risk
- 3-tier struct 🟢 (pure data; biggest risk = NOT doing it — mya rebuilds per-turn, loses Anthropic prefix cache every turn).
- Context scanner 🟢 (reuses PromptGuard; default Strict).
- **`Session::joined_prompt` cache 🟡 SSOT-critical** — must NOT be `&'static str`; use `Arc<str>` materialized at use-time; content-hash test to catch silent invalidation.
- Provenance sidecar 🟡 (new on-disk file; `xtask migrate` backfill mandatory — day-1 curator has zero AgentCreated to prune).
- SkillManager gating 🟡 (hot path; tests: foreground vs Bundled→refusal, background-curator vs Bundled→refusal stricter, pinned-delete→refusal, AgentCreated-delete→Archive `_deleted/`).
- Deterministic curator 🟡 (pure fn of (state,config,now); risk = archiving wrong skill; pinned+cron bypass mandatory).
- **Auxiliary fork 🟡** — single most important property: curator NEVER touches main session prompt cache. Test: foreground+curator parallel, assert foreground joined_prompt byte-identical before/after curator pass.
- License 🟢 (hermes MIT — reimplement, no copy-paste).
- AGENTS.md 🟢 (no unsafe, no unwrap/expect in prod, fl!() for UI, SSOT via sidecar+resolver).
**THE defining constraint:** joined system prompt MUST be byte-stable across session, mutated only at documented rebuild boundaries (provider/profile swap, compressor). Everything flows from this.

## Open questions
1. Sidecar location: colocated `<skill_dir>/.provenance.json` (hermes-style, moves w/ skill) vs centralized index? → **colocate** + lazy in-memory index (mirror skills/cache.rs).
2. `SkillOrigin::Bundle(alias)` vs `SkillProvenance::Bundled` — different layers (user path vs integrator). Derive `Bundled` from new `[forge] vendor="mya"` discriminator.
3. Auxiliary client per-model instances — confirm `ProviderRegistry::create(provider_id, model_id)` returns per-model (not singleton) so curator `gpt-5.5-mini` doesn't share cache state with foreground `claude-opus`.
4. Compressor rebuild trigger — session event (mirror `ObserverEvent::TurnComplete`) vs poll last-compression-time.
5. `Suspicious` threshold in Strict — default `Blocked` (matches hermes) + config knob `security.context_scanner_block`.
6. `SkillOrigin::Plugin` provenance default → `HubInstalled` until plugin declares `[forge] vendor`.
7. Cron-reference resolver — confirm `crates/mya-runtime/src/cron/` API for "skills referenced by any cron job"; if absent, cron-bypass degrades to TODO no-op.
8. Migration ordering — backfill: `open-skills`→HubInstalled, `workspace`→UserCreated.
9. Test fixture — reuse `tempfile::TempDir` + `make_agent_created_skill(svc, name)` helper.
10. Observability — `ObserverEvent::CuratorRunCompleted{archived,marked_stale,reactivated,consolidated}` for dashboard.
