# mya

A **unified coding/autonomous agent** — TypeScript core + Rust napi engine. Built from a [25-section SPEC](source/.learned/AGENT-SPEC.md) synthesized from 16 reference projects, reviewed across 44 rounds. 32 packages, 308 tests.

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
# One-shot prompt (auto-config: reads ~/.mya/agent/auth.json for MiniMax/OpenAI keys)
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

The CLI auto-configures from `~/.mya/agent/auth.json`:
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
npm test                 # vitest (308 tests)
npm run lint             # invariant #10 guard (no Date.now outside core.time)
npm run lint:deps        # invariant #19 guard (no cross-transport imports)
npm run lint:rust        # clippy clean (Rust natives)
```

## Architecture

```
my-agent/
├── packages/                        # 29 npm workspace packages
│   ├── core/          # THE minimal frozen core: types (SSOT), loop, FSM, budget, laneboard, time
│   ├── agent/         # THE assembly point: createAgent() + InProcessRunner (subagents, budget tree)
│   ├── ai/            # provider abstraction: OpenAI adapter + Mock + Registry + streamWithFallback
│   ├── prompts/       # 3-tier cache-stable prompt + injection scanner + DriftGrader + compressors
│   ├── tools/         # tool registry + permission gate + 9 builtins + hashline + LspClient + codegraph
│   ├── memory/        # Brain + MemoryManager + per-role backends (InMemory + FileBackend durable)
│   ├── skills/        # SKILL.md curator + provenance + progressive disclosure
│   ├── council/       # CouncilProvider (fan-out + vote) + HindsightReviewer (advisor lane)
│   ├── workflows/     # sandboxed JS workflow runner (Node vm, no fs/net/child_process)
│   ├── cron/          # CronScheduler (due sweep + background jobs)
│   ├── audit/         # tamper-evident Merkle audit log
│   ├── secrets/       # SecretStore + secret redactor
│   ├── signing/       # SHA-256 digest + sigstore verify (release integrity)
│   ├── gateway/       # HTTP/WS gateway + HookRegistry + MCP 11-phase manager + readiness
│   ├── dap/           # DAP client (stdio JSON-RPC: launch/breakpoints/stack/variables)
│   ├── dap-server/    # canned DAP debug-adapter server (proves the client end-to-end)
│   ├── collab/        # multi-user collab relay (authz: owner RW / guest RO)
│   ├── acp/           # ACP agent-lineage bridge (spawn ledger)
│   ├── sync/          # multi-agent shared-state convergence (HLC + LWW push/pull)
│   ├── x402/          # micropayments + wallet (HTTP 402 → pay → retry)
│   ├── pkg/           # extension PackageHost (manifest registry + activation)
│   ├── eval/          # parity harness + drift grading
│   ├── tts/           # text-to-speech surface (macOS say / Linux espeak / no-op)
│   ├── print/         # print transport (--json | human transcript)
│   ├── rpc/           # stdio JSON-RPC 2.0 transport (editor integration)
│   ├── tui/           # interactive TUI (pi InteractiveMode + mya bridge)
│   ├── web/           # HTTP + WS gateway dashboard SPA
│   ├── desktop/       # desktop shell contracts (Tauri): deep-link + IPC + sidecar lifecycle
│   └── natives/       # TS bridge to Rust napi engine (hash/glob/grep) + JS fallback
├── crates/
│   ├── natives/       # Rust napi: hash/glob/grep/time (NativeResult, no shell/sandbox)
│   ├── desktop-shell/ # Tauri native shell (boots gateway sidecar, serves frontendDist)
│   └── desktop-ui/    # static frontend dist served by Tauri (index.html, not a Rust crate)
├── source/.learned/   # SPEC (25 sections) + FEATURE-INVENTORY + REVIEW-LOG + deepdives
├── AGENTS.md          # project conventions (the project-truth source)
└── package.json       # npm workspaces, TypeScript 7
```

> **Note on sub-systems vs packages:** `subagents`, `codeexec`, and `codenav`
> are capabilities that live *inside* existing packages (`agent`, `tools`),
> not separate packages. Likewise `channels`/MCP live in `gateway` and the
> `lsp` client lives in `tools`. The 32 packages above are the real workspace
> members.

## Package reference

| Package | § | Purpose |
|---|---|---|
| `core` | §4 | Type glossary SSOT (TurnState, BudgetConfig, RuntimeEvent, Tool, Mode…) + runTurn FSM + LaneBoard |
| `agent` | §3/§10 | createAgent(): wires providers + memory + tools + prompt + fallback; InProcessRunner (subagents + budget tree) |
| `ai` | §6 | OpenAIAdapter (real HTTP/SSE) + MockProvider + ProviderRegistry (taint/cooldown) + streamWithFallback |
| `prompts` | §5 | 3-tier cache-stable assembler + injection scanner (8 patterns) + DriftGrader + window/summarize compressors |
| `tools` | §7/§11 | ToolRegistry + permission gate (7-step) + dispatch + repair + hashline + `code` tool + codegraph + LspClient |
| `memory` | §8 | Brain + MemoryManager (sync snapshot, async refresh) + InMemory/FileBackend (durable markdown) |
| `skills` | §9 | parseSkillMarkdown + SkillStore (discover, index, loadBody, suggest) + provenance |
| `council` | §6/§10 | CouncilProvider (attributed/majority/judge) + HindsightReviewer (structured critique JSON) |
| `workflows` | §25 | runWorkflow: Node vm sandbox (frozen ctx, no fs/net) + timeout + log events |
| `cron` | §25 | CronScheduler: register/list/sweep cron jobs with due detection |
| `audit` | §18 | AuditLog: tamper-evident Merkle log of every tool call/result + channel event |
| `secrets` | §18 | SecretStore + secret redactor (scrub known secrets from tool output before display) |
| `signing` | Frontier | fileSha256 + sigstore verify (release-tarball integrity before apply) |
| `gateway` | §12/§25 | HTTP/WS gateway + HookRegistry (priority + isolation) + MCP 11-phase FSM + readiness probes |
| `dap` | §11.2 | DapClient: Content-Length framed stdio JSON-RPC (launch/attach/breakpoints/stack/variables/evaluate) |
| `dap-server` | §11.2 | Canned DAP debug-adapter server (proves the DapClient against a conformant peer) |
| `collab` | §25.4 | CollabRelay: in-memory bus, per-room authz (owner RW / guest RO / guest-approval RW) |
| `acp` | §10 | AcpBridge: agent-lineage spawn ledger (ACP `spawn` events, replay) |
| `sync` | §23 | SyncServer: last-writer-wins per key + HLC + server-authoritative push/pull |
| `x402` | Frontier | Wallet (balance/pay/receipt) + X402Client (402→pay→200, pay-once, timeout) + paidFetch tool |
| `pkg` | §25 | PackageHost: registered extension packages (manifest + activation state) |
| `eval` | §15 | ParityHarness: MOCK scenarios graded via DriftGrader (identity/window) |
| `tts` | §25 | speak(): text-to-speech abstraction + platform detection (say/espeak/no-op) |
| `print` | §20 | print transport: `--json` (one RuntimeEvent/line) or human transcript |
| `rpc` | §20 | stdio JSON-RPC 2.0 transport (prompt/cancel/status/heartbeat + streaming notifications) |
| `tui` | §20 | interactive TUI: pi InteractiveMode + mya bridge (all 18 slash commands) |
| `web` | §25 | HTTP + WS gateway dashboard SPA (live RuntimeEvent stream) |
| `desktop` | §25.3 | desktop shell contracts: deep-link (`myagent://`) + IPC + sidecar lifecycle (Tauri) |
| `natives` | §18 | TS bridge to Rust napi engine (BLAKE3 hash, glob, grep) + pure-JS fallback |

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

## Slash commands

In the interactive TUI, mya exposes 18 slash commands that surface every package:

| Command | Description |
|---|---|
| `/audit` | Show mya audit-log summary (record count + Merkle tip) |
| `/mcp` | List/connect MCP servers, inspect discovered tools + health |
| `/wallet` | Show x402 wallet balance + receipts + health |
| `/debug` | Show DAP debug-tool status (adapter command + args) |
| `/cron` | List cron jobs with due/off state |
| `/sync` | Show sync replica state (key count + HLC wall/counter/node) |
| `/collab` | Show collab relay rooms + client counts |
| `/acp` | Show ACP agent-lineage spawn + ledger event counts |
| `/workflow` | Run a mya workflow file (`.wf` / `.js`): `/workflow <file>` |
| `/sign` | Verify a tarball signature (SHA-256 + sigstore sidecar) |
| `/pkg` | List registered extension packages |
| `/council` | Show multi-model council status (members + strategy + health) |
| `/memory` | Show Brain stats (facts, pending, takes, embedded) |
| `/skills` | Show skill-store status (loaded from `~/.mya/skills/`) |
| `/secrets` | Show secret-store status (registered secret count) |
| `/eval` | Run eval unit-tier parity tests |
| `/channel` | Manage messaging channels (list/setup/config/send/health) |
| `/mya-help` | List all mya bridge commands |

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
