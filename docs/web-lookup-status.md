# Web-Lookup — Current State (detailed)

> Definitive status reference for mya's web-lookup capability (browser + search + fetch).
> Implemented per `docs/PLAN-BROWSER.md` (Phases 0-6). Commits: `d1a56e8` (Phases 1-5), `40aba5a` (Phase 6).
> Last verified: 2026-07-18 via real TUI (MiniMax-M3) + direct dispatch + unit/harness.

## Status: DONE (testable parts), with honest gaps

| Aspect | State |
|---|---|
| Code | committed (`d1a56e8` + `40aba5a`); 64 files, +21868/-1622 |
| Unit tests | **697/697** (`packages/tools/src/web/`) |
| Tool harness | **58/58** (`scripts/tool-test-harness.mjs`, +6 web cases) |
| Edge sweep | ~50 cases across 2 sweeps — all pass after correcting test-assumption errors |
| TUI verification | browser research (HN top-3 + points), web_search, web_extract→web_fetch, security blocks |
| Live engines | local agent-browser ✅, Camofox ✅ (@ localhost:9377) |
| Key-gated (UNTESTED on this box) | cloud Browserbase (no API key), real search backends (no Tavily/Exa/etc key) |

## Architecture (3 composable layers + cross-capability orchestrator)

```
TUI agent (MiniMax-M3)
   │  tools: browser_*, web_search, web_extract, web_fetch
   ▼
packages/tools/src/web/
   ├─ security-guard.ts      6-layer URL gauntlet (shared by browser + fetch + extract)
   ├─ exec-tempfile.ts       temp-file subprocess I/O (NOT pipes — daemon-fd deadlock)
   ├─ fetch.ts               web_fetch — universal HTTP→markdown floor
   ├─ orchestrator.ts        cross-capability fallback (browser all-fail → web_fetch)
   ├─ config.ts              web.* config schema
   ├─ browser/               engine chain A
   │   ├─ engine-resolver.ts     camofox → cloud → local + hybrid routing + chrome→lightpanda
   │   ├─ agent-browser-runner.ts  local/cloud dispatcher (--session | --cdp, --json)
   │   ├─ cloud-provider.ts      browserbase (stealth+proxies+402-fallback) + browser_use
   │   ├─ camofox-client.ts      REST /tabs/{id}/* anti-detect
   │   └─ index.ts               8 tools + registerBrowserTools adapter
   └─ search/                backend chain B
       ├─ provider.ts            WebSearchProvider interface
       ├─ backend-resolver.ts    tavily>exa>parallel>firecrawl>searxng>brave>ddgs(floor)
       ├─ ddgs/tavily/exa/parallel/firecrawl/searxng/brave.ts
       └─ index.ts               web_search/web_extract + registerSearchTools adapter
```

Wired into TUI via `packages/print/src/mya-bridge.ts` (`registerBrowserTools(pi)` + `registerSearchTools(pi)`). Old truncated `browser_action` hard-removed.

## Capabilities

### Browser (engine chain A: camofox → cloud → local)
| Tool | Action | Tested |
|---|---|---|
| `browser_navigate` | open URL → title + auto ariaSnapshot + refs (@e1…); guard first, post-redirect re-check | ✅ local + camofox live |
| `browser_snapshot` | accessibility-tree snapshot + element refs | ✅ |
| `browser_click` | click by ref (@e1) | ✅ real + invalid-ref error |
| `browser_type` | type text into ref | ✅ (Wikipedia search box) |
| `browser_scroll` / `browser_back` / `browser_press` / `browser_screenshot` | — | ✅ |

**Engines:**
- **local** (default, zero-config): `agent-browser` Rust CLI (Vercel) drives headless Chromium. Binary discovery: node_modules/.bin → PATH → npx fallback. Fail-fast if Chromium missing ("run: npx agent-browser install --with-deps").
- **Camofox** (anti-detect): self-hosted Firefox+C++ fingerprint-spoof REST server (`CAMOFOX_URL`); `/tabs/{id}/{navigate,snapshot,click,type,scroll,screenshot}`. LIVE-verified @ localhost:9377.
- **cloud**: BrowserProvider → `createSession` returns `cdpUrl` → `agent-browser --cdp`. browserbase (stealth+proxies, **402-fallback** drops feature+retry) + browser_use. **Built but UNTESTED (no API key on box).**
- **Hybrid routing**: private URL + cloud configured → force local sidecar (cloud never sees private). Cloud-metadata floor UNCONDITIONAL (even local browser on cloud VM).
- **Engine fallback**: chrome → lightpanda retry on chrome failure (local).

### Search/extract (backend chain B)
| Tool | Returns | Tested |
|---|---|---|
| `web_search` | metadata only (`{results:[{title,url,description}], query, backend}`) — search-then-fetch separation | ✅ ddgs floor |
| `web_extract` | page content (markdown); per-URL error as data; char-limit head+tail+footer; **guard runs first (soft-block: `backend:"guard", guardBlock:{...}`)** | ✅ web_fetch fallback |

**Backends:** `ddgs` (ZERO-KEY floor — search never hard-fails) + tavily/exa/parallel/firecrawl (search+extract) + searxng/brave (search-only). Per-capability override (`web.search_backend` ≠ `web.extract_backend`). Capability discrimination: extract on search-only → typed error, no silent switch. **Real paid backends UNTESTED (no keys); only ddgs + web_fetch-fallback verified.**

### web_fetch (universal floor)
HTTP GET → markdown (HTML strip script/style/nav/head; `<a>`→`[text](href)`; base64 image→`[IMAGE]`; JSON→pretty; char-limit head+tail+footer). Reuses security-guard. **The "feature never dies" floor** — works with no browser, no keys.

## Security (security-guard.ts, 6 layers) — VERIFIED

| Layer | Blocks | Verified |
|---|---|---|
| 1. Secret-in-URL | API-key prefixes (`sk-`, `sk-ant-`, `AKIA`, `ghp_`, `xox`, …); checks raw + percent-decoded (1-3 passes) | ✅ plain, `%2D`, `%252D` (double), `%25252D` (triple) |
| 2. SSRF metadata floor (UNCONDITIONAL) | `169.254.169.254`, `metadata.google.internal`, ECS/Alibaba; IPv6-mapped `::ffff:`, compat `::`; **decimal/octal/hex IP-notation** (Node normalizes → dotted) | ✅ IPv4, IPv6-mapped, IPv6-compat, gcp, decimal(2852039166), octal, hex |
| 3. Private/internal | RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127, ::1), ULA (fc00::/7), link-local | ✅ IPv4 + IPv6 |
| 4. Post-redirect re-check | re-runs 1-3 on `finalUrl` after open/redirect | ✅ |
| 5. Scheme allowlist | only http/https | ✅ lower/upper/mixed |
| 6. Bot-detection | title pattern scan (captcha/cloudflare/…) → warning (never blocks) | ✅ (detectBot) |

**Parser-confusion cases checked (all correctly handled):** userinfo-trick both directions (`meta@evil` → host=evil.com safe; `evil@meta` → blocked), backslash (`evil\@meta` → host=evil.com, metadata in pathname only), port on metadata (blocked), `allowPrivateUrls:true` toggle.

> ⚠️ **DNS-rebinding TOCTOU** (resolve-then-fetch): the guard resolves hostname→IP, but a cloud fetcher resolves separately → rebinding window. Meaningful for local fetch; theatrical for cloud backends (their own network). Documented limitation, not fixed.

## Resilience / fallback (the "feature never dies" directive)

- **Browser chain A** all-fail → **web_fetch floor** (`web.fallback_to_fetch`, default true) → returns `{engine:"web_fetch_fallback", degraded:true, snapshot:<markdown>}`. Regression-tested (mocked resolver→unavailable→assert web_fetch_fallback + content).
- **Search chain B**: no paid backend → **ddgs zero-key floor** (always available). No key → search still works.
- **Extract**: no extract-capable backend → **web_fetch fallback** (HTTP pull, no JS).
- **402-fallback** (browserbase): drop premium feature (proxies/keepAlive) + retry.
- **Engine fallback**: chrome → lightpanda.
- **Autoinstall**: missing Chromium → cached download (fastembed-pattern).

## TUI evidence (real research, MiniMax-M3)

Agent drove browser to research Hacker News front page:
1. *"GPT-5.6 used a prompt to close a 30-year gap in convex optimization"* — 140 pts
2. *"Fable 5 vs. GPT-5.6 Sol on an NP-Hard Problem: Does /goal help?"* — 86 pts
3. *"Is this the end of the once-mighty GoPro?"* — 38 pts

Agent: *"All three titles, point counts, and authors came straight from the page's accessibility tree — no inference needed."* engine: local agent-browser.

Browser is a **working research tool**: navigate → ariaSnapshot → read dynamic current content → answer from real data.

## Config (`web.*` in config.ts)

```
web.preferred_engine:   camofox | cloud | local | auto  (default auto = chain resolution)
web.search_backend:     <name> | auto
web.extract_backend:    <name> | auto
web.allow_private_urls: false (default)
web.fallback_to_fetch:  true (default — universal floor)
```
Env-driven (CAMOFOX_URL, BROWSERBASE_API_KEY/PROJECT_ID, BROWSER_USE_API_KEY, TAVILY_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY, PARALLEL_API_KEY, SEARXNG_URL, BRAVE_API_KEY).

## Install / setup

1. `agent-browser` = optional peer dep (`packages/tools/package.json` peerDependencies, `^0.27`, optional). Consumer installs: `npm install agent-browser`.
2. First run: `npx agent-browser install` (downloads Chromium-for-Testing, ~184MB, cached at `~/.agent-browser/`). Linux: `--with-deps` for system libs.
3. Node ≥20 OK (agent-browser engines says ≥24 but EBADENGINE is a WARNING only — the Rust binary runs on node22; `npm i` succeeds).
4. Optional engines: Camofox (set `CAMOFOX_URL`), Browserbase (set `BROWSERBASE_API_KEY`+`PROJECT_ID`), search keys as needed (none required — ddgs floor).

## Known gaps / follow-ups (honest)

| Gap | Severity | Note |
|---|---|---|
| **Cloud (Browserbase) e2e** | — (key-gated) | Built + 402-fallback logic, but no API key on dev box → never real-tested. Mock-only. |
| **Cloud CDP cache-fix (P1)** | medium | Fixed in Phase 5 but can't real-verify without cloud session (snapshot/click after navigate on cloud). |
| **Real search backends** (tavily/exa/firecrawl/parallel) | — (key-gated) | Implemented per hermes template; 0 keys on box → only ddgs + web_fetch verified. |
| **Browser Use managed-gateway dual-auth** | low | Only direct-key mode; managed-gateway path (X-Idempotency-Key + external_call_id) not built. |
| **ddgs ad-quality** | low | Free DDG returns ad-redirects (y.js→udemy) before organic results. Limit of free floor, not a bug. |
| **web_fetch redirect-follow live** | — (test-infra) | Code has redirect handling + post-redirect guard; couldn't live-verify (httpbin.org was 503). |
| **DNS-rebinding TOCTOU** | low | Documented; resolve-then-fetch window for cloud fetchers. |
| **Pre-existing** (out of scope) | — | workspace build TS errors (prompts/print/pi-ai-src) + invariant-time test (137 Date.now()) — predate this work. |

## Files

- Source: `packages/tools/src/web/{security-guard,exec-tempfile,fetch,orchestrator,config}.ts` + `browser/` (8 files) + `search/` (16 files)
- Tests: `*.test.ts` colocated (697 cases)
- TUI wiring: `packages/print/src/mya-bridge.ts` (registerBrowserTools + registerSearchTools; browser_action removed)
- Bundle: `scripts/bundle.mjs` (agent-browser marked external)
- Harness: `scripts/tool-test-harness.mjs` (+testWeb)
- Docs: `docs/PLAN-BROWSER.md`, `docs/web-lookup-architecture-deepdive.md`, `docs/mya-web-lookup-audit.md`, this file

## Commits
- `d1a56e8` feat(web): resilient web-lookup stack (browser-first + fallback) — Phases 1-5
- `40aba5a` test(web): Phase 6 — harness web cases + audit status
