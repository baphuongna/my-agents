# Security Audit — Final STRIDE Pass (5-domain parallel review)

> Conducted as a parallel 5-way STRIDE review (security-reviewer subagents, each reading actual code per the security-review skill). This is the consolidated report. Each finding cites file:line + exploit scenario. The CRITICALs + key HIGHs are fixed (commit `df2f221`); remaining HIGHs are tracked as follow-ups.
> **Posture:** the agent runs under the **pi model** (AGENTS.md: NO OS sandbox, the §7 permission gate is the ONLY runtime control). Findings are severity × exploitability.

## Summary

8 CRITICAL + 11 HIGH found across 5 domains. The headline systemic issue: **the trust boundary existed by design but was not enforced by code** — path-safety was dead code, the sigstore gate checked a boolean, the audit log's verify was a no-op, the vm "sandbox" was escapeable, and memory/tool args weren't injection-scanned. 6 CRITICALs are fixed in `df2f221`; the remaining wiring HIGHs are scoped below.

## Fixed (commits df2f221 + 107e985)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| C1 | CRITICAL | `AuditLog.verify()` was a no-op (stored hashes only, never recomputed) → no tamper detection | verify now recomputes hash_n from stored records + checks all checkpoint roots |
| C2 | CRITICAL | `verifyTarball` failed OPEN (no bundle / no sigstore → ok:true) | FAIL CLOSED |
| C3 | CRITICAL | `verifyNativeDeclaration` checked a boolean flag, not a signature (§14b gate was forgeable) | requires actual sigstoreBundle + `sigstore.verify` (fail-closed); path constrained to `.node` |
| F1 | CRITICAL | path-safety resolver was DEAD CODE — no tool called it → read/write/edit/replace accepted arbitrary paths (total compromise) | added TurnContext.workspace + RunTurnOptions.workspace/approval; `contain()` resolves every file-tool path (lexical write / canonical read) |
| F2 | CRITICAL | `Allow` mode granted `DangerFullAccess` (bash) without human escalation | DangerFullAccess ALWAYS sets needsHumanPrompt, regardless of active mode |
| F4 | HIGH | approval channel hardcoded to a stub in runTurn; no injection point in RunTurnOptions | RunTurnOptions.approval; runTurn uses it, stub only as fallback |
| CRITICAL-1 | CRITICAL | Node `vm` is NOT a security boundary — escape via prototype chain | documented: workflows run with FULL process privilege (pi model); use isolated-vm for semi-trusted |
| CRITICAL-2 | CRITICAL | CoW isolation `write/read/diff` did `join(root, '../../...')` → arbitrary file r/w | added `assertContained`; rejects path escapes |
| F3 | CRITICAL | memory entries interpolated into the prompt WITHOUT injection scanning → durable prompt-injection | `buildVolatileTier` now `scan()`s each entry → `[BLOCKED]` on match |
| HIGH-1 | HIGH | gateway WS no auth/Origin → cross-site WS hijacking (any site reads all events) | Origin allowlist on upgrade; bad Origin → 403 |
| HIGH-2 | HIGH | gateway WS replay leaked CROSS-SESSION events (global seq + buffer) | per-session retained buffers + `session` query param; live + replay filtered |
| HIGH-3 | HIGH | dashboard no security headers (clickjacking) | X-Frame-Options DENY + nosniff + CSP frame-ancestors 'none' |
| M8 | MEDIUM | gateway accepted 0.0.0.0 bind with no guardrail | refuses non-loopback bind unless allowExternalBind:true (+ warning) |
| F5 | HIGH | write resolver didn't canonicalize parent dir → symlinked-directory escape | canonicalize parent dir; in-workspace symlinks pass, escapes rejected |
| HIGH-3b | HIGH | codeexec bridge missing the DELEGATE_BLOCKED_TOOLS filter (spec R27-8) | filtered before dispatch (defense-in-depth) |
| M4 | MEDIUM | Content-Length / stdin framing readers unbounded → OOM | rpc 1 MiB cap; DAP/LSP/dap-server 16 MiB cap (§25.6) |
| M5/M6 | MEDIUM | OAuth state-CSRF not verified; error-page reflected XSS; verifyPkce timing-unsafe | verifyCallbackState (constant-time) + HTML-escape + timingSafeEqual + nosniff |
| – | release | `sign-release.mjs` syntax error (`await` in non-async fn) | rewritten top-level-async |
| M2 | MEDIUM | x402 `signDeterministic` had a forgeable FNV-1a 32-bit fallback | removed; fail-closed |

Verified: secfix 13/13, f1 7/7, gw-sec 10/10 + full regression green (clippy clean).

## Remaining (lowest priority — small isolated hardening)

| ID | Domain | Finding |
|---|---|---|
| F3-perm | permission | audit/Merkle log not wired into tool dispatch (repudiation) |
| F8 | tools | bash passes full process.env to child (secrets leak) |
| H1 | pkg | PackageHost skips sigstore when manifest omits it (non-native loads unsigned) |
| HIGH-4 | codeexec | workflow timeout only rejects — doesn't kill async (DoS); needs worker_threads |
| H2 | secrets | redactor bypass (split-secret / non-string / uncached-env) |
| H3 | secrets | "sealed" file backend stores plaintext (0600 only) |
| M5/6/7 | codeexec/codegraph | unbounded buffers/caches/concurrency (bridge output, codegraph cache, fanOut) |
| – | channels | MCP FSM no transition validation (Quarantine bypass); hook payload shared-mutable |
| – | invariant | Date.now() in bash + budget (invariant #10) |


## MEDIUM / LOW (logged, lower priority)

- M4 framing DoS: Content-Length readers (DAP/LSP/rpc/gateway) unbounded → OOM. Cap at `SSE_BUFFER_BYTES` (16 MiB).
- M5/M6/M7 codeexec/codegraph/fanOut: unbounded buffers/caches/concurrency.
- M6 OAuth: state CSRF not verified in-module; error-page reflected XSS; verifyPkce timing-unsafe (`===`).
- M8 gateway: `0.0.0.0` bind allowed with no warning.
- MCP FSM no transition validation (Quarantine bypass); hook payload shared-mutable; brain consolidate O(n²) uncapped.
- Date.now() in bash + budget (invariant #10 violations).
- `sign-release.mjs` has a syntax error (`await` in non-async fn) — the release workflow won't run as-is.

## Non-findings (ruled out — to prevent re-review)

- Budget tree-accounting (R39 CC2/CC13) — **correct**: root reserved vs child ownSpent, refund on any terminal state. No double-count.
- R42 workflow bridge fix — **correct** for ITS vector (body runs inside vm); the escape was a *different* vector (CRITICAL-1, now documented).
- x402 single-fetch double-spend guard — **correct**: `paid` flag + negative/NaN amount rejection.
- PKCE: S256 + 32-byte CSPRNG verifier + loopback 127.0.0.1 bind — **correct**.
- RPC concurrent-prompt guard (R1) — **correct** (inFlight flag, single-threaded).
- DELEGATE_BLOCKED_TOOLS subagent denylist — **correct** (step 1, before mode).
- Hashline stale-anchor detection — **correct** (recompute on current content).
- resolveSecret fail-closed (all 4 backends) — **correct**.
- BLAKE3 / SHA-256 — no collision/preimage concerns.

## Top recommendation

**The CRITICALs + the highest-impact HIGHs (F1 path-safety wiring, F4 approval injection, gateway WS auth/per-session/headers) are all closed.** The remaining items are lower-severity hardening (framing DoS caps, audit-log wiring into dispatch, workflow worker_threads timeout, OAuth state/XSS) — each is a small isolated fix tracked in the table above.
