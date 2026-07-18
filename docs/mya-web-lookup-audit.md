# mya Web-Lookup Audit

> **IMPLEMENTATION STATUS (2026-07-18): DONE — Phases 1-5 of `docs/PLAN-BROWSER.md`.**
> The audit below documents the PRE-implementation state. As of commit `d1a56e8` + Phase 6:
> - **Browser**: agent-browser local engine (navigate/snapshot/click/type/scroll/back/press/screenshot) + cloud (browserbase/browser_use) + Camofox REST — engine chain A (camofox→cloud→local). Truncated `browser_action` REMOVED.
> - **Search/extract**: ddgs zero-key floor + tavily/exa/parallel/firecrawl/searxng/brave; backend chain B; web_extract→web_fetch fallback.
> - **web_fetch**: universal HTTP→markdown floor (the "feature never dies" fallback).
> - **Security**: 6-layer guard (secret-URL percent-decode, SSRF metadata floor UNCONDITIONAL incl. IPv6-mapped `::ffff:`, private/internal, post-redirect, scheme, bot-detect).
> - **697/697 web tests** + harness 58/58 + TUI-verified (navigate/snapshot/click local+Camofox, web_search ddgs, web_extract→web_fetch, browser→web_fetch fallback, security blocks). See `docs/PLAN-BROWSER.md` + `docs/web-lookup-architecture-deepdive.md`.
>
> Audit of mya's web/network information retrieval tooling. 2026-07-18.
> Verified by reading source + `git ls-files`. Working tree is TypeScript-only + 3 desktop Rust crates (natives, desktop-shell, desktop-ui). The `crates/mya-*` Rust crates in session metadata are NOT materialized in this tree (0 git-tracked, 0 on disk).

## Summary table

| # | Mechanism | Path | Pull/Push/Interact | Reachable from TUI? | External dep | State |
|---|-----------|------|---------------------|---------------------|--------------|-------|
| 1 | `browser_action` | `packages/print/src/mya-bridge.ts:1175-1252` | Interact (CDP) | ✅ Yes | Chrome + `MYA_CDP_URL` | needs-setup |
| 2 | `browser_*` (navigate/click/type/screenshot/extract/eval/close) | `packages/tools/src/browser.ts` | Interact (CDP) | ❌ Headless-only | `chrome-remote-interface`, Chrome :9222 | working (agent runtime, NOT TUI) |
| 3 | `paid_fetch` (x402) | `packages/x402/src/index.ts:591-616` | Pull (HTTP) | ✅ Yes (if wallet) | x402 wallet + balance | working |
| 4 | MCP servers | `packages/gateway/src/mcp-client.ts` + `mcp-lifecycle.ts` | Varies per server | ✅ Yes | `~/.mya/agent/mcp.json` | **EMPTY** (servers: []) |
| 5 | Composio (250+ integrations) | `packages/tools/src/composio.ts` | Varies | ❌ Headless-only | `COMPOSIO_API_KEY` | needs-setup |
| 6 | Channels (Telegram/Discord/Slack/Email/Webhook/WhatsApp/Signal/Matrix) | `packages/gateway/src/channel-adapters.ts` | Push/Pull (messaging) | ✅ Yes (via gateway) | Per-channel env vars | needs-setup |
| 7 | Web Push (RFC 8297) | `packages/gateway/src/push.ts` | Push | ✅ Yes (via gateway) | VAPID keys | needs-setup |
| 8 | Gateway HTTP server (webhook receiver) | `packages/gateway/src/index.ts` | Push (inbound) | ✅ Yes | None (loopback) | working |

## Per-mechanism detail

### 1. `browser_action` — CDP, TUI-reachable, needs Chrome — **TRUNCATED PORT**
`packages/print/src/mya-bridge.ts:1175` registers `browser_action` (comment: "CDP browser automation (from pi-computer-use)"). Opens a raw WebSocket to `MYA_CDP_URL` (format `ws://localhost:9222/devtools/page/<ID>`). Actions enum: `press|click|setText|scroll|drag|moveMouse|wait`. **No `navigate`/`open` action** — you must first point CDP at a page. Verified via TUI: with no Chrome attached it returns a clear CDP error + actionable setup guidance.

**⚠️ Root cause = truncated port.** `browser_action` is copied from `source/pi-computer-use/extensions/computer-use.ts`, which exposes **11 tools**: `find_roots`, `observe_ui`, `search_ui`, `expand_ui`, `inspect_ui`, `act_ui`, `read_text`, `wait_for`, **`launch_browser`** (manages own helium/chrome, can run headless), **`navigate_browser`** ("Navigate a browser window directly to a URL or search string" — CDP `Page.navigate`), **`evaluate_browser`** (run JS in page). mya's port kept ONLY the `act_ui` action subset and **dropped `launch_browser` + `navigate_browser` + `evaluate_browser`** — so it can neither start a browser nor go to a URL. This is the concrete, fixable gap: re-port the 3 dropped tools from `pi-computer-use`.

### 2. `browser_*` tools — headless-only, NOT in TUI
`packages/tools/src/browser.ts` defines a richer toolset (navigate/click/type/screenshot/extract/eval/close) via `chrome-remote-interface` (port 9222). Registered only in the **headless agent runtime** (`packages/agent/src/index.ts`), NOT in `mya-bridge.ts`. So the interactive TUI exposes the older/simpler `browser_action`, while the newer richer `browser_*` set is unreachable from the TUI agent loop. This is a **dead code in TUI** gap.

### 3. `paid_fetch` — x402 micropayment fetch, TUI-reachable
`packages/x402/src/index.ts:591`. HTTP GET/POST that negotiates an HTTP 402 micropayment from an x402 wallet. The only **plain HTTP fetch** available — but gated behind a funded wallet. Advertised in the TUI tool list (`mya-bridge.ts:681`).

### 4. MCP — escape hatch, currently EMPTY
`packages/gateway/src/mcp-lifecycle.ts` implements an 11-phase FSM. Bug fixes B2 (phase order `Discovered→Validated→Initializing→Healthy`), B3 (full `inputSchema` retained), B6 (full server config incl. `env` for spawn) — all verified in `mcp.test.ts`. **But `~/.mya/agent/mcp.json` = `{"servers": []}`** — no fetch/search MCP server is configured, so in practice MCP provides zero web lookup right now.

### 5. Composio — headless-only
`packages/tools/src/composio.ts` — 250+ hosted integrations via `fetch()` to `backend.composio.dev`. Needs `COMPOSIO_API_KEY`. Registered only in headless agent runtime, NOT in TUI.

### 6–8. Channels / Push / Gateway HTTP — messaging, not web-lookup
Channels are messaging platforms (inbound/outbound chat). Web Push + Gateway HTTP are inbound webhook receivers. None retrieve arbitrary web content on demand.

## Key findings

1. **`web_fetch.rs` does NOT exist.** No Rust HTTP client crate in the working tree (`find crates -name '*web*'` → empty; `git ls-files 'crates/mya-*'` → 0). The only HTTP-fetching capability is the TS `paid_fetch` (x402-gated).

2. **`browser_*` tools are unreachable from the TUI.** Built + tested, but wired only into the headless agent runtime. The TUI uses the older `browser_action` which lacks `navigate`/`open`.

3. **No native web search exists.** No `web_search`/`brave-search`/`tavily`/`serper`/`jina`/`firecrawl` in any `packages/` source.

4. **No RSS/feed parsing, no HTTP polling for web content.**

5. **MCP lifecycle is fixed (B2/B3/B6) but unused** — config is `{"servers": []}`.

## Gaps & dead code

- **Gap (high): no plain free `web_fetch`** — the only fetch is x402-paid (`paid_fetch`). A zero-config HTTP GET → markdown tool is the most obvious hole. (Note: `web_search` appears in `source/mya-v1` but ONLY as a placeholder tool name in provider-compat TEST FIXTURES — not a real implementation. mya has never had native web lookup.)
- **Gap (high): no `web_search`** — no Push capability at all (search query → results). Every serious harness ships search+fetch as a pair.
- **Gap (high, root-caused): `browser_action` is a truncated port** of `pi-computer-use` — it dropped `launch_browser` + `navigate_browser` + `evaluate_browser`. Re-port those 3 tools to get a working browser (incl. own-managed headless mode).
- **Dead code: `browser_*` in TUI** — richer browser toolset (`packages/tools/src/browser.ts`) exists but is headless-only. Either wire it into the TUI or unify with `browser_action`.
- **Unused infra: MCP servers empty** — lifecycle is correct (`{"servers": []}`) but no server configured; an easy win is a fetch-MCP server.
- **Composio unreachable from TUI** — 250+ integrations available in headless only.
