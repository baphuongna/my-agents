# PLAN — mya current status (post-consolidation)

## Architecture

mya = pi InteractiveMode (100% cloned) + custom agent backend (print/rpc/serve).

### Interactive mode (default `mya`)
- Entry: packages/print/src/main.ts → pi-main.ts → vendored/pi/dist/main.js
- TUI: packages/tui/ (renamed from @earendil-works/pi-tui)
- Config: ~/.mya/agent/ (auth.json, models.json, settings.json, themes/)
- Model: MiniMax-M3 (OpenAI-compatible, configured in models.json)

### Print/RPC/Serve modes
- Entry: packages/print/src/main.ts → createAgent() from @my-agent/agent
- Uses: core, ai, memory, prompts, skills, tools, council, natives

## Package structure (29 packages)

### Active (14)
core, agent, ai, memory, prompts, skills, tools, council,
natives, print, rpc, gateway, web, tui

### Standalone (15)
audit, signing, secrets, pkg, dap, dap-server, eval,
workflows, cron, acp, collab, sync, tts, desktop, x402

### Vendored (cloned pi)
vendored/pi/ (pi-coding-agent), vendored/pi-ai/, vendored/pi-agent-core/

## Remaining work

### Completed (recent)
- [x] **Hermes Agent port** — 8 phases, 6,316 LOC, 553 tests, 35 bugs fixed across 7 review rounds. See `PLAN-HERMES-PORT.md`.
  - Phase 0: Redaction engine (40+ secret patterns) + threat scanner (3-tier injection detection)
  - Phase 1: MCP reliability (reconnect budget, failure classification, keepalive)
  - Phase 2: Context compression engine (idle compaction, per-model threshold, anti-thrashing)
  - Phase 3: FTS5 improvements (CJK bigram tokenizer, external-content schema, REINDEX repair)
  - Phase 4: Gateway hardening (stale lock detection, hard-exit, session branch/seed, durable ack)
  - Phase 5: DDGS process isolation (disposable child process)
  - Phase 6: MCP OAuth storage layer (0600 atomic writes, dead-client auto-rereg)
  - Phase 7: Kanban SQLite upgrade (7-table schema, DAG, 12 tools, notifications)
  - Phase 8: Provider routing (sticky session_id, route URL identity, fail-closed context pin)
- [x] Wire main.ts → createAgent + Gateway (Phase 1)
- [x] Codebase hygiene (Phase 8)
- [x] DAP TCP socket leak fix + CLI debug tool wiring (Phase 4)

### Still open
- [ ] Wrap pi-ai providers into mya ProviderProfile interface
- [ ] Port pi's ls/find tools into mya tools
- [ ] Wire extensions support (pi-crew needs runtime package resolution)
- [ ] LLM-driven dream cycle
- [ ] Full MCP OAuth browser/callback flow (storage layer shipped; flow deferred)
