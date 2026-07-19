# Web-Lookup Hardening — Issues Log

Detailed record of every issue found + fixed during the web-lookup hardening
pass (deep review vs hermes/openclaw → G1–G7 gaps + B1–B3 bugs), including the
**defects caught by the 3-round review discipline** (the highest-value entries —
these are the ones that would have shipped without multi-perspective review).

Each entry: **symptom → root cause → fix → where it was caught**.

---

## Summary

| Phase | Issues | Review-caught defects |
|---|---|---|
| Deep review (B1–B3) | 3 bugs | — |
| G1 DNS SSRF | 1 gap | empty-array fail-open; redirect residual MEDIUM |
| G2 blocklist + G3 TTL + redirect:manual | 3 gaps | G3 dead-code; ReDoS; unbounded timeout; Auth-not-stripped |
| G4 cache + G6 reap + G7 anti-injection | 3 gaps | EPERM catch-all; stripHiddenDom false-positives; missing bidi chars |
| **Total** | **10 fixed** | **12 review-caught defects fixed** |

G5 (browser_vision) deferred — needs vision-model infra.

---

## B1 — browserBackTool wrong err() callId (copy-paste)

- **Symptom:** when no browser engine is available, `browser_back` returned an
  error tagged `browser_snapshot` instead of `browser_back`.
- **Root cause:** copy-paste — the engine-unavailable `err(...)` line wasn't
  updated when `browserBackTool` was cloned from `browserSnapshotTool`.
- **Fix:** `err("browser_back", "no browser engine available")`.
- **Where:** `browser/index.ts:853`. Caught by deep-review explorer.
- **Severity:** low (mislabel; no functional impact). Regression-guarded by
  `engine-unavailable-callid.test.ts`.

## B2 — browserScreenshotTool same copy-paste

- **Symptom/cause/fix:** identical to B1 for `browserScreenshotTool` →
  `err("browser_screenshot", ...)`.
- **Where:** `browser/index.ts:950`. Confirmed the ONLY remaining
  `err("browser_snapshot", "no browser engine available")` is the legitimate one
  in `browserSnapshotTool` (line 640). All 10 browser tools cross-checked.

## B3 — maxChars default inconsistency

- **Symptom:** three different "default fetch size" values drifted apart:
  `DEFAULT_MAX_CHARS=50_000` (internal `webFetch`), `DEFAULT_WEB_FETCH_MAX_CHARS=
  15_000` (tool), hardcoded `15_000` (orchestrator floor). The browser leaf-level
  floor returned 50k while the orchestrator floor returned 15k — same "fallback"
  concept, different sizes.
- **Root cause:** duplicate constants (two sources of truth drifted).
- **Fix:** unified to ONE exported `DEFAULT_MAX_CHARS=15_000`; removed the
  duplicate; orchestrator + leaf floor import it.
- **Where:** `fetch.ts:60`. Note: `search/*.ts` extract providers still have
  local `15_000` constants (all consistent, but independent — future-drift risk).

---

## G1 — DNS resolution in SSRF guard (DNS-rebinding TOCTOU)

- **Symptom:** `checkUrl` (sync) checked IP ranges against the *hostname string*
  only — a DNS name like `evil.com` pointing at `169.254.169.254` or `10.0.0.1`
  passed the guard. hermes resolves + fails-closed.
- **Fix:** `checkUrlAsync` — sync gauntlet, then resolve hostname via OS
  resolver (`node:dns/promises`), check EVERY resolved IP against metadata floor
  (unconditional) + private/internal. Fail-closed on DNS error.
- **Where:** `security-guard.ts`. Wired into `webFetch` + `browser_navigate`.

### Review-caught defects (G1)
1. **Empty-array fail-open** (code reviewer, LOW): a resolver returning `[]`
   skipped the loop → `ok:true`. Unreachable with the default resolver (throws on
   no records) but added `if (addrs.length === 0) return blocked` defense-in-depth.
2. **Redirect connection-before-check** (security reviewer, MEDIUM residual):
   `redirect:"follow"` connected to redirect targets before the guard ran. → led
   to the redirect:manual work (below).

---

## G2 — operator blocklist wiring + ReDoS

- **Symptom:** `checkUrl` accepted `opts.blocklist` but no production path read
  it. The model could fetch any host.
- **Fix:** `WebConfig.blocklist` from `MYA_WEB_BLOCKLIST` (comma-separated
  fnmatch); wired into `webFetch` + `browser_navigate` — ALWAYS applies, model
  cannot override (no tool arg).

### Review-caught defect (G2)
- **ReDoS in `fnmatchToRegex`** (security reviewer, LOW): N consecutive `*`
  emitted `.*.*.*…` → catastrophic backtracking (6★=1.6s, 8★=indefinite hang).
  Operator-controlled (self-DoS) but event-loop-blocking. **Fix:** collapse
  consecutive `*` → single `.*` (while-loop).

---

## G3 — Camofox health cache TTL

- **Symptom:** `cachedHealthResult` set once, never invalidated in production → a
  Camofox server going down mid-process wasn't detected until restart.
- **Fix (initial):** 60s TTL on the async `isCamofoxAvailable`.

### Review-caught defect (G3) — **the big one**
- **TTL on DEAD CODE** (cold-verifier, PARTIAL/defect): the initial TTL was on the
  async `isCamofoxAvailable`, but **production routing uses the SYNC
  `getCachedCamofoxHealth`** (engine-resolver Phase 2), which did NOT check TTL.
  AND `primeCamofoxHealth` (the only caller of the async probe) had **zero
  production callers** → the cache was never populated → `getCachedCamofoxHealth`
  always returned `undefined` → Phase 3 optimistic. The TTL had **zero observable
  effect**. The tests passed because they called the async function directly (not
  the sync path production uses).
- **Fix:** (1) `getCachedCamofoxHealth` TTL-aware (returns `undefined` when
  stale); (2) NEW `maybeProbeCamofoxHealth` (re-entrancy-guarded fire-and-forget)
  called from engine-resolver Phase 3 so the cache POPULATES + REFRESHES in
  production. Added a sync-path test.

---

## redirect: "manual" per-hop (residual MEDIUM from G1)

- **Symptom:** `fetch(redirect:"follow")` connected to redirect targets before
  the guard ran → blind SSRF on redirect to metadata/private.
- **Fix (initial):** `redirect:"manual"` + loop checking each Location via
  `checkUrlAsync` (DNS + gauntlet) BEFORE following.

### Review-caught defects (redirect)
1. **Unbounded total timeout** (code reviewer, MEDIUM-HIGH): each hop got its own
   `timeoutMs` (up to 6×15s=90s) AND the DNS check had NO timeout (up to 5×~30s).
   A malicious slow-DNS chain could stall webFetch. **Fix:** shared deadline
   (`Date.now()+timeoutMs`, `AbortSignal.timeout(min(timeoutMs, remaining))`) +
   DNS lookup capped at 5s (fail-closed).
2. **Authorization not stripped on cross-origin redirect** (code reviewer,
   MEDIUM): manual following forwarded headers to every hop, losing undici's
   `redirect:"follow"` cross-origin Authorization-stripping. Latent (no caller
   sends auth yet). **Fix:** `stripCrossOriginHeaders` removes Authorization/Cookie
   when target origin ≠ original.
3. **MAX_REDIRECTS 5** (code reviewer, LOW): undici default is 20; 5 might break
   legit long chains. **Fix:** raised to 10 (safe — shared deadline bounds total
   time regardless).

---

## G4 — bounded module-level caches

- **Symptom:** `sessionCache`, `camofoxSessionCache`, `engineCache`,
  `cloudSessionCache` grew unbounded for process lifetime; long-running daemons
  leaked.
- **Fix:** `trimCache(map)` evicts oldest (Map insertion order) when size >
  `CACHE_MAX_ENTRIES=32`; called after every `.set()`.

### Review-caught defects (G4)
- **Dead import** (code reviewer, LOW): `reapOrphanedBrowserSessions` was imported
  in `index.ts` but only used in `host.ts`. Removed.
- **Session handle leak on evict** (code reviewer, LOW, NOT fixed): evicting a
  sessionCache entry drops the handle without `closeBrowserSession()` (unlike
  `clearSessionCache`). Bounded cap + agent-browser idle-kill mitigate; deferred.

---

## G6 — orphan reaping + EPERM

- **Symptom:** crashed agent-browser daemons left stale `mya-browser-*` socket
  dirs in tmpdir.
- **Fix (initial):** `reapOrphanedBrowserSessions` — scan tmpdir, parse owner
  PID, skip own, check liveness, remove dead-owner dirs.

### Review-caught defects (G6)
1. **EPERM catch-all** (code reviewer, MEDIUM): `process.kill(pid,0)` throws for
   TWO reasons — ESRCH (dead) AND EPERM (alive but no permission, e.g. another
   user's process). The blanket `catch {}` treated BOTH as dead → a **root
   daemon could delete another user's LIVE session dir** (root bypasses /tmp
   sticky bit). **Fix:** reap only on `err.code === "ESRCH"`; EPERM/other = alive.
2. **Symlink defense** (security reviewer, LOW): add `lstatSync` — only remove a
   real directory, skip symlinks (guards against planted symlinks + future Node
   regressions). Node ≥20's rmSync already doesn't follow top-level symlinks, but
   belt-and-suspenders.
3. **Import-time side effect** (caught during test run): the initial reap call in
   `registerLifecycleHandlers` (auto-run at module import) broke tests that mock
   `session.js` without providing `reapOrphanedBrowserSessions`. **Fix:** moved
   the reap call to `host.ts registerWebTools` (proper init point, not import).

---

## G7 — anti-injection sanitization (most review iterations)

- **Symptom:** `web_fetch` output had no sanitization — hidden DOM (display:none)
  + invisible/bidi Unicode could carry concealed prompt-injection invisible to
  humans but read by the model.
- **Fix:** `stripHiddenDom` (remove hidden elements + content) +
  `stripInvisibleUnicode` (strip zero-width/bidi/BOM/Tags).

### Review-caught defects (G7) — 5 iterations
1. **Malformed `\uE0000` regex** (caught during test run — MY bug): the Tags
   block range written as `\uE0000` parses as `\uE000` + range `0-\uE007` → a
   HUGE range stripping ALL ASCII ("A0B" → ""). `git diff` showed tests garbled.
   **Fix:** `\u{E0000}-\u{E007F}` with the `u` flag (proper code-point escape).
   *Lesson: `\u` takes exactly 4 hex digits; >4 needs `\u{...}`.*
2. **`\bhidden\b` false positive** (cold-verifier + code + security, MEDIUM): `\b`
   treats `-` as a boundary → matched "hidden" inside `data-hidden`,
   `aria-hidden="false"`, `class="hidden-md"`, `title="the hidden truth"` →
   removed VISIBLE content (data loss). The anti-injection goal was met (no false
   negatives) but real pages lost content. **Fix:** `\shidden(?=\s*[=/>])` — bare
   attribute only (preceded by space, followed by `=`/`>`/`/`). Required two
   iterations: first `(?:^|\s)hidden(?=[\s=>\/]|$)` still matched "hidden" in
   quoted values (space before AND after); the `(?=\s*[=/>])` anchor finally
   distinguished bare-attr from word-in-value.
3. **`opacity:0` prefix** (code reviewer, MEDIUM): matched `opacity:0.5`,
   `opacity:0.01` → removed partially-visible content. **Fix:** `opacity:0(?![\d.])`.
4. **Missing U+061C** (security reviewer, MEDIUM): Arabic Letter Mark (bidi
   control, same surface as LRM/RLM) not stripped. **Fix:** added `\u061C`.
5. **Missing fillers** (security reviewer, LOW-MED): Hangul fillers
   (U+115F/1160/3164/FFA0), word-joiner/invisible-operators (U+2060-2064),
   Mongolian vowel separator (U+180E) — render blank, can hide injection from
   human review. **Fix:** added. (Excluded U+00AD soft-hyphen + U+2800 braille
   blank to avoid over-stripping legit content.)

### Acknowledged limitations (regex, no DOM parser — §18)
- External CSS class hiding (`class="secret"` + `.secret{display:none}`) not caught.
- Nested same-tag hidden trees partially handled (non-greedy pairs wrong close tag).

---

## G5 — browser_vision (DEFERRED)

- **Gap:** no screenshot → vision Q&A (hermes annotates with `[N]` ref overlays +
  routes to a vision model; mya returns raw base64 PNG).
- **Why deferred:** requires vision-model routing (no vision-capable model in
  `packages/ai` today) + image annotation (no image lib — §18 minimal core). A
  multi-day feature needing a design decision (which vision provider, annotation
  approach), not a contained hardening pass.
- **Resume:** decide vision provider → add vision routing to the gateway → add
  annotation (canvas/sharp) → `browser_vision` tool.

---

## Lessons (the recurring patterns)

1. **Sync vs async boundary:** making `checkUrl` async (`checkUrlAsync`) rippled
   to all callers — but the callers were already async, so the change was clean.
   The trap was the DNS resolver being uncoupled from the fetch timeout (G1
   residual → shared deadline).
2. **Tests can pass for the wrong reason** (G3): the TTL tests passed because they
   tested the async function, not the sync path production uses. Cold-verification
   (reading where production ACTUALLY calls) caught it. *Always verify the feature
   reaches the production call path, not just the tested function.*
3. **Copy-paste is the #1 bug source** (B1/B2): cloned tools kept the wrong
   `err()` name. The array-iteration registration (host.ts refactor) was the root
   fix, but the err-name still needed correction.
4. **Regex anchors matter** (G7): `\b` is too loose around `-`; `\u` is exactly 4
   hex. Always test regexes against adversarial inputs (false positives AND the
   malformed-escape case).
5. **`catch {}` is a security hole** (G6): blanket catch treated EPERM as "dead".
   Always discriminate on `err.code`.
6. **Import-time side effects break tests** (G6): mocking a module means the real
   import is absent — don't call mocked functions at module top level.

---

## Test inventory (final)

- Web suite: **849 tests** (39 files).
- Key regression files: `security-guard-dns.test.ts` (12), `engine-unavailable-
  callid.test.ts` (3), `cache-trim.test.ts` (3), `orphan-reap.test.ts` (4),
  `camofox-health-cache-ttl.test.ts` (4), `fetch.test.ts` (30 incl. redirect/
  blocklist/auth-strip/anti-injection).
- tsc clean; bundle rebuilt; TUI launches.
