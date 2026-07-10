# Tool System & Permissions

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §7.



## 7. Tool System

- **Self-registering tool registry** with AST/import discovery + `check_fn`/`is_available(config)` gate so absent tools cost nothing at schema-emission. *(source: [hermes](../../hermes-agent/) [`tools/registry.py`](../../hermes-agent/tools/registry.py).)*
- **5-mode permission model** *(source: [claw-code](../../claw-code/) [`permissions.rs`](../../claw-code/rust/crates/runtime/src/permissions.rs))*: `ReadOnly | WorkspaceWrite | DangerFullAccess | Prompt | Allow`, layered with per-tool requirements + allow/deny/ask rule lists + hook overrides + an **unconditional `denied_tools` list checked first** (production creds always denied, even in danger mode).
  - **SSOT rule:** `allowed_users`/`denied_tools` resolved on demand via `Arc<RwLock<Config>>` closure — **never cached in tool/channel handles**. *(source: [hermes](../../hermes-agent/) bug class + AGENTS.md.)*
  - **Permission evaluation order (round 24 — VERIFIED against claw-code `permissions.rs::authorize_with_context`):** first-match-wins, top-down:
    1. **`denied_tools`** (config-level, unconditional — prod creds never run, even in DangerFullAccess)
    2. **deny rules** (pattern-match tool + arg-subject)
    3. **hook override** (`PermissionContext.override`): `Deny`→deny · `Ask`→prompt · `Allow`→falls through **but still respects ask rules** (see invariant #13)
    4. **ask rules** → prompt via `ApprovalChannel` (explicit handle, never parent stdin) — **inviolable**
    5. **allow/mode**: an allow-rule matches, OR (`active_mode is Allow` AND `required_mode !== "DangerFullAccess"`), OR (`active_mode ≥ tool.required_mode` AND `required_mode !== "DangerFullAccess"`) → allow. **(R27-2/D8: `DangerFullAccess` is EXCLUDED from BOTH the `Allow` special-case AND the rank comparison — it ALWAYS escalates to a step-6 prompt. `Allow` = "auto-allow up to WorkspaceWrite; Danger always prompts" — closes the privilege-escalation hole.)**
    6. **escalation prompt**: `Prompt` mode, or a `WorkspaceWrite→DangerFullAccess` gap, or `required_mode === "DangerFullAccess"` (always, even in `Allow`) → prompt. **(R27-2/D9: `Prompt` mode = "prompt for writes only; ReadOnly auto-allowed".)**
    7. else **deny**
    Result: `PermissionOutcome = Allow | Deny { reason }` (NOT `Ask`/`Mutate` — a prompt resolves to Allow/Deny; input-mutation is a separate hook concern). Rule grammar: `tool(subject:*)` (prefix) / `tool(exact)`; arg-subject extracted from JSON keys `command|path|file_path|filePath|notebook_path|notebookPath|url|pattern|code|message` (**10 keys**). All tool/rule names normalized to lowercase. *(source: [claw-code](../../claw-code/) [`permissions.rs`](../../claw-code/rust/crates/runtime/src/permissions.rs), round 24 deep-read.)*
     **CC7/R28 (hook ordering):** hooks in the pipeline are AWAITED before the next step evaluates — async hook results (e.g. a Pre-hook that sets `override` or redacts args) are fully applied before the ask-rule match (step 4) reads them, so a pending hook can never be skipped by a racing rule decision.
  - **Concurrent-approval serialization (R26-D):** tools requiring approval (an `ask` rule matches, or hook `Ask`) execute **SEQUENTIALLY** — pulled OUT of the [§4 Core Loop](01-core-loop.md) `Promise.all` batch; each emits `AwaitingApproval` and blocks until `ApprovalChannel.request()` resolves. Non-approval tools run in parallel. A `Deny` does not cancel sibling pending calls (each tool decides independently).
- **Bash validation = composable pure functions** over argv: each guard returns `Allow | Block{reason} | Warn{msg}`; policy composes them. `CommandIntent` classifier (ReadOnly/Write/Destructive/Network/ProcessMgmt/...). *(source: [claw-code](../../claw-code/) [`bash_validation.rs`](../../claw-code/rust/crates/runtime/src/bash_validation.rs) 6 submodules.)*
- **Shell tool: executes via the user's shell** (`/bin/bash -c` / `$SHELL`), directly — **no sandboxing** (pi model). The [§7](03-tools-permission.md) 7-step permission pipeline (mode + deny/ask rules + approval) governs whether a command runs; it is the sole control. *(source: [pi](../../pi-coding-agent/).)* A vendored Rust shell (`brush`+`uutils`) is an OPTIONAL future perf/Windows-parity optimization behind a flag — explicitly NOT a security measure. hashline (content-addressed edits, below) is an edit-correctness feature, not a sandbox.
- **Pre/Post/Failure hooks** with the input-mutation + abort-signal + permission-override triad (e.g., "auto-redact secrets in `Write` inputs"). *(source: [claw-code](../../claw-code/) [`hooks.rs`](../../claw-code/rust/crates/runtime/src/hooks.rs).)*
- **Content-addressed edits (hashline):** TWO complementary models, both sourced:
  - **Per-line perfect-hash anchors (pi-hashline-edit-pro):** every line gets a UNIQUE 3-char content hash (URL-safe base64, 64-char alphabet = 18 bits) with **collision resolution** (`:R{retry}` salt) so byte-identical lines get DIFFERENT anchors. `read` returns `HASH│content` lines; `replace` references an inclusive hash RANGE `[startHash, endHash]`. **Stale detection** = recompute hashes on the CURRENT file content; a provided anchor not in the current hashes → `E_STALE_ANCHOR` (reject + tell the agent to re-read). Hash algo: FNV-1a 32-bit (deterministic, zero-dep); the pi source uses xxh32 — the uniqueness-via-retry is the correctness property, not the algo. *(source: [pi-hashline-edit-pro](../../pi-hashline-edit-pro/) (fork of RimuruW/pi-hashline-edit; 3-char + perfect hashing vs upstream's 2-char/256-bucket).)*
  - **Whole-file version tag (oh-my-pi):** BLAKE3 first-16-hex content tag for file-version binding + the patcher ALWAYS verifies `snapshot.text === liveContent` (full-text equality) before applying — an accidental-drift guard. *(source: [oh-my-pi](../../oh-my-pi/) [`hashline`](../../oh-my-pi/packages/hashline/).)*
  - **(R27-13/T4: the whole-file tag replaces the old xxHash32/4-hex.) Against an adversary hashline relies on the full-text equality gate, not the tag — it is an edit-correctness + accidental-drift feature, not a sandbox.** A stale anchor/tag rejects the edit → concurrent agents can't silently clobber divergent buffers.

**Completeness (R31)** — CORE tool-system features folded in from [FEATURE-INVENTORY](../../.learned/FEATURE-INVENTORY.md) Part 1:

| Feature | 1-line | Source |
|---|---|---|
| **Path-safety resolver (lexical vs canonical)** | `resolve_inside_workspace` (write — lexical) vs `resolve_existing_inside_workspace` (read — canonicalize + symlink-escape block): real path-traversal defense | [MyAgents](../../MyAgents/src-tauri/src/workspace_files/path_safety.rs) |
| **BashOperations delegation hook** | pluggable shell backend; a `user_bash` event can supply custom ops/result (custom shell provider) | [pi](../../pi-coding-agent/src/core/tools/bash.ts) · [claw-code](../../claw-code/) |
| **File-mutation queue** | serialize write/edit (`withFileMutationQueue`); per-tool `details.diff`+`details.patch`; `fullOutputPath` for large output | [pi](../../pi-coding-agent/src/core/tools/file-mutation-queue.ts) |
| **Settings merge (project-overrides-global) + lockfile** | global + project nested merge (project wins); `proper-lockfile` atomic writes; claw-code does a 5-file layered merge | [pi](../../pi-coding-agent/src/core/settings-manager.ts) · [claw-code config.rs](../../claw-code/rust/crates/runtime/src/config.rs) |

---
