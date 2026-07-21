# mya

A **unified coding/autonomous agent** — TypeScript core + Rust napi engine. Built from a [25-section SPEC](source/.learned/AGENT-SPEC.md) synthesized from 16 reference projects, reviewed across 44 rounds.

> **Status:** All major SPEC subsystems built + tested. Forked from pi-coding-agent (`@earendil-works/*` v0.80.10). Runs end-to-end with real LLM providers (MiniMax-M3 / OpenAI — verified). Installable via npm.

**Stats:** 32 packages · 3 Rust crates · ~182k LOC TypeScript · 1824 tests (142 files) · 0 @earendil runtime references.

---

## Install

```sh
npm install -g .
```

## Quick start

```sh
# One-shot prompt (auto-config: reads ~/.mya/agent/auth.json)
mya "What is 2+2?"

# JSON event stream (for piping / programmatic use)
mya --json "write a fibonacci function"

# Interactive TUI REPL (default — no args)
mya

# JSON-RPC 2.0 server over stdio (for editor integrations)
mya --rpc

# Web dashboard + WS gateway
mya serve --port 3999
```

### Auth (zero-config when possible)

The CLI auto-configures from `~/.mya/agent/auth.json`:
```json
{
  "minimax": { "key": "sk-..." },
  "openai": { "key": "sk-..." }
}
```

Or via env vars:
```sh
export MINIMAX_API_KEY="sk-..."        # model defaults to MiniMax-M3
export MINIMAX_MODEL="MiniMax-M3"      # MUST set (not "auto" — API rejects)
# or
export OPENAI_API_KEY="sk-..."
```

No key? Mock fallback — the agent still runs.

---

## Modes

| Mode | Command | Use case |
|---|---|---|
| **Interactive TUI** | `mya` | Default. Readline REPL with streaming + Ctrl-C abort |
| **One-shot print** | `mya "prompt"` | Single prompt → human-readable transcript |
| **JSON stream** | `mya --json "prompt"` | Newline-delimited RuntimeEvent JSON for piping |
| **RPC server** | `mya --rpc` | JSON-RPC 2.0 over stdio (editor integration) |
| **Web dashboard** | `mya serve` | HTTP + WS gateway with live event dashboard |

---

## Feature Areas

### Core Agent

| Area | Package(s) | Description |
|---|---|---|
| **Agent loop** | `core`, `agent` | createAgent() + runTurn FSM + LaneBoard + budget tree |
| **Providers** | `ai`, `pi-ai-src` | 35+ providers (OpenAI, Anthropic, MiniMax, Google, DeepSeek, Groq, Mistral, xAI, OpenRouter…) via pi-ai abstraction + OAuth + fallback |
| **Prompts** | `prompts` | 3-tier cache-stable assembler + injection scanner (8 patterns) + DriftGrader + compressors |
| **Tools** | `tools` | 9 builtins + permission gate (7-step) + dispatch + repair + hashline |
| **Memory** | `memory` | Brain + MemoryManager + SQLite FTS5 + Weibull decay + embeddings + consolidation |
| **Skills** | `skills` | SKILL.md curator + provenance + progressive disclosure |
| **Subagents** | `agent`, `coding-agent` | InProcessRunner + budget tree + isolated cwd + JSONL history |
| **Council** | `council` | CouncilProvider (fan-out + vote) + HindsightReviewer |

### Cron System (22 commits hardening — Phases 0-5)

| Feature | Description |
|---|---|
| **Scheduler** | Due sweep + background jobs + per-job sessions + SQLite run history |
| **Security scan** | 8 dangerous-command patterns: `destructive_root_rm`, `pipe_to_shell`, `cmd_subst_exec`, `eval_decoded`, `env_exfil`, `read_sensitive_file`, `reverse_shell`, `insecure_chmod` |
| **Auth** | Token file + cookie + CSRF Origin check + deny-mode + approval-mode |
| **Catch-up** | Missed-job recovery (nextRunAt + fire-once + advance) |
| **Shell jobs** | Direct shell command execution + `base_url`/snapshot + `context_from` |
| **Multi-platform delivery** | Telegram / Discord / Slack / Email / WhatsApp / Signal / Webhook / Matrix |
| **CLI** | `mya cron add/list/patch/run/delete` + dual-write (declarative + DB) |

```sh
mya cron add myjob "* * * * *" "Check server health"
mya cron list
mya cron run myjob --now
mya cron approval-mode require   # human-approve before exec
```

### Web & Browser Tools

| Tool | Description |
|---|---|
| **web_search** | Multi-backend: Tavily → Exa → Parallel → Firecrawl → SearXNG → Brave → **ddgs** (zero-key floor) |
| **web_extract** | Extract clean content from URLs |
| **web_fetch** | HTTP fetch + markdown conversion |
| **browser_navigate/snapshot/click/type/scroll/back/press/screenshot/close** | Camofox-backed browser automation (11 tools) |
| **browser_search** | Direct engine URL navigation (bypasses ref-based typing) |
| **browser_vision** | Screenshot + vision analysis question for vision-capable models |

> Browser tools require [Camofox](https://github.com/nichochar/camofox-browser) server running: `CAMOFOX_URL=http://127.0.0.1:3000`

### Gateway & Channels

| Endpoint | Description |
|---|---|
| `/health/live`, `/ready`, `/status` | Health + readiness probes |
| `/events` | WebSocket live event stream (`?token=XXX` query param) |
| `/cron/*` | Full cron CRUD + run + approval |
| `/sync/push`, `/sync/pull` | Cross-device state convergence (HLC + LWW) |
| `/collab/*` | Multi-user collaboration rooms (owner RW / guest RO) |
| `/push/*` | Web Push notifications (VAPID auto-gen + subscription persistence) |
| `/channels/*` | Channel management (Telegram/Discord/Slack/Email/WhatsApp/Signal) |
| `/mcp/*` | MCP server lifecycle (11-phase FSM) |
| `/pool/*` | Agent pool management |
| `/settings/*` | Runtime settings |
| `/webauthn/*` | WebAuthn registration/authentication |

```sh
# CSRF: Origin-header check (curl bypasses — no Origin = same-origin)
# RPC: via WebSocket only (no HTTP /rpc endpoint)
```

### Security & Audit

| Package | Description |
|---|---|
| `audit` | Tamper-evident Merkle audit log of every tool call/result |
| `secrets` | SecretStore + secret redactor + WebAuthn + pairing |
| `signing` | SHA-256 digest + sigstore verify (release integrity) |
| `secrets` | Secret redactor (scrub known secrets from tool output) |

---

## Architecture

```
my-agent/
├── packages/                        # 32 npm workspace packages
│   ├── core/              # Minimal frozen core: types (SSOT), loop, FSM, budget, laneboard, time
│   ├── agent/             # Assembly point: createAgent() + InProcessRunner (subagents, budget tree)
│   ├── ai/                # Provider abstraction: OpenAI adapter + Mock + Registry + streamWithFallback
│   ├── pi-ai-src/         # pi-ai TS source (35+ providers, OAuth) — forked from @earendil-works/pi-ai
│   ├── pi-agent-src/      # pi-agent-core TS source — forked from @earendil-works/pi-agent-core
│   ├── coding-agent/      # pi-coding-agent TS source — forked from @earendil-works/coding-agent
│   ├── tui/               # pi-tui TS source — forked from @earendil-works/pi-tui
│   ├── prompts/           # 3-tier cache-stable prompt + injection scanner + DriftGrader + compressors
│   ├── tools/             # Tool registry + permission gate + 9 builtins + web/browser/search tools
│   ├── memory/            # Brain + MemoryManager + SQLite FTS5 + Weibull + embeddings (32 files)
│   ├── skills/            # SKILL.md curator + provenance + progressive disclosure
│   ├── council/           # CouncilProvider (fan-out + vote) + HindsightReviewer
│   ├── workflows/         # Sandboxed JS workflow runner (Node vm, no fs/net/child_process)
│   ├── cron/              # CronScheduler (due sweep + background jobs + security scan + catch-up)
│   ├── audit/             # Tamper-evident Merkle audit log
│   ├── secrets/           # SecretStore + secret redactor + WebAuthn + pairing
│   ├── signing/           # SHA-256 digest + sigstore verify
│   ├── gateway/           # HTTP/WS gateway (auth, cron, sync, collab, push, channels, MCP, WS events)
│   ├── channels/          # Multi-platform delivery (Telegram/Discord/Slack/Email/WhatsApp/Signal)
│   ├── dap/               # DAP client (stdio JSON-RPC: launch/breakpoints/stack/variables)
│   ├── dap-server/        # Canned DAP debug-adapter server
│   ├── collab/            # Multi-user collab relay (authz: owner RW / guest RO)
│   ├── acp/               # ACP agent-lineage bridge (spawn ledger)
│   ├── sync/              # Multi-agent shared-state convergence (HLC + LWW push/pull)
│   ├── x402/              # Micropayments + wallet (HTTP 402 → pay → retry)
│   ├── pkg/               # Extension PackageHost (manifest registry + activation)
│   ├── eval/              # Parity harness + drift grading
│   ├── tts/               # Text-to-speech (macOS say / Linux espeak / MLX)
│   ├── print/             # Print transport + mya CLI entry + launcher + cron CLI
│   ├── rpc/               # stdio JSON-RPC 2.0 transport
│   ├── web/               # HTTP + WS gateway dashboard SPA (PWA)
│   ├── desktop/           # Desktop shell contracts (Tauri): deep-link + IPC + sidecar
│   └── natives/           # TS bridge to Rust napi engine (hash/glob/grep/time) + JS fallback
├── crates/
│   ├── natives/           # Rust napi: hash/glob/grep/time (NativeResult, no shell/sandbox)
│   ├── desktop-shell/     # Tauri native shell (boots gateway sidecar)
│   └── desktop-ui/        # Static frontend dist served by Tauri
├── source/.learned/       # SPEC (25 sections) + research docs (reference projects gitignored)
├── vendored/              # pi compiled JS (provider loading runtime + types + 18 deps)
├── AGENTS.md              # Project conventions
├── docs/                  # 35 technical docs (architecture, security, cron, memory, fork guide)
└── package.json           # npm workspaces + piConfig
```

---

## Fork: pi-coding-agent → mya

mya is forked from [`@earendil-works/*`](https://github.com/earendil-works/pi) v0.80.10 using a **source-first** strategy:

- **Own the source**: TS source copied into `packages/{coding-agent,pi-agent-src,pi-ai-src,tui}/` and bundled directly via esbuild — no npm runtime dependency on pi
- **piConfig branding**: `{"name":"mya","configDir":".mya"}` in `package.json` → dynamic APP_NAME/APP_TITLE throughout
- **15 fork markers** (`// mya fork:`) across 8 files — all documented in [docs/fork-pi-experience.md](docs/fork-pi-experience.md)
- **Zero `@earendil` references** in bundle (`grep -c "@earendil" dist/mya.js` = 0)

See:
- [docs/fork-pi-experience.md](docs/fork-pi-experience.md) — Fork strategy, sync procedure, lessons learned
- [docs/pi-clone-map.md](docs/pi-clone-map.md) — Detailed clone map (3-round reviewed)

---

## Development

```sh
npm install              # TypeScript 7 + workspace packages
npm run build            # tsc -b (all packages)
npm run bundle           # esbuild → dist/mya.js (single-file bundle)
npm run typecheck        # tsc --noEmit
npm test                 # vitest --pool forks (1824 tests)
npm run lint             # invariant #10 guard (no Date.now outside core.time)
npm run lint:deps        # invariant #19 guard (no cross-transport imports)
npm run lint:rust        # clippy clean (Rust natives)

# Cron dist force-rebuild (stale cache issue)
rm -rf packages/cron/dist && npx tsc -b packages/cron
```

> **Note:** `npx tsc -b` may show pre-existing TS errors in `coding-agent/` (rootDir/composite — pi code, not ours). `npm run bundle` (esbuild) succeeds regardless — esbuild doesn't type-check.

---

## Tools (9 builtins)

| Tool | Mode | Description |
|---|---|---|
| `read` | ReadOnly | Read file (+ optional `hashed` for hashline anchors) |
| `write` | WorkspaceWrite | Write content to file (overwrite) |
| `edit` | WorkspaceWrite | Exact-text replace (ambiguity-guarded) |
| `replace` | WorkspaceWrite | Hash-anchored line-range replace (stale detection) |
| `bash` | DangerFullAccess | Run shell command via `/bin/bash` (needs real approval) |
| `glob` | ReadOnly | Find files matching a glob pattern |
| `grep` | ReadOnly | Search file contents for a regex |
| `ls` | ReadOnly | List directory entries |
| `find` | ReadOnly | Find files in directory tree |

Plus: **web tools** (web_search, web_extract, web_fetch), **browser tools** (11 Camofox-backed), **code/codegraph** tools.

---

## Providers

| Provider | How |
|---|---|
| MiniMax | `MINIMAX_API_KEY` env → auto-config (model `MiniMax-M3`, base `api.minimax.io/v1`) |
| OpenAI | `OPENAI_API_KEY` env → auto-config (model `gpt-4o-mini`) |
| Anthropic | OAuth or `ANTHROPIC_API_KEY` |
| Any OpenAI-compatible | `OpenAIAdapter({ apiKey, baseUrl, model })` |
| 35+ providers | Via pi-ai abstraction (Google, DeepSeek, Groq, Mistral, xAI, OpenRouter…) |
| Mock | Always registered as fallback (agent runs without a key) |
| Council | `CouncilProvider({ members, strategy })` — fan-out N models → vote/aggregate |

---

## Slash commands

In the interactive TUI, mya exposes 18+ slash commands:

| Command | Description |
|---|---|
| `/audit` | Show audit-log summary (record count + Merkle tip) |
| `/mcp` | List/connect MCP servers, inspect discovered tools + health |
| `/wallet` | Show x402 wallet balance + receipts + health |
| `/debug` | Show DAP debug-tool status |
| `/cron` | List cron jobs with due/off state + nextRunAt + jobType |
| `/sync` | Show sync replica state (key count + HLC) |
| `/collab` | Show collab relay rooms + client counts |
| `/acp` | Show ACP agent-lineage spawn + ledger event counts |
| `/workflow` | Run a mya workflow file |
| `/sign` | Verify a tarball signature (SHA-256 + sigstore sidecar) |
| `/pkg` | List registered extension packages |
| `/council` | Show multi-model council status |
| `/memory` | Show Brain stats (facts, pending, takes, embedded) |
| `/skills` | Show skill-store status |
| `/secrets` | Show secret-store status |
| `/eval` | Run eval unit-tier parity tests |
| `/channel` | Manage messaging channels |
| `/mya-help` | List all mya bridge commands |

---

## Design Principles

- **Minimal core + maximal package edge** (pi model): `core` is tiny + frozen; every capability is a package.
- **No OS sandbox** (pi model): agent runs in the user's environment; §7 permission gate is the only control.
- **TypeScript 7** (native Go compiler, ~10× faster builds) + **Rust** (napi) for perf/safety natives.
- **Invariant-driven**: `nowWallclock()` for all timestamps (Invariant #10), no cross-transport imports (Invariant #19), no `process::exit` in natives.
- **npm-distributable**: `npm install -g`; Rust natives ship prebuilt.
- **SPEC-driven**: every design decision traces to [source/.learned/AGENT-SPEC.md](source/.learned/AGENT-SPEC.md).

See [AGENTS.md](AGENTS.md) for conventions (Rust gate, invariants, style).

---

## Documentation

| Doc | Description |
|---|---|
| [docs/fork-pi-experience.md](docs/fork-pi-experience.md) | Fork strategy, sync procedure, 8 lessons learned |
| [docs/pi-clone-map.md](docs/pi-clone-map.md) | Detailed pi → mya clone map (3-round reviewed) |
| [docs/cron-system-reference.md](docs/cron-system-reference.md) | Cron architecture, schema, security, CLI |
| [docs/FEATURE-CATALOG.md](docs/FEATURE-CATALOG.md) | Feature catalog (18 areas) |
| [docs/test-plan-comprehensive.md](docs/test-plan-comprehensive.md) | Comprehensive test plan |
| [docs/untested-features.md](docs/untested-features.md) | Features blocked by missing credentials |
| [source/.learned/AGENT-SPEC.md](source/.learned/AGENT-SPEC.md) | Authorative SPEC (25 sections) |

---

## Security

- **Secret scan**: MYA code is clean — no hardcoded API keys, tokens, passwords, or private keys. All credentials loaded from `~/.mya/agent/auth.json` (gitignored) or env vars.
- **`.gitignore`**: Covers `.env*`, `~/.mya/`, `node_modules/`, `dist/`, `target/`, `*.node`, `source/*` (reference projects).
- **OAuth client IDs** (e.g., Anthropic `9d1c250a-...`) are public identifiers by OAuth 2.0 design — not secrets.
- **Trust model**: mya fully trusts pi code (no sandbox, no capability restriction) — by design per AGENTS.md §7. Permission gate is the only runtime control.

See [docs/security-audit.md](docs/security-audit.md) for the full security review.

---

## Review history

44 review rounds (6 batches × 3 rounds each), each reading actual code. Key findings fixed:

| Round | Finding |
|---|---|
| R37 | budget double-count, turn/start event lost |
| R38 | bash auto-allow (security), scanInject on paths |
| R40 | code tool security (DangerFullAccess), codegraph canonical |
| R42 | **workflow sandbox bypass** (body ran outside vm) |
| R43 | DAP frameId 0, hindsight JSON `}` in string |
| R44 | **x402 double-pay** (malicious 402 loop), negative amount |

Plus 22-commit cron hardening saga (Phases 0-5) and PI sync 0.80.6→0.80.10 (585 files, 8 P1 fixes).

Full review log in [source/.learned/REVIEW-LOG.md](source/.learned/REVIEW-LOG.md).

---

## License

MIT OR Apache-2.0 (dual).
