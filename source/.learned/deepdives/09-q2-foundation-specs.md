# Q2 Foundation-PR Specs (explorer output, 2026-07-06)

Execution-ready designs for Q2 items #16, #12, #10, #13, #08. Each is a
foundation PR (additive types + tests as consumer, no behavior wiring).
Retrieved from background explorers; preserved here for durable continuation.

---

## #16 — Mock parity harness + test classification

**Files:** `crates/mya-eval/src/mock.rs` (NEW), `crates/mya-eval/src/tier.rs` (NEW), `lib.rs` (+mod), `Cargo.toml` (+`[features] network/llm`).

**Key types** (`mock.rs`): `MockProvider` replays a flat FIFO `Vec<ChatResponse>` (shared cursor between `chat()` and `chat_with_system()`), `ExhaustionPolicy { Error, RepeatLast }`, `MockProviderBuilder` (`.text()/.tool_calls()/.text_with_usage()/.response()` — the builder's Vec is the SSOT). `impl Attributable + ModelProvider` (`chat` returns full structured response incl. tool_calls+usage; `capabilities()` declares `native_tool_calling: true`). NOTE: real trait is `ModelProvider` in `crates/mya-api/src/model_provider.rs` (not provider.rs); `chat()` is the structured entry; `TraceLlmProvider` (replay.rs) is the turn-scoped eval sibling — MockProvider is the flat general-purpose one. Existing ~20 private mocks (`reliable.rs`, `dispatch.rs`, `router.rs`, gateway, orchestrator) converge onto it later.

**tier.rs:** `TestTier { Deterministic, Network, Llm }` (doc enum). Selection via Cargo `[features] network=[] / llm=[]` (default=[]), tests gated `#[cfg(feature="network")]` — features are compile-time, drift-free, idiomatic.

**Tests (10):** replay-single-text, FIFO-order, shared-cursor, tool-calls, usage-round-trip, exhaustion-Error-bails, exhaustion-RepeatLast, attributes-as-Custom, calls_made/remaining, capabilities-native-tool-calling.

---

## #12 — Unified event-hook registry

**Files:** `crates/mya-infra/src/hook_registry.rs` (NEW), `lib.rs` (+`pub mod hook_registry;`). Foundation ships ONLY the generic registry; domain `LifecycleEvent` enum + wiring are a LATER PR (so the foundation is mya-infra-only, matching lifecycle.rs precedent).

**Key types:** `HookPriority(pub i32)` (higher fires first; `NORMAL=0`), `HookId(u64)` (unregister token), `HookHandlerFn<Ctx> = Arc<dyn Fn(Arc<Ctx>) -> Pin<Box<dyn Future<Output=Result<(),String>> + Send>> + Send+Sync>`, `FireOutcome { errors: Vec<HookError> }`, `HookRegistry<E,Ctx>` (generic, event-keyed; `RwLock<Vec<Entry>>` + AtomicU64 ids/seqs). API: `register(event, priority, name, handler) -> HookId`, `unregister(id) -> bool`, `fire(event, Arc<Ctx>) -> FireOutcome`.

**Guarantees:** (1) priority desc then registration-order FIFO; (2) FULL error isolation — every handler wrapped in `AssertUnwindSafe(..).catch_unwind().await`, panic/Err recorded + chain CONTINUES (fixes gap where current void `HookRunner` hooks have no isolation); (3) no short-circuit (cancel stays with `HookHandler::run_*`). Already-dep check: mya-infra has parking_lot + futures-util.

**Tests (9):** single-fires, priority-order, equal-priority-FIFO, panic-no-abort, Err-no-abort, unregister, no-handler-noop, only-matching-event, collect-all-errors.

---

## #10 — Lean/headless binary (`mya-headless`)

**Files:** root `Cargo.toml` (+`[[bin]] name="mya-headless" path="src/bin/mya-headless.rs" required-features=["headless"]` + `[features] headless=["dep:mya-runtime","dep:mya-tools"]`), `src/bin/mya-headless.rs` (NEW ~150 LOC), `tests/test_headless.rs` (NEW).

**Scope:** links mya-runtime+mya-tools+mya-api+config+providers+memory+log+spawn+infra. OUT: mya-channels, mya-gateway, mya-hardware, mya-plugins, mya-eval, apps/myacode/tauri. KEY FACT: mya-runtime has ZERO dep on mya-channels (channel maps injected via `register_channel_map_fn` OnceLock; not calling it = empty handles). FS tools always compiled (no feature gate). Reuses existing `Agent::from_config` + `Agent::turn_streamed((msg, mpsc::Sender<TurnEvent>, cancel))` — NO new loop. Proven pattern: `src/bin/mya-acp-bridge.rs`.

**NDJSON contract:** stdin `{"type":"prompt","message":..,"agent":..}`; stdout one line per `TurnEvent` variant 1:1 (`chunk/thinking/tool_call/tool_result/usage/done/error`); logs→stderr only.

**Smoke test:** build --bin mya-headless --features headless; pipe a prompt; assert ≥1 valid NDJSON line (done OR error — error is valid contract compliance).

---

## #13 — Split mya-gateway-protocol + mya-net-policy

**First PR (protocol extraction, pure move):** create `crates/mya-gateway-protocol/` (deps: serde, serde_json; opt `schema-export`→schemars). Move `mya-gateway/src/a2a.rs` serde DTOs (`AgentCard` family + `JsonRpcRequest` etc, `pub(crate)`→`pub`) → `protocol/src/a2a.rs`; move the 3 version consts (`A2A_PROTOCOL_VERSION="1.0"`, `WS_PROTOCOL="mya.v1"`, `ACP_WS_PROTOCOL="mya.acp.v1"`) → `protocol/src/version.rs`. Gateway re-exports `pub use mya_gateway_protocol::{a2a::*, version::*};` so all call sites compile unchanged. REST DTOs stay (they carry config types — deferred). Foundation-leaf: NO mya-infra dep.

**`mya-net-policy` (greenfield egress evaluator, leaf):** `EgressPolicy { rules, default } + evaluate(&Target)->Decision`, `Decision { Allow, Deny(Reason) }`, `Target { host: HostRef, port, scheme }`, `HostRef { Domain/Ip/Wildcard }`, `Rule { action: Action{Allow,Deny}, host, port }`, `preset` (default-deny loopback/link-local/private-RFC1918/cloud-metadata 169.254.169.254). Callers (gateway + mya-tools web_fetch/http_request) build `Vec<Rule>` from `&Config` — crate NEVER depends on mya-config/mya-infra (deps flow inward). CIDR via tiny `ipnet`/`cidr` if needed.

**net-policy tests (8):** empty=deny-default, explicit-allow-domain, deny-overrides-allow, CIDR-IP-match, wildcard-subdomain (*.x not bare x), port-restriction, private/loopback/metadata-blocked-by-preset, case-insensitive-domain.

---

## #08 — Skill curator + provenance

**Files:** `crates/mya-runtime/src/skills/provenance.rs` (NEW), `skills/mod.rs` (+`pub mod provenance; pub use ...{SkillProvenance, ProvenanceError};`). Foundation only — does NOT touch SkillFrontmatter/SkillDocument/SkillImprover/loader.

**Key insight:** `SkillImprover::improve_skill` (improver.rs:90) overwrites SKILL.md with NO backup → a bad auto-edit silently destroys a human skill. THREE distinct concepts must NOT conflate: `ForgeMetadata` ([forge] discovery source — untouched), `SkillOrigin` (runtime location — untouched), `SkillProvenance` (NEW authorship).

**Sidecar, NOT frontmatter** (file `SKILL.provenance`, TOML): provenance must survive the very rewrite that corrupts SKILL.md — if it lived in frontmatter the improver could forge/strip it. `SkillProvenance { HumanAuthored (Default — backward-compat with installed base), AgentAuthored{agent_id, turn}, AuxiliaryFork{source} }` + `ProvenanceError { Malformed, Io }` (thiserror). Methods: `load(skill_dir) -> Result<Self,_>` (Ok(HumanAuthored) when sidecar absent), `write(skill_dir, &Self)`, `to_manifest()/from_manifest()` (pure).

**`archive_snapshot_before_overwrite(skills_root, slug) -> PathBuf`:** REUSES existing `.archive/` convention + timestamp-disambiguation from `tools/skill_manage.rs::archive()` (ARCHIVE_DIRNAME=".archive") — copies (not moves) the live SKILL.md into `.archive/<slug>[-<ts>]/` before overwrite. Follow-up wires it at top of `improve_skill`.

**Tests (8):** human-round-trip, agent-round-trip (agent_id+turn), fork-round-trip (source), load-defaults-human-when-sidecar-absent, load-typed-error-on-malformed (no panic), archive-copies-and-leaves-original, archive-disambiguates-by-timestamp, provenance-not-silently-reclassified (separate sidecar ⇒ SKILL.md edit cannot alter provenance).
