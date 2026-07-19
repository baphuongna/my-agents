# Web-Lookup Deep Review: mya vs Major References

**Scope:** Deep read-only review of mya's web-lookup stack + comparison against
the major sources in `source/`: hermes-agent (Python, primary), openclaw (TS
extraction + SSRF), system_prompts_leaks (production-agent patterns), claw-code
(Rust permission model).

**Method:** 3 parallel read-only explorers → 14 mya files, 14 hermes files,
~30 reference files (openclaw + prompts + claw-code). All findings cite
file:line. Bug claims independently verified in-source.

---

## 1. Executive summary

mya's web stack is **architecturally sound and already at parity on most
dimensions** with hermes-agent (the most complete reference). mya is
**stronger** on: single-source security boundary, universal `web_fetch` floor,
two-phase Camofox probe, never-throws contract. mya is **weaker** on: DNS
resolution in SSRF (TOCTOU), eval-path post-redirect guards, content-extraction
fidelity + anti-injection, vision Q&A, CDP dialog supervision, orphan reaping.

Two concrete bugs found + verified (§6). Five prioritized gaps (§7).

---

## 2. Architecture comparison matrix

| Dimension | mya (TS) | hermes (Python) | openclaw (TS) |
|---|---|---|---|
| **Structure** | 4-layer: leaf ToolImpl → engine/runner → orchestrator → host adapter | ABC provider + registry + tool dispatch | plugin extractors + guarded-fetch pipeline |
| **Tool exposure** | 8 action tools (orchestrator) + browser_search/browser_close (thin leaf) + web_fetch/search/extract | browser_* + web_search/extract + browser_vision + browser_console | web_fetch + web_search (plugin-provided) |
| **Routing** | `ORCHESTRATOR_ROUTED` Set (8) vs thin-leaf | `_navigation_session_key` hybrid cloud/local | `resolveFetchEnabled` flag |
| **Provider plugin model** | array iteration + resolver functions | ABC + registry + capability flags (`supports_search`/`supports_extract`) | config-scoped `WebContentExtractorPlugin` |
| **Error contract** | never-throws (typed `err()`/`ok()`) | exceptions + typed errors | exceptions |

---

## 3. Dimension-by-dimension

### 3.1 Search backends — **PARITY (+ mya browser_search edge)**

| | mya | hermes |
|---|---|---|
| Backends | tavily, exa, parallel, firecrawl, searxng, brave, **ddgs** (7) | same 7 + xAI (8) |
| Zero-key floor | ddgs (`isAvailable` always true) | ddgs |
| Chain | `tavily>exa>parallel>firecrawl>searxng>brave>ddgs` | `tavily>exa>parallel>firecrawl>searxng>brave>ddgs` |
| Capability flag | typed `CapabilityMismatchError` (no silent switch) | `supports_search`/`supports_extract` flags |
| **Anti-detect SERP** | **`browser_search`** — drives Camofox through DDG SERP, regex-parses a11y tree | Camofox backend (REST) |

**Verdict:** parity. mya's `browser_search` (Camofox-driven SERP parse) is a
distinct anti-detect search path that hermes also has via its Camofox backend.
Neither has explicit rate-limiting (both noted gaps).

### 3.2 Browser engines — **PARITY (hermes broader)**

| | mya | hermes |
|---|---|---|
| Anti-detect local | Camofox (REST, C++ fingerprint) | Camofox (REST) + Lightpanda (fast, no-render) |
| Cloud | Browserbase + Browser Use (2) | Browserbase + Browser Use + Firecrawl (3) |
| Local | agent-browser CLI (Playwright) | agent-browser CLI (Playwright) |
| CDP override | — | `BROWSER_CDP_URL` / `/json/version` discovery |
| **Vision Q&A** | `browser_screenshot` (base64 PNG only) | **`browser_vision`** — screenshot → vision model + annotated `[N]` ref overlay |
| **CDP supervisor** | — | live WebSocket: dialog bridge, frame tree, console ring, fast `Runtime.evaluate` |
| Session cache | cloud TTL 5min + lifecycle handlers | per-task dict + inactivity reaper + orphan reaper |

**Verdict:** hermes has 3 advantages mya lacks: **vision Q&A**, **CDP dialog
supervisor**, **orphan reaping**. mya has no eval/console tool → smaller attack
surface (no eval-SSRF vector).

### 3.3 Anti-detection — **PARITY**

Both use Camofox (Camofox/Camoufox, C++ fingerprint defeat) as the anti-detect
local engine, accessed via REST. Both do basic bot-detection title scanning
(warning-only). Neither rotates UAs or proxies at the framework level (proxy is
a per-provider cloud feature: Browserbase `BROWSERBASE_PROXIES`).

### 3.4 SSRF / security — **mya SIMPLER, hermes DEEPER**

This is the most consequential difference. Both have multi-layer guards, but
**hermes resolves DNS**; **mya does not**.

| Layer | mya (`security-guard.ts`) | hermes (`url_safety.py`) |
|---|---|---|
| Scheme allowlist | http/https only | http/https only |
| Secret-in-URL | ✅ 3-decode scan (`sk-`/`AKIA`/`ghp_`/...) + sensitive query params | ✅ prefix regex + sensitive-param blocking |
| Metadata floor UNCONDITIONAL | ✅ `169.254.169.254` + IPv6 mapped | ✅ same + Alibaba `100.100.100.200` |
| Private/loopback reserved | ✅ RFC1918/loopback/link-local/ULA/CGNAT | ✅ same |
| IPv4-mapped IPv6 | ✅ `extractEmbeddedIPv4` (Bug C fix) | ✅ explicit handling |
| **DNS resolution** | ❌ **no resolve** (documented TOCTOU caveat) | ✅ **`socket.getaddrinfo` AF_UNSPEC, fails closed** |
| Post-redirect re-check | ✅ fetch + navigate + orchestrator D8 | ✅ + **eval-path after every console/snapshot/vision/click/type/press/back** |
| Domain blocklist | ✅ `opts.blocklist` (fnmatch) but **not wired to config** | ✅ `website_blocklist` config + shared files + wildcards, 30s TTL cache |
| Eval safety policy | N/A (no eval tool) | ✅ `_enforce_browser_eval_policy` (blocks `document.cookie`/`fetch`/...) |
| Subprocess credential scrub | ✅ `exec-tempfile.ts` `SECRET_ENV_RE` | ✅ `_build_browser_env` strips all secrets |
| Hybrid cloud/local routing | ✅ `shouldForceLocalForUrl` | ✅ `_navigation_session_key` (`::local` suffix) |

**Critical mya gap:** no DNS resolution → **DNS-rebinding TOCTOU**. A hostname
resolving public-at-check, private-at-fetch bypasses mya's IP-range layer.
hermes closes this (resolve-then-check, fail-closed). Both acknowledge full
connection-level validation (Smokescreen-style) is the only complete fix.

### 3.5 Content extraction — **openclaw >> mya**

| | mya (`web_fetch`) | openclaw (`web-fetch.ts`) |
|---|---|---|
| Tiers | turndown HTML→md (single) | **4-tier**: Cloudflare markdown-for-agents → Readability → basic HTML → provider fallback |
| Link preservation | ❌ **lost** (documented: "html→md loses links") | ✅ `[label](url)` preserved |
| Tables/code | ❌ flattened | ❌ regex path flattened (rich `markdown-core` IR exists but not wired) |
| **Anti-injection** | ❌ none | ✅ hidden-DOM sanitize (`display:none`/`sr-only`/`clip-path`) + invisible-unicode strip (U+200B–FEFF, bidi-override) + `externalContent.untrusted` wrapping |
| Spill-to-file | ❌ | ✅ truncated content → private temp (`WEB_FETCH_SPILL_MAX_CHARS=2M`) |
| Bounded | maxChars 50k (fetch) / 15k (tool) **inconsistent** | 20k chars / 750kB bytes / 3 redirects |
| Caching | ❌ | ✅ in-memory TTL cache |

**Verdict:** openclaw's extraction is materially more robust (anti-injection
sanitization is a real prompt-injection defense mya lacks). mya's `maxChars`
inconsistency (50k vs 15k) is a confirmed bug.

### 3.6 Fallback / resilience — **mya STRONGER (universal floor)**

| | mya | hermes |
|---|---|---|
| Browser all-fail → ? | ✅ **universal `web_fetch` floor** (works zero-config, no keys) | cloud → local Chromium (needs local browser) |
| Search all-fail → ? | ddgs zero-key floor | ddgs zero-key floor |
| Extract all-fail → ? | ✅ `web_fetch` floor | provider fallback only |
| Retry/backoff | none (hardcoded retry constants) | Browserbase 402-retry, Browser Use idempotency, Camofox tab-recovery |

**Verdict:** mya's **two independent `web_fetch` floors** (leaf-level +
orchestrator-level) give a genuine "feature never dies" guarantee that hermes
matches only for browser→local, not for all action tools. **mya advantage.**

### 3.7 Permission model — **claw-code most rigorous; mya mid**

| | mya | claw-code (Rust) | openclaw |
|---|---|---|---|
| Mode tiers | `requiredMode` per tool (`Prompt`/`WorkspaceWrite`) | **`PermissionMode` enum + `PartialOrd`** (ReadOnly<WorkspaceWrite<DangerFullAccess) | flags |
| Per-tool rules | — | ✅ `allow/deny/ask(tool(subject))` pattern rules + `denied_tools` flat list | — |
| Path safety | (N/A for web) | ✅ lexical `..` normalization | `inbound-path-policy` |
| Bash safety | (N/A for web) | ✅ `is_read_only_command` (metachar/git-subcommand gating) | approval hooks |
| Network safety | ✅ rich SSRF (see §3.4) | ❌ **coarse `networkIsolation` bool, no IP blocklist** | ✅ `net-policy` + `ssrf-policy` |

**Insight:** claw-code has the most rigorous command/file permission engine but
**no SSRF/IP policy**. mya has the SSRF policy claw-code lacks. A hybrid (mya's
SSRF + claw-code's mode-tiered allow/deny rules) would be strongest.

---

## 4. mya strengths (keep / extend)

1. **Single security boundary** (`security-guard.ts`) — every fetch/navigate
   path routes through `checkUrl` + `checkRedirect`. One place to audit.
2. **Universal `web_fetch` floor** — feature never dies; zero-config works.
3. **Two-phase Camofox probe** — cheap sync env check + cached async health,
   keeps the resolver off the hot path.
4. **Auto-registration via array iteration** — root fix for the expose bug;
   `for (const impl of browserTools)` + `ORCHESTRATOR_ROUTED` set.
5. **Never-throws contract** — universally enforced typed results.
6. **IPv4-mapped IPv6 metadata detection** — `::ffff:169.254.169.254` correctly
   classified (Bug C fix).
7. **Smaller attack surface** — no eval/console tool (no eval-SSRF vector).
8. **Cloud session TTL** (5min) + lifecycle handlers (SIGINT/SIGTERM, idempotent).

---

## 5. mya gaps (prioritized)

### P0 — Security correctness
- **G1. No DNS resolution in SSRF (DNS-rebinding TOCTOU).** ✅ **FIXED.** Added
  `checkUrlAsync` (resolve-then-check): runs the sync gauntlet, then resolves the
  hostname via the OS resolver (`node:dns/promises`) and checks EVERY resolved
  address against the metadata floor (unconditional) + private/internal ranges.
  **Fail-closed** on DNS error AND empty answer. Wired into `webFetch` (pre/post)
  + `browser_navigate` (guard + 2 post-redirect spots). 12 regression tests
  (private/metadata/loopback/IPv6/multi-record/DNS-fail/empty-array/IP-literal
  short-circuit/allowPrivateUrls/secret-before-DNS). Security review: 8/8 checks
  PASS, no exploitable bypass. Residual MEDIUM (redirect-connection-before-check)
  ✅ **CLOSED:** `webFetch` now uses `redirect: "manual"` with per-hop
  `checkUrlAsync` (DNS + gauntlet) BEFORE following — a redirect to a private /
  metadata target is blocked before connecting. 3-review cycle hardened it:
  shared deadline bounds total time across hops, DNS lookup capped at 5s
  (fail-closed), cross-origin redirects strip Authorization/Cookie.
  *(was: mya checked IP ranges against the hostname without resolving; hermes
  resolves + fails-closed.)*
- **G2. `blocklist` not wired to config/env.** ✅ **FIXED.** Added
  `blocklist: string[]` to `WebConfig` (parsed from `MYA_WEB_BLOCKLIST`, comma-
  separated fnmatch patterns). Wired into `webFetch` + `browser_navigate` guards
  — the operator deny-list ALWAYS applies; the model cannot override it (no
  `blocklist` tool arg exposed). 3-review cycle hardened it further: ReDoS
  defense (`fnmatchToRegex` collapses consecutive `*` → single `.*`).
  *(was: `checkUrl` accepted `opts.blocklist` but no production path read it.)*

### P1 — Robustness
- **G3. Camofox health cache never invalidated in production.** ✅ **FIXED.**
  Added 60s TTL: `getCachedCamofoxHealth` returns `undefined` when stale (so the
  sync resolver doesn't trust a stale cache), and `maybeProbeCamofoxHealth`
  (re-entrancy-guarded fire-and-forget) is called from the engine-resolver's
  Phase 3 so the cache POPULATES + REFRESHES in production (was dead code —
  cold-verifier caught the initial TTL-on-dead-code defect). A downed Camofox
  server is re-detected within the TTL window.
  *(was: cache set once, never invalidated; downed server not detected until restart.)*
- **G4. Module-level session caches never evicted.** ✅ **FIXED.** Added
  `trimCache(map)` (LRU-ish: evicts oldest via Map insertion order when size >
  `CACHE_MAX_ENTRIES=32`) called after every cache `.set()`. Bounds all 4 caches
  (sessionCache, camofoxSessionCache, engineCache, cloudSessionCache) so
  long-running daemons no longer leak.
  *(was: caches persisted for process lifetime; long-running daemons leaked.)*

### P2 — Capability (feature gaps vs hermes)
- **G5. No `browser_vision` (screenshot → vision Q&A).** ⏳ **DEFERRED.** Requires
  vision-model routing (no vision-capable model in `packages/ai` today) + image
  annotation (no image lib — §18 minimal core). hermes annotates screenshots with
  `[N]` ref overlays + routes to a vision model. A multi-day feature needing a
  design decision (which vision provider, annotation approach) — not a contained
  hardening pass like G1–G4/G6/G7.
- **G6. No orphan reaping.** ✅ **FIXED.** Added `reapOrphanedBrowserSessions()` —
  scans `tmpdir()` for stale `mya-browser-*` socket dirs, identity-verifies the
  owner PID (`process.kill(pid,0)`; **ESRCH-only reap** — EPERM/other treated as
  alive so a root daemon never deletes another user's live session), `lstatSync`
  symlink guard, skips own PID. Called fire-and-forget from `registerWebTools`.
  *(was: crashed agent-browser daemons left stale socket dirs.)*
- **G7. No content anti-injection sanitization.** ✅ **FIXED.** Added `stripHiddenDom`
  (regex removes hidden elements + content: `display:none`/`visibility:hidden`/
  `opacity:0`/`aria-hidden`/bare `hidden` attr — anchored to avoid false positives
  on `data-hidden`/`title="…hidden…"`/`opacity:0.5`) + `stripInvisibleUnicode`
  (zero-width + bidi controls incl. U+061C ALM + Hangul fillers + word-joiner +
  Tags block) applied to ALL web_fetch output. 3-review-hardened. Known regex
  limitation: external-CSS class hiding + nested same-tag trees (no DOM parser —
  §18) — documented.

---

## 6. Confirmed bugs (verified in-source)

| # | Location | Bug | Severity |
|---|---|---|---|
| **B1** | `browser/index.ts:853` | `browserBackTool` engine-unavailable path returns `err("browser_snapshot", ...)` — should be `err("browser_back", ...)` | low (mislabel, no functional impact) |
| **B2** | `browser/index.ts:950` | `browserScreenshotTool` engine-unavailable path returns `err("browser_snapshot", ...)` — should be `err("browser_screenshot", ...)` | low (mislabel) |
| **B3** | `fetch.ts:40` vs `:332` | `maxChars` default inconsistent: `webFetch` 50_000 vs `webFetchTool`/orchestrator-floor 15_000 | low (truncation surprise) |

B1/B2 are copy-paste from `browserSnapshotTool` (the engine-unavailable `err`
line wasn't updated when the tool was cloned). Verified: lines 861/863/870/874
(back paths) and 958/960/970/976 (screenshot paths) use the correct names — only
the engine-unavailable line at the top of each `run()` is wrong.

---

## 7. Recommendations

### Do now (low-risk, high-clarity)
1. **Fix B1/B2** — two-line name corrections (engine-unavailable `err`).
2. **Fix B3** — reconcile `maxChars` to one default (recommend 20_000, matching
   openclaw's `DEFAULT_FETCH_MAX_CHARS`).
3. **Wire G2** — `MYA_WEB_BLOCKLIST` env → `opts.blocklist` in fetch + navigate.

### Do soon (security hardening)
4. **G1 DNS resolution** — resolve hostname, check all IPs fail-closed. This is
   the one place mya is materially weaker than hermes on SSRF. ~30 lines in
   `security-guard.ts`. Test: hostname resolving to 127.0.0.1 must be blocked.
5. **G3 Camofox TTL** — invalidate health cache on TTL + on REST failure.

### Defer (capability, larger effort)
6. **G5 browser_vision** — needs vision-model routing + annotation overlay.
7. **G4/G6** — cache eviction + orphan reaping (operational, not correctness).
8. **Extraction fidelity** — adopt openclaw-style multi-tier + anti-injection
   if web_fetch output is ever treated as trusted instructions.

---

## 8. Verdict

mya's web stack is **production-credible and at parity with hermes on
architecture, search, browser, anti-detect, and resilience** — with a genuine
edge on the universal `web_fetch` floor and single-boundary security design.

The **one material security gap** vs hermes is DNS-rebinding (G1) — worth
closing. The **one material robustness gap** vs openclaw is content-extraction
anti-injection — worth adopting if untrusted output becomes trusted. The 3 bugs
(B1/B2/B3) are low-severity cleanups.

No rewrites needed. Targeted hardening (G1/G2/G3 + B1/B2/B3) closes the gaps to
the references without sacrificing mya's design strengths.
