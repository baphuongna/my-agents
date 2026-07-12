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
- [ ] Wrap pi-ai providers into mya ProviderProfile interface
- [ ] Port pi's ls/find tools into mya tools
- [ ] Wire extensions support (pi-crew needs runtime package resolution)
- [ ] DAP adapter for debugging
- [ ] LLM-driven dream cycle
