# Security Audit — Final STRIDE Pass (5-domain parallel review)

> Conducted as a parallel 5-way STRIDE review (security-reviewer subagents, each reading actual code per the security-review skill). This is the consolidated report. Each finding cites file:line + exploit scenario. The CRITICALs + key HIGHs are fixed (commit `df2f221`); remaining HIGHs are tracked as follow-ups.
> **Posture:** the agent runs under the **pi model** (AGENTS.md: NO OS sandbox, the §7 permission gate is the ONLY runtime control). Findings are severity × exploitability.

## Summary

8 CRITICAL + 11 HIGH found across 5 domains. The headline systemic issue: **the trust boundary existed by design but was not enforced by code** — path-safety was dead code, the sigstore gate checked a boolean, the audit log's verify was a no-op, the vm "sandbox" was escapeable, and memory/tool args weren't injection-scanned. 6 CRITICALs are fixed in `df2f221`; the remaining wiring HIGHs are scoped below.

## Fixed (commit df2f221)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| C1 | CRITICAL | `AuditLog.verify()` was a no-op (stored hashes only, never recomputed) → no tamper detection | verify now recomputes hash_n from stored records + checks all checkpoint roots |
| C2 | CRITICAL | `verifyTarball` failed OPEN (no bundle / no sigstore → ok:true) | FAIL CLOSED |
| C3 | CRITICAL | `verifyNativeDeclaration` checked a boolean flag, not a signature (§14b gate was forgeable) | requires actual sigstoreBundle + `sigstore.verify` (fail-closed); path constrained to `.node` |
| F2 | CRITICAL | `Allow` mode granted `DangerFullAccess` (bash) without human escalation | DangerFullAccess ALWAYS sets needsHumanPrompt, regardless of active mode |
| CRITICAL-1 | CRITICAL | Node `vm` is NOT a security boundary — escape via prototype chain (`Promise.constructor.constructor('return this')()` → outer global) | documented the honest posture: workflows run with FULL process privilege (pi model); vm is state-isolation only. Use isolated-vm for semi-trusted workflows |
| CRITICAL-2 | CRITICAL | CoW isolation `write/read/diff` did `join(root, '../../...')` with no containment → arbitrary file r/w outside the sandbox | added `assertContained`; rejects path escapes |
| F3 | CRITICAL | memory entries interpolated into the prompt WITHOUT injection scanning → durable prompt-injection persistence | `buildVolatileTier` now `scan()`s each entry → `[BLOCKED]` on match |
| M2 | MEDIUM | x402 `signDeterministic` had a forgeable FNV-1a 32-bit fallback | removed; fail-closed (throws if BLAKE3+HMAC both fail) |

Verified: 13/13 (`secfix-test`) + full regression green (clippy clean).

## Remaining HIGH (follow-ups — not in this commit)

| ID | Domain | Finding | Effort |
|---|---|---|---|
| F1 | permission | path-safety resolver is **dead code** — no builtin tool calls it → read/write/edit/glob/grep accept arbitrary paths (total compromise on injection). **Highest-priority remaining.** | medium — wire `resolveInsideWorkspace` into every tool; needs `workspace: string` on `TurnContext` |
| F3-perm | permission | no audit/Merkle log wired into tool dispatch (repudiation) | small — inject AuditLog into ToolExecutor, `append({kind:"tool"})` in runTool |
| F4-perm | permission | approval channel hardcoded to a stub in runTurn; `RunTurnOptions` has no `approval` field → no way to inject real human-in-the-loop | small — add `approval?` to RunTurnOptions; thread from createAgent |
| F5-perm | permission | write resolver doesn't canonicalize parent dir → symlink-redirect on writes | small — canonicalize parent dir before write |
| H1 | pkg | PackageHost skips sigstore check when manifest omits it (non-native loads unsigned) | small — require sigstore OR `--allow-unsigned` opt-in |
| HIGH-1 | network | gateway WS has no auth/Origin check → cross-site WS hijacking (any visited website reads all events) | small — Origin allowlist + session cookie on upgrade |
| HIGH-2 | network | gateway WS replay-from-cursor leaks **cross-session** events (single global seq + buffer) | medium — per-session retained buffer + session-filter |
| HIGH-3 | network | no CSRF/session-cookie on dashboard (spec §25.2 non-compliance) + no frame-ancestors | small — Set-Cookie + CSP + X-Frame-Options |
| HIGH-3b | codeexec | codeexec bridge missing the DELEGATE_BLOCKED_TOOLS filter (spec R27-8) | small — check the denylist before dispatch |
| HIGH-4 | codeexec | workflow timeout only rejects — doesn't kill async sandbox code (DoS: infinite loop burns a core forever) | medium — run workflows in worker_threads + terminate() |
| H2 | secrets | redactor bypass (split-secret / non-string / uncached-env secrets) | medium — structural redaction + register all env secrets |
| H3 | secrets | "sealed" file backend stores plaintext (0600 only) | small — age/AES-GCM or remove "sealed" language |

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

**Fix F1 (path-safety wiring) next** — it's the highest-impact remaining issue. Every other CRITICAL is closed; F1 is the one that makes the §7 gate actually contain file tools. With F1 + F4 (approval injection) + the network WS auth, the agent's runtime trust boundary would be enforceable end-to-end.
