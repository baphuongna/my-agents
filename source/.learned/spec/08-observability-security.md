# Observability & Security

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §13 · §14 · §14b.



## 13. Observability

- **Typed lifecycle events** emit on every FSM transition → dashboards/observers consume data, not logs. *(source: [claw-code](../../claw-code/) tenet #2.)*
- **LaneBoard** + **structured error surfaces** (phase + recoverable + context) as the operational liveness source. *(source: [claw-code](../../claw-code/).)*
- **ComponentHealth tri-state** (`Healthy | Degraded | Failed`) on every plugin/channel/MCP/cron. *(source: [mya-v1](../../mya-v1/) `mya-api::health`.)*
- **Telemetry export** (opt-in) + **openOSS session sharing** flywheel for eval data. *(source: [pi-coding-agent](../../pi-coding-agent/) `pi-share-hf`.)*
- **Single time helper** (`core.time.now()` in TS / `now_wallclock`+`now_monotonic` in Rust natives) — never duplicate `SystemTime::now()…` across files; injectable for tests. *(source: [claw-code](../../claw-code/) `now_secs` anti-pattern + [mya-v1](../../mya-v1/) #07.)*

**Concrete liveness API (round 5):**
```ts
type LaneFreshness = "Healthy" | "Stalled" | "TransportDead" | "Unknown" | "AwaitingHuman";  // R27-19: AwaitingHuman added
interface LaneHeartbeat { observedAt: number; transportAlive: boolean; status: LaneStatus; blockedOn?: "approval"; }  // R27-19: blockedOn; status: LaneStatus (typed enum, §4 Core primitives; R26-H)
interface LaneBoardEntry { taskId: string; prompt: string; status: LaneStatus; teamId: string; heartbeat: LaneHeartbeat; freshness: LaneFreshness; }  // lane identity (task_id) lives HERE, not on the heartbeat
interface LaneBoard { generatedAt: number; entries: LaneBoardEntry[]; }  // entries are LaneBoardEntry[], NOT LaneHeartbeat[]; LaneBoard also has generated_at
// freshness is NOT a per-laneId method — it is per-heartbeat and en masse:
//   LaneHeartbeat::freshnessAt(now, stalledAfterS) → LaneFreshness   (per-heartbeat)
//   TaskRegistry::laneBoardAt(now, stalledAfterS) → LaneBoard        (en masse)
// `now` is injected (single time helper) — never reads the clock inline
// R27-19: a lane whose turn is AwaitingApproval classifies as AwaitingHuman{since, approvalRequest}
//   — EXEMPT from Stalled timeout escalation; reapers MUST NOT kill it without operator action;
//   approvalEscalationTimeoutS (default 24h) escalates (notify) rather than discards.
//   CC5/R28 (false-kill race): the turn sets blockedOn:"approval" on the heartbeat ATOMICICALLY BEFORE
//   emitting AwaitingApproval (or the heartbeat reads TurnState directly), so there is no window in
//   which an approval-pending lane reads as Stalled and gets reaped before the emit lands.
// R29-13/m4: `LaneBoard.entries=[]` ⇒ no active lanes ⇒ overall freshness `Healthy`.
// R29-13/m7: LaneBoardEntry.freshness is derived per-heartbeat via LaneHeartbeat::freshnessAt(now, stalledAfterS):
//   status="running" && transportAlive && !blockedOn → Healthy; status="running" && !transportAlive → TransportDead;
//   status="blocked" && blockedOn="approval" → AwaitingHuman; status="idle" → Healthy (if recent) or Stalled (if stale);
//   else → Unknown. The mapping is exhaustive over LaneStatus + transportAlive + blockedOn.
```

**Event taxonomy (round 15) — every emit is one of:**
```ts
type RuntimeEvent =
  | { kind: "turn";      e: TurnEvent }
  | { kind: "lifecycle"; lane: LaneId; state: LifecycleState }   // FSM transitions
  | { kind: "approval";  stage: "requested" | "decided"; call: ToolCall }   // R25-5: hook-Allow→ask-human round-trip observable (§7 step 4, invariant #13)
  | { kind: "tool";      decision: PermissionDecision; result: ToolResult }   // C2: PER-CALL event — result is a single ToolResult; the batch DegradedResult lives only on TurnEvent.ToolExec (§4)
  | { kind: "repair";    raw: string; repaired: ToolCall; resolver: string }   // R27-14: repair audit — emitted when repaired !== raw (enters Merkle log)
  | { kind: "budget";    level: "warn" | "exhausted"; spent: Cost }
  | { kind: "health";    component: ComponentId; tri: ComponentHealth };
// R27-16: the Merkle audit log covers ALL RuntimeEvent.kind==="tool" entries (every tool surface,
//   not just MCP writes) PLUS approval and repair events; channel messages are logged on receipt.
// Telemetry export = opt-in sampled projection of RuntimeEvent (secrets/PII redacted per §14).
```

---
## 14. Security

> **No containment (pi model) — R30 sandbox-removal.** The agent is a personal coding/automation tool that runs in the user's own workspace with the user's own privileges (like `pi`, Claude Code, or any dev tool). It does **NOT contain or sandbox itself**. The trust boundary is the user's machine. The controls below are **detection / audit / approval / policy**, NOT OS containment: the [§7](03-tools-permission.md) permission gate (mode + deny/ask rules + approval) is the sole runtime gate over whether an operation runs. **Accepted risk:** a malicious agent or package can affect the host exactly like any npm-installed dev tool can — the user accepts this (same trust as `npm install -g <anything>`). The R27 OS sandbox machinery (the kernel-enforcer crate, the cwd-jail + env-allow-list shell hardening, the shell/sandbox sidecar) is **removed** — see `SPEC-CHANGE-sandbox-npm.md`.

- **Prompt-injection scan** on every context file before injection (`[BLOCKED]` placeholder). *(source: [hermes](../../hermes-agent/) + [openhuman](../../openhuman/) `prompt_injection`.)*
- **Per-surface audit:** MCP tool calls audited separately from tool calls separately from channel messages; **Merkle/append-only audit log (mya-v1)** — openhuman's `mcp_audit` is a **plain SQLite table, MCP-write-tools-only, NOT Merkle/append-only**. *(source: [openhuman](../../openhuman/) `mcp_audit` (SQLite) + [mya-v1](../../mya-v1/) (Merkle).)* **(R27-16/T10: the Merkle audit log covers ALL `RuntimeEvent.kind==="tool"` entries (every tool surface, not just MCP writes) PLUS `approval` and `repair` events; channel messages are logged on receipt.)**
- **Content-addressed edits** prevent silent multi-agent clobbering. *(source: [oh-my-pi](../../oh-my-pi/) hashline.)*
- **Subagent isolation** (blocked-tools denylist + explicit approval channel). *(source: [hermes](../../hermes-agent/).)*
- **Secrets redaction** via Pre-tool hook (auto-redact in `Write`/`bash` inputs). *(source: [claw-code](../../claw-code/) hooks.)*
- **Rate-limiting & abuse protection (round 6):** per-identity (channel user / API key / session) token + cost budgets at the gateway; hard ceiling on concurrent subagents (`MAX_CONCURRENT_SUBAGENTS`) and per-run cost ([§21 Cross-cutting](11-invariants-roadmap.md) `BudgetConfig`) to bound runaway spend and DoS. *(source: [openclaw](../../openclaw/) perf + [mya-v1](../../mya-v1/) hardware caps.)*
- **Secret management lifecycle (round 6 — partly SPEC-proposed):** secrets live in the OS keyring (or a sealed `0600` file), never in config TOML or env-as-default; a `secrets` package provides `get/rotate/revoke`; the audit log stores only a hash/redacted form — **this lifecycle is the SPEC's own proposal**. oh-my-pi's real `secrets` package is a **prompt/output redactor** (`SecretObfuscator`: obfuscate/redact via plain/regex patterns from `.omp/secrets.yml`); no OS-keyring, no lifecycle. *(source: [oh-my-pi](../../oh-my-pi/) `secrets` redaction + [claw-code](../../claw-code/) path validation.)*
- **PII handling (round 6 — SPEC-proposed):** a configurable PII redactor in the injection-scanner pipeline (regex + dictionary) scrubs PII before provider calls and before audit-log write; per-jurisdiction retention on memory — **this is the SPEC's proposal**. openhuman's real privacy posture is **hash-based audit logging (sha256 of prompts)**, NOT a PII redactor. *(source: SPEC proposal + [openhuman](../../openhuman/) hash-audit + [hermes](../../hermes-agent/) scan.)*
- **Injection-scanner honesty (R27-15/T7):** the prompt-injection scanner is **defense-in-depth, NOT a security boundary** — the real control is **privilege separation** (untrusted context can never raise `active_mode`, [§7 Tools](03-tools-permission.md)). The 64 KiB truncation is removed (sliding window with overlap); TR#39 confusables detection added; secrets redaction runs AFTER `prepare_messages` ([§6 Providers](02-providers.md), R27-17), not only in tool Pre-hooks. *(source: [hermes](../../hermes-agent/) + [openhuman](../../openhuman/) `prompt_injection`.)*

### 14.1 AuditLog (Merkle)
```ts
interface AuditRecord {
  seq: number; ts: number;                              // monotonic seq + wallclock ts
  kind: "tool"|"approval"|"repair"|"channel";           // mirrors RuntimeEvent.kind (subset, §13)
  actor: string;                                         // identity that produced the event
  payload: Record<string,unknown>;                      // redacted body (see §14.2)
}
```
- **Chain.** Serialization = deterministic JSON (keys sorted, no whitespace, UTF-8 NFC). Hash chain: `hash_n = sha256( canonical(prevHash_n-1 || record_n) )`, `prevHash_0 = 0x00..00`. Merkle root committed every `N` records (default `100`) to a tamper-evident anchor (durable store / external witness). Covers all `RuntimeEvent.kind in {"tool","approval","repair"}` plus channel-message receipt logs (R27-16); a plain SQLite table (e.g. openhuman `mcp_audit`) is a transport, NOT the trust root.
- **Redaction-before-hash.** §14.2 redaction runs BEFORE canonicalization, so the hashed bytes never contain a `SecretRef`, token, or env-derived value. Payload schema is the post-redaction view.
- **Verify.** `verifyAuditLog(since: number): { ok: true } | { ok: false; forksAt: number }` — replay from `since`, recompute hashes; first divergence yields `forksAt`. Tamper / fork detection on every checkpoint.
- **Retention.** Append-only — records are never mutated or deleted in place; rotation writes a new sealed ledger and archives the prior root anchor.

Source: [claw-code](../../claw-code/) `mcp_audit` · [oh-my-pi](../../oh-my-pi/) hash-chain.

### 14.2 Secrets
```ts
type SecretRef =
  | { from: "env";     ref: string }                    // e.g. "OPENAI_API_KEY"
  | { from: "file";    ref: string }                    // sealed 0600 file path (decrypt on read)
  | { from: "exec";    ref: string }                    // argv → stdout (parsed, never echoed)
  | { from: "keyring"; ref: string };                   // service/account name in OS keyring
declare const secrets: {
  resolve(ref: SecretRef): Promise<string>;             // fail-closed: rejects if missing/denied
  rotate(ref: SecretRef): Promise<void>;
  revoke(ref: SecretRef): Promise<void>;
};
```
- **Backends.** OS keyring primary (via `keytar` / libsecret / Windows Credential Manager — per-platform secret-service adapter); sealed-file fallback (`age`-encrypted, 0600).
- **Lifecycle.** Per-channel env schema (`channels.<id>.envSchema`) declares which `SecretRef`s the channel needs at construction → channel adapter mounts or fails fast. Rotation bumps the ref; revocation deletes the underlying store entry and invalidates dependents.
- **Redaction.** `resolve()` returns the plaintext ONLY to the in-process caller; it is redacted before any log / `RuntimeEvent` / audit write (§14.1 invariant: the audit log records the `SecretRef` + a short fingerprint, never the resolved value).
- **Fail-closed.** Missing / expired / denied `SecretRef` ⇒ startup error (channel refuses to mount). Never an empty string, never a fallback constant.

Source: [headroom](../../headroom/) proxy secret-rotation · [MyAgents](../../MyAgents/) `ChannelSecretsAdapter` (`channel-secret-*-runtime.js`).

### 14.3 Catalog Types (cross-ref §14b completeness table)
```ts
// ApprovalToken — short-lived, single-use, scoped; consumed against an Authority ledger.
interface ApprovalToken {
  id: string;                                          // ULID / UUIDv7
  tool: string; scopes: string[];                      // e.g. {"write","to:src/**"}
  repo?: string; branch?: string;                      // optional repo+branch binding
  issuedAt: number; expiresAt: number;                 // short TTL (default 5m, bounded)
  consumed: boolean; spent?: Cost;                     // one-shot; ledger records `spent` on consume
  parent?: string;                                     // multi-hop chain: each link references parent
}

// RecoveryRecipe — bounded FSM: detect → classify → apply bounded retry.
type FailureScenario = "NetworkError"|"ToolTimeout"|"InvalidOutput"|"PermissionDenied"|"Provider5xx"|"ApprovalExpired";
type RecoveryStep    = { kind: "retry"|"reauth"|"rephrase"|"rebuild-context"|"escalate" };
interface RecoveryRecipe {
  scenario:     FailureScenario;                       // typed symptom (not stringly)
  detect:       (e: RuntimeEvent) => boolean;          // FSM: detect
  classify:     (e: RuntimeEvent) => { steps: RecoveryStep[]; bound: number; escalateAfter: number };
  apply:        (steps: RecoveryStep[]) => Promise<void>; // FSM: apply, bounded by `bound`
  onExhaust:    EscalationPolicy;                      // FSM: escalate (not "kill")
}

// ProjectTrust — per-project-root trust gate; before trust only safe context loads.
type TrustLevel = "untrusted" | "trusted" | "privileged";  // gates auto-approve (§7)
interface ProjectTrust {
  root: string;                                        // absolute project-root path
  level: TrustLevel;                                   // persisted in trust.json
  defaultProjectTrust: "ask"|"always"|"never";         // first-run prompt (ask vs auto-assume)
  // Before trust: ONLY context-files + global `-e` extensions load (no dotenv, no auto-approve,
  //   no MCP auto-mount); trust promotion requires explicit operator action.
}
```
These elaborate the 1-line rows in the §14b completeness table (`Approval-Token ledger`, `RecoveryRecipe FSM`, `Project-trust`). Other rows (MCP 11-phase, LaneEvent, Readiness, maybeSpill) stay prose-only at the row level until their upstream types stabilize. *sources: [claw-code](../../claw-code/rust/crates/runtime/src/approval_tokens.rs) `approval_tokens.rs` · [claw-code](../../claw-code/rust/crates/runtime/src/recovery_recipes.rs) `recovery_recipes.rs` · [pi-coding-agent](../../pi-coding-agent/src/core/trust-manager.ts) `trust-manager.ts`.*

## 14b. Native Crash & Process Resilience

*(R27-12 — T3, GAP-1, GAP-11 — simplified by R30 sandbox-removal.)* Native code (Rust napi, third-party `.node`) runs **in-process** via napi. With the OS sandbox gone (R30), there is **no reason to isolate natives in a subprocess/sidecar** — they are trusted like any napi module, exactly as any dev tool trusts its native deps. **A native crash (segfault) kills the agent process — accepted** (same as any napi module / any dev tool). What remains here is cheap, in-process robustness (no process overhead), NOT containment.

- **No-abort invariant (#14):** every napi entry wraps its body in `std::panic::catch_unwind` and returns a typed `NativeResult<T> { Ok(_) | Panic(backtrace) }`. **napi natives MUST NOT `abort!`/`process::exit`** — panics propagate as typed errors, never process death. *(new invariant #14, [§18 Invariants](11-invariants-roadmap.md).)*
- **No subprocess/sidecar isolation (R30):** with the sandbox removed, trust-boundary natives (`shell` via `/bin/bash`, the search/fs/ast natives) run **in-process** — there is no longer a sandbox to crash, and no sidecar is warranted. The previous sidecar/subprocess isolation for `shell`/`sandbox` is **dropped**. A native segfault kills the process (accepted; see intro).
- **Third-party `.node` binaries:** a **sigstore signature + SHA-256 content-hash pinned in the release lockfile** MUST verify BEFORE `dlopen` (resolves [§23 Open Questions](11-invariants-roadmap.md) #6 as a **RELEASE-BLOCKER** for third-party `native`). `abiStamp`/`napiVersion` are **compatibility** guards, not security.
- **Prompt COW-immunity (#15):** the prompt struct is COW-immutable + serialized (invariant #15, [§5 Prompt](04-prompt-compression.md)/R27-23) so a native crash mid-turn never tears a reader-visible `SystemPrompt`.

**Completeness (R31)** — CORE security/observability features folded in from [FEATURE-INVENTORY](../../.learned/FEATURE-INVENTORY.md) Part 1:

| Feature | 1-line | Source |
|---|---|---|
| **Approval-Token ledger** | delegated-approval scopes w/ repository+branch, consume/verify/expiry, multi-hop chain — beyond a one-shot `ApprovalChannel` | [claw-code](../../claw-code/rust/crates/runtime/src/approval_tokens.rs) |
| **RecoveryRecipe FSM** | typed `FailureScenario`→`RecoveryStep`→`EscalationPolicy` recipe table (vs generic "bounded retry") | [claw-code](../../claw-code/rust/crates/runtime/src/recovery_recipes.rs) |
| **MCP hardened 11-phase lifecycle + McpErrorSurface** | typed phase FSM + per-phase error surface (configload→…→cleanup) | [claw-code](../../claw-code/rust/crates/runtime/src/mcp_lifecycle_hardened.rs) |
| **LaneEvent control-plane taxonomy** | named lane events + NudgeTracking + RoadmapId supersession + commit provenance (beyond `RuntimeEvent`) | [claw-code](../../claw-code/rust/crates/runtime/src/lane_events.rs) |
| **Project-trust (input-loading guard)** | `trust.json`; before trust only context-files + global `-e` extensions load; `defaultProjectTrust: ask\|always\|never` | [pi](../../pi-coding-agent/src/core/trust-manager.ts) |
| **Readiness 3-phase probe** | `/health/live` (liveness) vs `/ready` (readiness, 503+Retry-After) vs `/functional`; `DeferredInitState` | [MyAgents](../../MyAgents/src/server/readiness-state.ts) |
| **Large-value spill (maybeSpill)** | payload >256 KB → `~/.<app>/refs/<id>` + `LargeValueRef{preview,mimetype,ttl}`; SSE 3-tier priority | [MyAgents](../../MyAgents/src/server/utils/large-value-store.ts) |

---
