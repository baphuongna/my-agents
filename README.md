# mya

A **unified coding/autonomous agent** — TypeScript core + Rust napi engine. Built from a [25-section SPEC](source/.learned/AGENT-SPEC.md) synthesized from 16 reference projects, reviewed across 44 rounds. 29 packages, 223 tests.

> **Status:** All major SPEC subsystems built + tested. Runs end-to-end with real LLM providers (MiniMax-M3 / OpenAI — verified). Installable via npm.

## Install

```sh
npm install -g .
```

Or from the registry (once published):
```sh
npm install -g mya
```

## Quick start

```sh
# One-shot prompt (auto-config: reads ~/.pi/agent/auth.json for MiniMax/OpenAI keys)
mya "What is 2+2?"

# JSON event stream (for piping / programmatic use)
mya --json "write a fibonacci function"

# Interactive TUI REPL (default — no args)
mya

# JSON-RPC 2.0 server over stdio (for editor integrations)
mya --rpc

# Web dashboard + WS gateway
mya serve --port 3000
```

### Auth (zero-config when possible)

The CLI auto-configures from `~/.pi/agent/auth.json`:
```json
{
  "minimax": { "key": "sk-..." }
}
```

Or via env vars:
```sh
export MINIMAX_API_KEY="sk-..."   # or OPENAI_API_KEY
mya "hello"
```

No key? Mock fallback — the agent still runs.

## Modes

| Mode | Command | Use case |
|---|---|---|
| **Interactive TUI** | `mya` | Default. Readline REPL with streaming + Ctrl-C abort |
| **One-shot print** | `mya "prompt"` | Single prompt → human-readable transcript |
| **JSON stream** | `mya --json "prompt"` | Newline-delimited RuntimeEvent JSON for piping |
| **RPC server** | `mya --rpc` | JSON-RPC 2.0 over stdio (editor integration) |
| **Web dashboard** | `mya serve` | HTTP + WS gateway with live event dashboard SPA |

## Development

```sh
npm install              # TypeScript 7 + workspace packages
npm run build            # tsc -b (all packages)
npm run bundle           # esbuild → dist/mya.js (single-file bundle)
npm run typecheck        # tsc --noEmit
npm test                 # vitest (223 tests)
npm run lint             # invariant #10 guard (no Date.now outside core.time)
npm run lint:deps        # invariant #19 guard (no cross-transport imports)
npm run lint:rust        # clippy clean (Rust natives)
```

## Architecture

```
my-agent/
├── packages/
│   ├── core/          # THE minimal frozen core: types (SSOT), loop, FSM, budget, laneboard, time
│   ├── ai/            # provider abstraction: OpenAI adapter + Mock + Registry + streamWithFallback
│   ├── prompts/       # 3-tier cache-stable prompt + injection scanner + DriftGrader + compressors
│   ├── tools/         # tool registry + permission gate + 9 builtins + hashline edit
│   ├── memory/        # MemoryManager + per-role backends (InMemory + FileBackend durable)
│   ├── skills/        # SKILL.md curator + provenance + progressive disclosure
│   ├── subagents/     # InProcessRunner + budget tree (CC2) + CoW isolation + 6 topologies
│   ├── codeexec/      # bidirectional code-exec bridge (JS/Python ↔ tools via JSON-RPC)
│   ├── codenav/       # codegraph (file-relevance import graph)
│   ├── council/       # CouncilProvider (fan-out + vote) + HindsightReviewer (advisor lane)
│   ├── workflows/     # sandboxed JS workflow runner (Node vm, no fs/net/child_process)
│   ├── channels/      # hook registry + MCP 11-phase lifecycle FSM
│   ├── lsp/           # LSP client (stdio JSON-RPC: hover/def/refs/diagnostics)
│   ├── dap/           # DAP client (stdio JSON-RPC: launch/breakpoints/stack/variables)
│   ├── collab/        # multi-user collab relay (authz: owner RW / guest RO)
│   ├── x402/          # micropayments + wallet (HTTP 402 → pay → retry)
│   ├── eval/          # parity harness + drift grading
│   ├── agent/         # THE assembly point: createAgent() wires everything together
│   ├── print/         # print transport (--json | human transcript)
│   └── sdk/           # embedded library (AsyncIterable<RuntimeEvent>)
├── crates/
│   └── natives/       # Rust napi: hash/glob/grep/time (NativeResult, no shell/sandbox)
├── source/.learned/   # SPEC (25 sections) + FEATURE-INVENTORY + REVIEW-LOG + deepdives
├── AGENTS.md          # project conventions (the project-truth source)
└── package.json       # npm workspaces, TypeScript 7
```

## Package reference

| Package | § | Purpose |
|---|---|---|
| `core` | §4 | Type glossary SSOT (TurnState, BudgetConfig, RuntimeEvent, Tool, Mode…) + runTurn FSM + LaneBoard |
| `ai` | §6 | OpenAIAdapter (real HTTP/SSE) + MockProvider + ProviderRegistry (taint/cooldown) + streamWithFallback |
| `prompts` | §5 | 3-tier cache-stable assembler + injection scanner (8 patterns) + DriftGrader + window/summarize compressors |
| `tools` | §7 | ToolRegistry + permission gate (7-step) + dispatch (parallel, DegradedResult) + repair + hashline |
| `memory` | §8 | MemoryManager (sync snapshot, async refresh) + InMemory/FileBackend (durable markdown) |
| `skills` | §9 | parseSkillMarkdown + SkillStore (discover, index, loadBody, suggest) + provenance |
| `subagents` | §10 | InProcessRunner (budget deriveChild + CC2 refund) + CoW isolation (file_copy) + 6 topologies |
| `codeexec` | §11.4 | `code` tool: JS/Python script calls `tool()` ↔ agent registry via stdin/stdout JSON-RPC |
| `codenav` | §11.3 | codegraph: import-graph file-relevance index (TS/JS/Python/Rust regex matchers) |
| `council` | §6/§10 | CouncilProvider (attributed/majority/judge) + HindsightReviewer (structured critique JSON) |
| `workflows` | §25 | runWorkflow: Node vm sandbox (frozen ctx, no fs/net) + timeout + log events |
| `channels` | §12 | HookRegistry (priority + isolation) + MCP 11-phase FSM (quarantine after 5 failures) |
| `lsp` | §11.1 | LspClient: Content-Length framed stdio JSON-RPC (initialize/didOpen/hover/def/refs/diagnostics) |
| `dap` | §11.2 | DapClient: same framing, launch/attach/setBreakpoints/continue/step/stackTrace/scopes/variables/evaluate |
| `collab` | §25.4 | CollabRelay: in-memory bus, per-room authz (owner RW / guest RO / guest-approval RW) |
| `x402` | Frontier | Wallet (balance/pay/receipt) + X402Client (402→pay→200, pay-once, timeout) + paidFetch tool |
| `eval` | §15 | ParityHarness: MOCK scenarios graded via DriftGrader (identity/window) |
| `agent` | §3 | createAgent(): wires providers + memory + tools + prompt + fallback into one entry point |
| `print` | §20 | print transport: `--json` (one RuntimeEvent/line) or human transcript |
| `sdk` | §20 | embedded lib: `new Agent(config).prompt(text): AsyncIterable<RuntimeEvent>` |

## Tools (9 builtins)

| Tool | Mode | Description |
|---|---|---|
| `read` | ReadOnly | read file (+ optional `hashed` for hashline anchors) |
| `write` | WorkspaceWrite | write content to file (overwrite) |
| `edit` | WorkspaceWrite | exact-text replace (ambiguity-guarded) |
| `replace` | WorkspaceWrite | hash-anchored line-range replace (stale detection) |
| `bash` | DangerFullAccess | run shell command via `/bin/bash` (needs real approval) |
| `glob` | ReadOnly | find files matching a glob pattern |
| `grep` | ReadOnly | search file contents for a regex |
| `code` | DangerFullAccess | run JS/Python with round-trip tool access |
| `codegraph` | ReadOnly | list files related to a path (import graph) |

## Providers

| Provider | How |
|---|---|
| MiniMax | `MINIMAX_API_KEY` env → auto-config (model `MiniMax-M3`, base `api.minimax.io/v1`) |
| OpenAI | `OPENAI_API_KEY` env → auto-config (model `gpt-4o-mini`) |
| Any OpenAI-compatible | `OpenAIAdapter({ apiKey, baseUrl, model })` |
| Mock | always registered as fallback (agent runs without a key) |
| Council | `CouncilProvider({ members, strategy })` — fan-out N models → vote/aggregate |

## Design

- **Minimal core + maximal package edge** (pi model): `core` is tiny + frozen; every capability is a package.
- **No sandbox** (pi model): agent runs in the user's environment; §7 permission gate is the only control.
- **TypeScript 7** (native Go compiler, ~10× faster builds) + **Rust** (napi) for perf/safety natives.
- **npm-distributable**: `npm install -g`; Rust natives ship prebuilt (no cargo for end-users).
- **SPEC-driven**: every design decision traces to [source/.learned/AGENT-SPEC.md](source/.learned/AGENT-SPEC.md) (25 sections, sourced from 16 reference projects).

See [AGENTS.md](AGENTS.md) for conventions (Rust gate, invariants, style).

## Development

```sh
npm run build              # tsc -b (all packages)
npm run typecheck          # tsc --noEmit
cargo build -p my-agent-natives   # Rust natives
cargo clippy -p my-agent-natives -- -D warnings   # clippy clean
```

## Review history

18 review rounds (6 batches × 3 rounds), each reading actual code:

| Round | Scope | Key findings |
|---|---|---|
| R37 | Tier 0 | budget double-count, turn/start event lost, u128 napi |
| R38 | Tier 1.1+1.2 | bash auto-allow (security), scanInject on paths |
| R39 | Tier 1.4-1.7 | budget tree rewrite (CC2 refund), memory id at read-time |
| R40 | Tier 2.1-2.3 | code tool security (DangerFullAccess), codegraph canonical, Python hang |
| R41 | Tier 2.4 | council usage undercount, member timeout, judge input ADD |
| R42 | Tier 2.5-2.8 | **workflow sandbox bypass** (body ran outside vm), JSDoc comment nesting |
| R43 | Tier 3 | DAP frameId 0, hindsight JSON `}` in string, collab identity |
| R44 | x402 | **double-pay** (malicious 402 loop), negative amount (free money), fetch timeout |

## SPEC

The authoritative design is [source/.learned/AGENT-SPEC.md](source/.learned/AGENT-SPEC.md) (36-line index → `spec/00-OVERVIEW.md` through `spec/12-ui-surfaces.md`, 13 files). Feature inventory in [FEATURE-INVENTORY.md](source/.learned/FEATURE-INVENTORY.md). Full review log in [REVIEW-LOG.md](source/.learned/REVIEW-LOG.md).

## License

MIT OR Apache-2.0 (dual).
