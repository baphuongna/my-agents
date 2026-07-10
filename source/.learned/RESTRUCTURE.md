# SPEC RESTRUCTURE — split into multi-file + source links

> Per directive: "SPEC phải cực kỳ chi tiết HOẶC có đường dẫn source tham khảo; nếu quá dài tách multi-file." AGENT-SPEC.md is 947 lines → split into a `spec/` directory of focused files, and convert every source attribution into a real relative markdown link to the actual source file. Preserve ALL content (every line, every fix R24-R28).

## File plan — create `source/.learned/spec/`
Split the current `AGENT-SPEC.md` sections into these files (each carries its §number + a back-link to `00-OVERVIEW.md`):

| File | Content (current §) |
|---|---|
| `00-OVERVIEW.md` | Header + Sources-synthesized table + §1 Vision/Tenets + §2 Language Decision + §3 Architecture map + §19 License + §22 "What it's NOT" + a **TOC** linking to all detail files + the deepdive-translation note. |
| `01-core-loop.md` | §4 (TurnState FSM, TurnEvent, LifecycleError, Core primitives glossary, runTurn pseudocode). |
| `02-providers.md` | §6 (ProviderProfile, StreamEvent, fallback chain, 3-stage repair, council, auxiliary provider). |
| `03-tools-permission.md` | §7 (registry, 7-step permission pipeline, MODE_RANK, bash validation, sandboxed shell, hooks, hashline). |
| `04-prompt-compression.md` | §5 (3-tier prompt, injection scanner, compression, CCR, drift grader, markCompressed COW). |
| `05-memory.md` | §8 (MemoryBackend vs MemoryRole, MemoryManager, ragfs URI). |
| `06-skills-subagents.md` | §9 (Skills) + §10 (Subagents, topologies, CoW merge-back, approval chain). |
| `07-code-channels.md` | §11 (codegraph/LSP/DAP/code-exec bridge) + §12 (Channels, gateway, hooks, gateway-protocol). |
| `08-observability-security.md` | §13 (Observability, LaneBoard, event taxonomy) + §14 (Security) + §14b (Native Crash & Process Resilience). |
| `09-eval-supply.md` | §15 (Eval) + §16 (Supply chain). |
| `10-packages.md` | §17 (Extension model, PackageManifest, isolation tiers, third-party napi). |
| `11-invariants-roadmap.md` | §18 (15 invariants) + §20 (Roadmap tiers) + §21 (Cross-cutting) + §23 (Open questions) + §24 (Glossary). |

## Top-level `AGENT-SPEC.md` → becomes a 1-page INDEX
Replace the 947-line file with a short pointer: title, one-paragraph summary, the **TOC** (links into `spec/`), and "full detail in `spec/`. Audit trail: `REVIEW-LOG.md` + `SPEC-FIXES-R2[4-8].md`." Keep it < 60 lines.

## Source-link convention
Every attribution like `*(claw-code \`permissions.rs\`)*` → markdown relative link. Path from `.learned/spec/<file>.md` to a source file = `../../<project>/<path>` (spec/ is two levels under source/). Use this path map (linkify the project+file token):

- **claw-code**: `../../claw-code/rust/crates/runtime/src/permissions.rs` · `…/plugin_lifecycle.rs` · `…/task_registry.rs` · `…/mcp_lifecycle_hardened.rs` · `…/trident.rs` · `…/bash_validation.rs` · `…/hooks.rs`
- **hermes-agent**: `../../hermes-agent/agent/system_prompt.py` · `…/prompt_builder.py` · `…/memory_manager.py` · `…/curator.py` · `../../hermes-agent/providers/base.py` · `…/tools/lazy_deps.py` · `…/tools/delegate_tool.py` · `…/tools/registry.py` · `…/gateway/run.py` · `…/gateway/platform_registry.py` · `…/gateway/hooks.py`
- **openhuman**: `../../openhuman/src/openhuman/memory_archivist/` · `…/codegraph/` · `…/model_council/` · `…/plan_review/` · `…/rhai_workflows/` · `…/memory_goals/` · `…/memory_sync/` · `…/memory_diff/` · `…/memory_tree/`
- **headroom**: `../../headroom/crates/headroom-core/src/transforms/` · `…/headroom-parity/` · `../../headroom/Cargo.toml`
- **openclaw**: `../../openclaw/packages/tool-call-repair/` · `…/gateway-protocol/` · `…/net-policy/`
- **oh-my-pi**: `../../oh-my-pi/packages/coding-agent/src/task/` · `…/advisor/` · `…/secrets/` · `../../oh-my-pi/packages/hashline/` · `../../oh-my-pi/crates/pi-natives/` · `…/pi-shell/`
- **pi-coding-agent**: `../../pi-coding-agent/README.md` · `…/docs/extensions.md` · `…/docs/packages.md` · `…/src/core/session-manager.ts` · `…/src/core/extensions/loader.ts`
- generic fallback: link the project root `../../<project>/` when the exact file isn't in the map.

Format: `*(source: [claw-code permissions.rs](../../claw-code/rust/crates/runtime/src/permissions.rs))*`. Where a claim cites a line, append `#L<line>` if the file is code (optional).

## Rules
- **Preserve every line of content** — this is a reorganize+linkify, not an edit. All R24-R28 fixes must survive verbatim in the right file.
- Each detail file starts with `# <Title>` + a one-line `> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §<n>.`
- Keep cross-§ references working: `§7` → `[§7 Tools](03-tools-permission.md)`, `§4` → `[§4 Core Loop](01-core-loop.md)`, etc. (provide a §→file map at the top of 00-OVERVIEW and use it consistently).
- Keep all code fences balanced per file.
- After: verify each file's fences are even; the §→file map is complete (§1-24 + §14b); spot-check 10 source links resolve (the target files exist under source/).
- Return: files created, total line count across spec/, any content that couldn't be placed, 2-3 risk spots. Flush to disk frequently.
