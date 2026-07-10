# Deep-dive: Typed FSM + LaneBoard + structured errors → port to mya

> Source: claw-code `runtime/src/{task_registry,team_cron_registry,plugin_lifecycle,mcp_lifecycle_hardened}.rs`. AGENTS.md SSOT: the FSM enum is the single state source — no parallel cached status fields.

## Source design (claw-code, `source/claw-code/rust/crates/runtime/src/`)

**1. `task_registry.rs` — typed `TaskStatus` FSM + `LaneHeartbeat` + `LaneBoard`.**
```rust
#[serde(rename_all = "snake_case")]
pub enum TaskStatus { Created, Running, Blocked, Completed, Failed, Stopped }   // L21-40 + Display
pub struct LaneHeartbeat { observed_at: u64, transport_alive: bool, status: String }  // L67
pub enum LaneFreshness { Healthy, Stalled, TransportDead, Unknown }                  // L61
pub struct LaneBoard { generated_at: u64, active: Vec<_>, blocked: Vec<_>, finished: Vec<_> }  // L85
```
Key insight: `LaneBoard` is a **projection, not state**. `TaskRegistry::lane_board_at(now, stalled_after)` (L235-267) walks once, derives `freshness_at` per row, bins by the same `TaskStatus`. No parallel cached "is_active". `freshness_at`: `!transport_alive → TransportDead; now-observed>stalled → Stalled; else Healthy`. JSON = one-shot `serde_json::to_value`.

**2. `team_cron_registry.rs` — `TeamStatus {Created,Running,Completed,Deleted}` (L32); `Arc<Mutex<HashMap>>` with `now_secs()` clock; `updated_at` from single source. Cron deliberately has NO typed status (enabled:bool + run history).

**3. `plugin_lifecycle.rs` — tri-state `PluginState` (L32-48):**
```rust
#[serde(rename_all="snake_case", tag="state")]
pub enum PluginState { Unconfigured, Validated, Starting, Healthy,
    Degraded { healthy_servers: Vec<String>, failed_servers: Vec<ServerHealth> },
    Failed { reason: String }, ShuttingDown, Stopped }
```
Three patterns: (i) `#[serde(tag="state")]` adjacent-tag so FSM variant IS the wire discriminator; (ii) `from_servers(&[ServerHealth]) -> PluginState` pure aggregator (Healthy|Degraded{healthy,failed}|Failed); (iii) `startup_event()`/`is_startup_terminal()` narrow to 3 startup-terminal events (`Healthy|Degraded|Failed` emit; others → None).

**4. `mcp_lifecycle_hardened.rs` — 11-phase FSM + structured error (L17-38, 62-80):**
```rust
pub enum McpLifecyclePhase { ConfigLoad, ServerRegistration, SpawnConnect, InitializeHandshake,
    ToolDiscovery, ResourceDiscovery, Ready, Invocation, ErrorSurfacing, Shutdown, Cleanup }
pub struct McpErrorSurface { phase, server_name: Option<String>, message: String,
    context: BTreeMap<String,String>, recoverable: bool, timestamp: u64 }  // impl Error (L92)
```
`McpPhaseResult::{Success{phase,duration}, Failure{phase,error}, Timeout{phase,waited,error}}` typed per-phase return. **`validate_phase_transition(from,to)`** (L234-258) encodes allowed edges: `ToolDiscovery→Ready` may skip ResourceDiscovery; `ErrorSurfacing→Ready` only when last error `recoverable:true`; forbids `Cleanup→Ready`. This makes the FSM **enforced, not advisory**.

## mya today (`/home/bom/source/my-agent/`)
**Already has typed FSMs:** control_plane `TaskStatus` (`mya-runtime/src/control_plane/task_registry.rs:30-49`, + `is_terminal()` L48), `TaskKind`, heartbeat `TaskStatus` (engine.rs:34, **name collision!**), `TaskPriority`, cron `JobType`/`SessionTarget`/`Schedule`(`#[serde(tag="kind")]`), legacy `BackgroundTaskStatus` (delegate.rs:55), SOP `SopRunStatus`/`SopStepStatus`/`ProposalStatus`, security `StepStatus`, `IntegrationStatus`, `TurnCompletionOutcome`, `SessionUpdateEvent`(`#[serde(tag="type")]`).

**Stringly-typed / missing:**
- (a) `health::ComponentHealth.status: String` (`mya-runtime/src/health/mod.rs:8-23`); `mark_component_ok/error` write `"ok"`/`"error"` literals. Central liveness surface for gateway + channels (mqtt at `orchestrator/mod.rs:69`).
- (b) `CronJob::last_status: Option<String>` (cron/types.rs:190) + `CronRun::status: String`; literals `"ok"|"error"|"skipped"|"pending"`. **No enum.**
- (c) **No `McpLifecyclePhase`/`McpErrorSurface`** anywhere. MCP errors are `anyhow::Error` via `ObserverEvent::Error{component,message}`.
- (d) **No plugin lifecycle FSM** — `mya-plugins/src/component.rs::PluginState` is a wasmtime `Store` data wrapper, NOT a lifecycle FSM. No `from_servers` aggregator.
- (e) **No channel FSM** — channels push health via `mark_component_ok/error`.
- (f) `ObserverEvent::Error` (`mya-api/src/observability_traits.rs:233`) has no `phase`/`recoverable`/`context`/`server_name` (but enum is `#[non_exhaustive]` — extensible).
- (g) **No `LaneBoard` aggregator**; `health::snapshot()` is flat `BTreeMap<component,ComponentHealth>` stringly-typed, no active/blocked/finished bins.
- (h) **No shared FSM convention** — each enum picks own serde repr + Display + terminal method.
- (i) **`RuntimeAdapter`** (`mya-api/src/runtime_traits.rs`) has no `lane_board()`.

## Proposed design for mya

**1. Shared FSM convention — `mya-infra/src/lifecycle.rs`:**
```rust
pub trait LifecycleState: Copy + Eq + Send + Sync + 'static {
    fn as_str(&self) -> &'static str;
    fn is_terminal(&self) -> bool;
    fn startup_event(&self) -> Option<LifecycleEvent> { None }
}
pub enum LifecycleEvent { Started, Ready, Degraded, Failed, Stopped }   // #[serde rename snake_case]
pub enum LaneFreshness { Healthy, Stalled, TransportDead, Unknown }
pub struct Heartbeat { observed_at: u64, transport_alive: bool }
impl Heartbeat { pub fn freshness_at(&self, now:u64, stalled_after:u64) -> LaneFreshness { /* claw-code math */ } }
```

**2. Per-subsystem FSM enums — adopt in place (don't move):**
| Subsystem | Path | Change |
|---|---|---|
| Durable task | `control_plane/task_registry.rs` `TaskStatus` | `impl LifecycleState` (as_str/is_terminal already L48; +startup_event) |
| Cron | `cron/types.rs:190,204` | **replace** `last_status:CronRunStatus` + `CronRun::status:CronRunStatus {Ok,Error,Skipped,Pending}` |
| Heartbeat | `heartbeat/engine.rs:34` | **rename** `TaskStatus`→`HeartbeatItemStatus` (resolve collision) + impl |
| MCP | **new** `mya-infra/src/lifecycle/mcp.rs` | port `McpLifecyclePhase` + `McpErrorSurface` + `validate_phase_transition` (in mya-infra so runtime+channels+plugins all use it) |
| Plugin | **new** `mya-runtime/src/plugin_lifecycle.rs` | port `PluginState`(8-var,tag="state")+`ServerHealth`+`from_servers`+`DegradedMode`+`DiscoveryResult` |
| Channel | **new** `mya-channels/src/lifecycle.rs` | `ChannelPhase{Configured,Connecting,Authenticated,Listening,Reconnecting,ShuttingDown,Stopped}`; phase computed from (last_send,last_recv,reconnect_count) — **no parallel cached fields** (SSOT) |
| Health | `health/mod.rs:8` | `status:String` → `status:ComponentLifecycle{Starting,Ok,Degraded,Error,Stopped}` |

Wire format: `#[serde(rename_all="snake_case")]` simple; `#[serde(rename_all="snake_case",tag="state")]` data-variant enums.

**3. `LaneBoard` aggregator — `mya-runtime/src/laneboard.rs`:**
```rust
pub struct LaneBoardEntry<L: LifecycleState> { id:String, status:L, heartbeat:Option<Heartbeat>, freshness:LaneFreshness, context:BTreeMap<String,String> }
pub struct LaneBoard<L: LifecycleState> { generated_at:u64, active:Vec<_>, blocked:Vec<_>, finished:Vec<_> }
pub trait LaneBin<L: LifecycleState> { fn bin(status:L) -> Bin; }   // Active|Blocked|Finished
pub trait LaneSnapshot<L: LifecycleState> { fn lane_board_at(&self, now:u64, stalled:u64) -> LaneBoard<L>; }
```
One pure read path per registry (mirror claw-code L235-267): walk canonical store, derive freshness per row, bin by `LaneBin::bin`. **No caching.**

**4. Structured error — `mya-infra/src/error.rs`:**
```rust
pub struct LifecycleError<L: LifecycleState> { state:L, subsystem:String, target:Option<String>, message:String, context:BTreeMap<String,String>, recoverable:bool, timestamp:u64 }
impl<L: LifecycleState> std::error::Error for LifecycleError<L> {}
pub type McpLifecycleError = LifecycleError<McpLifecyclePhase>;  // + Plugin/Channel/Cron/Task aliases
```

**5. `RuntimeAdapter::lane_board()`:** add `fn lane_board(&self) -> serde_json::Value` (default `json!({})` — zero break). `Native` adapter joins per-subsystem `LaneBoard`s into one envelope `{generated_at, tasks, plugins, channels, mcp, cron}` each with active/blocked/finished. Queries live `Arc<RwLock<…>>` each call — no parallel copy.

**6. Typed `ObserverEvent::Lifecycle`** (additive, `#[non_exhaustive]`):
```rust
pub enum LifecycleEventKind { Started{..}, Ready{..}, Degraded{..,reason}, Failed{..,reason}, Stopped{..} }
ObserverEvent::Lifecycle { subsystem:String, target:Option<String>, event:LifecycleEventKind, state:String, context:BTreeMap<String,String>, timestamp:u64 }
```
Emitted at every FSM transition (validator, from_servers, channel heartbeat, task update, cron completion). **Replaces** `ObserverEvent::Error` for FSM transitions; Error reserved for non-FSM faults (config/IO/panic).

**7. Gateway/TUI:** new RPC `Method::LaneBoard` + `LaneBoardParams/Result` + `LaneBoardWire`/`LaneEntryWire`; HTTP `GET /api/lane-board`. Dashboard renders typed active/blocked/finished panels with freshness color-coding — **no log scraping**.

## Integration points
`mya-api` (RuntimeAdapter.lane_board default impl; ObserverEvent::Lifecycle; lifecycle submodule) · `mya-infra` (lifecycle + lifecycle/mcp + error modules) · `mya-runtime` (laneboard.rs; control_plane impl; heartbeat rename; cron typed status; health typed; plugin_lifecycle.rs; rpc Method::LaneBoard; daemon emits Lifecycle) · `mya-channels` (lifecycle.rs; orchestrator stops mark_component_ok/error → ChannelPhase) · `mya-plugins` (don't rename wasmtime PluginState; runtime-level PluginState lives in mya-runtime::plugin_lifecycle) · `mya-gateway` (GET /api/lane-board) · `apps/tauri` (typed dashboard widgets).

**Breaking changes:** cron `last_status`/`CronRun::status` String→enum (keep SQL column TEXT, convert at read seam — back-compat); `health::ComponentHealth.status` String→enum (variant names match literals so JSON identical); heartbeat `TaskStatus`→`HeartbeatItemStatus` rename (keep `pub use` alias one minor, Beta-tier OK); `RuntimeAdapter::lane_board()` new w/ default empty (no break).

## Migration / implementation steps (11 PRs, lowest-risk first)
1. **infra/lifecycle-foundation** XS 🟢 — `mya-infra::{lifecycle,error,lifecycle/mcp}` pure-data port. No callers.
2. **heartbeat/rename-status** XS 🟢 — resolve `TaskStatus` name collision + alias.
3. **runtime/laneboard-core** S 🟢 — `LaneBoard<L>` + `impl LaneSnapshot<TaskStatus>` on SQLite registry + `impl LifecycleState`.
4. **runtime/plugin-lifecycle** M 🟡 — port 8-variant PluginState + from_servers; hook plugin startup → emit Lifecycle.
5. **cron/typed-run-status** M 🟡 — `CronRunStatus`; keep SQL column TEXT, convert at read seam; same-PR migration.
6. **health/typed-component-status** S 🟡 — ComponentLifecycle enum; verify gateway JSON still parses.
7. **channels/lifecycle-fsm** M 🟡 — ChannelPhase + per-channel wiring; replace mark_component_ok/error.
8. **runtime/laneboard-wire** S 🟢 — RuntimeAdapter::lane_board + RPC Method::LaneBoard + gateway route (default empty → no break).
9. **observability/lifecycle-event** M 🟡 — add ObserverEvent::Lifecycle; migrate emit sites.
10. **apps/dashboard-lane-board** M 🟢 — UI typed consumers.
11. **runtime/lifecycle-trait-sweep** XS 🟢 — impl LifecycleState on SOP/security/delegate statuses; `#[deprecated]` on legacy BackgroundTaskStatus.

## Effort & risk — ~11 PRs sequential; 1-3 foundational (any order), 4-7 parallelizable after 3, 8-11 depend on 4-7
**SSOT adherence:** FSM enum = single state source per subsystem; `LaneBoard`/`LaneFreshness` derived at read time (no caching), materialized on-demand from canonical store; no parallel cached status fields; cron column stays TEXT in step 5 (typed at read seam), column-type change is a separate follow-up.
**Stability tiers:** mya-infra Beta (MINOR breaks + changelog OK); mya-api/mya-runtime/mya-gateway Experimental (breaks OK).

## Open questions
1. `LaneBoard<L>` generic on wire → hand-roll `LaneBoardWire`; one filtered RPC vs per-subsystem methods → **filtered for v1**.
2. Cron `last_status` column shape → keep TEXT in this port, INTEGER variant-index in separate PR.
3. `health::ComponentLifecycle` overlap with subsystem FSMs → keep one minor (serves gateway Health for mcp/model_provider), deprecate once all migrated.
4. `McpLifecycleValidator` location → `mya-infra::lifecycle::mcp` (reusable from runtime + channels + WASM plugin host, no platform deps).
5. `ChannelPhase` granularity → orchestrator wraps each channel (don't fork per-channel impl) — matches claw-code PluginLifecycle separation.
6. ObserverEvent::Lifecycle vs Error coexistence → additive one minor, deprecation warning at v0.8.
7. `lane_board()` on RuntimeAdapter vs separate trait → on RuntimeAdapter w/ default empty (zero break), revisit at v1.0.
8. Subsystem naming → `mya_api::subsystem` const module (`TASK/PLUGIN/MCP/CHANNEL/CRON`) shared by ObserverEvent + LaneBoardWire.
