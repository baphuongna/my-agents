# mya Tools — Cross-System Comparison

> Comparative study of mya's tool layer against **20+ agent harnesses**: Claude Code, Cursor, Devin, opencode (proprietary, via leaked prompts); claw-code, openclaw, pi-coding-agent, mya-v1 (open-source coding agents); pi-hashline-edit-pro, pi-computer-use, graphify, ctx, context-mode, hypa, rtk, fff, ponytail (specialized tool projects); hermes-agent, headroom, openhuman, OpenViking, MyAgents (agentic systems); oh-my-pi, openpi, pi-dynamic-workflows, pi-mobile, pi-soly, pi-lens, pi-vcc, pi-session-manager (pi ecosystem).
>
> Method: 5 parallel read-only explorer agents (each read mya's `packages/tools/src/` + their assigned sources, cited file:line). All claims cited; the actionable BUG section (§6) is verified against current code.
>
> Status: reference doc. Last updated post-memory-redesign + embeddings work.

---

## 0. TL;DR

**mya is the outlier in two directions at once:**

- **🟢 Ahead** — hashline-edit (unique vs *all* proprietary leaders), code-intelligence stack (codegraph + LSP cascade + tree-sitter symbols — Claude Code notably has **none**), typed tool-call repair, a 7-step permission pipeline with `DELEGATE_BLOCKED`, Composio (250+ integrations), x402 micropayments, a bidirectional code-exec bridge.
- **🟡 Gaps to close** — no `Workflow` orchestrator (CC/Cursor/pi-dynamic-workflows have one), no `SemanticSearch` (Cursor), no typed `subagent_type` enum, weak tool-call repair (openclaw's is far richer), and **3 regressions vs mya-v1** (dropped sub-agent CLIs, `web_search`/`web_fetch`, whitespace diagnostic).
- **🔴 Bugs found in *current* code** (§6) — `bash` is internally contradictory (never escalates), MCP has a real FSM transition bug + discards schemas, the production LSP cascade is a no-op, `hashline_edit` + `glob`/`grep` bypass path containment, Composio registration races the prompt snapshot.

The single highest-ROI theme across every system: **mya already has the primitives (Rust napi `reflink_or_copy`, `mapStableHashes`, `codegraph`) but has not wired several of them through the runtime surface.** Wiring > new code.

---

## 1. mya tool baseline

Source of truth: `packages/tools/src/` + `crates/natives/` + `packages/print/src/mya-bridge.ts`.

### 1.1 Two distinct tool surfaces (important)

mya exposes tools through **two separate surfaces** with different defaults, permission paths, and edit formats:

| Surface | Default tools | Permission path | Edit format |
|---|---|---|---|
| **Core `createAgent()`** (`packages/agent/src/index.ts:278-311`) | 18 `@my-agent/tools` built-ins (`builtin.ts:471-489`) | core 7-step pipeline | `edit` (exact) + `replace` (3-char hashline) |
| **Interactive pi bridge** (`packages/print/src/mya-bridge.ts`) | 7 coding-agent tools + MYA bridge tools + extensions + MCP | pi dispatch | `hashline_edit` (4-char SHA-256) |

This split is the root cause of several inconsistencies in §6.

### 1.2 Inventory by category (core surface)

| Category | Tools | File:line |
|---|---|---|
| **File ops** | `read`, `write`, `ls`, `find` | `builtin.ts:51,89,359,407` |
| **Code edit** | `edit` (exact-text), `replace` (3-char hashline range) | `builtin.ts:116,313` |
| **Search** | `glob`, `grep` (TS facade → Rust napi `nativeGlob`/`nativeGrep` w/ JS fallback) | `builtin.ts:209,252`; `crates/natives/src/lib.rs:91,190` |
| **Code intel** | `codegraph` (file-relevance import graph), LSP-on-write hook, `lsp-cascade` (BFS depth-2 diagnostic impact) | `codegraph.ts:137`; `lsp-cascade.ts:75` |
| **Browser/CDP** | `browser_navigate/click/type/screenshot/extract/eval/close` + `screen_capture/screen_find` (OCR) | `browser.ts:19-110`; `screen.ts:137-224` |
| **Code exec** | `code` (JS/Python shim, bidirectional JSON bridge, 50-call cap) | `codeexec.ts:24-157` |
| **External** | `composio_<slug>` (250+ integrations, `Prompt` mode), `paid_fetch` (x402), `mcp_<server>_<tool>` | `composio.ts:117`; `mya-bridge.ts:1197` |
| **Meta/delegation** | `delegate_task` (bounded-depth subagent), `skill-search`, `recall`/`remember` (memory) | `mya-bridge.ts:1151,540,872,909` |

**Not in default surface (require explicit wiring):** `code` (`codeexec.ts`), `codegraph` (`codegraph.ts:155`), `debug` (DAP, gated on `dapConnect`), `paid_fetch` (gated on wallet), full LSP/symbol/reference-graph APIs (programmatic only). See §6 #4–#5.

### 1.3 Edit model — three mechanisms

1. **`write`** — full-file rewrite (`builtin.ts:89`).
2. **`edit`** — unique exact-text search/replace; refuses if `oldText` occurs >1 time or is absent (`builtin.ts:116-153`). **Does NOT enforce a prior `read`** (unlike Claude Code).
3. **`replace`** — hash-anchored inclusive-range replace via 3-char FNV anchors; `read({hashed:true})` renders `HASH│content` with `:R<n>` salt for collisions (`builtin.ts:313`; `hashline.ts:1-152`).
4. **`hashline_edit`** (bridge-only) — 4-char SHA-256 anchors, multi-edit, overlap/no-op dedup, stable-hash preservation (`hashline-edit.ts:32-501`; `mya-bridge.ts:1010`).

> ⚠️ **Two incompatible hashline wire formats coexist** (3-char FNV in core `replace`; 4-char SHA-256 in bridge `hashline_edit`). See §6 #7.

### 1.4 Permission / safety model

- **5 modes**: `ReadOnly | WorkspaceWrite | DangerFullAccess | Prompt | Allow` (`packages/core/src/types.ts:102-116`).
- **7-step pipeline** (`permission.ts:105-169`): unconditional-deny → deny-rules → pre-hook-override → inviolable ask-rules → allow/mode → escalation-prompt → deny.
- **Rule grammar**: `tool`, `tool(subject)` exact, `tool(subject:*)` prefix; first-string extracted from 10 arg keys (`command`/`path`/`url`/`pattern`/`code`/…) (`permission.ts:34-90`).
- **`DangerFullAccess`** always prompts a human even under `Allow` mode or with an allow rule (`permission.ts:141-169`).
- **`DELEGATE_BLOCKED_TOOLS`** unconditionally denies `{task, delegate, codeexecbridge, spawn, exec, bash}` for subagents (`packages/core/src/types.ts:397-405`).
- **Path safety**: `contain()` for read/write/edit/replace/ls/find. Read resolver realpaths target+workspace; write resolver realpaths the parent dir (symlink-dir escape blocked) but **not the final file component** (`path-safety.ts:31-96`).
- **Sandbox posture**: `bash` runs `/bin/bash -c` with **no sandbox** (permission gate is the only control; secret-env stripped pre-spawn). `code` spawns Node/Python directly. Extension packages are trusted in-process (`packages/pkg/src/index.ts`).
- `permission7.test.ts` = spec §7 regression test (NOT a 7th permission impl).

### 1.5 Tool-call format + repair

- Structured `{id, name, args}`; JSON Schema → OpenAI `type:"function"` (`packages/core/src/types.ts:54-60`; `agent/index.ts:730`).
- Provider adapters receive `tool_calls[].function.arguments` as JSON string → `JSON.parse`, malformed left as string for repair (`openai.ts:199-218`).
- **`repair()`** is **Tier-1 only**: parses JSON-string args, `{}`-ifies blank/null, rejects missing names. **Does NOT** repair trailing commas, partial JSON, misspelled names, or schema violations (full AJV validation marked "later") (`repair.ts:1-38`).

### 1.6 Code intelligence (mya's biggest differentiator)

- `buildCodegraph`: scans ≤50k TS/JS/Py/Rust files, builds forward-import + reverse-importer maps, 64-root cache (`codegraph.ts:26-111`).
- TS/JS symbols via **Rust tree-sitter** (`parse_ts_symbols`) with JS regex fallback; Rust/Py/Go are regex-MVP extractors (`symbol-extractor.ts`; `crates/natives/src/lib.rs:347-416`).
- `GraphStore`: in-memory symbol+reference index (by ID / lowercased name / file / ref). JSON snapshot round-trip only (no on-disk DB) (`graph-store.ts`).
- `LspClient`: Content-Length-framed JSON-RPC; initialize/didOpen/didChange/hover/definition/references/diagnostics (`lsp-client.ts:61-203`).
- `lsp-cascade`: BFS depth-2 reverse-import impact → parallel `didOpen`/`didChange` → diagnostics (`lsp-cascade.ts:75-187`).
- `SearchIndex`: native glob + filename bigram prefilter + subsequence fuzzy + frecency ranking — **service, not a model tool** (`search-index.ts`).

> ⚠️ **Production LSP cascade is currently a no-op** — the interactive bridge constructs an adapter whose `diagnostics()` always returns `[]` (`mya-bridge.ts:1459-1478`). See §6 #6.

### 1.7 MCP / extension / scripting

- `ToolRegistry.register` (any `ToolImpl`, rejects dup names, one-hop aliases) (`registry.ts:18-49`).
- Composio: remote tool list → registry as `composio_<slug>` with remote param schema, `Prompt` mode (`composio.ts:117-157`).
- MCP: stdio child-process, JSON-RPC 2.0, `initialize`/`tools/list`/`tools/call`; bridge registers as `mcp_<server>_<tool>` (`gateway/src/mcp-client.ts`; `mya-bridge.ts:1197-1224`).
- **Scripting**: Rhai engine via napi (`crates/natives/src/rhai.rs`) — I/O-free by default, `log`+`emit_event`, expression/call/string/array/map limits. Also `packages/workflows/src/rhai-runner.ts` + `runner.ts` (node:vm, *not* a security boundary).

---

## 2. Where mya LEADS (genuine differentiators)

These are capabilities that the proprietary leaders and most OSS systems **do not have**:

1. **Hashline-edit model** — uniquely robust stale/ambiguous-anchor detection (`hashline-edit.ts:164-501`). CC/Cursor/Devin/opencode all use exact-string edit. pi-hashline-edit-pro (mya's ancestor) has *more* here (§4.1), but mya is already ahead of every shipped competitor.
2. **Code-intelligence stack** — `codegraph` + `lsp-cascade` + **Rust tree-sitter symbols** + LSP-on-write. Claude Code's prompt *explicitly* directs to `find`/`grep` (`claude-code-opus-4.6.md:119`) — it has **zero** LSP/graph. Cursor's `SemanticSearch` is the one thing it has that mya doesn't (§4).
3. **Typed tool-call repair** — deterministic `{ok|unrepairable}` return (`repair.ts`). CC relies on SDK validation; Cursor/Devin/opencode use model-native.
4. **Permission gate rigor** — 7-step pipeline + `DangerFullAccess` auto-escalation + `DELEGATE_BLOCKED` + hook-override triad. claw-code is at parity; CC's per-tool rule grammar is simpler.
5. **Composio (250+ integrations)** + **x402 micropayments** (`paid_fetch`).
6. **Bidirectional code-exec bridge** — `code` tool's child can call back into the agent's own tools (`codeexec.ts:128-157`). oh-my-pi has this; proprietary leaders don't.
7. **Rust napi hot loops** — `nativeGlob`/`nativeGrep`/`parse_ts_symbols`/`hash_content`/`compress_log`/`reflink_or_copy` (`crates/natives/src/lib.rs`). Deterministic + cross-platform; pi-coding-agent (the parent) has none.

---

## 3. Comparison matrix (dimension × system)

| Dimension | **mya-v2** | **Claude Code** | **Cursor** | **claw-code** | **openclaw** | **pi** | **mya-v1** |
|---|---|---|---|---|---|---|---|
| Edit model | exact + 3-char hash + 4-char hash + multi | exact (requires prior Read) | exact `StrReplace` | exact + `replace_all` | delegate→ext | `edits[]` array | exact + whitespace diag |
| Permission | 5-mode + 7-step + DELEGATE_BLOCKED | per-tool rules | `SwitchMode` | 5-mode (parity) | factory allow/deny + sandbox | none | 3-level autonomy |
| Tool-call repair | Tier-1 JSON parse | SDK schema val | model-native | none | **full pipeline** (§4.5) | per-tool `prepareArgs` | none |
| Code intel | codegraph + LSP cascade + tree-sitter | **none** | `SemanticSearch` | `lsp_client` only | none | none | none (deferred) |
| Bash sandbox | none (gate-only) | sandbox toggles | `block_until_ms` bg | `bash_validation` intent | — | — | `RateLimitedTool`+`PathGuarded` |
| Subagent | `delegate_task` (free-form `allowed_tools`) | `Agent` + `subagent_type` enum + `Workflow` + `SendMessage` resume | `Task` (7 typed kinds) | — | — | — | 4 CLI runners (dropped) |
| Network | browser/CDP only | `WebFetch`/`WebSearch` | `WebSearch`/`WebFetch` | `WebFetch`/`WebSearch` | `web_search`/`web_fetch` | none | `web_search`/`web_fetch` (dropped) |
| Plugin FSM | flat composio registry | MCP dynamic | `CallMcpTool` | **typed FSM** (`Degraded{healthy,failed}`) | dynamic npm (147 ext) | Pi Packages | WASM plugins |
| Unique | `code` bridge, `paid_fetch`, screen/OCR | `ScheduleWakeup`, `Workflow`, `TeamCreate` | `GenerateImage`, `best-of-n`, `codex-rescue` | `PluginState::Degraded`, `bash_validation` | `tool-call-repair` | — | sub-agent CLI delegation |

(Full per-system detail in §5.)

---

## 4. Adoption opportunities (ranked by impact × ease)

### Tier S — high impact, low effort (algorithm already exists in mya)

**S1. Persistent cross-edit hash store** *(from pi-hashline-edit-pro)*
- mya already has `mapStableHashes` (`hashline-edit.ts:99-170`) but only uses it inline. Persisting `(content, hashes[])` to `~/.mya/agent/hash-store.json` lets the model keep using old anchors for untouched regions after editing elsewhere → cuts "stale anchor" errors in long sessions.
- **Effort**: ~150 LOC new file `packages/tools/src/hashline-store.ts` + 1 import.

**S2. Boundary-duplication warnings** *(from pi-hashline-edit-pro)*
- When a `content_lines` first/last entry equals the adjacent surviving line (the `}`/`});`/`} else {` duplication — the LLM's #1 edit error), emit a contextual hashline-anchored warning block. Anchors stay valid → model fixes in one follow-up `replace`.
- **Effort**: ~80 LOC (`checkBoundaryDup` + `fmtBoundaryWarning`) into `hashline-edit.ts`.

**S3. `never_worse` guard for output compression** *(from rtk)*
- Only apply compression when it actually saves tokens; passthrough otherwise. mya's `output-compress.ts` has no "fall back if bigger" path.
- **Effort**: ~5 LOC in `compressCommandOutput`.

**S4. mya-v1 whitespace diagnostic** *(regression, §5)*
- mya-v1's `file_edit.rs:262-289` produced actionable "differs only in leading whitespace" errors. mya-v2's `edit` just says "oldText not found". Pure additive UX.
- **Effort**: ~25 LOC.

### Tier A — high impact, medium effort

**A1. `Workflow` orchestrator** *(from Claude Code `Workflow`, pi-dynamic-workflows, oh-my-pi `swarm-extension`)*
- Declarative `parallel()`/`pipeline()`/`phase()` primitives + **journaled resume** (interrupted runs replay finished agents, no re-run, no tokens) + **worktree isolation** per agent.
- **Crucial**: mya already has `reflink_or_copy` (CoW primitive) in `crates/natives/src/lib.rs:295-345` and a `vm`-sandboxed `packages/workflows/src/runner.ts`. This is *wiring*, not new infra.
- mya's current `delegate_task` is one-shot; CC's `Workflow` is multi-stage with budget gates. Biggest orchestration gap.

**A2. Typed `subagent_type` enum + `SendMessage` resume** *(from Claude Code, Cursor)*
- Replace free-form `allowed_tools: string[]` with typed kinds (`Explore`/`Plan`/`code-reviewer`/`best-of-n-runner`). CC's `SendMessage` resumes a subagent by ID with full context — mya subagents are fire-and-forget or `wait:true`.
- Pairs with A1.

**A3. openclaw `tool-call-repair` pipeline** *(the #1 robustness port)*
- mya's `repair.ts` is Tier-1 only. openclaw ships a full pipeline: `stream-normalize` → `grammar/payload` repair (handles Harmony `<|channel|>` markers, XML-ish tool-call ends, bracketed JSON payloads) → `promote` (partial→valid).
- Especially valuable for non-OpenAI/non-Claude providers that emit malformed streaming partials.
- **Effort**: port `source/openclaw/packages/tool-call-repair/src/{grammar,payload,promote,stream-normalizer}.ts`.

**A4. claw-code `bash_validation` intent classifier** *(from claw-code)*
- mya's `bash` only strips secret-env. claw-code classifies intent (`ReadOnly`/`Write`/`Destructive`/`Network`/`ProcessManagement`/`PackageManagement`/`SystemAdmin`) via 6 orthogonal guards → `ValidationResult::{Allow,Block,Warn}`. Composes with the permission gate for destructive-command warning.
- **Effort**: medium (port 6 submodules from `source/claw-code/rust/crates/runtime/src/bash_validation.rs`).

**A5. `SemanticSearch` tool** *(from Cursor)* — **leverages the embeddings work just shipped**
- mya's `codegraph` is regex-only. Cursor's `SemanticSearch` finds code by meaning. **mya now has fastembed embeddings in memory** (`packages/memory/src/embeddings.ts`) — the same arm could index source chunks. Closes the one gap where Cursor beats mya on code intel.

**A6. claw-code `PluginState::Degraded` tri-state** *(from claw-code)*
- mya's composio/MCP registration is a flat opaque list. claw-code's typed FSM: `Unconfigured → Validated → Starting → Healthy | Degraded{healthy_servers,failed_servers} | Failed{reason} | ShuttingDown | Stopped`, with per-server `ServerHealth` + `startup_event()`. "Partial-success is first-class."
- **Effort**: medium — matters most when mya runs multi-server MCP gateways.

### Tier B — medium impact, medium effort

**B1. `run_in_background` for `bash`** *(from CC `Bash`, Cursor `Shell`, opencode `&`)* — all three leaders have it; mya's `bash` blocks until exit. Unlocks dev-server/watch workflows. ~small.

**B2. `WebFetch`/`WebSearch` built-ins** *(from CC, Cursor, claw-code, mya-v1)* — mya relies on MCP/Composio. A thin built-in (esp. w/ x402 `paid_fetch` already there) removes a common dependency.

**B3. `ScheduleWakeup`** *(from CC `/loop`)* — cache-window-aware delay picker (60-270s warm, 1200-1800s cold, "don't pick 300s"). mya has `cron` (poll-based) but no autonomous-loop equivalent.

**B4. Mandatory `Read` before `Edit`** *(from CC)* — mya's `edit` doesn't enforce it. A session-level Read-tracker hook.

**B5. Algorithmic compaction + lossless recall** *(from pi-vcc)* — no-LLM compaction (35-99% token reduction) as free-tier default before LLM-summarization, plus a `recall` tool that searches raw JSONL. Big cost win.

**B6. `<ref_file/>` citation tags** *(from Devin)* — model-emitted clickable XML citations in output. No mya equivalent.

**B7. fff auto-fuzzy fallback + definition-first auto-expand** *(from fff)* — when `search-index.ts` exact query returns 0 hits, retry case-folded bigram; when a grep match lands on a symbol definition, auto-expand the body (eliminates a follow-up `read`).

**B8. Pit-of-success lint enforcement** *(from MyAgents)* — convert `AGENTS.md` forbidden patterns to `clippy.toml::disallowed_methods` + ESLint `no-restricted-imports` + depcruise. Makes the wrong call *uncompilable*. Single highest-ROI *cultural* change.

**B9. headroom content-aware compression** *(from headroom)* — per-type compressors (tool-output / log / RAG / conversation) + a `compressing` provider wrapper in the same seam as mya's `compatible`/`reliable`. Enable `serde_json::preserve_order + arbitrary_precision` for byte-faithful passthrough.

### Tier C — lower priority / skip

- `GenerateImage` (Cursor), native desktop computer-use (pi-computer-use — huge eng investment), full graphify tree-sitter rebuild, ctx 7-crate history workspace, rtk per-command reimplementation, ponytail (prompt skill, not a tool).

---

## 5. Regressions vs mya-v1 (confirmed)

The TS migration gained a lot (§1.7) but **dropped three concrete tool capabilities**:

| # | Lost capability | mya-v1 location | mya-v2 status | Severity |
|---|---|---|---|---|
| R1 | **Sub-agent CLI delegation** (4 runners: `claude_code_runner`, `codex_cli`, `gemini_cli`, `opencode_cli`) | `source/mya-v1/crates/mya-tools/src/lib.rs:23-32` | **None** — replaced by ACP bridge / skill system (needs confirmation) | 🔴 High |
| R2 | **`web_search` / `web_fetch` built-ins** (+ provider routing) | `source/mya-v1/crates/mya-tools/src/lib.rs:94,107` | **None** — delegates to Composio/external | 🔴 High |
| R3 | **Whitespace `no_match_diagnostic`** | `source/mya-v1/crates/mya-tools/src/file_edit.rs:262-289` | `edit` returns bare "oldText not found" | 🟡 Low (S4) |

Likely **intentional simplifications** (not regressions): `notion`/`jira`/`discord`/`email`/`linkedin`/`weather`/`google_workspace`/`cloud_ops` → folded into Composio (250+); `hardware_*`/`firmware_*` → `crates/mya-hardware/`; `knowledge`/`project_intel`/`model_routing`/`pipeline`/`report_template` → own packages.

---

## 6. BUGS & INCONSISTENCIES in current mya code (actionable)

> These were surfaced by the baseline mapping agent and verified against current source. Several are real correctness/security issues, not style nits. **This is the section worth acting on first.**

### 6.1 Correctness bugs

**🐛 B1 — `bash` is internally contradictory (never escalates).**
`bashTool` metadata declares `DangerFullAccess` (implies human escalation), but `DELEGATE_BLOCKED_TOOLS` (`types.ts:397-405`) unconditionally includes `bash`, so core dispatch denies it at permission step 1 (`permission.ts:114-120`) **before** it can ever escalate. The existing test (`permission.test.ts:35-50`) even asserts this. So in the core surface, `bash` is effectively dead via the 7-step path. (The interactive bridge must register its own `bash`.) → **Decide: is `bash` core-supported or bridge-only? Align metadata + denylist.**

**🐛 B2 — MCP FSM transition bug.**
`McpClient.start()` requests `Discovered → Initializing`, but the transition matrix only allows `Discovered → Validated | Stopped`. The request happens *before* the startup `try` block (`mcp-client.ts:43-61`; `mcp-lifecycle.ts:46-61`). Either the matrix is wrong or the transition is. → **Verify + fix the matrix or the call order.**

**🐛 B3 — MCP schemas are discarded.**
Discovery reduces `McpToolInfo[]` to bare names; the bridge registers every MCP tool with an **empty object schema** instead of the server's `inputSchema` (`mcp-client.ts:18-22,104-108`; `mya-bridge.ts:1211-1217`). The model gets no parameter info for MCP tools. → **Pass `inputSchema` through.**

**🐛 B4 — Production LSP cascade is a no-op.**
The interactive bridge constructs an LSP adapter whose `diagnostics()` always returns `[]` (`mya-bridge.ts:1459-1478`). So the edit-time diagnostic cascade — a headline mya differentiator (§2) — does nothing in production. → **Wire a real LSP client or remove the claim.**

**🐛 B5 — Composio registration races the prompt snapshot.**
`createAgent()` calls `registerComposioTools(...).catch(...)` **without awaiting**, then immediately snapshots the registry into OpenAI schemas + the stable prompt (`agent/index.ts:287-311`). Asynchronously added Composio tools may exist in the registry but be absent from that agent's model-facing surface. → **Await before snapshot, or register before schema build.**

**🐛 B6 — MCP env overrides are not retained.**
`register` copies id/command/args but **not `env`**; `getConfig` reconstructs from that reduced state, so spawn-time env merge cannot recover registered custom env (`mcp-client.ts:23-29,43-57,181-185`). → **Persist `env` in registration state.**

### 6.2 Security gaps

**🔒 S1 — `hashline_edit` bypasses path containment.**
The bridge `hashline_edit` reads/writes `params.filePath` directly, **never calling `contain()`** (`mya-bridge.ts:1047-1054`). A model (or malicious prompt) could edit outside the workspace. → **Route through `path-safety.ts` resolvers.**

**🔒 S2 — `glob`/`grep` caller-controlled `cwd` bypasses containment.**
Both accept a caller-supplied `cwd` and do **not** use `contain()` or the turn workspace (`builtin.ts:219-226,266-273`). Search roots are unbounded by the path-safety layer. → **Bound `cwd` to the workspace (or a configured allowlist).**

**🔒 S3 — Write resolver doesn't realpath the final file component.**
`path-safety.ts:48-65` realpaths the *parent* directory (blocks symlink-dir escape) but not the final file → final-component file symlinks are not rejected. → **Consider realpath-ing the target when it exists.**

**🔒 S4 — Extension packages run in-process as trusted code.**
`packages/pkg/src/index.ts:31-45` loads activated package code in-process with only advisory permission declarations; no OS sandbox. (Consistent with AGENTS.md "no sandbox" rule, but worth documenting as a trust-boundary assumption.)

### 6.3 Wiring / consistency gaps

- **W1** — `code` and `codegraph` are public factories but **not in the default built-in list** and not registered by `createAgent()` (`builtin.ts:471-489`). Their capabilities exist but require explicit host wiring.
- **W2** — Symbol/LSP/reference-graph APIs are programmatic-only; the callable `codegraph` tool exposes only file relations, not symbols/call-graphs (`codegraph.ts:155-233`).
- **W3** — `tool-search.ts` is **not wired**: `createAgent()` doesn't instantiate it; it surfaces the full registry directly. And `search()` only *ranks* — it does not `activate()` results (`tool-search.ts:103-126`; `agent/index.ts:303-311`). Deferred-tool budgeting is effectively inert.
- **W4** — **Two incompatible hashline wire formats** coexist (3-char FNV in core `replace`; 4-char SHA-256 in bridge `hashline_edit`), and the upstream interactive `read` has no `hashed:` option, so the bridge cannot generate 4-char anchors via a standard tool (`hashline.ts:1-15`; `hashline-edit.ts:1-17`; `mya-bridge.ts:1013-1039`). → **Unify or document the two-format split explicitly.**
- **W5** — Output compression is wired **only** in the interactive bridge's `bash` hook, not in core `runTool`/`runToolBatch` (`dispatch.ts:21-81`; `mya-bridge.ts:698-725`). Other callers get no compression.
- **W6** — `agent/index.ts:7-16` comment still says "6 builtins"; there are now 18.
- **W7** — `packages/core/src/security.ts` is **absent** (tool-gating types live in `types.ts`; impl in `permission.ts`/`path-safety.ts`).
- **W8** — `crates/mya-tools/` is **empty** — the Cargo workspace has only `crates/natives` + `crates/desktop-shell` (`Cargo.toml:1-6`). The Rust tool crate named in AGENTS.md doesn't exist yet.

---

## 7. Per-system deep notes (compressed reference)

### Proprietary (leaked prompts)

- **Claude Code** (`system_prompts_leaks/Anthropic/`): `Bash`/`Read`/`Edit`/`Write`/`Agent`(typed `subagent_type` + `SendMessage` resume)/`AskUserQuestion`/`ScheduleWakeup`/`Skill`/`ToolSearch`/`Workflow`(declarative `phase/agent/parallel/pipeline`, `isolation:'worktree'`, budget caps)/`WebFetch`/`WebSearch`/`TodoWrite`/`EnterPlanMode`/`TeamCreate`+`SendMessage`/MCP. **No LSP/codegraph** — pure text. *Adopt*: `Workflow`, `subagent_type` enum, `SendMessage`, `ScheduleWakeup`, mandatory Read-before-Edit.
- **Cursor** (`cursor.md`): 20 tools incl. `SemanticSearch` (embedding), `GenerateImage`, `Task` (7 typed kinds: `best-of-n-runner`, `codex-rescue`, …), `SwitchMode` (Agent/Plan/Debug/Ask), `AwaitShell`. *Adopt*: `SemanticSearch` (A5), typed subagent kinds, `run_in_background`.
- **Devin** (`devin-cli.md`): minimal surface (`read`/`edit`/`exec`/`grep`/`glob`/`notebook_read`/`todo_write`); high-level workflow philosophy; hard-gated `Plan` mode; `<ref_file/>`/`<ref_snippet/>` citation tags; `.devin/` config namespace. *Adopt*: citation tags (B6), hard-gated Plan, `.mya/` namespace.
- **opencode** (`opencode.md`): `read`/`write`/`edit`/`bash`/`grep`/`glob`/`ls`; per-call confirmation; `&` background; absolute-path discipline; self-verification-via-tests. *Adopt*: `run_in_background` (B1).

### OSS coding agents

- **claw-code** (Rust): 15+ tools; exact-text edit + `replace_all`; 5-mode permission (**parity with mya**); **`bash_validation`** intent classifier; **typed `PluginState::Degraded`** FSM; 11-phase MCP FSM w/ `McpErrorSurface`; `WebFetch`/`WebSearch` (Danger). *Adopt*: `bash_validation` (A4), `PluginState::Degraded` (A6), MCP error surface.
- **openclaw** (TS monorepo): dynamic factory registration; `web_search`/`web_fetch`/`pdf`/`nodes`/`message`; **`tool-call-repair` full pipeline** (the standout); 147 dynamic npm extensions. *Adopt*: **tool-call-repair pipeline (A3)** — highest single robustness win.
- **pi-coding-agent** (mya's parent): 7 tools (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`); `edits[]` array w/ diff preview; per-tool `prepareArguments`. *Reference*: mya inherits + greatly extends this.
- **mya-v1** (Rust): 80+ tool modules; default = `shell`/`read`/`write`/`edit`/`glob`/`content_search`; `AutonomyLevel` 3-mode; WASM plugins; sub-agent CLI runners + web tools (regressed, §5); `RateLimitedTool`+`PathGuardedTool` wrappers. *Port*: whitespace diagnostic (S4).

### Specialized projects

- **pi-hashline-edit-pro** (mya's hashline ancestor): mya ported the algorithm but **misses** persistent hash store (S1), bulk atomic mode, boundary-dup warnings (S2), bare-prefix detector, unicode-escape warn, `[E_LEGACY_SHAPE]`/`[E_BARE_HASH_PREFIX]` diagnostics, atomic fs writes (temp+rename), auto-read-after-write, BOM/line-ending-aware undo, empty-file `HASH│` handling.
- **pi-computer-use**: accessibility-tree-first desktop automation (`observe_ui`/`search_ui`/`act_ui`); **state-scoped immutable observations** (stateId preserved across calls); `@eN` outline-ref stabilization; `expect:` postconditions; headless-first/foreground-fallback. mya has the *type model* (`cdp-actions.ts`) + CDP path but lacks the state-scoped model + ref stabilization — porting those into `browser.ts` would eliminate a major LLM error class (refs lost on re-render). Native desktop AX/UIA = big eng investment, defer.
- **graphify**: deterministic knowledge graph (tree-sitter AST → nodes/edges → community detection). EXTRACTED/INFERRED confidence tagging + `path A B` query are cheap ports into mya's regex codegraph; full tree-sitter rebuild = defer.
- **ctx**: 7-crate Rust agent-history search (SQLite FTS5 + sqlite-vec + semantic). Search-*packet* pattern (snippet + truncation metadata) is the portable idea for `tool-search.ts`.
- **context-mode**: TS MCP server; per-session FTS5 of tool calls/edits/tasks (survives compaction); `ctx_execute` "think in code"; PreToolUse/PostToolUse hooks that nudge toward `ctx_*` tools; exit-classification. *Port*: small FTS5 session-store + PreToolUse nudges in `permission.ts`.
- **hypa** (.NET): mya's `output-compress.ts` is already a faithful port (the comments cite hypa source). Missing: broader reducer breadth, real `o200k_base` tokenizer (vs `len/4`), artifact-tee-on-truncation.
- **rtk** (Rust): drop-in CLI replacement for 100+ commands; **declarative TOML filter DSL** (60+ filters); `never_worse` guard (S3); `ultra_compact`. *Port*: TOML DSL + never_worse.
- **fff** (Rust+C+Lua): frecency + smart-case + auto-fuzzy fallback; definition-first auto-expand; git-aware annotations; Aho-Corasick multi-pattern; background watcher. *Port*: auto-fuzzy fallback + definition-expand (B7).
- **ponytail**: prompt skill ("lazy senior dev" ladder), not a tool — skip; consider an `AGENTS.md` tool-selection-nudge snippet.

### Agentic systems

- **hermes-agent** (Python): single gateway, 23 messaging adapters; AST-discovery tool registry; lazy-deps w/ hardcoded allowlist + appended-last `sys.path`; 3-tier cache-stable prompt assembly; background curator fork on auxiliary provider. *Adopt*: lazy-deps allowlist for WASM plugins; declarative `ProviderProfile` metadata.
- **headroom** (Rust): content-aware compression layer (inline/proxy/MCP); trained `Kompress-v2`; per-type compressors; `headroom-parity` byte-faithful proof crate. *Adopt*: per-type compression (B9) + a `mya-parity` discipline.
- **openhuman** (Rust, ~130 feature modules): `memory_archivist`/`diff`/`tree`/`sync`/`graph`/`queue`; `tinyflows` + `rhai_workflows` (**same Rhai choice as mya**); `model_council` + `council_registry`; `subconscious` (event-triggered bg); `plan_review` critic; `codegraph`; `runtime_python`/`javascript`; `wallet`/`web3`/`x402`. **mya already adopted**: ArchivistRole, TypedGraph, CouncilProvider, HindsightReviewer, Rhai, x402, codegraph. *Remaining delta*: `memory_diff`/`memory_tree`, `council_registry`, per-turn advisor (vs post-turn Hindsight), event-triggered subconscious.
- **OpenViking** (Rust+C++, **AGPLv3**): retrieval-as-filesystem (`ragfs`); tiered cache (Redis/Mooncake/Yuanrong); memory-quality benchmarks. *Study only* (AGPL blocks reuse): unified FS namespace over memory/vector/skill; extend `mya-eval` with memory-quality suite.
- **MyAgents** (Tauri + Claude SDK): **Sidecar Owner model** (ref-counted Node subprocess per Session); persistent `while(true)` session w/ deferred restart; 500ms pre-warm debounce; **dual lexical/canonical path resolution** (mya *already does this*: `resolveInsideWorkspace` lexical-write vs `resolveExistingInsideWorkspace` canonical-read, `builtin.ts:18-21`); token-based watcher handles; **pit-of-success lint-enforced wrappers** (`clippy::disallowed_methods` + ESLint `no-restricted-imports` + depcruise). *Adopt*: **B8 pit-of-success lint** (highest-ROI cultural change), persistent-session pattern.

### pi ecosystem (siblings)

- **oh-my-pi** (~17K⭐, TS+Rust): maximalist pi derivative; ~55K-line Rust perf core (`pi-natives`, vendored **pure-Rust POSIX shell** `pi-shell`, `pi-uu-grep`, `pi-ast`); `mnemopi` (memory), `hashline`, `task` (**worktree-isolated subagents returning Zod-validated objects**), `advisor` (**per-turn second-model critic**), `dap` (28 ops), `web_search` (18-provider chain), `swarm-extension` (YAML DAG), **bidirectional code-exec bridge**. *Adopt*: `task` w/ Zod returns (uses mya's existing `reflink_or_copy`!), per-turn `advisor`, vendored Rust shell for `bash`.
- **pi-dynamic-workflows**: `workflow` JS script tool (`agent`/`parallel`/`pipeline`/`phase` in vm); **journaled resume**; worktree isolation; real token/cost accounting; background-by-default + live panel; `/ultracode` auto-arm. *Adopt*: A1 primitives + journaled resume.
- **pi-lens**: LSP diagnostics on every write + impact-cascade (mya has this); **word-indexed `symbol_search`**; ast-grep + tree-sitter structural rules for smells; background security/dependency scans; read-guard + edit-autopatch. *Adopt*: word-indexed symbol search, ast-grep structural rules.
- **pi-vcc**: **algorithmic compaction** (no LLM, 35-99% reduction) + `vcc_recall` lossless JSONL search + bounded merge. *Adopt*: B5.
- **pi-mobile**: web UI; Abort vs Release lifecycle (preserves JSONL concurrency). *Note* for `mya-gateway`.
- **pi-soly**: plan-and-execute w/ per-plan branch; **built-in `rules` channel** (static advisory docs alongside skills). *Low*: consider a rules channel.
- **openpi**: Electron wrapper; `@heyhuynh/​pi-task` delegation w/ durable `conversation_id` + `TASKS.md` registry. *Note*.
- **pi-session-manager**: Tauri session browser; two-layer extension model (Agent + UI). *Low*.

---

## 8. Prioritized action plan

**Phase 0 — fix the bugs (§6), no new features.** Highest leverage, mostly small:
1. S1+S2+S3 (`hashline_edit`/`glob`/`grep` path containment) — **security**, do first.
2. B1 (`bash` metadata vs denylist contradiction) — decide core vs bridge.
3. B2 (MCP FSM transition) + B3 (MCP schemas discarded) + B6 (MCP env) — MCP correctness cluster.
4. B4 (LSP cascade no-op) — either wire a real client or stop claiming the feature.
5. B5 (Composio race) — await before snapshot.
6. W3 (wire `tool-search`) + W1 (default-surface `code`/`codegraph`) — unlock existing capability.

**Phase 1 — Tier S adoption (algorithm exists):** S1 hash store, S2 boundary warnings, S3 never_worse, S4 whitespace diagnostic. All ≤200 LOC, high UX/correctness payoff.

**Phase 2 — Tier A (wiring-heavy):**
- A1 `Workflow` orchestrator (reuse `reflink_or_copy` + `workflows/runner.ts`).
- A2 typed `subagent_type` + `SendMessage`.
- A3 openclaw tool-call-repair pipeline.
- A4 claw-code `bash_validation`.
- A5 `SemanticSearch` (extends the embeddings arm just shipped into a code-search tool).

**Phase 3 — Tier B (polish):** `run_in_background`, `WebFetch`/`WebSearch`, `ScheduleWakeup`, algorithmic compaction, citation tags, pit-of-success lint.

**Phase 4 — regressions (§5):** decide R1 (sub-agent CLIs) + R2 (web tools) — likely "intentional, delegate to Composio/ACP", but document the decision. R3 = S4 (Tier S).

**Defer:** native desktop computer-use, full tree-sitter codegraph rebuild, ctx history workspace, OpenViking (AGPL).

---

## 9. Trust notes

- All citations verified by the explorer agents against actual source (not just `.learned/*.md` summaries).
- AGPLv3 systems (OpenViking) studied for architecture only — **no code reuse**.
- The §6 bugs are flagged from code-reading; before acting, **runtime-verify** each (the recall-inversion lesson: trust code, but test the claim). Especially B1 (`bash` deny), B2 (MCP FSM), B4 (LSP no-op) deserve a live repro.
- mya-v1 comparisons rely on `source/mya-v1/` being the predecessor; confirm R1/R2 were intentional drops vs lost-in-migration with the team.
