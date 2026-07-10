# SPEC-CHANGE — npm distribution + remove sandbox (pi model)

> User directive: "cài qua npm được không, bỏ sandbox đi — cần hoạt động thoải mái giống pi, thêm gate nếu cần thôi." Two changes: (1) npm-installable distribution; (2) drop OS-level sandboxing — operate freely like pi (shell to `/bin/bash`, packages in-process, trust the user's environment), keeping ONLY the permission gate (§7 ask/approval) as the control. This is a SIMPLIFICATION that removes much of the R27 security/resilience machinery. Apply across `source/.learned/spec/`. State the risk tradeoff honestly (accepted for a personal coding agent).

## Design decision (state explicitly in 00-OVERVIEW tenets)
The agent is a **personal coding/automation agent that runs in the user's own workspace with the user's own privileges** — like `pi`, Claude Code, or any dev tool. It does NOT contain or sandbox itself. The user's machine is the trust boundary. **The permission gate (§7: ReadOnly/WorkspaceWrite/DangerFullAccess/Prompt/Allow + deny/ask rules + approval channel) is the sole runtime control.** Accepted risk: a malicious agent or package can affect the host exactly like any npm-installed dev tool can; the user accepts this (it's the same trust as `npm install -g <anything>`).

## CHANGE 1 — npm distribution (add)
In `00-OVERVIEW.md` (and a line in `11-invariants-roadmap.md` §21 deployment):
- "**Distribution:** the agent ships as an **npm package** (`npm install -g <agent>` or `npx <agent>`). Rust natives ship as **prebuilt napi binaries** via npm `optionalDependencies` (one per {os,arch}, like `@napi-rs/*`) — no Rust toolchain required to install. The TS core + packages resolve from npm."
- Update §3 architecture note: the install story is npm-first (matches the TS-primary stack + pi's distribution).

## CHANGE 2 — remove the OS sandbox (drop, don't reframe-as-lighter)
### 00-OVERVIEW.md — tenet #8
Rewrite from "Security as architecture (sandbox…)" → **"Trust-the-environment + permission gate (pi model). The agent runs in the user's workspace with their privileges; there is NO OS-level sandbox/containment. Dangerous operations are controlled by the §7 permission gate (ask/approval), not by containment. Accepted risk: host exposure like any dev tool."** Drop the "sandboxed in-process shell, content-addressed edits, byte-stable signing" list from the tenet (content-addressed edits stay as an edit-correctness feature, not security).

### 03-tools-permission.md (§7)
- The shell = **the user's shell (`/bin/bash` / `$SHELL`), directly** (like pi) — NOT a vendored brush sandbox. Replace "Sandboxed in-process shell (vendored brush + uutils) instead of shelling to /bin/bash" → "**Shell tool: executes via the user's shell (`/bin/bash -c` / `$SHELL`), directly. No sandboxing. The §7 permission gate governs whether a command runs (mode + deny/ask rules + approval).**"
- Note: vendored `brush`/`uutils` are **dropped from the default** (they were a security measure; no longer needed). Mention as an OPTIONAL future perf/Windows-parity optimization behind a flag, NOT security.
- hashline (content-addressed edits) STAYS — it's an edit-correctness feature (prevents stale-buffer clobbering), not a security sandbox.

### 08-observability-security.md — §14 Security (rewrite the posture)
Drop these (they were the sandbox machinery):
- "Sandbox enforcers in Rust (seccomp/seatbelt/AppContainer)"
- "Sandbox escape prevention: env allow-list + cwd locked to workspace root + path validator + capability drop"
- The whole "even a panic can't reach the host FS" claim
KEEP (these are not containment, they're detection/audit/approval):
- Prompt-injection scan (defense-in-depth, not a boundary)
- Per-surface Merkle audit log (all tools + approval + repair + channel receipts)
- Secrets redaction (Pre-tool hook)
- Rate-limiting / abuse (per-identity budgets, MAX_CONCURRENT_SUBAGENTS)
- Subagent isolation: DELEGATE_BLOCKED_TOOLS + explicit ApprovalChannel + budget tree-accounting (these are POLICY controls, not OS containment)
Add a prominent "**No containment (pi model)**" note at the top of §14 stating the trust boundary is the user's machine; the §7 gate + audit are the controls.

### 08-observability-security.md — §14b Native Crash & Process Resilience (simplify)
DROP "trust-boundary natives (shell, sandbox) run in a subprocess/sidecar with auto-restart" — natives run **in-process** via napi (no sandbox ⇒ no reason to isolate). A native crash (segfault) kills the agent process — **accepted** (same as any napi module / any dev tool). KEEP invariant #14 ("napi natives MUST NOT `abort!`/`process::exit`; panics propagate as typed `NativeResult` via `catch_unwind`") as **best-effort** (cheap, no process overhead) — but drop the "subprocess isolation" enforcement claim.

### 10-packages.md — §17 Extension Model (simplify isolation)
DROP the `moduleIsolation` tiers (`in-process` / `worker` / `isolated-vm`) and the runtime module-load allowlist + sigstore-for-in-process complexity. Replace with: "**Packages run IN-PROCESS** (loaded via jiti, like pi extensions). They are **trusted code** — the same trust as any npm dependency you install. The static lint banning `node:fs`/`net`/`child_process` in package code is **advisory best-practice, not a boundary** (and is bypassable; we don't pretend otherwise)." 
- KEEP: 4 extension kinds (Extensions/Skills/Prompt-Templates/Themes), `PackageManifest` (apiVersion, provides), `--ignore-scripts` at install (still good hygiene), supply-chain age-gate + `npm ci` (still good).
- Third-party napi packages: keep deny-by-default + sigstore **as a release-blocker** (loading a `.node` is still arbitrary native code — that gate stays; it's orthogonal to dropping the sandbox).

### 01-core-loop.md / 11-invariants-roadmap.md — §18 invariants
- **Invariant #9** (was "Never shell to /bin/bash — use the sandboxed in-process Rust shell"): **INVERT/REPLACE** → "The agent executes shell commands via the user's shell directly (`/bin/bash`/`$SHELL`); there is **no sandbox/containment**. The §7 permission gate (mode + deny/ask rules + approval) is the sole control over whether a command runs. *[ENFORCED: the shell tool has no sandboxing code path; permission decision is the only gate.]*"
- **Invariant #14** (napi no-abort): keep, soften to best-effort (drop "subprocess isolation" from the enforcer).
- Remove any invariant whose sole purpose was sandbox enforcement (none others — the rest are about cache/prompt/approval, which stay).

### 11-invariants-roadmap.md — §20 Tier 0 (simplify)
- Tier 0 bullet "Rust natives napi package: search (glob/grep), fs, ast, edit-hash, **sandboxed shell (vendored brush)**" → "Rust natives napi package: search (glob/grep), fs, ast, edit-hash. **Shell = the user's `/bin/bash` (no vendoring, no sandbox — pi model).**" (Drops the huge brush/uutils vendoring effort — was R26 BB-5.)
- DROP the `crates/sandbox/` crate from the §3 workspace map (08/00). The Rust crates are now: `natives` (search/fs/ast/edit-hash/crypto) + `compress`. (shell via `/bin/bash`, sandbox gone.)
- §23 open question #7 (shell vendoring spike): mark "**RESOLVED by the pi-model decision: shell = `/bin/bash`; vendoring brush/uutils is deferred/optional (perf/Windows-parity only, not Tier 0).**"

## Net effect (state in 00-OVERVIEW or REVIEW-LOG)
- **Simpler + leaner**: removes seccomp/sidecar/isolation-tiers/vendored-brush-as-security + the R27 security/resilience complexity they caused.
- **npm-installable** (TS-primary, prebuilt napi).
- **pi-like UX**: runs free in the user's workspace; permission gate + audit are the controls.
- **Honest risk**: host exposure like any dev tool — accepted for a personal agent.

## NOT changed (keep)
- Permission gate §7 (7-step, MODE_RANK, approval) — this IS the "gate if needed" the user wants.
- hashline content-addressed edits (correctness, not security).
- Merkle audit, injection scan (defense-in-depth), secrets redaction, budget, subagent policy isolation.
- All R24-R29 fixes unrelated to sandbox.
