# PLAN — Web-Lookup for mya (Browser-First + Fallback Chains)

> Expanded from browser-only to the **full web-lookup stack with fallback-first resilience**, per user decisions (2026-07-18).
> Grounded in deep-read of hermes `browser_tool.py` (~4700 lines), `browser_provider.py`, `plugins/browser/*`, `browser_camofox.py`, `web_tools.py`, `web_search_provider.py`, `url_safety.py`, the public `agent-browser` CLI (Vercel), and mya's current state.
> Companion: `docs/web-lookup-architecture-deepdive.md`.

## 1. Goal & scope

**Goal:** Give the mya TUI agent a **resilient web-lookup stack** — browser automation (navigate/snapshot/click) + search + fetch — that **degrades gracefully through fallback chains** so no single failure kills the feature.

**User directive (core design constraint):** *"làm nhiều phương án khác nhau để đảm bảo có fallback để đảm bảo tính năng không chết hẳn quá nhanh nếu lỗi"* → every capability has ≥1 fallback; the stack never hard-fails.

**In scope (v1):**
- **Browser**: agent-browser local (default) + cloud provider (browserbase/browser_use) + Camofox anti-detect — as a **fallback chain**, not optional phases.
- **web_search / web_extract**: multi-backend (ddgs zero-config floor + tavily/exa/parallel/firecrawl/searxng/brave opt).
- **web_fetch**: universal HTTP→markdown fallback (always available, no key, no browser).
- **Security gauntlet** (shared by browser + fetch) — the primary web boundary (containment removed).
- **Fallback orchestrator** — resolves engine/backend chains, handles 402/engine-fail/missing-dep gracefully.
- Wire into TUI; **hard-remove** truncated `browser_action`; granular tool names; unit + harness + **real TUI tests**.

**Rejected:** pi-computer-use re-port; Playwright-MCP (agent-browser supersedes); node24 bump (verify it's not needed).

## 2. Locked decisions

| # | Decision | Source |
|---|---|---|
| D1 | Engine = `agent-browser` (Vercel npm, Rust CLI) | research |
| D2 | Wrap the pattern, don't re-port the browser | research |
| D3 | `agent-browser` + search SDKs = optional peer deps (minimal-core §18) | AGENTS.md |
| D4 | **Granular tool names** (`browser_navigate/snapshot/click/...`, hermes-style) | **Q1 = ok** |
| D5 | **Hard-remove** `browser_action` (no alias) | **Q2 = remove** |
| D6 | **Verify Node version carefully — do NOT bump engines** (agent-browser is a Rust binary; node>=24 is for npm build scripts, not runtime; shell-to-binary on node20) | **Q3** |
| D7 | **Build cloud provider (browserbase/browser_use) + Camofox NOW** (part of fallback chain, not deferred) | **Q4 = build luôn** |
| D8 | **Build web_search + web_extract NOW** (not deferred) | **Q5 = làm luôn** |
| D9 | **Fallback-first**: every capability has a chain; `web_fetch` is the universal floor | user directive |
| D10 | Security guard mandatory (containment removed → sole web boundary) | research |
| D11 | temp-file stdout/stderr, not pipes (daemon fd deadlock) | gotcha |
| D12 | Cloud/Camofox built when keys present, but **interfaces + chain resolution built now** | D7 |

## 3. Fallback & resilience design (FIRST-CLASS)

### A. Browser engine chain (`resolveBrowserEngine`)
```
1. Camofox   if CAMOFOX_URL set && GET /health ok          [anti-detect; user has it in hermes]
2. Cloud     if browserbase/browser_use key set            [--cdp; stealth+proxies; 402-fallback]
3. Local     agent-browser --session (headless Chromium)   [zero-config DEFAULT]
   engine-within: chrome → lightpanda retry on chrome fail
   hybrid-routing: private URL + cloud configured → force local sidecar (cloud never sees private)
→ ALL fail: degrade to web_fetch (C) for known URLs + return typed error listing the tried chain
```

### B. Search/extract backend chain (`resolveSearchBackend`, hermes `_get_backend` pattern)
```
search:  tavily > exa > parallel > firecrawl > searxng > brave-free > ddgs(ZERO-KEY FLOOR) > error
extract: firecrawl > tavily > exa > parallel (extract-capable only) > web_fetch fallback
→ ddgs importable ⇒ search NEVER hard-fails (zero-config floor)
→ no extract backend ⇒ extract degrades to web_fetch (HTTP pull, no JS)
```

### C. Universal fallback — `web_fetch` (the feature-never-dies floor)
```
web_fetch(url): HTTP GET → html→markdown (+ PDF/DOCX opt) + security guard
  works even if: agent-browser missing, Chromium missing, ALL keys absent
  → guaranteed available; every other capability can fall back to it
```

### D. Resilience patterns (encoded in orchestrator)
1. `isAvailable()` cheap probe (env/import, **NO network**) — skip unavailable backends without trying.
2. try/catch per backend → next in chain (never throw to model; return typed error + tried-chain).
3. **402/payment** → drop premium feature (proxies/keepAlive) + retry (browserbase pattern).
4. **engine chrome fail** → lightpanda retry.
5. **missing Chromium** → autoinstall (cached, fastembed-pattern) → retry once.
6. **pipe-deadlock** → temp-file I/O (gotcha #1).
7. **timeout** → kill + cleanup + actionable message (gotcha #6 fail-fast).
8. **post-redirect SSRF** → block + `about:blank`.

### E. Config (with `auto` = chain resolution)
`web.preferred_engine` (camofox|cloud|local|auto), `web.search_backend`, `web.extract_backend`, `web.allow_private_urls`, `web.fallback_to_fetch` (default true).

## 4. Architecture

```
TUI agent ──tool──► mya-bridge.ts ──register──► packages/tools/src/web/
                                                   ├─ browser/   (engine chain: camofox|cloud|local)
                                                   │   ├─ agent-browser-runner.ts  (local dispatcher)
                                                   │   ├─ camofox-client.ts        (REST /tabs/{id}/*)
                                                   │   ├─ cloud-provider.ts        (BrowserProvider: browserbase/browser_use)
                                                   │   ├─ engine-resolver.ts       (chain A + hybrid routing)
                                                   │   └─ index.ts                 (navigate/snapshot/click/...)
                                                   ├─ search/   (backend chain B)
                                                   │   ├─ provider.ts              (WebSearchProvider interface)
                                                   │   ├─ ddgs.ts tavily.ts exa.ts ... (backends)
                                                   │   ├─ backend-resolver.ts      (chain B)
                                                   │   └─ index.ts                 (web_search/web_extract)
                                                   ├─ fetch.ts                     (web_fetch — universal floor C)
                                                   ├─ security-guard.ts            (shared gauntlet: secret-URL + SSRF + blocklist)
                                                   ├─ exec-tempfile.ts             (gotcha: temp-file I/O)
                                                   └─ orchestrator.ts              (D resilience patterns + fallback wiring)
```

## 5. Phase breakdown (expanded scope)

### Phase 0 — De-risk & availability scan (~0.5d) [GATE]
| Task | Acceptance |
|---|---|
| 0.1 install agent-browser + `agent-browser install` (Chromium) on dev box | `agent-browser --json open https://example.com` → success |
| 0.2 **Node version check (D6)** — verify Rust binary runs shelled from node20; confirm node>=24 only needed for build scripts | documented; no engines bump |
| 0.3 **availability scan** — what's live on THIS box: `CAMOFOX_URL`? search keys (tavily/exa/...)? Browserbase? | table of available fallbacks → tunes chain defaults |
| 0.4 snapshot `browser_action` lines to remove; check `bundle.mjs` external handling | list + external marker |
**Gate:** if 0.1 fails → stop, re-evaluate engine (Playwright-MCP fallback).

### Phase 1 — Foundation: security-guard + web_fetch + exec-tempfile (~1d)
The **universal fallback floor + shared guard** — build first so everything can degrade to it.
- `security-guard.ts`: secret-URL block (`_PREFIX_RE` + percent-decode), SSRF metadata floor (UNCONDITIONAL), SSRF private, post-redirect re-check, blocklist hook, bot-detect.
- `exec-tempfile.ts`: temp-file spawn + wait/timeout/kill/cleanup.
- `fetch.ts`: `web_fetch(url)` HTTP→markdown (reuse html→md; + security guard).
- Unit tests (vitest forks).
**Acceptance:** `web_fetch("https://example.com")` returns markdown; secret-URL + metadata blocked.

### Phase 2 — Browser core: local agent-browser (~1.5d)
- `session.ts` (per-task socket dir, idle-kill, --no-sandbox inject, binary discovery + fail-fast/autoinstall).
- `agent-browser-runner.ts` (single dispatcher; `--session` XOR `--cdp`; engine; `--json`; temp-file exec).
- `engine-resolver.ts` (chain A skeleton: local-only for now; cloud/camofox stubs return unavailable).
- `index.ts`: `browser_navigate/snapshot/click/type/scroll/back/press/screenshot`.
- **Hard-remove** `browser_action` from mya-bridge.ts.
- Unit tests + **TUI verify** (navigate→snapshot→click on live site).
**Acceptance:** TUI agent navigates+snapshots+clicks through real Chrome; no deadlock/hang.

### Phase 3 — web_search + web_extract (multi-backend) (~1.5d)
- `provider.ts` (WebSearchProvider interface: name/isAvailable/supports_search/supports_extract/search/extract).
- backends: `ddgs.ts` (zero-key floor), `tavily.ts`, `exa.ts`, `parallel.ts`, `firecrawl.ts`, `searxng.ts`, `brave.ts` (each ~150 lines, hermes template).
- `backend-resolver.ts` (chain B; per-capability override; capability discrimination search-only vs extract).
- `index.ts`: `web_search`/`web_extract` (security guard; char-limit truncation + read-file recovery; per-URL error as data).
- Unit + harness tests.
**Acceptance:** with no keys → ddgs search works; extract degrades to web_fetch.

### Phase 4 — Browser fallback chain: cloud + Camofox (~1.5d)
- `cloud-provider.ts`: BrowserProvider interface + browserbase (stealth+proxies, 402-fallback) + browser_use (dual-auth).
- `camofox-client.ts`: REST `/tabs/{id}/{navigate,snapshot,click,type,scroll,screenshot}` + `/health` + session_key auth.
- complete `engine-resolver.ts` chain A (camofox → cloud → local + hybrid routing + engine fallback chrome→lightpanda).
- Unit + harness.
**Acceptance:** chain resolves camofox/cloud/local by availability; 402 drops feature+retries; private URL → local sidecar.

### Phase 5 — Resilience orchestrator + wiring (~1d)
- `orchestrator.ts`: wire D patterns (isAvailable probe, try/catch chain, 402-fallback, engine-fallback, autoinstall-retry, timeout-cleanup, post-redirect, **browser-chain→web_fetch ultimate fallback**).
- config schema (`web.*` with `auto`).
- register ALL tools in mya-bridge.ts; bundle.
- **Full TUI test sweep** (browser happy + each fallback path + security blocks).
**Acceptance:** kill agent-browser mid-run → tool degrades to web_fetch (not hard-fail); remove all keys → ddgs still searches.

### Phase 6 — Hardening + docs (~0.5d)
- bot-detection awareness, auto-snapshot after navigate, snapshot truncation.
- update `docs/mya-web-lookup-audit.md`, `docs/tools-comparison.md`, `docs/web-lookup-architecture-deepdive.md`.
- harness cases for every fallback path.

## 6. Test strategy (mandatory TUI)

| Level | What |
|---|---|
| Unit (vitest forks) | guard, resolver chains, runner, providers, orchestrator fallbacks |
| Harness (`scripts/tool-test-harness.mjs`) | each tool dispatch + each fallback path + security blocks |
| **TUI (MiniMax-M3 via tmux)** | real agent; disk/snapshot evidence |

**Mandatory TUI cases (gates):**
- browser: navigate→snapshot→click on live site ✓
- browser security: secret-URL blocked, metadata IP blocked, private-IP per config, redirect→metadata blocked ✓
- **fallback**: agent-browser killed → web_fetch still works; all keys removed → ddgs searches ✓
- search: query→results; extract→content; char-limit truncation ✓
- resilience: 402 simulation → feature dropped + retry; engine fail → lightpanda ✓

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| agent-browser native binary fails on box | Phase 0 gate; Playwright-MCP fallback option |
| node20 vs engines>=24 | D6 verify; shell-to-binary; document (no engines bump) |
| Chromium autoinstall slow | first-run cached (fastembed pattern); progress msg |
| pipe-deadlock regression | encapsulate in exec-tempfile; lint; test asserts temp-file |
| SSRF DNS-rebinding (resolve-then-fetch TOCTOU) | metadata floor = hostname+IP; note caveat (cloud fetcher ≠ resolver) |
| esbuild bundles agent-browser | mark external in bundle.mjs; verify dist |
| fallback chain masks real errors | orchestrator returns tried-chain in error; never silent |
| Camofox/cloud unavailable on box | chain skips via isAvailable; local always works; web_fetch floor |

## 8. Effort & critical path

| Phase | Effort |
|---|---|
| 0 De-risk (gate) | 0.5d |
| 1 Foundation (guard+fetch+exec) | 1.0d |
| 2 Browser core (local) | 1.5d |
| 3 Search/extract (multi-backend) | 1.5d |
| 4 Browser fallback (cloud+Camofox) | 1.5d |
| 5 Orchestrator + wiring | 1.0d |
| 6 Hardening + docs | 0.5d |
| **v1 total** | **~7.5 days** |

Critical path: 0→1→2→5 (browser+fallback is the headline). 3 and 4 can parallelize after 1 (search/extract and cloud/Camofox are independent of browser-core).

**Parallelization:** Phase 3 (search) and Phase 4 (cloud+Camofox) are independent → can run as 2 worktree-isolated tracks after Phase 1.

## 9. Open items (minor — decide during execution)
- ddgs npm package choice (DuckDuckGo no-key): candidate libs to confirm in Phase 0.3.
- html→markdown lib (reuse existing mya dep if any, else minimal).
- PDF/DOCX conversion in web_fetch: defer unless requested.

---

**Next action on approval:** execute **Phase 0** — install agent-browser, verify node20 shell works, availability scan (which fallbacks are live on this box), snapshot browser_action removal + bundle external. This gate de-risks the whole 7.5d plan.
