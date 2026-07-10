# SPEC-FIXES — Round 24 (from 7 parallel code-verified reviewers)

> Apply EVERY fix below to `AGENT-SPEC-SPEC.md`. Sole file owner. Preserve all ✅ ACCURATE claims. Every fix has code file:line evidence. Do NOT rephrase beyond the correction.

## §2 (headroom serde)
- F1. Add 3rd serde feature: "Byte-faithful JSON (`preserve_order` + `arbitrary_precision` + `raw_value`)" — `raw_value` is load-bearing for byte-range live-zone surgery. *(headroom `Cargo.toml:48`)*

## §4 (claw-code)
- F2. `tag="state"`: the SPEC cites TaskStatus/McpLifecyclePhase; correct = `PluginState` is the one with `#[serde(tag="state")]`; the other two use `rename_all` only. Reword to attribute `tag="state"` to `PluginState`.
- F3. `McpErrorSurface.context` type: `Record<string,unknown>` → **`Record<string,string>`** (values are always String). *(mcp_lifecycle_hardened.rs:70)*
- F4. "recovery loops retry only recoverable=true **once** before escalating" → remove "once". Reality: `can_resume_after_error()` checks only whether the last error is recoverable — **no retry counter**; recoverable errors may resume an unlimited number of times. Reword: "recovery resumes iff the last error is `recoverable` (no fixed retry cap)."

## §5 (Trident + compression)
- F5. Trident is **NOT per-type and NOT reversible** — it is a **lossy, structural** 3-stage compaction: Supersede (deletes obsolete file ops by path), Collapse (summarizes short chatty exchanges), Cluster (groups messages by tool/path Jaccard similarity → summary). The "per-type compressors" + "reversible" belong to **headroom only**, not claw-code Trident. Split the two sources. *(claw-code trident.rs:139/210/283 — all lossy)*
- F6. "reversible" (headroom) is **unqualified** — correct: "**lossy on the wire, reversible end-to-end via the CCR side-cache** (originals stored under an MD5 hash key, retrieved on demand)." *(headroom ccr_roundtrip.rs:4-5)*
- F7. Per-type compressor list "tool output / log / RAG / **history**" → drop "history". Real types: `{SmartCrusher (JSON) / Log / Search / Diff / Text}`. Conversation history is NEVER compressed — only the **live zone (latest user turn)** is eligible. *(headroom live_zone.rs:9-12,52-56)*
- F8. `CompressionDriftGrader` / `DriftGrader` / CI job `compression-drift` are **SPEC-coined names** — the concept (accuracy-preservation eval suite) is real; the names don't exist in headroom (grep = 0). Reword: "**accuracy-preservation eval gate** (SPEC-proposed name; headroom's eval suite = GSM8K/TruthfulQA via lm-eval + before/after + LLM-as-judge)." Apply this rename everywhere it recurs (§5, §15, §18 #5, §24 glossary).
- F9. "in CI … required" OVERSTATED. Reality: the only **mandatory** in-repo gates are the zero-cost CCR round-trip + tool-schema-compaction checks; the live GSM8K eval **skips green** without `OPENAI_API_KEY`; the Rust-vs-Python parity-nightly job is `continue-on-error` (Phase 0). Reword accordingly. Fix §18 #5 enforcer: replace "CI job `compression-drift` is `required`" with the real gates.
- F10. "headroom's whole value = GSM8K ±0.000" → headroom reports **4 benchmarks**: GSM8K ±0.000, **TruthfulQA +0.030**, SQuAD 97% (19% compression), BFCL 97% (32% compression). Reword. *(headroom README.md:121-127)*

## §6 (provider pipeline)
- F11. round-10 stage names `normalize_whitespace → balance_json → repair_schema(Zod) → promote` are **INVENTED** and contradict the §6 inline claim. Correct (openclaw `tool-call-repair`): **`stream-normalize → grammar/payload parse → promote`** (3 stages). No Zod — validation is against an `allowedToolNames` allowlist. Also fix the §4 turn-loop comment "4-stage repair" → "3-stage repair". *(openclaw tool-call-repair/{stream-normalizer,grammar,payload,promote}.ts)*

## §7 (permission + edits)
- F12. Arg-subject JSON keys missing `notebookPath`. Full list = `command|path|file_path|filePath|notebook_path|notebookPath|url|pattern|code|message` (**10 keys**). *(permissions.rs:437-447)*
- F13. hashline "content hash of **surrounding lines**" is WRONG. Correct: **whole-file content-hash tag (xxHash32, 4-hex) for file-version binding + line-number anchors; a stale tag rejects the edit.** The clobber-prevention outcome is real; the per-edit surrounding-lines hashing is not. *(oh-my-pi hashline/format.ts:107-114, patcher.ts:652)*

## §8 (memory roles — openhuman)
- F14. `archivist`: "active curation/decay/promotion" is **INVENTED**. Correct: "**conversation→tree-leaf bridge** — strips tool-call noise from chat turns and appends the cleaned markdown as a single leaf into a memory tree. No curation/decay/promotion." *(grep decay|promote|curator in memory_archivist/ = 0)*
- F15. `memory_goals`: "goal-oriented retrieval" WRONG. Correct: "**user goal-list manager** (CRUD + LLM reflection agent maintaining `MEMORY_GOALS.md`)." Not a retrieval key.
- F16. `memory_sync`: "multi-device" WRONG. Correct: "**upstream-source ingestion** pipelines (Composio connectors / workspace file-watch / MCP servers) pulling external data into memory_store." No CRDT/device-replication. (§23 #5 already flags this as open — make §8 consistent.)

## §9 (skills — hermes)
- F17. `SkillProvenance` enum `Bundled|HubInstalled|UserCreated|AgentCreated` is **INVENTED**. Reality: provenance is a runtime function `provenance()` returning **`'hub' | 'bundled' | 'agent'`** (3 values); a separate ContextVar tags background-review writes. Reword: keep the 4-way enum but mark it **"SPEC-proposed enhancement"** over hermes's 3-value function.
- F18. "only touches AgentCreated skills" FALSE. Reality: by default `curator.prune_builtins=True`, so **built-in skills are also curated**. Correct: "touches agent-created **and bundled built-in** skills (when `prune_builtins` is on, the default); hub-installed/external are off-limits."

## §10 (subagents + plan_review)
- F19. "Zod-validated object" WRONG. oh-my-pi validates subagent yield with **JSON-Schema/JTD** (JTD normalized to JSON Schema, AJV-class validator); Zod appears only in tests/examples; eval args use arktype. Reword. *(oh-my-pi tools/output-schema-validator.ts, jtd-to-json-schema)*
- F20. "worktree-isolated" imprecise. Correct: "**copy-on-write overlay-isolated** subagents (overlayfs/APFS-reflink/btrfs/ZFS via `pi-natives` `IsoBackendKind`; `git worktree` is one backend option)." *(oh-my-pi task/worktree.ts)*
- F21. `plan_review` "automated plan critic" WRONG (openhuman). Correct: "**interactive human-in-the-loop plan-approval gate** — parks the live turn on `PlanReviewGate` until the user decides Approve/Reject/Revise (10-min TTL, fail-closed Reject); NOT an automated critic." Attribute the automated advisor/critic only to oh-my-pi's advisor lane.

## §11 (codegraph + LSP)
- F22. `codegraph` "in-process code semantic graph (symbols/refs/call-graph)" is a **severe overclaim**. Correct: "**content-addressed file-relevance search** (BM25 + structural-doc embeddings + reciprocal-rank fusion) returning **ranked file paths** — NOT a symbol/ref/call-graph. A tree-sitter call-graph is a *future* upgrade." *(openhuman codegraph/index.rs, README)*. Also update §23 #1 to reflect this is file-search today.
- F23. "LSP wired into every write (diagnostics **gate** edits)" WRONG. Correct: "**LSP format + diagnostics surfaced as opt-in post-write feedback** (`lsp.formatOnWrite`/`lsp.diagnosticsOnWrite`); the write always succeeds — diagnostics are an appended notice, NOT a gate. LSP is force-disabled for eval/subagent turns (cold-start cost). The real DAP debugger IS first-class." *(oh-my-pi tools/write.ts:329-331, output-meta.ts:523-526, eval/agent-bridge.ts)*

## §12 (hooks + gateway-protocol)
- F24. "user hooks (~/.agent/hooks/<name>/hook.yaml + **WASM handler**)" WRONG. hermes uses **Python `handler.py` + `HOOK.yaml`** (uppercase), loaded via importlib — never WASM. Reword (keep WASM only as the SPEC's own aspiration for the new agent, clearly marked). *(hermes gateway/hooks.py:34-36,86-87)*
- F25. "built-in core hooks (shutdown, scale-to-zero, memory-monitor) via the **same path**" FALSE. Reality: `_register_builtin_hooks()` is **empty**; scale-to-zero/memory-monitor are **separate gateway subsystem modules**, not hook-registry entries. Reword: "user hooks via HookRegistry (no shipped built-ins yet); scale-to-zero/memory-monitor as separate subsystem modules." *(hermes gateway/hooks.py:68-74)*
- F26. §12 + source table "A2A protocol" imprecise for openclaw. Correct: "**gateway control-plane protocol** (sessions/channels/cron/config/tools/skills/terminals/agents/nodes — includes multi-agent messages, but is broader than agent-to-agent)." *(openclaw packages/gateway-protocol)*

## §13 (LaneBoard API — claw-code)
- F27. The §13 `LaneHeartbeat`/`LaneBoard` TS API is **invented/wrong**. Correct:
  - `LaneHeartbeat` = `{ observed_at, transport_alive, status: String }` — **no `laneId`**, `status` is `String` not a typed enum.
  - Lane identity (`task_id`) lives on the **wrapper** `LaneBoardEntry { task_id, prompt, status, team_id, heartbeat, freshness }`, not the heartbeat.
  - `LaneBoard` entries are `LaneBoardEntry[]` (NOT `LaneHeartbeat[]`); `LaneBoard` also has `generated_at`.
  - `freshness()` is NOT a per-laneId method. Real API: `LaneHeartbeat::freshness_at(now, stalled_after_secs) → LaneFreshness` (per-heartbeat) and `TaskRegistry::lane_board_at(now, stalled_after_secs) → LaneBoard` (en masse). Reword the TS interface to match. *(claw-code task_registry.rs:100-134,203-247)*

## §14 (security — many oh-my-pi corrections)
- F28. "Sandbox enforcers in Rust (seccomp/seatbelt/AppContainer) … *(oh-my-pi + claw-code)*" → **drop oh-my-pi**. No seccomp/seatbelt/AppContainer in oh-my-pi (grep = 0). That is **claw-code/openhuman (`cwd_jail`)** only. oh-my-pi's isolation = in-process brush shell + CoW overlay (`pi-iso`).
- F29. "in-process Rust shell runs with a reduced env **allow-list** + **cwd locked to workspace root** + a path validator rejecting `..`/symlink escapes" → **not in oh-my-pi's `pi-shell`**. The only env filtering is a **deny-list in the Python eval runtime** (different component). cwd is settable, not locked. Remove these from the oh-my-pi attribution (they belong to claw-code/openhuman).
- F30. "a `secrets` package provides `get/rotate/revoke`" WRONG for oh-my-pi. Its `secrets` package is a **prompt/output redactor** (`SecretObfuscator`: obfuscate/redact via plain/regex patterns from `.omp/secrets.yml`); no OS-keyring, no lifecycle. Reword: oh-my-pi's secrets = redaction; the keyring/get/rotate/revoke lifecycle is the **SPEC's own proposal**. *(oh-my-pi secrets/{index,obfuscator}.ts)*
- F31. invariant #9 + §14 "Never shell to /bin/bash … sandboxed in-process shell (no /bin/bash)" is an **OVERCLAIM**. Correct: "the in-process brush shell with vendored uutils builtins **reduces but does not eliminate** external-process execution; non-builtin commands still spawn external binaries (incl. /bin/sh). The `exec` builtin is disabled." *(oh-my-pi pi-shell/src/shell.rs:2053, external-exec path)*
- F32. "MCP tool calls audited separately … Merkle/append-only audit log. *(openhuman `mcp_audit` + mya-v1)*" → openhuman's `mcp_audit` is a **plain SQLite table, MCP-write-tools-only, NOT Merkle/append-only**. Re-attribute Merkle/append-only to **mya-v1 only**; soften the openhuman half.
- F33. "PII redactor (openhuman privacy-first)" → **overclaim**. openhuman has NO PII redactor; its privacy posture is **hash-based audit logging** (sha256 of prompts). Reword; PII redaction = SPEC proposal.

## §15 (eval)
- F34. Add caveat: headroom's `headroom-parity` has **3 of 7 comparators still `todo!` stubs (Phase 0)** — only Diff/Tokenizer/SmartCrusher/ContentDetector are real. *(headroom-parity/src/lib.rs:140-161)*
- F35. Rename the invented `DriftGrader`/`compression-drift` terms here too (see F8).

## §17 (extension kinds — pi)
- F36. "Five extension kinds … **Modes**" → **WRONG**. pi has **FOUR** kinds: **Extensions / Skills / Prompt Templates / Themes**. Remove the "Modes" row. Rename row 1 "Tools" → "**Extensions**" (Extensions subsume tools + commands + events + UI). Update `PackageManifest.kind` tuple to `("extensions"|"skills"|"prompt-templates"|"themes")[]`. The 4 runtime modes (interactive/print/json/rpc) are built-in, not a package kind. *(pi README.md:6, docs/packages.md)*

## §18 (invariants)
- F37. #2 "(hermes + AGENTS.md)" for `denied_tools` — hermes has **no `denied_tools`** (that's claw-code). Re-attribute to claw-code only.
- F38. #6 `no_dangling_stub` lint "(claw-code)" — **not found** in claw-code (it's a SPEC proposal). Mark as SPEC-proposed enforcer, drop the claw-code attribution.
- F39. #5 + #9 — apply F9 (CI overstated) + F31 (/bin/bash overclaim) here too.

## §21 (session migrations)
- F40. "session format (`session.v{N}` + `migrations.ts`)" → **wrong file**. `src/migrations.ts` holds startup/config **filesystem** migrations (auth moves, sessions relocation, commands→prompts, tools→bin) — side-effectful, not pure. The session-format version migrations (`CURRENT_SESSION_VERSION=3`, `migrateV1ToV2`, `migrateV2ToV3`) live in **`src/core/session-manager.ts`**. Reword: "session format (`session.v{N}` + `session-manager.ts` migrations)". *(pi src/migrations.ts, src/core/session-manager.ts:45,~250-282)*

## §24 glossary + source table
- F41. glossary "drift grader — source: headroom" → "drift grader — **SPEC-proposed term** for the accuracy-preservation eval-gate pattern headroom demonstrates."
- F42. source table row 7 "session-as-contract" → **INVENTED term** (0 matches in pi). Replace with "versioned session format (JSONL, v1→v3)".

## NOT defects (keep as-is)
- openclaw ⭐ 382K — VERIFIED live via `gh api` (382,332). Reviewer's "implausible" note is wrong; keep.
- All ✅ ACCURATE claims (permission 7-step order, ProviderProfile fields, MemoryManager 5.0s drain / 128 / 3600 cache, DELEGATE_BLOCKED_TOOLS, model_council chair-synthesis, rhai_workflows, 4 transport modes, progressive disclosure, minimumReleaseAge 2880, gateway-protocol/net-policy split, bidirectional eval bridge, vendored brush+uutils, advisor lane, DAP debugger, MIT licenses, 60-95% tagline) — KEEP UNCHANGED.
