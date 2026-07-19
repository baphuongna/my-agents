# Cron Hardening — Implementation Plan (rev 3, post Round-2 review)

Port hermes cron correctness + security into mya. Fixes D1–D10 per
`docs/cron-comparison.md`, guided by `docs/hermes-cron-deepdive.md`.

**Rev 3** incorporates Round-2 review (code/security/cold all
CONDITIONAL-PASS). Round 2 converged on **Spike-0 being unresolved** (3 reviewers:
`pool.acquire`/`SessionFactory` have no role param; `applyRole` absent) + 4
structural gaps (rootHtml token leak, dashboard auth, file-reload bypass, missing
CronScheduler methods). Rev 3 downgrades Spike-0 honestly, makes the role-wiring
an explicit 0A task, and closes the auth/store gaps.

**Review rounds:** R1 (3 reviewers: code FAIL / sec FAIL / cold COND-PASS) → rev 2 →
R2 (3 reviewers: all COND-PASS) → rev 3 → **R3 final cold-verify: PASS** (all 13
Round-2 blockers resolved; 5 minor design notes folded below; 0A simpler than
claimed — `createAgentSession` already has `tools`/`excludeTools` params,
`sdk.ts:62-67`).

**Discipline:** 3-review + verify + test + commit per phase. This doc is the
artifact under continued review.

---

## Round-1 review — findings → resolutions

| # | Finding (reviewer) | Resolution |
|---|---|---|
| C1 | Phase 2 inverts 2C↔2D — advance+persist needs persistence first (code CRIT-1) | **Foundation 0B lands atomic persistence first**; 2C (advance) builds on it. No stub-then-replace. |
| C2 | `due()→{due,dirty}` breaks unmentioned caller `mya-bridge.ts:1480` (code CRIT-2, cold MAJ-2) | **Keep `due(): CronJob[]`; add `dueAndAdvance(now): {due, dirty}`.** Sweep uses the new method; read-only callers unchanged. |
| C3 | `_cron` shared session serializes all jobs → `Promise.allSettled` parallelism illusory (cold CRIT-1, code MIN-5) | **Per-job sessions `_cron:<jobId>`** (Foundation 0A). Also enables per-job cron-role → solves Spike-0. |
| C4 | CLI writes cron.json directly; never reaches running gateway; bypasses auth+scan (cold CRIT-2/3) | **File-as-single-store model** (Foundation 0B): CronScheduler re-reads cron.json each sweep; mutations write-through atomically; CLI file-writes picked up next sweep; scan at every mutation boundary. |
| C5 | `/ws-info` leaks wsToken to any local process/browser → 3A is theater (sec CRIT-1) | **Auth redesign** (Foundation 0C): 0600 token file + gate `/ws-info` + auth at TOP of handleHttp + CLI reads token file. |
| C6 | 3A breaks CLI (sends no Authorization); R3 premise false (sec CRIT-2, cold MIN-2) | Foundation 0C ships token distribution + CLI update together. |
| C7 | APPROVE-mode = full creds unattended, base_url/snapshot deferred (sec CRIT-3) | **Defer base_url/snapshot** (needs CronJob schema change — separate feature). **`approval_mode` default DENY**; APPROVE = explicit per-job opt-in, documented as "unattended full-credential execution — trust the prompt." No claim that APPROVE is safe. |
| C8 | deny-mode BLACKLIST misses MCP/plugin/web tools (sec MAJ-3) | **deny-mode = WHITELIST** (cron-role `toolsAllowed`); MCP tools opt-in only for cron turns. |
| C9 | scan omits PATCH/update (sec MAJ-4) | **Single `validateCronPrompt()` at EVERY mutation** (register, updateCronJob, PATCH, CLI add/update). |
| C10 | no max-jobs cap / min-interval (sec MAJ-6) | **`scheduler.max_jobs` (default 50) + min-interval floor** in register(). |
| C11 | MYA_NO_WS_TOKEN bypass re-opens D6 on cron routes (sec MAJ-1) | **Decouple**: cron mutating routes require a SEPARATE `MYA_CRON_UNSAFE_NO_AUTH=1` (loudly named, logged); never honor the WS bypass for mutations. |
| C12 | DOW/DOM OR-semantics claim FALSE (matchesCronExpr is AND) (code MAJ-2) | **Implement OR** (standard cron): when `domF!=="*" && dowF!=="*"`, OR the two matches. Fixes a latent parser bug; ~5 LOC. (Prereq 2A.) |
| C13 | recovery-on-load: job loaded during its minute stops firing (code MAJ-3) | In recovery, **if `matchesCronExpr(expr, now)` → set `nextRunAt=now`** (fire this minute); else `computeNextFire`. Pinned by test. |
| C14 | syncCronJobs reverts control-plane PATCHes every 5s (cold MAJ-1) | **Remove periodic syncCronJobs overwrite.** Control plane reads directly from scheduler (`listCronJobs` → `scheduler.listJobs()`); PATCH writes through to scheduler via `updateJob`. Single direction of truth. |
| C15 | mya-bridge has own sweep/loader (dual-instance) (cold MAJ-3) | **Remove mya-bridge's cron loader + sweepExpired timer.** mya-bridge delegates to the gateway's scheduler (it already receives `opts.cron`). |
| C16 | stale line numbers (code MAJ-1) | All file:line re-derived at implementation time; not trusted from docs. |
| C17 | persistence ownership unspecified (code MIN-1) | **Gateway-driven via `onDirty(jobs)` callback** — CronScheduler stays pure (no fs dep); gateway persists the `dirty` list returned by `dueAndAdvance`. Preserves minimal-core. |
| C18 | reuse stripInvisibleUnicode, not hermes's set (sec MIN-3) | **Import** `INVISIBLE_UNICODE_RE` from `@my-agent/tools/web/fetch` (G7); hard-block for cron prompts (one definition, no drift). |
| C19 | regex scan is bypassable (sec MAJ-5) | **Document scan as best-effort detection**, not a boundary. Real boundary = auth (0C) + tool whitelist (C8) + deny-default. |
| C20 | ReDoS (sec MIN-2) | Each ported pattern checked under `safe-regex`/re2 as a CI gate. Drop the fnmatchToRegex reference (category error). |

**Unchanged from rev 1:** all 10 defects D1–D10 verified real by cold-verifier;
Spike-0 NOT a hard blocker (fallback viable); phases 1/2 correctness sound.

## Round-2 review — findings → resolutions (rev 3)

Round 2 (code CONDITIONAL-PASS / security CONDITIONAL-PASS / cold
CONDITIONAL-PASS) converged hard on **Spike-0 being unresolved** (3 reviewers
independently) plus 4 structural gaps in the auth/store pivots.

| # | Finding (reviewer) | Resolution (rev 3) |
|---|---|---|
| R2-1 | **Spike-0 NOT resolved**: `pool.acquire`/`SessionFactory` have NO role param; `applyRole` doesn't exist (grep 0); `filterToolsForRole` only called from TUI `/role`, not the gateway pool path. AD1 "cron-role" aspirational (code N1, sec C8, cold MAJ-1) | **Honest downgrade + explicit 0A task**: add a `roleFilter?: string[]` param through `AgentPool.acquire` → `SessionFactory` → `createAgentSession`, applying `filterToolsForRole` at toolset assembly. Spike-0 status = "**targeted by 0A; proven by `cron-role-toolset.test.ts`**; if wiring is infeasible, fall back to prompt-level + document the gap (weaker, NOT a security claim)." |
| R2-2 | **rootHtml bakes wsToken** (`main.ts:382`→`dashboard.ts:127`), served at `GET /` without auth → gating `/ws-info` is theater (sec NB-1, code N3) | **0C: stop baking token into rootHtml.** Dashboard obtains the token via an authenticated bootstrap (HttpOnly `SameSite=Strict` cookie set on first load, OR a post-load authenticated fetch). `GET /` must contain NO token. |
| R2-3 | **dashboard `fetch()` has no auth header** + top-of-handleHttp auth needs an **allowlist** or the SPA breaks (sec NB-2, code N2) | **0C: (a) auth allowlist** — `/health/live`, `/ready`, `/manifest.json`, `/icons/*`, `/sw.js` exempt (health probes + PWA assets); `GET /` serves token-free HTML. (b) dashboard client sends `Authorization: Bearer` (or cookie) on all data fetches. |
| R2-4 | **file `reload()` trusts cron.json** → scan/cap/auth bypassed at file layer (CLI writes file directly; any same-user process) (sec NB-3) | **0B: `reload()` validates EVERY loaded job** through `validateCronPrompt` + max-jobs cap; invalid jobs are **quarantined** (logged, not loaded), not silently accepted. File set 0600. |
| R2-5 | CronScheduler missing 5 methods (reload/saveJobs/updateJob/removeJob/onDirty) — all new, unenumerated (code N5) | **0B enumerates them as explicit tasks** (list below). |
| R2-6 | 0B reload reconcile algorithm unspecified (preserve run records?) (cold MAJ-2) | **0B reconcile contract** (3 cases): file-only→add to jobs Map; Map-only→drop job (keep `runs`/`jobRuns` for history); both→replace job def, **preserve** `runs`/`jobRuns`. |
| R2-7 | mya-bridge is a **separate process** (TUI vs `serve`) — "shares scheduler" FALSE; cross-process dual-sweep is the hazard (cold) | **0A/0B honest framing**: the TUI's `opts.cron` is a DIFFERENT `CronScheduler` singleton. Fix = TUI becomes **display-only** (queries gateway `GET /cron/jobs` via HTTP); remove mya-bridge's sweep timer + divergent loader entirely. Only the gateway sweeps/fires. |
| R2-8 | no per-sweep **concurrency cap** — 50 jobs × `* * * * *` = 50 concurrent full-cred turns (sec NB-7) | **3A: per-sweep fire budget** (`scheduler.max_concurrent`, default 4) via `Promise.allSettled` chunking; excess due jobs deferred to next sweep (not dropped). |
| R2-9 | `approval_mode` frozen at startup → friction pushes operators to `MYA_CRON_UNSAFE_NO_AUTH` (sec NB-8) | **3C: runtime-flippable** via authenticated `POST /config` (logged); startup freezes only the *initial* mode. |
| R2-10 | persist-before-fire ordering implied, not mandated (code N7, cold MIN-1) | **2C hard invariant: persist `dirty` (await `saveJobs`) BEFORE dispatching any due job.** Crash between persist and fire = missed fire (at-most-once, hermes's choice) — documented. |
| R2-11 | token-file startup race (code N9) | **0C: write `gw.token` (0600) synchronously before `listen()` resolves.** |
| R2-12 | D8 (2×/min) implicitly fixed by nextRunAt, never named (cold) | **2B explicitly names D8**: nextRunAt advance prevents same-minute double-fire. |
| R2-13 | 0600 token file = same-trust-boundary as rootHtml for same-user processes (sec NB-4) | **AD3 threat-model honesty**: 0C blocks **browsers + cross-user**; **same-user isolation** is explicitly deferred to Unix-socket (Phase 5+). The token file is defense-in-depth, not a same-user boundary. |

---

## Architecture decisions (post Round-1)

### AD1 — Per-job cron sessions `_cron:<jobId>` + cron-role wiring (resolves C3; Spike-0 TARGETED, not assumed)
Each fired cron job runs on its own session id `_cron:<jobId>`. **Spike-0 (R2-1)
is real new work, not a given**: today `AgentPool.acquire(sessionId, agentName?)`
and `SessionFactory(sessionId, cwd?, agentDir?)` take **no role param**, and
`applyRole` does not exist — `filterToolsForRole` is reachable only from the TUI
`/role` command, not the gateway pool path. So 0A must **wire a `roleFilter?:
string[]` param** through acquire → factory → `createAgentSession` and apply
`filterToolsForRole` at toolset assembly, **proven by `cron-role-toolset.test.ts`
asserting the scheduler tool is absent**. Benefits once wired:
- Real parallelism (each job → distinct `AgentSession`; bounded by AgentPool +
  the 3A per-sweep concurrency cap).
- The cron role carries `toolsAllowed` (whitelist) → anti-recursion + deny-mode at
  the **tool layer** (R2-1). **If the wiring is infeasible, fall back to
  prompt-level + document the gap explicitly as NOT a security control.**
- Per-job isolation (a runaway job doesn't poison the shared session).
- Session lifecycle: per-job sessions persist in the pool (JSONL reuse across
  fires); rely on `maxSessions` eviction. Under max_jobs=50 this is well within
  limits (not a leak).

### AD2 — File-as-single-store (resolves C4, C14, C15, C17 + R2-4/5/6/7)
hermes model: **cron.json (0600) is the single source of truth.** CronScheduler
stays pure (no fs dep); new methods are **enumerated explicit tasks** (R2-5):
`reload(state)`, `saveJobs()`, `updateJob(id, patch)`, `removeJob(id)`, ctor
`onDirty?: (jobs) => void`. The gateway owns persistence via `onDirty`.
- **`reload()` validates every loaded job** through `validateCronPrompt` +
  max-jobs cap (R2-4); invalid jobs **quarantined** (logged, not loaded) — closes
  the file-layer scan/cap bypass.
- **Reconcile contract** (R2-6): file-only→add; Map-only→drop job (keep
  `runs`/`jobRuns` for history); both→replace job def, **preserve** run records.
- HTTP API + CLI both mutate through `register()`/`updateJob()` → atomic
  `saveJobs()` — **same path**, so scan + cap apply uniformly. `syncCronJobs`
  periodic overwrite removed; control plane reads from scheduler. The `cronRemove`
  private-field cast hack (D10) replaced by `removeJob()`.
- **mya-bridge is a SEPARATE process** (R2-7): its `opts.cron` is a different
  singleton. Fix = TUI becomes **display-only** (queries gateway `GET /cron/jobs`);
  mya-bridge's sweep timer + divergent `~/.mya/cron.json` loader **deleted**. Only
  the gateway sweeps/fires.
- **listJobs join** (R2-6): gateway `/cron/jobs` GET joins `scheduler.listJobs()`
  with `runsOf(id)` for `lastRun`/`lastStatus` (so removing syncCronJobs doesn't
  lose observability between phase 0 and 4).

### AD3 — Real auth (resolves C5, C6, C11 + R2-2/3/11/13)
- Gateway writes wsToken to **`~/.mya/agent/gw.token` (0600) synchronously before
  `listen()` resolves** (R2-11) — no startup race.
- **`GET /` serves token-free HTML** (R2-2): stop baking wsToken into `dashboardHtml`
  (`main.ts:382`→`dashboard.ts:127`). Dashboard obtains the token via an
  authenticated bootstrap (HttpOnly `SameSite=Strict` cookie set on first trusted
  load, OR a post-load authenticated fetch) — never page source.
- **`/ws-info` gated behind auth** (no open token leak).
- **Auth at TOP of `handleHttp` with an allowlist** (R2-3): exempt `/health/live`,
  `/ready`, `/manifest.json`, `/icons/*`, `/sw.js`, token-free `GET /`. All other
  routes (incl. all `/cron/jobs*` mutations, `/sessions/*`, `/sync/*`) require
  `Authorization: Bearer <token>` or the cookie.
- **Dashboard client sends `Authorization: Bearer`** (or cookie) on all data
  fetches — update `dashboard.ts` `fetchJSON` + all call sites (R2-3).
- CLI reads the token from the 0600 file + sends `Authorization: Bearer` on all
  HTTP calls (`fetchJobs`, `cronRemove`, `cronToggle`, `cronRun`) (R2/C6).
- Cron mutating routes require the token; a **separate** `MYA_CRON_UNSAFE_NO_AUTH=1`
  (loudly named, logged at startup) is the only bypass — never `MYA_NO_WS_TOKEN`.
- **Threat-model honesty** (R2-13): 0C blocks **browsers + cross-user**. Same-user
  isolation is **explicitly deferred** to Unix-socket binding (Phase 5+). The 0600
  file is defense-in-depth, not a same-user boundary.

### AD4 — Credential scoping stance (resolves C7, C19)
- `approval_mode` default **DENY** (cron role = read-only whitelist).
- APPROVE = **explicit per-job opt-in**; documented as "unattended full-credential
  execution; the operator is trusting the prompt." No security claim.
- base_url/provider-host guard + snapshot drift (hermes §4c/§4g) **deferred** — they
  require adding `provider`/`base_url`/`model` to CronJob (schema change = feature).
  Tracked as Phase 5 (future), NOT Phase 3.
- The injection scan (Phase 3B) is **best-effort detection**, explicitly NOT a boundary.

---

## Phased execution (rev 2)

> Line numbers are placeholders — re-derive from HEAD at implementation.

### Phase 0 — Foundation (the architectural pivots; prerequisites for all)
**0A. Per-job cron sessions + cron-role wiring.** Spike-0 = **real new work**
(R2-1): add a `roleFilter?: string[]` param through `AgentPool.acquire` →
`SessionFactory` → `createAgentSession`, applying `filterToolsForRole` at toolset
assembly. **Round-3 shortcut:** `createAgentSession` already accepts
`tools?: string[]` + `excludeTools?: string[]` (`sdk.ts:62-67`) → prefer passing
`excludeTools: cronRole.toolsDenied` from the factory closure (`main.ts:254`),
minimizing blast radius on interactive/channel sessions (pool caches by
`poolKey(sessionId, agentName)` — no cross-contamination). Create a `cron` role
(`toolsAllowed` = safe read-only set; excludes scheduler/cron tools). Cron-fired
turns acquire session `_cron:<jobId>` built with the cron role. **Proven by
`cron-role-toolset.test.ts`** (scheduler tool absent). If wiring is infeasible →
prompt-level fallback + documented gap (weaker, not security). TUI becomes
display-only (queries gateway, no own sweep) — R2-7.
**0B. File-as-single-store + atomic persistence + validated reload.** New
CronScheduler methods: `reload(state)`, `saveJobs()` (mkdtemp→write→fsync→rename,
0600), `updateJob(id,patch)`, `removeJob(id)`, ctor `onDirty?:(jobs)=>void`.
`reload()` re-reads cron.json each sweep, **validating every job via
`validateCronPrompt`+cap** (invalid→quarantine), reconciling by the 3-case
contract (preserve run records). Gateway persists via `onDirty`. Remove
`syncCronJobs` overwrite + mya-bridge loader/sweep (R2-7). `/cron/jobs` GET joins
listJobs+runsOf. Unify path to `~/.mya/agent/cron.json` (0600).
**0C. Auth foundation.** 0600 token file (written before `listen()`); **token-free
`GET /`** (stop baking into dashboardHtml); gate `/ws-info`; **top-of-handleHttp auth
+ allowlist** (health/rootHtml/static/manifest/sw exempt); dashboard client sends
`Authorization: Bearer`; CLI reads token file + sends header on all calls;
`MYA_CRON_UNSAFE_NO_AUTH` decoupled. (Resolves C5/C6/C11 + R2-2/3/11/13.)
*Phase 0 verify:* test suite; TUI: `mya cron add` reaches running gateway without
restart; unauthenticated POST → 401; `GET /` contains no token; `/ws-info` → 401
without token; dashboard loads + fetches work; reload quarantines a bad-prompt job.

### Phase 1 — P0 correctness (D1, D2)
**1A. D2 — await-before-complete.** Extract `fireCronJob(job, run)`:
`start → await runOnSession("_cron:"+jobId, ...) → complete(real status)` with
empty-response soft-fail. Sweep uses per-job sessions (0A) + `Promise.allSettled`
(now real parallelism). `onRunOnSession` callback added to GatewayOptions (non-
breaking; keep `onWsMessage` for broadcast). Fix the stale startup warning (C… MIN-2).
**1B. D1 — wire cronAdd.** Trivial now that gateway owns the store (0B): `cronAdd`
callback → `register()` (write-through). POST forwards `timezone` (D9).
*Phase 1 verify:* failing prompt → `RunRecord.status="failed"`; empty → failed;
success → succeeded; D2 regression test asserts `runsOf(id)[n].status` post-await.

### Phase 2 — D3 missed-job catch-up (on 0B's persistence)
**2A. DOW/DOM OR fix + next-fire.** Implement OR semantics in `matchesCronExpr`
(C12). Add `computeNextFire(expr, base, tz)`: bounded minute-iteration from
`base+1min`, cap 527040 (1yr), reuse `matchesCronExpr`. Cache the two-call cron
period per-job. (C16 line numbers re-derived.)
**2B. nextRunAt + grace-windowed catch-up.** Add `nextRunAt?` to CronJob.
`computeGraceMs(trigger, schedule)` = `clamp(½·period, [120000, 7200000])`.
`dueAndAdvance(now): {due, dirty}`: for each cron job — recovery (C13: if
`matchesCronExpr(now)` → nextRunAt=now, else computeNextFire); due gate; fast-forward
if lateness > grace; fire-once fall-through. Return dirty set for the gateway to persist.
**2C. advance_next_run — crash at-most-once.** After `dueAndAdvance`, **persist the
`dirty` set (await `saveJobs`) BEFORE dispatching any due job** (R2-10 hard
invariant). Then advance recurring jobs' `nextRunAt`. `complete()` re-anchors off
completion time; make `complete(..., now=)` clock-injectable (cold MIN-1). Tradeoff
documented: crash between persist and fire = missed fire (at-most-once, hermes).
*Phase 2 verify:* stop gateway mid-minute, restart after → missed `0 9 * * *` fires
once, nextRunAt = tomorrow 09:00; far-overdue job fires exactly once; crash-after-
persist test via reload shows nextRunAt is future (no re-fire).

### Phase 3 — security (on 0A role + 0C auth)
**3A. max-jobs cap + min-interval floor + per-sweep concurrency cap.**
`scheduler.max_jobs` (default 50) + refuse `* * * * *` unless explicitly allowed
(C10). **Per-sweep fire budget** `scheduler.max_concurrent` (default 4) (R2-8):
`Promise.allSettled` over at most N due jobs; excess deferred to next sweep. All
enforced in register()/sweep.
**3B. `validateCronPrompt()` at every mutation.** Port hermes Tier-1 regexes (8
threat + 5 exfil), reuse `INVISIBLE_UNICODE_RE` from web/fetch (C18), ReDoS-gate each
pattern (C20). Called from register, updateCronJob, PATCH, CLI add/update. (C9.)
**3C. deny-mode cron-role whitelist + approval_mode config.** `scheduler.approval_mode`
(default DENY, **initial value frozen at startup; runtime-flippable via
authenticated `POST /config`**, logged — R2-9). DENY → cron role `toolsAllowed`
whitelist (0A, proven by cron-role-toolset test); MCP tools opt-in only. APPROVE →
explicit per-job opt-in, documented as unattended-full-cred (C7). (C8/C19.)
**3D. gateway-lifecycle guard.** Port the 4-branch regex (restart/stop/kill),
`hermes`→`mya`. At create+update. (hermes §4f.)
*Phase 3 verify:* benign-create + malicious-PATCH → 400; deny-mode job can't call
write/shell/scheduler; invisible-unicode blocked; max-jobs over cap → 429.

### Phase 4 — reliability / observability
**4A. Run history SQLite** (`~/.mya/agent/cron.db`, better-sqlite3 already a dep).
`cron_runs` table; insert on claim, update on complete; prune to N.
**4B. observability fields (D5).** Populate `lastRunAt`/`nextRunAt`/`lastStatus`/
`lastError` from the completion path; propagate via `listCronJobs` (control plane
reads scheduler — no syncCronJobs). `cronHistory` CLI → new `GET /cron/jobs/:id/runs`
endpoint (CLI goes through HTTP now).
**4C. heartbeat.** `cron_heartbeat` + `cron_last_success` files; `mya cron status`
reports freshness.
*Phase 4 verify:* restart → `cron history` shows prior runs; `cron status` heartbeat.

### Phase 5 (future, deferred — feature-tier)
base_url/provider-host guard + snapshot drift (needs CronJob schema: add
`provider?`/`base_url?`/`model?`); Tier-2 skill scan; tirith; delivery fan-out;
`[SILENT]`; continuable threads; context_from; workdir; no_agent; TZ offset-migration
repair; multi-machine claim; parallel/sequential pool split.

---

## Test plan (rev 2)
New: `gateway-cron-fire.test.ts`, `gateway-cron-add.test.ts`, `gateway-cron-auth.test.ts`,
`cron-nextfire.test.ts`, `cron-catchup.test.ts`, `cron-persist.test.ts`,
`cron-scan.test.ts`, `cron-history.test.ts`, `cron-role-toolset.test.ts`,
`cron-concurrency.test.ts` (atomic-claim: two workers, one job → one fire).
Clock-injection seams: `due(now=)`, `claim(...,now=)`, `complete(...,now=)`,
`computeNextFire(expr, base)`, `computeGraceMs`. Target +~45 tests; suite stays green.

## Verification (per phase + final)
`npx vitest run --pool forks packages/cron packages/gateway packages/print` ·
`npx tsc --noEmit` · `npm run bundle` + grep markers · TUI real check (tmux +
MiniMax): add/observe/history/status end-to-end, including restart-mid-minute.
Cold-verify each phase independently against actual changed code.

## Risks (rev 3)
- **R1 (load-bearing):** 0A role-wiring (R2-1) is THE dependency for anti-recursion
  + deny-mode whitelist. `roles.ts` `filterToolsForRole` exists; adding a param to
  acquire/factory is likely straightforward but UNVERIFIED until 0A lands. If
  infeasible → prompt-level fallback (explicitly NOT a security claim); deny-mode
  downgraded to "best-effort" + approval_mode stays deny-default (so no full-cred
  unattended unless operator explicitly approves).
- **R2:** 0C is the largest single piece (token file + token-free rootHtml +
  dashboard client auth + allowlist + CLI). Budget as M-L.
- **R3:** next-fire perf (minute-iteration) — cap + per-job period cache.
- **R4:** file-as-store reload each sweep — reconcile preserves run records; tested.
- **R5:** scope grew (Phase 0). If time-boxed: **Phase 0C (auth) + 0B (store) +
  Phase 1 fix D1/D2 + the worst security hole.** 0A role-wiring is the droppable
  piece (prompt-level fallback); 0B/0C are not safely deferrable.

## Round-3 execution guardrails (implementer must hold to)

1. **0A role-wiring — use `excludeTools`** (already in `CreateAgentSessionOptions`,
   `sdk.ts:67`) rather than threading `roleFilter` through 3 layers. Pass
   `excludeTools: cronRole.toolsDenied` from the factory closure (`main.ts:254`).
   Pool caches by `poolKey(sessionId, agentName)` → no cross-contamination with
   interactive sessions. Prove with `cron-role-toolset.test.ts`.
2. **0C bootstrap token — pick the cookie path** (the "authenticated fetch"
   option is circular). HttpOnly `SameSite=Strict` cookie set only on
   localhost-origin `GET /` (reuse the Origin check at `gateway:376`). Same-user
   browsers receiving it is within AD3's deferred-to-Unix-socket threat model.
3. **0B quarantine observability** — surface quarantined-job count via
   `mya cron status` (connect to Phase 4C heartbeat) so a user whose hand-edited
   cron.json job got quarantined discovers why without reading gateway stderr.
4. **mya-bridge token reading** — wire `gw.token` file reading in mya-bridge (same
   as CLI) so TUI `/cron` display works post-0C. Document that `/cron` now requires
   a running gateway (deliberate tradeoff of "gateway sole sweeper").
5. **Phase 1 sweep refactor** — budget the gateway sweep loop (`gateway:405-429`)
   async refactor in Phase 1A: synchronous `setInterval` + immediate
   `complete("succeeded")` → async `fireCronJob` + `Promise.allSettled` +
   post-await `complete(realStatus)`.
