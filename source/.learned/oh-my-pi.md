# oh-my-pi — Study for unified agent SPEC

> Studied 2026-07-10. **Source:** `/home/bom/source/my-agent/source/oh-my-pi` (`can1357/oh-my-pi`, `omp-monorepo`, ~17K⭐, MIT, very active). Author: Can Boluk. Homepage: omp.sh.
> **TL;DR:** A **maximalist TS+Rust hybrid** coding/autonomous agent — a derivative of the `pi` harness that bolts on a ~55K-line Rust perf core + every feature pi deliberately omits (subagents, plan mode, memory, compression, collab). The clearest example in the set of the **"TS agent loop + Rust performance/safety natives"** architecture, which is the strongest language split signal for the SPEC.

## Stack & Architecture

```
oh-my-pi/  (omp-monorepo, Bun workspace + Rust workspace)
├── packages/                      # TypeScript (Bun) — the agent surface
│   ├── coding-agent/              # main CLI agent (@oh-my-pi/pi-coding-agent); ~60 subsystem dirs
│   ├── agent/                     # agent core
│   ├── ai/                        # provider abstraction (40+ providers)
│   ├── catalog/                   # tool/model catalog
│   ├── mnemopi/                   # memory subsystem
│   ├── snapcompact/               # context compression
│   ├── hashline/                  # content-addressed (hash) edits
│   ├── tui/, collab-web/, wire/, natives/, stats/, utils/
├── crates/                        # Rust — perf/safety core (via napi → TS)
│   ├── pi-natives/                # napi bridge: glob, grep, fd, ast, clipboard, fonts, block
│   ├── pi-shell/                  # vendored brush-core = pure-Rust POSIX shell
│   ├── pi-uu-grep/, pi-uutils-ctx/# uutils coreutils in Rust
│   ├── pi-ast/, pi-walker/, pi-iso/
│   └── vendor/{brush-core,brush-builtins}
├── Cargo.toml (lto="fat", edition 2024) · bun.lock · Dockerfile.robomp · infra/
```

**Numbers (README):** 40+ providers · 32 built-in tools · 14 LSP ops · 28 DAP (debugger) ops · ~55K lines Rust core. TS agent loop is the conductor; Rust owns every hot/sensitive path.

## Key Patterns (Pattern → Why → Spec rec)

1. **TS loop + Rust natives via napi-rs.** Glob/grep/fd/ast/clipboard/shell/coreutils in Rust; agent logic + extension in TS. → *Best of both:* TS iteration speed + npm/AI-SDK ecosystem AND Rust perf/memory-safety on hot paths. **SPEC: adopt this split as the canonical language architecture.**
2. **Bidirectional code-execution bridge.** Persistent Python + Bun worker kernels that can call *back into the agent's own tools* (read/search/task) over a loopback. → Agent never leaves the cell; load CSV via `tool.read` from Python, chart from JS. **SPEC: code-exec tool with a loopback tool-call bridge.**
3. **Worktree-isolated subagents with typed results.** `task` fans out into isolated git worktrees; each worker has its own tool surface; final yield is a **schema-validated object** the parent reads directly (no prose to parse, no sibling merge conflicts). **SPEC: subagents = worktree isolation + Zod/schema-validated return contract.**
4. **"Advisor" second model watching every turn + hindsight.** A second model observes the active turn, flags issues, and a `hindsight` pass reviews completed work. **SPEC: optional advisor/critic model lane per turn (multi-model deliberation without slowing the main loop).**
5. **Hashline — edit by content hash.** Edits addressed by a content hash of the surrounding lines → concurrent/agents can't silently clobber divergent buffers. **SPEC: content-addressed edit primitive (collision-safe multi-agent edits).**
6. **LSP wired into every write + real DAP debugger (28 ops).** Edits go through LSP diagnostics; the agent drives a real debugger with time-travel. **SPEC: LSP-as-write-validator + DAP debugger as first-class tools.**
7. **mnemopi (memory) + snapcompact (compression) as first-class packages.** Memory and compression are top-level subsystems, not afterthoughts. **SPEC: memory + compression are named, peer subsystems.**
8. **collab-web — "hand someone the link, they're in."** Live collaboration surface. → Agent is multi-tenant/shareable by design. **SPEC: collaboration/relay as an optional transport.**
9. **`web_search` chains 18 ranked providers → `read` URLs as structured markdown.** Unified tool surface over local + remote (arxiv/GitHub/SO). **SPEC: one read surface for local files + fetched remote URLs.**
10. **Vendored `brush` (pure-Rust POSIX shell) + uutils coreutils.** Shell tool doesn't shell out to bash; it runs a sandboxed Rust shell. → Security + determinism + Windows parity. **SPEC: sandboxed in-process shell, not /bin/bash.**

## Notable / Novel
- **Maximalist philosophy** = the deliberate opposite of upstream `pi` (which omits subagents/plan-mode). oh-my-pi ships everything; pi ships nothing-but-core. The SPEC should pick **pi's minimal core + oh-my-pi's Rust layer + opt-in feature packages** (best of both philosophies).
- `Dockerfile.robomp` + `infra/` → production/robot deployment patterns; `tui` + `collab-web` + `terminal-bench` → multi-surface.
- `lto = "fat"` for the Rust core = aggressive perf.

## ★★ TOP 5 PORT-WORTHY PATTERNS
1. **TS agent loop + Rust napi natives** for perf/safety paths — the single strongest language-architecture signal across all sources.
2. **Worktree-isolated subagents returning Zod/schema-validated objects** (no prose parsing, no sibling conflicts).
3. **Bidirectional code-exec bridge** (Python/Bun kernels call back into agent tools).
4. **Content-addressed (hash) edits** for collision-safe multi-agent editing.
5. **Sandboxed in-process Rust shell (vendored brush + uutils)** instead of shelling to /bin/bash.

## Verdict
oh-my-pi uniquely contributes the **validated hybrid TS+Rust architecture** and proves that the *features* a coding/autonomous agent needs (subagents, plan mode, memory, compression, collab, LSP/DAP, debug) can be delivered as **opt-in packages over a minimal core** — with all hot/sensitive paths in Rust.

## Key reference files
| Path | Teaches |
|---|---|
| `README.md` | "12 batteries-included" features; the TS+Rust split |
| `Cargo.toml` | Rust workspace: `pi-*` crates, `lto="fat"`, vendored brush/uutils |
| `crates/pi-natives/src/{glob,grep,fd,ast,clipboard}.rs` | napi perf bridge pattern |
| `packages/coding-agent/src/{task,advisor,hindsight,edit,mnemomp,snapcompact,modes,lsp,dap}/` | each flagship subsystem |
| `packages/hashline/` | content-addressed edits |
| `Dockerfile.robomp`, `infra/` | production/robot deployment |

## Scope note
Did not read individual subsystem source deeply (each is large). A deeper pass on `task` (worktree subagent protocol), `hashline` (edit-by-hash), and `pi-natives` (napi contract) would yield concrete APIs when implementing.
