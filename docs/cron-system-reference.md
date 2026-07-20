# Cron System — Technical Reference

> **Status**: production-ready (deny-mode default). 282 tests. 29 commits
> (`017a9cc` → `9c35bd9`). Bundle rebuilt. TUI/CLI verified end-to-end.
> Last updated: 2026-07-20.

## Overview

mya's cron schedules **agent turns** (LLM) and **shell jobs** (no LLM) on cron
expressions, intervals, or one-shot timestamps. Jobs persist to `~/.mya/agent/
cron.json` (atomic 0600); run history to `~/.mya/agent/cron.db` (SQLite WAL).
The gateway sweeps every 30 s, claims due jobs atomically, fires each on an
isolated `_cron:<jobId>` session, and records the real outcome.

## Architecture

```
┌─ CLI (cron-cli.ts) ─────────────────────────────────────────────┐
│  mya cron {list|add|remove|update|enable|disable|run|history|   │
│             status}                                              │
│  dual-write: file (atomicWriteJobs) + HTTP POST (immediate)     │
│  resolveJobId: name→ID (exact ID / exact name / prefix)         │
│  validateCronPrompt at add-time (immediate rejection)           │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP (Bearer wsToken or MYA_CRON_UNSAFE_NO_AUTH)
┌─ Gateway (gateway/index.ts) ┴────────────────────────────────────┐
│  Auth gate: wsToken Bearer/cookie + CSRF Origin-exact + C11     │
│  cron mutations (/cron/* non-GET) require wsToken or UNSAFE     │
│  Allowlist: health/ready/manifest/sw/icons/GET / + webhook/pair │
│                                                                  │
│  cronSweep (async, every 30 s, unref):                           │
│    1. cronHeartbeat(false) — alive marker                        │
│    2. cronReload → reconcile (validates every loaded job)        │
│    3. dueAndAdvance → fire-once + advance nextRunAt              │
│    4. cronPersist (pre-fire, at-most-once across crashes)        │
│    5. batch = due.slice(0, cronMaxConcurrent=4)                  │
│    6. for each job:                                              │
│       drift check → context_from inject → skills inject →        │
│       Tier-2 assembled-prompt scan →                             │
│       shell? (onRunShell) : agent? (onRunOnSession) →            │
│       [SILENT] suppression → delivery (channel:<id>:<target>) →  │
│       complete(real status) → cronRunEnd (SQLite mirror)         │
│    7. cronPersist (post-complete, re-anchor accuracy)            │
│    8. sweepExpired → mirror lease-expired runs                   │
│    9. cronHeartbeat(true) — success marker                       │
│                                                                  │
│  cronSweeping guard: overlapping sweeps skip                     │
└────────────────────────────┬─────────────────────────────────────┘
                             │ callbacks (wired in main.ts)
┌─ Scheduler (cron/index.ts) ┴─────────────────────────────────────┐
│  CronScheduler (pure, zero-dep beyond @my-agent/core)            │
│  Jobs Map + runs/jobRuns Maps (in-memory)                        │
│  onDirty callback → gateway atomicWriteJobs                      │
│  register/updateJob/removeJob → markDirty → persist              │
│  reconcile (3-case: add/replace/drop, preserve run records)      │
│  dueAndAdvance: recovery → fire-once → advance nextRunAt         │
│  computeNextFire: bounded minute-iteration (1-yr cap)            │
│  matchesCronExpr: 5-field + DOW/DOM OR semantics                 │
│  summary(): joins lastRunAt/lastStatus/lastError for GET         │
│  validator: validateCronPrompt at register/updateJob             │
│  maxJobs cap (50) + min-interval floor (refuse * * * * *)        │
│  impossible-expr → disable (not perpetual re-fire)               │
└──────────────────────────────────────────────────────────────────┘
```

## CronJob schema

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID or timestamp-based |
| `name` | string | Display name (used for name→ID resolution) |
| `trigger` | `"cron" \| "on-interval" \| "once"` | Scheduling type |
| `schedule` | string \| number | Cron expr / interval-ms / epoch-ms |
| `prompt` | string | Agent prompt (empty for shell-only) |
| `deliveryTarget` | string | `"channel:<id>:<target>"` comma-separated, or `"_cron"` |
| `enabled` | boolean | Master on/off |
| `leaseMs` | number | TTL lease (default 300 000 = 5 min) |
| `timezone` | string? | IANA name (e.g. `"America/New_York"`) |
| `nextRunAt` | number? | Epoch-ms — advanced before fire (at-most-once) |
| `jobType` | `"agent" \| "shell"?` | Default `"agent"`; `"shell"` = no LLM |
| `command` | string? | Shell command (`sh -c`) for jobType=shell |
| `script` | string? | Script path (confined to `~/.mya/agent/scripts/`) |
| `workdir` | string? | Per-job cwd |
| `provider` | string? | Per-job provider override |
| `base_url` | string? | Per-job base URL (requires explicit provider) |
| `model` | string? | Per-job model override |
| `providerSnapshot` | string? | Global default at create (drift guard) |
| `modelSnapshot` | string? | Same |
| `contextFrom` | string[]? | Job IDs whose latest output is injected |
| `skills` | string[]? | Skill names to load + inject |

## Scheduling

| Trigger | Match | Catch-up |
|---|---|---|
| `cron` (5-field expr) | `matchesCronExpr` (DOW/DOM OR) | fire-once + advance (hermes fast-forward) |
| `on-interval` (ms) | `now - lastRunAt >= schedule` | single fire on next sweep |
| `once` (epoch-ms) | `now >= schedule && !succeeded` | retries until succeeded |

- **Timezone**: per-job IANA via `Intl.DateTimeFormat` (job.timezone → `MYA_TZ` → local).
- **Missed-job**: downtime collapses the backlog to a single fire (no burst-fire,
  no silent skip, no #33315 infinite-defer).
- **At-most-once**: nextRunAt advanced + persisted BEFORE fire; a crash during
  fire → the job's nextRunAt is already future on disk → no re-fire.
- **Impossible expressions** (`0 0 31 2 *`, month 13): DISABLED on first
  due-check (not perpetual re-fire).

## Execution

| Path | Mechanism |
|---|---|
| Agent job | `onRunOnSession("_cron:<jobId>", prompt)` → pooled AgentSession (per-job isolation, real parallelism) |
| Shell job | `onRunShell({command/script, workdir})` → `execFile` (async, 120s timeout, script path confined + realpath-checked) |
| Skills | `cronLoadSkills(names)` → SkillStore.get(name).body injected pre-prompt |
| context_from | `cronJobOutput(srcId)` → getLastOutput from SQLite → injected pre-prompt |
| [SILENT] | `isSilenceResponse(text)` → succeeded, content not broadcast/delivered |

### Concurrency
- `cronMaxConcurrent` (default 4, per-sweep fire budget). Excess due jobs deferred
  to next sweep (not dropped).
- `cronSweeping` re-entrancy guard: overlapping sweeps skip.

## Delivery

`deliveryTarget` grammar: comma-separated `"channel:<id>:<target>"` entries.

After a succeeded non-silent run, cronSweep resolves each target via
`ChannelRegistry.get(id).send(target, output)`. Supported channels:
Telegram, Discord, Slack, Email, Webhook, WhatsApp, Signal, Matrix.

## Security

| Layer | Mechanism |
|---|---|
| **Auth gate** | wsToken Bearer header OR HttpOnly `mya_ws` cookie. Constant-time compare. CSRF: Origin must match gateway's own port (blocks cross-port localhost). |
| **C11 cron mutations** | All `/cron/*` non-GET routes require wsToken OR `MYA_CRON_UNSAFE_NO_AUTH=1`. `MYA_NO_WS_TOKEN` does NOT open them. |
| **Token distribution** | `~/.mya/agent/gw.token` (0600), written before `listen()`. CLI/launcher/channels-cli read it via `gw-auth.ts`. |
| **Token-free rootHtml** | Dashboard obtains token via HttpOnly SameSite=Strict cookie on `GET /`. `/ws-info` is Bearer-only (no cookie). |
| **Prompt scan** (Tier-1) | `validateCronPrompt`: 12 patterns (injection, exfil curl/wget, destructive rm, secrets, ssh-backdoor, sudoers, gateway-lifecycle) + invisible-unicode hard-block. At register/updateJob + reconcile (file-layer gate). |
| **Tier-2 assembled scan** | `validateCronAssembledPrompt`: looser (injection directives only) on the assembled prompt (skills + context_from). At fire-time. |
| **Deny-mode** (default) | `MYA_CRON_APPROVAL_MODE=deny` → cron-fired agent turns restricted to `{read, glob, grep, ls, find}` (allowlist, not denylist). Fail-closed (only explicit `approve` grants full tools). Runtime-flippable via `POST /cron/approval-mode`. |
| **Shell jobs** | Require `MYA_CRON_ALLOW_SHELL=1`. Script paths confined to `~/.mya/agent/scripts/` (realpath-checked). |
| **base_url guard** | `validateCronBaseUrl`: base_url requires explicit provider; `custom` (BYOK) allowed. |
| **Snapshot drift** | `providerSnapshot`/`modelSnapshot` captured at create; if global default drifted → run fails closed. |
| **Max-jobs cap** | 50 (enforced in register + reconcile). `MYA_CRON_MAX_JOBS` env. |
| **Min-interval floor** | `* * * * *` refused unless `MYA_CRON_ALLOW_HIGH_FREQUENCY=1`. |
| **PATCH field allowlist** | jobType/command/script/provider/base_url are create-only (can't PATCH-escalate agent→shell). |

### Threat model
- **Blocks**: browsers (SameSite=Strict, HttpOnly, CSRF Origin), cross-user
  (0600 files, 0700 dir), prompt-injection (regex scan), cost amplification
  (cap + concurrency), file-layer bypass (reconcile validate).
- **Residual (deny-mode)**: `read` can read secrets into the LLM context — same
  provider trust boundary as interactive; no outbound network in deny-mode (no
  bash/web) so no exfil to attacker URL.
- **Same-user isolation**: deferred to Unix-socket binding (a same-user process
  can still read gw.token / cron.json).

## Persistence

| Store | Path | Mode | Atomic |
|---|---|---|---|
| Jobs (config) | `~/.mya/agent/cron.json` | 0600 | `flag:"wx"` + fsync + rename |
| Run history | `~/.mya/agent/cron.db` | 0600 | SQLite WAL |
| Heartbeat | `~/.mya/agent/cron_heartbeat` + `cron_last_success` | 0600 | tmpfile + rename |
| Token | `~/.mya/agent/gw.token` | 0600 | `flag:"wx"` |
| Declarative | `~/.mya/agent/cron.config.json` | — | operator-managed |

- **Reconcile**: every sweep, `cronReload()` re-reads cron.json → `reconcile()`
  (3-case: add new, replace changed, drop removed; preserves run records).
  Validates every loaded job via `validateCronPrompt`. Quarantines bad jobs.
- **Declarative seed**: at startup, `cron.config.json` seeds jobs by name
  (missing only, preserves runtime state). Reconcile runs BEFORE seed (no
  overwrite of manual jobs).
- **Dirty guard**: if a write fails (disk full / RO FS), `cronReload` retries +
  skips reconcile (in-memory state preserved — no silent drop).

## Observability

| Signal | Source | Surface |
|---|---|---|
| `lastRunAt` / `lastStatus` / `lastError` | `summary()` (in-memory runsOf) | `GET /cron/jobs`, launcher tab |
| `nextRunAt` | CronJob field (advanced before fire) | `GET /cron/jobs`, launcher tab |
| Run history | SQLite `cron_runs` (pruned to 500) | `GET /cron/jobs/:id/runs`, `mya cron history` |
| Output | SQLite `cron_runs.output` (100KB cap) | `getLastOutput` (context_from chaining) |
| Heartbeat | `cron_heartbeat` (every sweep) + `cron_last_success` (clean sweep) | `mya cron status`, `heartbeatAge()` |
| Quarantine count | `reconcile().quarantined` | gateway stderr warn |

**Alive-but-failing detection**: heartbeat fresh + success stale = ticker is
running but every sweep throws. Both stale = dead ticker.

## CLI commands

| Command | Description |
|---|---|
| `mya cron list` | List all jobs (via HTTP GET /cron/jobs) |
| `mya cron add <name> <schedule> [prompt] [timezone]` | Add (dual-write: file + HTTP POST; validates prompt) |
| `mya cron remove <name\|id>` | Remove (resolveJobId; file + HTTP DELETE) |
| `mya cron update <name\|id> <field> <value>` | Patch (name\|schedule\|prompt\|enabled\|trigger\|timezone) |
| `mya cron enable\|disable <name\|id>` | Toggle enabled |
| `mya cron run <name\|id>` | Manual trigger (claim → run → complete) |
| `mya cron history <name\|id>` | Durable run history (SQLite) |
| `mya cron status` | Heartbeat freshness + job count |

All commands use `resolveJobId()` (name→ID: exact ID, exact name, 8-char prefix).
Auth via `gw-auth.ts` (`readGwToken` → Bearer header).

## Launcher (TUI)

- **Cron tab** (key `3`): lists jobs with enabled icon (●/○), schedule, type
  badge (🤖 agent / 🔧 shell), lastStatus (✓/✗/⏱), lastRunAt, nextRunAt.
- **Keybindings**: `↑/↓` navigate, `Space` toggle, `r` run, `d` delete,
  `a` add (inline prompt wizard).
- **Status tab**: shows cron job count + `~/.mya/agent/cron.json` path.
- Uses `job.id` from GET response (no name resolution needed).

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `MYA_PORT` | `3000` | Gateway port (CLI/launcher use this to connect) |
| `MYA_NO_WS_TOKEN` | unset | Skip wsToken (DEV — disables ALL auth) |
| `MYA_CRON_UNSAFE_NO_AUTH` | unset | Allow cron mutations without wsToken (DEV) |
| `MYA_CRON_APPROVAL_MODE` | `deny` | `deny` = read-only allowlist; `approve` = full tools |
| `MYA_CRON_ALLOW_SHELL` | unset | Allow shell-job registration + execution |
| `MYA_CRON_MAX_JOBS` | `50` | Max registered jobs |
| `MYA_CRON_ALLOW_HIGH_FREQUENCY` | unset | Allow `* * * * *` (every-minute cron) |
| `MYA_TZ` | unset | Default timezone for jobs without explicit `timezone` |
| `MYA_PROVIDER` | unset | Global default provider (snapshot drift check) |
| `MYA_MODEL` | unset | Global default model (snapshot drift check) |

## Known limitations (documented, Phase 5+)

- **base_url host-match**: the schema-level guard (base_url requires provider)
  is enforced; the full host-match against the provider registry is not yet wired
  (per-job base_url/provider not yet honored by the agent turn).
- **Per-job workdir for agent jobs**: honored for shell jobs (cwd); agent sessions
  use the pool default cwd (pool factory doesn't accept per-session workdir).
- **Continuable threads**: delivery-to-thread is supported via the channel target
  format; full session-routing (user replies in-context to the cron session) needs
  deeper integration.
- **Same-user isolation**: gw.token / cron.json are 0600 but readable by any
  same-user process. Deferred to Unix-socket binding.
- **tirith**: external binary, not integrated (regex scan is the defense-in-depth).
- **Multi-machine**: single-process design; cross-process locking + multi-replica
  claim_job_for_fire deferred.
