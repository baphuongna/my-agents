# PLAN-REMAINING — Final Roadmap to a Runnable `mya` Command

> Post-Phase 13 state: 40 packages, 212 tests, 27 commits, engine complete.
> This plan covers ALL remaining gaps (SPEC + UI + publish) in 3 phases.

## Current State

**Engine**: ✅ complete — turn FSM, 7-step permission, 10/22 dream-cycle phases,
4-arm RRF, ragfs scan-on-read, CoW subagents, gateway control-plane, telemetry,
212 tests, CI green.

**CLI**: ✅ `my-agent` bin works (MiniMax verified: "What is 2+2?" → "Four.").
But `bin` is named `my-agent`, not `mya`. TUI/RPC are libraries (no entry).
Web/desktop are built but need startup scripts.

## Phase 14: Remaining SPEC Gaps (tractable)

### 14a. §9 Skills — SkillCurator + SkillProvenance fix
- **SkillProvenance**: change from interface `{sourcePath, loadedAt}` to the
  spec's 4-value enum `"Bundled" | "HubInstalled" | "UserCreated" | "AgentCreated"`.
  Gate which skills the curator may touch.
- **SkillCurator**: implement `curate(store, opts)`: inactivity-triggered prune
  (archive-not-delete), `prune_builtins` flag, pinned-skills bypass. Runs on
  auxiliary provider chain (Phase 14 wires to MockProvider for testing).
- **Tests**: curator prune/archive/pin; provenance enum gating.

### 14b. §15 Eval — tier fix + no-egress guard
- Change `ParityScenario.tier` from `"mock" | "live"` to spec's
  `"unit" | "integration" | "credentialed"`.
- **no-egress guard**: monkey-patch `globalThis.fetch` during non-credentialed
  test runs; fail the test if any network call fires outside the credentialed tier.
- **golden-set age gate**: check `recordedAt + maxGoldenAgeDays` on golden
  fixtures; warn if stale.
- **Tests**: egress fence blocks fetch in unit tier; allows in credentialed.

### 14c. §8 — GoalsRole prompt rendering + performance
- **GoalsRole → prompt**: wire `GoalsRole.systemPromptBlock(store)` into the
  volatile tier composition (`buildVolatileTier` or `assemblePrompt`). The goals
  text now appears in the agent's system prompt.
- **conversationFactsBackfill incremental**: track `lastBackfillIdx`; only scan
  new history entries (not the entire conversation every turn).
- **brain.backlinks() cache**: cache the result; invalidate on `recordFact`.
- **Tests**: goals appear in assembled prompt; backfill is incremental (N facts
  scanned once, not N×N).

### 14d. §6 — resolveToolName mapping
- Replace the stub `return rawName` with a config-declared alias map
  (`{ "search_web": "web_search", "fs_read": "read" }`). Pure deterministic.
- **Test**: resolveToolName maps a known alias; passes through unknown names.

## Phase 15: Complete UI (all transports runnable)

### 15a. TUI entry point — interactive REPL
- Create `packages/tui/src/cli.ts`:
  ```ts
  #!/usr/bin/env node
  // mya-tui — interactive REPL over the agent core
  import { createAgent } from "@my-agent/agent";
  import { TuiRepl } from "./index.js";
  // ... auto-config (auth.json + env) + boot the REPL
  ```
- Features: readline prompt cycle, Ctrl-C abort, streaming event rendering,
  approval modal (y/n), slash commands (`/help`, `/budget`, `/memory`).
- Wire to `createAgent` → `agent.run(text, sink)`.
- **Test**: boot TuiRepl with mock provider, send a prompt, verify output.

### 15b. RPC entry point — JSON-RPC stdio server
- Create `packages/rpc/src/cli.ts`:
  ```ts
  #!/usr/bin/env node
  // mya-rpc — JSON-RPC 2.0 server over stdio (for editor integrations)
  import { createAgent } from "@my-agent/agent";
  import { RpcServer } from "./index.js";
  // ... boot the RPC server bound to createAgent
  ```
- Methods: `prompt`, `cancel`, `status`, `heartbeat`.
- **Test**: send a JSON-RPC `prompt` request via stdin, verify response.

### 15c. Web dashboard startup — `mya serve`
- Create `packages/gateway/src/cli.ts`:
  ```ts
  #!/usr/bin/env node
  // mya serve — HTTP + WS gateway with the web dashboard at /
  import { createAgent } from "@my-agent/agent";
  import { Gateway } from "./index.js";
  import { dashboardHtml } from "@my-agent/web";
  // ... boot the gateway on port 3000 (or --port)
  ```
- Serves the SPA dashboard + WS event stream + control-plane REST.
- **Test**: `curl localhost:3000/health/live` → 200.

### 15d. Desktop launch verification
- Verify the Tauri shell (`crates/desktop-shell`) launches the web dashboard
  in a webview. If Tauri builds in this env, produce a binary; else document
  the `cargo tauri dev` command for local development.

## Phase 16: The `mya` Command — npm-installable + runnable

### 16a. Multi-mode `mya` CLI
- Rename `bin` from `my-agent` to **`mya`** in root package.json.
- Single entry point (`packages/print/src/cli.ts` rewritten):
  ```bash
  mya "hello"              # default: interactive TUI REPL
  mya --print "hello"      # print mode (transcript or --json)
  mya --rpc                # JSON-RPC stdio server
  mya serve                # web dashboard + gateway
  mya --model gpt-4o "..." # explicit model
  echo "hi" | mya --json   # stdin pipe → JSON stream
  ```
- Auto-config (existing): reads `~/.pi/agent/auth.json` → MiniMax/OpenAI/mock.
- Auth file: `~/.mya/config.toml` or `~/.pi/agent/auth.json` (backward compat).

### 16b. npm-publishable package.json
```jsonc
{
  "name": "@mya/agent",         // or "mya" if unscoped
  "version": "0.1.0",
  "description": "Unified coding + autonomous agent (TypeScript 7 + Rust natives)",
  "bin": { "mya": "./packages/print/dist/cli.js" },
  "engines": { "node": ">=20" },
  "os": ["darwin", "linux", "win32"],
  "optionalDependencies": {
    "@mya/natives-darwin-arm64": "*",
    "@mya/natives-linux-x64": "*"
    // prebuilt napi binaries via optionalDependencies
  }
}
```

### 16c. README + install instructions
```markdown
# mya — Unified Agent

## Install
npm install -g mya

## Quick start
mya "Hello, what can you do?"
```

### 16d. `npm pack` verification
- `npm pack` produces a tarball.
- `npm install -g ./mya-0.1.0.tgz` + `mya "hello"` works end-to-end.
- Integration test: `mya "What is 2+2?"` → real MiniMax response.

### 16e. Final integration test
```bash
# Install globally
npm install -g .

# Run
mya "What is 2+2? Answer in one word."
# Expected: "Four." + cost + provider info

# JSON mode
mya --json "hello" | head -1
# Expected: {"kind":"turn","stage":"start"}

# Interactive (TUI)
mya
# Expected: greeting + prompt → type a message → streaming response
```

## Summary: what each phase delivers

| Phase | Scope | Tests | Outcome |
|---|---|---|---|
| **14** | SPEC gaps (curator, eval, goals-render, resolveToolName, perf) | +10 | All tractable SPEC gaps closed |
| **15** | TUI/RPC/Web entry points (all transports runnable) | +5 | 4 ways to use the agent: TUI, RPC, Web, CLI |
| **16** | `mya` command + npm publishable + verified install | +3 | `npm i -g mya && mya "hello"` works |

## After Phase 16: what remains (documented, not blocking)

- DAP live adapter (vscode-js-debug env limitation)
- 12 LLM-driven dream-cycle phases (need a model in the loop)
- no-explicit-any ESLint (TS-7 incompatibility)
- CCR side-cache + Trident compaction (large)
- Provider compat flags (~20)
- Durable audit persistence (SQLite backend)
- Collab E2E + CRDT (medium)
- Desktop tray/overlay/notification
