# Provider Abstraction

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §6.



## 6. Provider Abstraction

**Declarative `ProviderProfile`** *(source: [hermes-agent](../../hermes-agent/) [`providers/base.py`](../../hermes-agent/providers/base.py))* — a typed metadata record paired with the provider transport:
```
ProviderProfile = { aliases[], api_mode, base_url, auth_type, env_vars[],
                    supports_vision, fallback_models[], models_url,
                    hooks: { prepare_messages, build_extra_body, fetch_models } }
```
- New provider = register ONE profile (not a 6-file change). Readable by config at build time → setup wizard / `doctor` UX. *(source: [hermes](../../hermes-agent/) ProviderProfile.)*
- **Tool-call repair pipeline** ahead of dispatch: `stream-normalize → grammar/payload parse → promote` (3 stages; no Zod — validation is against an `allowedToolNames` allowlist). *(source: [openclaw](../../openclaw/).)* Robust against model malformation. **Repair audit (R27-14): `resolveToolName` is a pure deterministic config-declared mapping (not an arbitrary callback), unit-tested for identical-input-identical-output. A tool-call block embedded in a TOOL RESULT (not an assistant turn) is NEVER promoted (role-gate). Whenever `repaired !== raw` a `RuntimeEvent{kind:"repair"; raw; repaired; resolver}` is emitted and enters the Merkle audit log ([§14 Security](08-observability-security.md)).**
- **Optional council provider archetype:** fan-out to N models → vote/aggregate for high-stakes turns. *(source: [openhuman](../../openhuman/) [`model_council`](../../openhuman/src/openhuman/model_council/).)*
- **Auxiliary provider instance** for side tasks (skill curator LLM pass, memory reflection) — NEVER touches the main session's prompt cache. *(source: [hermes](../../hermes-agent/) + deepdive #02/#05 shared helper.)* **Auxiliary health (R27-22): the auxiliary provider registers as `ComponentHealth` components (`"curator-aux"`, `"memory-reflection-aux"`); a failed `resolve_aux_provider` or failed LLM pass emits `RuntimeEvent{kind:"health";tri:"Degraded"}`. On boot, if `curator.enabled=true` but `auxiliary.curator` is unset/misconfigured → a loud startup WARNING (NOT a silent fallback-to-main, which would violate invariant #8). A LaneBoard lane is registered for the curator.**

**Concrete provider pipeline (round 10):**
```ts
type StreamEvent =
  | { kind: "text";      delta: string }
  | { kind: "tool_call"; call: ToolCall }    // may be partial/malformed → repair
  | { kind: "usage";     usage: TokenUsage }
  | { kind: "done";      finish: "stop"|"length"|"tool"|"error" };
// Fallback chain: ProviderProfile[] tried in order on recoverable error;
//   a provider is SKIPPED (not retried) if its last error phase = "auth"|"quota".
//   R27-1/D7: streamWithFallback widens its return to carry the surviving profile + partial cost;
//   finish:"length" runs a compression pass (§5) BEFORE retrying; a user-UNINITIATED fallback's
//   partial cost is refunded. All-profiles-tainted => AllProvidersDegraded (not generic Failed).
//   A mid-stream cost watermark cancels the stream when cumulative-turn cost > abortThreshold (R27-6).
//   CC8/R28 (encapsulation invariant): streaming callbacks COLLECT into the return value (`events`),
//   NEVER emit directly to the RuntimeEvent bus — only the turn loop's emit() feeds observers; this
//   prevents ghost events from a failed/abandoned profile (a tainted profile's partial stream is unobserved).
// Repair stages applied to each partial tool_call before promotion:
//   stream-normalize → grammar/payload parse → promote (3 stages; no Zod —
//   validation is against an `allowedToolNames` allowlist).
//   R27-14: resolveToolName is a pure deterministic config-declared mapping; repair emits an audit
//   event when repaired !== raw; a tool-call block in a TOOL RESULT is never promoted (role-gate).
// Provider hooks re-scan (R27-17): `prepare_messages` output is re-scanned by `scanInject` before the
//   wire call; secrets redaction (§14) runs AFTER `prepare_messages`, not only in tool Pre-hooks.
```

**Completeness (R31)** — CORE provider features folded in from [FEATURE-INVENTORY](../../.learned/FEATURE-INVENTORY.md) Part 1:

| Feature | 1-line | Source |
|---|---|---|
| **Provider compat flags (~20)** | per-profile capability toggles: `supportsDeveloperRole`, `thinkingFormat` (qwen/deepseek/openrouter), `cacheControlFormat`, `requiresToolResultName`, `maxTokensField` | [pi](../../pi-coding-agent/docs/custom-provider.md) · [claw-code](../../claw-code/) |
| **Auth-profile rotation + cooldown + failover** | per-provider OAuth profile pool; cooldown auto-expiry; round-robin (not last-good); typed failover-error classification | [openclaw](../../openclaw/src/agents/auth-profiles.ts) |
| **OAuth/PKCE loopback + token refresh** | `OAuthAuthorizationRequest`, PKCE `code_challenge_s256`, loopback redirect, refresh-token rotation | [claw-code](../../claw-code/rust/crates/runtime/src/oauth.rs) |
| **prompt_cache_key strategy** | per-provider cache-key injection (Anthropic `cache_control`, OpenAI `prompt_cache_key`) | [headroom](../../headroom/crates/headroom-proxy/src/cache_stabilization/openai_cache_key.rs) · [openclaw](../../openclaw/) |
| **Transport selection (SSE/WebSocket)** | `transport: auto\|sse\|websocket\|websocket-cached` + idle/connect timeouts | [pi](../../pi-coding-agent/src/core/sdk.ts) |
| **Provider-prefix routing** | model-name prefix (`openai/`/`local/`/`qwen/`/`kimi/`/`grok`) wins over auth-sniff; foreign-provider hint | [claw-code](../../claw-code/rust/crates/api/src/providers/mod.rs) |
| **Context-window preflight** | reject requests where est. input+output > `context_window` BEFORE the wire call, with a typed error (`estimated_total_tokens`, `context_window_tokens`) — fail fast, don't burn quota | [claw-code](../../claw-code/rust/crates/api/src/providers/mod.rs) `preflight_message_request` |

### 6.1 Provider auth flows

- OAuth 2.1 + PKCE: generate `code_verifier` (random 43–128 chars) → `code_challenge = S256(verifier)` → auth URL with random `state` (CSRF) → loopback `http://127.0.0.1:{port}/callback` (bind ephemeral port; never `0.0.0.0`) → exchange `code+verifier` for tokens.
- Store tokens only via `SecretRef{from:"keyring"}` (§14.2); rotate refresh tokens on every use; revoke on profile removal.
- `type AuthProfile = { provider: string; method: "api_key"|"oauth_pkce"|"subscription"; status: "healthy"|"cooldown"|"failed"; cooldownUntil?: number; lastError?: AuthError }`
- On 401/403, put the profile in cooldown; fail-closed after N retries (no unauthenticated fallback).
- `type AuthError = { kind: "denied"|"expired"|"network"|"rate_limited"|"consent_missing" }` maps to provider-cooldown (`expired`/`rate_limited`) vs user-retry (`denied`/`consent_missing`); `network` follows retry budget.
- If no browser/head is available, use device-code fallback and UI handoff via `RuntimeEvent{kind:"auth";stage:"device_code"}`.
- Source: [headroom](../../headroom/) auth-profile · [MyAgents](../../MyAgents/) OAuth · [openclaw](../../openclaw/ui/src/components/login-gate.ts).

---
