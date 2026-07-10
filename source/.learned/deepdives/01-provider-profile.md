# Deep-dive: Declarative `ProviderProfile` → port to mya

> Source: hermes-agent `providers/base.py` (MIT, Nous Research 2025 — re-implement, don't copy). mya integration design. Reading budget: 25/28.

## Source design
Hermes ships a single **declarative metadata struct** — `ProviderProfile` (`providers/base.py:42`) — owning every piece of static per-provider state. The transport (`agent/transports/chat_completions.py:438`) reads from it instead of 20+ boolean flags. The registry (`providers/__init__.py:67`) is populated by lazy discovery of `plugins/model-providers/<name>/__init__.py`; all downstream layers look up profiles via `get_provider_profile(name)` / `list_providers()`.

**Fields & hooks** (`providers/base.py:42-194`):
- Identity: `name`, `api_mode` (transport selector), `aliases`.
- Human-readable: `display_name`, `description`, `signup_url`.
- Auth & endpoints: `env_vars`, `base_url`, `models_url`, `auth_type` (api_key|oauth_device_code|oauth_external|copilot|aws_sdk), `supports_health_check`.
- Vision: `supports_vision`, `supports_vision_tool_messages`.
- Catalog: `fallback_models`, `hostname` (URL→provider reverse map).
- Quirks: `default_headers`, `fixed_temperature` (`OMIT_TEMPERATURE` sentinel = omit), `default_max_tokens`, `default_aux_model`.

Hooks (default impls overridable): `get_hostname()`, `prepare_messages()`, `build_extra_body()` (OpenRouter prefs, Gemini thinking_config), `build_api_kwargs_extras()` → `(extra_body_additions, top_level_kwargs)` (Kimi puts reasoning_effort top-level), `get_max_tokens(model)`, `fetch_models()` (default hits `{models_url or base_url}/models` Bearer + UA).

Transport consumption (`chat_completions.py:438-557`): `sanitized = profile.prepare_messages(sanitized)`; temperature three-state via sentinel; max_tokens priority chain; reasoning split between extra_body and top-level. **This replaces the entire legacy flag-based branch** (`is_openrouter/is_kimi/...` booleans + giant if/elif). Known providers → profile path; only `custom:https://...` takes the legacy branch.

**Declaring a provider** is ~3 lines (`plugins/model-providers/openai-codex/__init__.py`): construct a `ProviderProfile(...)`, call `register_provider(profile)`. Or subclass to override a hook (Anthropic overrides `fetch_models` to use `x-api-key` + `anthropic-version`).

**Discovery**: bundled scan `plugins/model-providers/<name>/__init__.py` → user scan `$HERMES_HOME/plugins/model-providers/<name>/` (last-writer-wins override) → legacy single-file fallback. `register_provider` writes `_REGISTRY[name]` + `_ALIASES[alias]→name` for every alias.

**Consumers** (`providers/README.md:23-37`): `auth.py`, `models.py` (fetch_models), `doctor.py` (health check per api_key profile), `config.py` (wizard env_var), `runtime_provider.py` (api_mode), `model_metadata.py` (hostname→profile), `auxiliary_client.py` (default_aux_model), the chat transport (all quirk hooks), `run_agent.py` (passes profile so transport takes profile path).

## mya today
- **Trait** `crates/mya-api/src/model_provider.rs:303-355`: `ModelProvider` trait already exposes profile-style concepts (`capabilities()`→`ProviderCapabilities{native_tool_calling,vision,prompt_caching,extended_thinking}`, `default_temperature`, `default_max_tokens`, `default_timeout_secs`, `default_base_url`, `default_wire_api`, `list_models*`, `chat*`). But every consumer re-asks the concrete provider via method calls — no flat declarative record.
- **SSOT family list** `crates/mya-config/src/providers.rs:184-243`: `for_each_model_provider_slot!` macro expands `(field_ident, type_str, typed_config_ty)` tuples for **74 families**. Drives: `ModelProviders` struct, `iter_entries()`, `resolved_endpoint_uri()`, `find/find_by_name/ensure()`. Factory `crates/mya-providers/src/factory.rs:283-318` dispatches `create_provider` via the same macro.
- **`CompatFamilySpec` trait** (factory.rs): consts `DISPLAY`, `DEFAULT_URL`, `AUTH`, `FALLBACK_ALLOWS_MISSING_API_KEY`, `MODELS_DEV_KEY`, `OPENROUTER_VENDOR_PREFIX`, `PUBLIC_MODEL_LISTING`; blanket `FamilyProviderFactory` impl. ~15 bespoke families (azure, openrouter, anthropic, ollama, gemini, bedrock, qwen, minimax) have custom `create_provider`.
- **Per-alias config** `crates/mya-config/src/schema.rs:758-874`: `ModelProviderConfig { api_key, kind, uri, model, fallback, fallback_models, temperature, timeout_secs, extra_headers, wire_api, requires_openai_auth, max_tokens, merge_system_into_user, provider_extra, pricing, replay_assistant_reasoning, native_tools, think, chat_template_kwargs, tls_ca_cert_path }`.
- **`ModelProviderRuntimeOptions`** (lib.rs:613-645): the already-collected per-call runtime knobs; `factory::apply_compat_options` is the single funnel mutating every newly-built compat provider.

**What's implicit/scattered/duplicated (SSOT violations):**
1. `display_name` (DISPLAY) hardcoded only in `CompatFamilySpec` impls; wizard asks for bare `provider_type` string.
2. `MODELS_DEV_KEY`+`OPENROUTER_VENDOR_PREFIX` declared in `CompatFamilySpec` AND **duplicated** in `catalog.rs:32 catalog_source_for` (~60 families) — the exact SSOT violation AGENTS.md flags.
3. `api_mode`/`wire_api` defaults duplicated across typed slot + trait `default_wire_api()` + `WireApi` switch.
4. `supports_vision`, `supports_health_check`, `fetch_models` hook, `default_aux_model`, `fixed_temperature`, `signup_url`, `description` — **declared nowhere**; wizard must guess.
5. Aliases (`claude`, `codex`, `grok`, `kimi-cn`) live in scattered `is_*_alias` helpers (lib.rs:74-128).
6. `hostname` URL→provider reverse map has no Rust equivalent.
7. `fetch_models` hook not expressed; `list_models()` bails by default, concrete providers re-implement bespoke signatures.

mya has **no legacy flag-chain to delete** (structurally closer to profiles than hermes-pre-refactor). Wins = metadata consolidation + wizard UX + future hook authoring.

## Proposed design for mya
Declarative, SSOT-derived `ProviderProfile` populated from the SAME `for_each_model_provider_slot!` macro. Owns every currently-duplicated metadata field + hermes' hooks reshaped for typed-family architecture.

**Location**: types in `crates/mya-api/src/provider_profile.rs` (new); registry in `crates/mya-providers/src/profile.rs` (new, co-located with the factory that already uses the macro). Stability: Experimental → Beta at v0.8.0.

```rust
// crates/mya-api/src/provider_profile.rs
#[derive(Debug, Clone)]
pub struct ProviderProfile {
    // Identity
    pub name: &'static str,
    pub aliases: &'static [&'static str],
    pub api_mode: ApiMode,           // ChatCompletions|Responses|AnthropicMessages|GeminiNative|BedrockConverse
    // Human-readable (wizard)
    pub display_name: &'static str,
    pub description: &'static str,
    pub signup_url: &'static str,
    // Auth & endpoints
    pub env_vars: &'static [&'static str],
    pub base_url: &'static str,
    pub models_url: &'static str,    // "" → f"{base}/models"
    pub auth_type: AuthType,         // ApiKey|OAuthDeviceCode|OAuthExternal|Copilot|AwsSdk
    pub supports_health_check: bool,
    // Capabilities
    pub supports_vision: bool,
    pub supports_vision_tool_messages: bool,
    // Catalog
    pub fallback_models: &'static [&'static str],
    pub hostname: &'static str,
    // Quirks
    pub fixed_temperature: Option<f64>,
    pub omit_temperature: bool,      // Kimi sentinel
    pub default_max_tokens: Option<u32>,
    pub default_aux_model: &'static str,
    // Catalog hooks (from CompatFamilySpec consts — consolidate here)
    pub models_dev_key: Option<&'static str>,
    pub openrouter_vendor_prefix: Option<&'static str>,
    pub public_model_listing: bool,
    // Factory handle
    pub create_provider: ProviderFactoryFn,
    pub fallback_auth_ready: AuthReadyFn,
}
pub type ProviderFactoryFn = fn(family:&str, alias:&str, key:Option<&str>, api_url:Option<&str>, opts:&ModelProviderRuntimeOptions) -> anyhow::Result<Box<dyn ModelProvider>>;
pub type AuthReadyFn = fn(key:Option<&str>, opts:&ModelProviderRuntimeOptions) -> bool;
```

**Hooks trait** (opt-in per family, default no-ops; consumed by `OpenAiCompatibleModelProvider::build_request`):
```rust
pub trait ProviderProfileHooks: Send + Sync {
    fn prepare_messages(&self, _m: &mut [ChatMessage]) {}
    fn build_extra_body(&self, _model:&str, _reasoning:Option<&ReasoningConfig>, _session:Option<&str>) -> serde_json::Value { Value::Object(Default::default()) }
    fn build_api_kwargs_extras(&self, ...) -> (Value, Value) { (Value::Object(Default::default()), Value::Object(Default::default())) }
    fn max_tokens_for(&self, _model:&str) -> Option<u32> { None }
    fn fetch_models(&self, _key:Option<&str>, _base:Option<&str>, _t:Duration) -> impl Future<Output=anyhow::Result<Vec<String>>> + Send { async { Ok(vec![]) } }
}
```

**Registry** (populated from the slot macro — adding a family = one row, the only way to add a profile):
```rust
// crates/mya-providers/src/profile.rs
static PROFILES: OnceLock<&'static [ProviderProfile]> = OnceLock::new();
pub fn provider_profiles() -> &'static [ProviderProfile] {
    PROFILES.get_or_init(|| mya_config::for_each_model_provider_slot!(emit_provider_profiles))
}
pub fn provider_profile(name_or_alias:&str) -> Option<&'static ProviderProfile> { /* name || aliases */ }
```

**Aliases as const slice** (replaces 15 `is_*_alias` fns): each typed config gets `const ALIASES: &'static [&'static str]`; `canonicalize_v2_model_provider_name` becomes one `provider_profile(name).map(|p|p.name)` lookup.

**Wizard integration** (no schema change — profile is derived data): picker shows `display_name`+`description`; "Get your key at `<signup_url>`"; model picker pre-seeds `fallback_models`; `supports_vision` tooltip; `env_vars[0]` prefills API-key field label. All `fl!()`-wrapped at the wizard site (profile stays English metadata).

## Integration points
| Surface | Change |
|---|---|
| `mya-api/src/provider_profile.rs` | **new** — types + hooks trait |
| `mya-providers/src/profile.rs` | **new** — registry + lookup + macro arm |
| `mya-providers/src/factory.rs` | each `CompatFamilySpec` adds `const ALIASES`; macro emits profile slice |
| `mya-providers/src/lib.rs` | `is_*_alias` (74-128) collapse to derived `is_alias!`; `canonicalize_v2_model_provider_name` (778) → single lookup |
| `mya-providers/src/{openrouter,anthropic,moonshot}.rs` | add `impl ProviderProfileHooks` |
| `mya-providers/src/catalog.rs:32` | **delete** duplicated `(models_dev_key, openrouter_vendor_prefix)` tuples → `provider_profile(family)` lookup (SSOT fix) |
| `mya-config/src/providers.rs:184` | extend macro to emit both typed-struct arm AND profile arm (one row list) |
| `mya-runtime/src/quickstart/mod.rs:951` | `apply_model_provider` reads profile for wizard help text |
| `mya-runtime/src/doctor/mod.rs:321` | gate `/models` probe on `profile.supports_health_check` |
| config schema | **zero** changes (profile is derived) |

**Breaking changes: none.** Trait unchanged; TOML round-trips identically; display strings bit-identical (sourced from existing `DISPLAY` consts). Wizard help text is additive.

## Migration / implementation steps (PR-sized, ordered)
1. **PR#1 S**: add `provider_profile.rs` (types + default hooks). Build green only.
2. **PR#2 S**: extend `for_each_model_provider_slot!` with profile-emission arm + compile-time test (all 74 families).
3. **PR#3 M**: `profile.rs` registry; replace `catalog.rs::catalog_source_for` with profile lookup (**dedupe, not copy**); catalog tuple test stays green.
4. **PR#4 M**: aliases → const slices + `is_alias!` derive; `canonicalize_v2_model_provider_name` → one lookup.
5. **PR#5 S**: first `ProviderProfileHooks` impl (OpenRouter) — dormant, no behavior change.
6. **PR#6 S**: wizard UX (display_name/description/signup_url/env_vars[0]).
7. **PR#7 S**: doctor UX (supports_health_check gating).
8. **PR#8 XS** (follow-up): move OAuth refresh helpers to `auth/<family>.rs`.

## Effort & risk — 🟢 Low overall (structural consolidation, not behavior change)
- Macro slot extension 🟡 (highest churn — isolate the new arm, don't touch existing `emit_*`).
- `catalog_source_for` rewrite 🟢 (pure dedupe; tests assert exact tuples).
- Alias collapse 🟡 (15 fns; compile-time `static_assertions` alias-count test).
- Doctor UX 🟡 (failure modes for `supports_health_check=false` families: bedrock/copilot/lmstudio/llamacpp/ollama/sglang/vllm/litellm/osaurus need explicit tests).
- License 🟢 (MIT — re-implement signatures/behavior, don't translate Python idioms 1:1; `field(default_factory=dict)`→derive Default; `OMIT_TEMPERATURE`→`Option`/bool; `urllib`→`reqwest`).
- SSOT 🟢 (consolidates catalog.rs↔factory.rs duplication; no new concurrent-storage fields).

## Open questions
1. Profile in `mya-api` (clean) or `mya-providers` (macro co-located)? → types in api, registry in providers.
2. Hooks as `&self` trait vs `Fn` closures? → `&self` trait (user-overlay support is separate follow-up).
3. Families without `signup_url` → suppress wizard line (treat "" as none).
4. `default_aux_model` on profile vs runtime lookup → on profile (parity; dormant if runtime picks own default).
5. `default_temperature` via profile vs existing trait method → defer (trait stays canonical).
6. Gateway `/api/config/catalog/models` migration → unchanged call sites once `catalog_source_for` is profile-backed.
7. **Tier placement**: `mya-api` is Experimental (Stable at v1.0.0). Promote `ProviderProfile` to Beta at v0.8.0, or delay to v0.9? — **decision needed**.
8. `WireApi` enum (2-variant) insufficient — introduce `ApiMode` (5-variant) at profile boundary, convert to `WireApi` for compat; no schema drift.
