# Cron / Scheduling — mya vs Reference Implementations

Deep comparison of mya's current cron implementation against three reference
agent projects: **hermes-agent** (Python), **mya-v1** (Rust — previous attempt),
and **openhuman** (Rust). Goal: identify correctness defects in mya's cron and
prioritize what to adopt.

> Source of truth: `packages/cron`, `packages/gateway`, `packages/print` (mya) ·
> `source/hermes-agent/tools/cronjob_tools.py` + `cron/jobs.py` (hermes) ·
> `source/mya-v1/crates/mya-runtime/src/cron/` (mya-v1) ·
> `source/openhuman/src/openhuman/cron/` (openhuman).
> `openpi`, `openclaw`, `oh-my-pi`, `pi-coding-agent` have **no scheduling engine**
> (only UI/keep-alive timers) — excluded.

---

## TL;DR — verdict

mya's cron is a **minimal viable scheduler with three correctness defects that
make it unsafe for production unattended use**, plus a security gap (no auth on
the management API). The scheduling *expression* layer (5-field parser + TZ) is
competent, but the **execution-tracking**, **missed-job**, **persistence**, and
**authorization** layers are each substantially behind all three references.

| Layer | mya | hermes | mya-v1 | openhuman |
|---|---|---|---|---|
| Cron expression | hand-rolled 5-field ✅ | croniter ✅ | `cron` crate ✅ | `cron` crate (5→6 norm) ✅ |
| Timezone | per-job IANA ✅ | Hermes-config TZ + offset-migration repair | per-job IANA | per-job IANA + `active_hours` |
| Persistence | JSON file (jobs), **ephemeral runs** | JSON + atomic fsync + filelock | **SQLite WAL** + `locked_at` CAS | SQLite WAL |
| Missed-job policy | **NONE** (cron trigger silently skips) | **catch-up-once + fast-forward** (grace-windowed) | **configurable** catch-up vs skip | re-anchor only |
| At-most-once | claim/lease (but buggy — see D2) | pre-run advance + multi-machine claim TTL | DB `locked_at` CAS + stale-lock recovery | none (next_run advance) |
| Run history | **ephemeral, stub CLI** | per-run `.md` (keep 50) | `cron_runs` table (pruned) | `cron_runs` table (pruned) |
| Execution tracking | **marks "succeeded" before run** ✗ | pre-run advance, real status | real status + retries | real status + retries |
| Auth/approval | **NONE** (unauthenticated API) | **`cron_mode`** (deny default) + injection scan | per-agent `SecurityPolicy` + risk gate | `ApprovalGate` + `TrustedAutomation` origin |
| Retries | none | none (one-shot grace) | exponential backoff | exponential backoff + permanent-halt |

---

## mya cron — current state (summary)

A `CronScheduler` (`packages/cron/src/index.ts`, 260 lines, **zero runtime deps**
beyond `@my-agent/core` — minimal-core compliant) driven by a `setInterval`
sweep in the gateway (default 30s, `unref()`-ed). Three trigger types:
`cron` (5-field expr), `on-interval` (ms), `once` (epoch-ms). Jobs persisted to
`~/.mya/agent/cron.json`; a claim/lease mechanism (`leaseMs`, default 5min)
attempts at-most-once. Firing kicks a **real agent turn** (`session.prompt(...)`)
on a pooled `AgentSession`, broadcasting events to the `"_cron"` WS session.

Parser supports `*`, `*/N`, ranges, `A-B/N`, comma lists, named DOW/months,
`7→0` Sunday, with a `*/0` infinite-loop guard. Timezone via `Intl.DateTimeFormat`
(job.timezone → `MYA_TZ` → local). 13 parser tests; **zero tests** for claim,
lease, due, persistence, sweep, or any CLI command.

Full audit: see §"mya Cron" in the research artifacts. The headline issues:

### D1 — `cronAdd` callback never wired (CRITICAL, functional)
`POST /cron/jobs` registers the job in the `ControlPlane` but the
`if (this.cronAdd) this.cronAdd(created)` guard (`gateway/index.ts:825`)
silently no-ops because the `Gateway` constructor in `main.ts` never sets
`cronAdd`. **HTTP-added jobs appear in `GET /cron/jobs` but never fire.** Only
the file-reload path (`cron.json` at startup) actually registers jobs in the
`CronScheduler`.

### D2 — sweep marks `"succeeded"` before execution (CRITICAL, observability)
The sweep loop (`gateway/index.ts:416-420`) calls `onWsMessage(...)` (a
fire-and-forget async `runOnSession`), then **synchronously** calls
`cron.start(run.runId); cron.complete(run.runId, "succeeded")`. Every auto-fired
job is recorded as succeeded regardless of actual outcome, *before* the agent
turn runs. This also **defeats the `once`-trigger retry logic** (a failed `once`
job is falsely marked succeeded → never retries).

### D3 — no missed-job catch-up for `cron` trigger (HIGH, correctness)
`due()` matches `matchesCronExpr(schedule, new Date(now))` against the current
minute only (`index.ts:128`). If the gateway is down at 09:00 and restarts at
09:01, the 09:00 job is **silently skipped** — no last-fired timestamp, no
detection, no replay. (`on-interval` does a single catch-up fire; `once`
retries-until-succeeded — but see D2.) This is the #1 correctness gap vs all
references.

### Plus (lower severity)
- **D4** dual persistence paths: `~/.mya/agent/cron.json` (CLI/main) vs
  `~/.mya/cron.json` (mya-bridge loader) never agree.
- **D5** observability fields dead: `lastRunAt`/`nextRunAt`/`lastStatus`/
  `lastError` declared + displayed but never written anywhere.
- **D6** no auth on `/cron/jobs` management API (any local process can register
  arbitrary-prompt jobs with full agent credentials).
- **D7** no `update` command (only `enabled` patchable); `cronHistory` is a stub.
- **D8** minute-granularity only (no seconds); `* * * * *` can fire 2×/min under
  a 30s sweep.
- **D9** timezone not propagated through `syncCronJobs()`/HTTP POST.
- **D10** `leaseMs` hardcoded on reload; `cronRemove` uses a private-field cast
  hack; module docstring over-promises (failure-alert, delivery grammar — none
  implemented).

---

## Reference highlights (what each does that mya doesn't)

### hermes-agent — the gold standard for cron safety
- **Catch-up-once + fast-forward**: a grace window (½ period, clamped 120s–2h)
  decides whether a missed job fires once (then `next_run` is fast-forwarded to
  the next future occurrence) — prevents both silent skip AND burst-fire
  backlogs (#33315).
- **`approvals.cron_mode`** (default **deny**): when `HERMES_CRON_SESSION` is set
  and mode is `deny`, dangerous commands are hard-blocked ("cron jobs run without
  a user present to approve"). Fail-closed on unknown/config-load error. Aliases
  `off`/`allow`/`yes` → approve; `--yolo` overrides.
- **Two-tier prompt-injection scan**: strict `_scan_cron_prompt` (injection,
  `cat .env`, `authorized_keys`, `/etc/sudoers`, `rm -rf /`, secret-exfil curl)
  on the user prompt; looser scan on assembled skill content (invisible-unicode
  *sanitized*, not blocked). **`_validate_cron_base_url`** rejects pairing a
  named provider's stored credential with an off-host base_url (CWE-200/522
  exfil). Script paths confined to `~/.hermes/scripts/`.
- **Pre-run at-most-once**: `advance_next_run` called *before* execution for
  recurring jobs; `claim_dispatch` atomically increments `repeat.completed` under
  lock *before* the side effect (crash can't re-fire forever, #38758);
  multi-machine `claim_job_for_fire` with stale-claim TTL.
- **Atomic persistence**: JSON tmpfile → `os.fsync` → atomic_replace, secured
  `0600`, cross-process `fcntl.flock`/`msvcrt.locking` (nesting-aware).
- **Rich execution**: full agent spawn with skills, `context_from` job-output
  chaining, `no_agent` script-only mode (watchdog), multi-platform delivery
  (telegram/discord/slack/…), `[SILENT]` sentinel, continuable threads
  (`attach_to_session`), per-job workdir, provider/model **snapshot drift
  detection** (#44585).

### mya-v1 (Rust) — the "previous mya" baseline
- **SQLite + DB-level in-flight locking**: `claim_job` does conditional
  `UPDATE cron_jobs SET locked_at=? WHERE id=? AND locked_at IS NULL` (single
  atomic step); `clear_stale_locks` at boot recovers crashed-process locks (#6037).
- **Configurable missed-job policy**: `catch_up_on_startup` (default on → runs
  ALL overdue ignoring max_tasks) OR skip (advance recurring / disable one-shot
  as `last_status='skipped'`).
- **Retries with exponential backoff** (`scheduler_retries`, jitter, capped 30s);
  deterministic policy violations short-circuit.
- **Per-agent `SecurityPolicy`**: read-only blocks, `max_actions_per_hour` rate
  limit, `approved=true` required for medium/high-risk shell commands in
  supervised mode, **agent-alias ownership scoping** (one agent can't mutate
  another's job).
- **Declarative config sync**: config-defined jobs reconcile into the DB on every
  daemon start; stale declarative entries removed, runtime state preserved.
  Plus a synthesized builtin **backup job** from `config.backup.schedule_cron`.
- **Shell + Agent job types**; cron agent jobs auto-exclude `cron_*` tools
  (prevent recursive scheduling); per-agent memory recall + scoped purge on
  failed isolated runs.

### openhuman (Rust) — flow-engine integration
- **Flow trigger binding**: `JobType::Flow` publishes `FlowScheduleTick` → a
  tinyflows graph executes (n8n-import, Flow Scout discovery, run-history
  inspector). Partial unique index prevents duplicate flow bindings.
- **`active_hours` window** with midnight-spanning support.
- **Permanent-halt classification**: expired-session / insufficient-credits /
  budget-exhausted / api-key-unset / local-provider-unreachable failures halt on
  **first occurrence** and skip the retries-exhausted Sentry report, surfacing
  actionable static `&'static str` copy (no raw error leak — load-bearing
  contract tested).
- **Built-in agent definitions** (`agent_id`) with model-spec resolution
  (Hint/Inherit/Exact) and iteration caps; morning-briefing specialization.
- **`TrustedAutomation { Cron }` turn origin** auto-authorizes the job's
  external-effect tools (user authorized the prompt at creation); a
  `Flow.require_approval` flag overrides to force per-action approval.

---

## Gap analysis — what mya should adopt, prioritized

### P0 — correctness defects (fix before any production cron use)

| # | Gap | Fix inspiration | Effort |
|---|---|---|---|
| **D1** | `cronAdd` not wired → HTTP jobs never fire | Wire `cronAdd` callback in `main.ts` Gateway ctor (call `cron.register(created)`) | S |
| **D2** | Sweep marks "succeeded" before run | Make the sweep `await runOnSession` then `complete(run, status)` (mirror the correct `cronRunNow` path); OR pass an async completion callback | S |
| **D3** | No missed-job catch-up for `cron` | Track `lastFiredAt` per job; on sweep, if `lastFiredAt` missed a matched window within a grace period, fire once + fast-forward (hermes model). At minimum: persist + compare against last-fired | M |

### P1 — security (unattended jobs = privilege)

| # | Gap | Fix inspiration | Effort |
|---|---|---|---|
| **D6** | No auth on cron management API | Reuse the gateway's `wsToken`/auth for `/cron/jobs` routes; or bind to a Unix socket with fs perms (hermes `0600`) | S |
| — | No approval gate for dangerous job prompts | Adopt hermes's `cron_mode` (deny default) + prompt-injection scan; or mya-v1's `approved` flag for risky commands | M |
| — | Jobs run arbitrary prompts with full credentials | mya-v1 `allowed_tools` scoping + auto-exclude `cron_*` tools (prevent recursive scheduling) | M |

### P2 — reliability / observability

| # | Gap | Fix inspiration | Effort |
|---|---|---|---|
| **D5** | Dead observability fields | Populate `lastRunAt`/`nextRunAt`/`lastStatus`/`lastError` from the (fixed) completion path | S |
| — | Ephemeral run history | Persist `RunRecord`s to the memory SQLite backend (already exists) — `cron_runs` table, pruned (mya-v1/openhuman) | M |
| — | No retries | `execute_job_with_retry` with backoff (mya-v1/openhuman); permanent-halt classification (openhuman) | M |
| **D4** | Dual persistence paths | Unify to one path; remove the mya-bridge divergent loader | S |
| **D7** | No `update`; `cronHistory` stub | Add full `cron_update` (mya-v1 patch shape); implement history from `cron_runs` | M |
| — | No at-most-once crash recovery | A `locked_at`/claim-with-persistence column (mya-v1) or pre-run `next_run` advance (hermes) | M |

### P3 — capability (feature parity, lower urgency)

| Gap | Fix inspiration |
|---|---|
| Delivery-target grammar (declared in docstring, not implemented) | hermes multi-platform fan-out + `[SILENT]`; openhuman proactive/announce + empty-output suppression |
| Declarative/config-defined jobs | mya-v1 `sync_declarative_jobs` |
| `no_agent` script-only watchdog mode | hermes |
| Job-output chaining (`context_from`) | hermes |
| Seconds-level scheduling (6-field) | openhuman 5→6 normalization |
| Flow/graph trigger | openhuman `JobType::Flow` (only if mya adopts a flow engine) |
| Provider/model snapshot drift detection | hermes (#44585) |

---

## Architectural decision points

1. **Persistence backend: JSON or SQLite?** mya currently uses JSON (like hermes).
   The memory package already has a SQLite backend — reusing it for `cron_runs`
   + a `cron_jobs` table would match mya-v1/openhuman and get WAL + transactions
   for free, enabling DB-level `locked_at` CAS (the cleanest at-most-once). The
   minimal-core constraint is satisfied (better-sqlite3 is already a dep via
   memory). **Recommendation: SQLite for runs + locking, keep JSON for the
   declarative job list if desired, or migrate fully.**

2. **Missed-job policy: which model?** hermes's grace-windowed catch-up-once is
   the most robust (handles both "was down briefly" and "was down for days"
   without burst-fire). mya-v1's configurable flag is simpler. openhuman's
   re-anchor-only is the *current mya* behavior for `on-interval` — extending
   that explicitness to `cron` is the minimal fix. **Recommendation: adopt
   hermes's grace window (½ period, clamped) — it's the proven design.**

3. **Execution tracking: how to close D2?** Two clean options: (a) make the sweep
   `await` each fire (serializes cron jobs — may delay subsequent ticks; bounded
   by `buffer_unordered(max_concurrent)` like the Rust refs); (b) pass an async
   `onComplete(runId, status, error)` callback to `runOnSession`. **(b) is
   non-blocking and matches the current fire-and-forget shape.**

4. **Approval model: hermes `cron_mode` vs general SecurityPolicy?** hermes's
   dedicated cron approval *mode* is the most thoughtful (cron runs unattended
   → default-deny dangerous commands). Worth adopting wholesale if mya adds a
   command-risk classifier; otherwise mya-v1's per-agent `SecurityPolicy` +
   `approved` flag is the lighter path.

---

## Lessons (cross-cutting with the web-hardening findings)

1. **Tests passing ≠ feature working (again).** mya's 13 parser tests pass, but
   the *scheduling* (claim/due/sweep/persistence) has zero tests and 3 of its
   paths are broken. Same pattern as G3 (TTL on dead code): the unit under test
   works; the production wiring doesn't. → *Always verify the feature reaches
   the production call path.*
2. **Fire-and-forget + synchronous status marking is a category bug.** D2 is the
   async-completion-tracking analogue of the G3 "cache populated but never read"
   defect. → *Async side effects need async completion; never mark done before
   the effect runs.*
3. **Unattended execution = elevated privilege.** hermes's entire cron-mode +
   injection-scan + base_url-guard layer exists because cron jobs run without a
   user present. mya's "arbitrary prompt, full credentials, no auth" is the
   highest-leverage security debt — more so than any single web-lookup gap.

---

## Test inventory (target, post-fix)

A production cron needs at minimum:
- Atomic claim correctness (two workers, same job → exactly one fires).
- Lease expiry + recovery.
- `cron`/`on-interval`/`once` trigger logic each.
- Missed-job: downtime-then-restart fires once (not zero, not N).
- Persistence round-trip (cron.json / sqlite reload).
- D1 fix: HTTP-added job actually fires.
- D2 fix: failed run recorded as `failed`.
- `cronHistory` reads persisted runs.
- Management API auth (unauthorized → 401).
