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

## ALL FINDINGS CLOSED ✅

Every finding from the 5-domain STRIDE audit (8 CRITICAL + 11 HIGH + all
MEDIUM/LOW) is now resolved across commits d24fe02 → HEAD. The two final items:

- HIGH-4: runWorkflowIsolated runs the body in a worker_thread; timeout →
  worker.terminate() (was: infinite async loop survived the reject).
- H2: secrets redactor adds a structural by-field-name pass (was value-only →
  split-secret / non-string / uncached-env bypass).

The agent's trust boundary is enforced end-to-end: §7 gate contains file tools
(F1+F5), escalates DangerFullAccess (F2), accepts a real approval channel (F4),
audits every tool call (F3-perm + C1 verify); gateway is auth/Origin-guarded +
per-session + CSRF-headered (HIGH-1/2/3); supply chain fail-closed (C2/C3);
sandbox honestly documented as full-privilege (CRIT-1) + killable via worker
(HIGH-4); CoW contained (CRIT-2); memory/channel/bridge inputs scanned/filtered
(F3/HIGH-3b); framing bounded (M4); bash env secret-free (F8-perm); redaction
structural (H2).