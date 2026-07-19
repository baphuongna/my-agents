# Hermes Cron — Deep-Dive & Port Reference

Implementation-level analysis of hermes-agent's cron, consolidated from a
three-layer deep-dive (scheduling core / ticker+execution / security). Every
algorithm is quoted at `file:line` against `source/hermes-agent/`. Goal: a
port reference for fixing mya's cron defects (D1/D2/D3) + security gap (D6).

> Files: `cron/jobs.py` (1924L), `cron/scheduler.py` (3638L),
> `cron/scheduler_provider.py`, `cron/lifecycle_guard.py`, `cron/jobs.py`,
> `tools/cronjob_tools.py` (1137L), `tools/approval.py`, `hermes_time.py`,
> `utils.py`, `tests/tools/test_cron_approval_mode.py` (434L).

---

## Architecture — the end-to-end fire flow

```
InProcessCronScheduler.start()  [daemon thread, 60s loop, sync=False]
  └─ tick()
       ├─ flock(.tick.lock, LOCK_EX|LOCK_NB)   ← cross-process single-tick
       ├─ due = get_due_jobs()                   ← catch-up + fast-forward + at-most-once recovery
       ├─ for job in due: advance_next_run(job)  ← PRE-EXEC at-most-once (recurring)
       ├─ partition: workdir→seq-pool, rest→parallel-pool
       └─ for job: submit → run_one_job(job)
                      ├─ claim_dispatch(job)     ← PRE-EXEC atomic (finite one-shot)
                      ├─ run_job(job)            ← build prompt + AIAgent (or no_agent script)
                      │    ├─ _build_job_prompt  (skills + context_from + script + cron hint)
                      │    ├─ AIAgent(...).run_conversation(prompt)
                      │    └─ inactivity timeout (600s)
                      ├─ save_job_output()        ← cron/output/<id>/<ts>.md (keep 50)
                      ├─ _deliver_result()        ← fan-out unless [SILENT]
                      └─ mark_job_run(ok, err, delivery_err)  ← POST-EXEC, real status
```

**The two load-bearing orderings** (what mya gets wrong):
1. **advance + claim BEFORE** the side effect → at-most-once across crashes.
2. **mark_job_run AFTER** execution completes → RunRecord reflects reality.

mya's sweep does the opposite of #2: it marks `"succeeded"` synchronously before
the async agent turn even starts (D2).

---

## 1. Missed-job catch-up — THE algorithm (D3 fix)

`get_due_jobs` → `_get_due_jobs_locked` (`jobs.py:1537-1685`). Core idea: **fire
ONCE now, fast-forward `next_run_at` to the future** — neither silently skip (mya)
nor burst-fire N times (naive catch-up).

```python
if next_run_dt <= now:                                   # DUE GATE (jobs.py:1631)
    grace = _compute_grace_seconds(schedule)             # ½ period, clamp [120, 7200]
    if kind in {"cron","interval"} and (now-next_run_dt).total_seconds() > grace:
        new_next = compute_next_run(schedule, now.isoformat())  # FAST-FORWARD
        # persist new_next; FALL THROUGH (no continue) → fires ONCE now
    due.append(job)                                      # FIRE ONCE (jobs.py:1681)
```

### Grace window — `_compute_grace_seconds` (`jobs.py:487`)
```python
MIN_GRACE=120; MAX_GRACE=7200
# interval: period = minutes*60,  grace = clamp(½·period, [120,7200])
# cron:     measure period = (cronNext-next2) - (cronNext-next1), ½ clamp
```
A daily job (86400s) → ½=43200 → clamped to 7200 (2h). A 1-min job → ½=30 →
clamped up to 120s. **Cron period is measured empirically** (two consecutive
`get_next()` calls subtracted) so `*/5` and `0 9 * * 1` both work.

### Why fast-forward (the #33315 fix)
Without it, a job whose `runtime > interval` has its `next_run_at` perpetually
in the past → marked stale → skipped → new `next_run_at` also past → **infinite
defer**. Fast-forward + "fire once now" breaks the loop.

### One-shot grace — `_recoverable_oneshot_run_at` (`jobs.py:470`)
`ONESHOT_GRACE_SECONDS = 120`. A `once` job created at T but not ticked until
T+121s is rejected as a ghost job. Enforced at create + update so it can't
re-enter.

### `compute_next_run` anchoring (`jobs.py:519`) — drift prevention
| kind | last_run_at given | absent |
|---|---|---|
| interval | **last_run + interval** | now + interval |
| cron | **croniter(expr, last_run).next()** | croniter(expr, now).next() |

Anchoring on `last_run_at` (not `now`) prevents interval drift under slow
execution: a 10:00 fire taking 90s schedules 10:10, not 10:01:30. `mark_job_run`
passes the **completion** time as `last_run_at`.

---

## 2. At-most-once / crash safety (D2-adjacent)

### advance_next_run — recurring, PRE-execution (`jobs.py:1395`, called `scheduler.py:3447`)
```python
for job in due_jobs:
    advance_next_run(job["id"])   # BEFORE any pool dispatch
```
No-op for one-shots. Advances `next_run_at` under the file lock + persists. A
crash between advance and execution leaves a future `next_run_at` → won't
re-fire on restart. `mark_job_run` later overwrites with the completion-anchored
value (provisional advance corrected). **"missing one run is far better than
firing dozens of times in a crash loop."**

### claim_dispatch — finite one-shot, atomic PRE-increment (`jobs.py:1352`, called `scheduler.py:3280`)
```python
repeat["completed"] = completed + 1   # UNDER LOCK
save_jobs(jobs)                       # PERSISTED BEFORE side effect
return True
```
`mark_job_run` detects the pre-claim (`preclaimed_oneshot`, `jobs.py:1296`) and
does NOT double-increment. Crash after increment → restart sees `completed >=
times` → removes stale entry (`jobs.py:1411`). **at-most-times** semantics (#38758).

### claim_job_for_fire — multi-machine CAS (`jobs.py:1430`)
`fire_claim = {at, by}` stamped under lock; fresh-claim check vs
`claim_ttl_seconds=300`. Stale claim (older than TTL) overwritable → crashed
replica doesn't wedge the job. `by` = `HERMES_MACHINE_ID` or `hostname:pid`
(debug only; correctness from lock + freshness). `mark_job_run` clears it.

---

## 3. Execution — run_one_job (D2 fix reference) (`scheduler.py:3252`)

```python
def run_one_job(job):
    try:
        if not claim_dispatch(job["id"]): return True      # finite one-shot limit
        success, output, final_response, error = run_job(job)
        save_job_output(job["id"], output)
        deliver_content = final_response if success else _summarize_failure(...)
        should_deliver = bool(deliver_content.strip())
        if should_deliver and success and _is_cron_silence_response(deliver_content):
            should_deliver = False                          # [SILENT] suppress
        if should_deliver:
            delivery_error = _deliver_result(job, deliver_content, ...)
        if success and not final_response.strip():          # empty = soft failure
            success = False; error = "Agent produced empty response..."
        mark_job_run(job["id"], success, error, delivery_error)  # POST-EXEC
        return True
    except Exception as e:
        mark_job_run(job["id"], False, str(e))              # ANY throw → failed
        return False
```

**`mark_job_run` is called ONLY after execution + delivery** (or on throw).
`delivery_error` tracked **separately** from agent error (platform-down ≠
agent-fail). Empty response → soft failure (`success=False`).

### no_agent short-circuit (`scheduler.py:2426`)
Script IS the job. non-zero exit → error alert; `wakeAgent:false` or empty stdout
→ silent; non-empty stdout → delivered verbatim. No LLM, no tokens.

### Concurrency model
- **Persistent ThreadPoolExecutor** (parallel, `max_workers` = `HERMES_CRON_MAX_PARALLEL`
  env / `cron.max_parallel_jobs` / unbounded). `sync=False` → tick returns
  immediately after dispatch.
- **Sequential pool** (`max_workers=1`) for workdir jobs (mutate process-global
  `TERMINAL_CWD`), guarded by writer-preferring **`_ReadWriteLock`** so a
  workdir-less parallel job never observes another's cwd.
- **`_running_job_ids` set** — a still-running job from a prior tick isn't re-dispatched.

### Liveness — heartbeat (`jobs.py:592`)
Two files: `ticker_heartbeat` (every iteration) + `ticker_last_success` (clean
tick only). heartbeat-fresh + success-stale = **alive-but-failing every tick**
(catches the dead-looping ticker, #32612/#32895).

---

## 4. Security — the cron-specific defense stack (D6 fix)

### 4a. cron_mode approval gate (headline) — `approval.py:1861`
```python
def _get_cron_approval_mode():
    config = load_config()
    mode = cfg_get(config, "approvals", "cron_mode", default="deny").lower().strip()
    if mode in {"approve","off","allow","yes"}: return "approve"
    return "deny"
# except Exception: return "deny"   ← fail-closed
```
Default **deny**. Aliases `off/allow/yes`→approve (YAML author means "approval off").
**Fail-closed** on any config error/unknown/YAML-False. When `HERMES_CRON_SESSION`
set + deny + dangerous command → hard-block:
> "BLOCKED: Command flagged as dangerous (...) but **cron jobs run without a user
> present to approve it**. ... set approvals.cron_mode: approve in config.yaml."

`--yolo` overrides (frozen at import — `_YOLO_MODE_FROZEN`). Container env (docker
no host-mounts, singularity, modal, daytona) auto-approves. `_is_gateway_approval_context()`
short-circuits False when `HERMES_CRON_SESSION` set → **cron-from-telegram uses
cron_mode, not gateway-approval** (no hang). Pinned by 13 tests in
`test_cron_approval_mode.py`. `execute_code` also blanket-blocked in cron-deny
(bypasses terminal guard via subprocess).

### 4b. Two-tier prompt-injection scan — `cronjob_tools.py:229`
**Tier-1 STRICT** (`_scan_cron_prompt`, on raw user prompt, hard-block):
8 threat patterns (prompt_injection, deception_hide, sys_prompt_override,
disregard_rules, read_secrets `cat .env`/`.netrc`, ssh_backdoor `authorized_keys`,
sudoers_mod, destructive_root_rm `rm -rf /`) + 5 exfil patterns
(curl/wget with secret-var regex `\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|...)` or
`Authorization:` header). Invisible-unicode = **hard block**.

**Tier-2 LOOSER** (`_scan_cron_skill_assembled`, on assembled skill content):
only the 4 injection *directives* (skill bodies are markdown that describes
attacks in prose → strict patterns false-positive). Invisible-unicode
**sanitized (stripped + logged), not blocked**. Skill bodies pre-scanned at install.

**tirith** (separate binary): content-level threats (homograph URLs, pipe-to-interpreter).
Runs in cron-deny branch of `check_all_command_guards`. Fail-open/closed toggle
`security.tirith_fail_open` (default True). #22070 regression pins homograph-block.

### 4c. Credential/base_url exfil guard — `_validate_cron_base_url` (`cronjob_tools.py:448`)
Named provider's stored key may only go to its **own configured endpoint host**
(`base_url_host_matches`). Bare `custom` (BYOK, no stored secret) allowed.
Runs on the **effective** (provider, base_url) pair on **every update** so editing
an unrelated field can't leave an unsafe pair schedulable. CWE-200/522.

### 4d. Script-path confinement — `_validate_cron_script_path` (`cronjob_tools.py:528`)
Reject absolute/`~`/`C:` prefixes; `validate_within_dir` keeps resolved path inside
`~/.hermes/scripts/`. Blocks `../../` traversal.

### 4e. Disabled-toolset strip — `_resolve_cron_disabled_toolsets` (`scheduler.py:116`)
**Always-strip `["cronjob","messaging","clarify"]`** on every cron-fired agent:
- `cronjob` → **prevents recursive scheduling** (self-amplifying loop). Schema also
  warns: "cron-run sessions should not recursively schedule more cron jobs."
- `messaging`/`clarify` → interactive, block on user input that never arrives.
User `agent.disabled_toolsets` unioned on top (per-job `enabled_toolsets` can't
widen past operator denylist, #25752).

### 4f. Gateway-lifecycle guard — `check_gateway_lifecycle` (`lifecycle_guard.py:112`)
Blocks `hermes gateway restart/stop`, `launchctl`/`systemctl`/`pkill` targeting the
gateway → prevents **SIGTERM-respawn loop** under launchd KeepAlive / systemd Restart
(#30719). `start` excluded (benign). Scans prompt **and** script together.

### 4g. Provider/model snapshot drift (`#44585`)
Unpinned jobs snapshot global default at create (`provider_snapshot`/`model_snapshot`).
On fire, if drifted → **skip + alert** (no silent spend reroute).

---

## 5. Persistence — atomic + locked

### `_save_jobs_unlocked` (`jobs.py:689`)
`tempfile.mkstemp` → `json.dump` → `f.flush()` → **`os.fsync(fd)`** →
`atomic_replace(tmp, JOBS_FILE)` (os.replace, EXDEV→copy fallback) →
`_secure_file` (chmod 0600). Cleanup tmpfile on any `BaseException`.

### `_jobs_lock` (`jobs.py:97`) — two-layer, nesting-aware
1. in-process `threading.RLock` (cheap, prevents parallel tick threads clobbering)
2. cross-process `fcntl.flock(LOCK_EX)` on `.jobs.lock` (gateway vs CLI race)
`threading.local` depth counter → nested calls reuse the held lock (no deadlock).
Graceful degradation (log + proceed in-process only if flock unavailable).

### `load_jobs` (`jobs.py:640`) — corruption repair
JSONDecodeError → retry `strict=False` (bare control chars) → re-save. Bare-list →
wrap as `{"jobs":[...]}` → re-save. Non-dict/non-list → raise (unrepairable).

### Output — `save_job_output` (`jobs.py:1693`)
Per-run `cron/output/<id>/<timestamp>.md`, atomic write, prune to keep 50
(`_CRON_OUTPUT_DEFAULT_KEEP`). `context_from` reads the latest of these (≤8K chars).

### Timezone — offset-migration repair (`jobs.py:433-460, 1611-1628`)
Cron persists absolute instants but expr = local wall-clock intent. TZ config change
+10→+02 makes stored 21:00+10 land at 13:00+02 (looks due, fires early, then again
at 21:00 = double-fire). Repair: when `cron & due & offset-mismatch & wall-clock-future`,
recompute `next_run_at` + **skip this tick**. `_ensure_aware` normalizes naive legacy ts.

---

## 6. Port plan for mya — prioritized & mapped to defects

### P0 — correctness (the D1/D2/D3 fixes)

| Defect | hermes reference | mya port | effort |
|---|---|---|---|
| **D2** (mark succeeded before run) | `run_one_job` (`scheduler.py:3252`): claim→run→save→deliver→**mark_job_run(real)** | mya already has the correct pattern in `cronRunNow` (`main.ts:455`: await then complete). **Apply it to the sweep**: make sweep `async`, `await runOnSession`, then `complete(runId, status, error)`. ~15 LOC. | **S** |
| **D3** (no catch-up for cron) | `get_due_jobs` + `_compute_grace_seconds` (§1) | Add `nextRunAt` field (currently `due()` matches the expr live, no stored next-fire). On sweep: `if overdue`: compute grace (`max(120,min(½period,7200))`); if lateness > grace → fast-forward `nextRunAt=computeNextRun(sched, now)` + fire once; else fire once + advance. Needs cron **next-fire from base** (verify mya's parser supports it; else `cron-parser` dep). | **M** |
| **D1** (cronAdd not wired) | — (mya-only wiring bug) | Wire `cronAdd` callback in `main.ts` Gateway ctor → `cron.register(created)`. | **S** |
| crash at-most-once | `advance_next_run` pre-exec (`jobs.py:1395`) | Persist `nextRunAt` to `cron.json`; advance before dispatch. (Follows D3 — once `nextRunAt` is persisted, the advance is trivial.) | **M** |

### P1 — security (D6 + anti-injection)

| Gap | hermes reference | mya port | effort |
|---|---|---|---|
| **unauthenticated API (D6)** | `_secure_file` 0600 + flock | Bind management API to **Unix socket (0600)** OR require Bearer `wsToken` on every `/cron/jobs` call. mya already has `wsToken` for WS — reuse. | **S** |
| **recursive scheduling** | `_resolve_cron_disabled_toolsets` (§4e) | **Adopt unconditionally**: when building toolset for a cron-fired turn, always exclude `scheduler`/`cron` tools. ~5 LOC. Cheapest+strongest anti-recursion. | **XS** |
| **approval gate** | `cron_mode` deny-default (§4a) | Config `scheduler.approval_mode: "deny"|"approve"` (default deny, frozen at startup). In deny → cron-fired turn runs **read-only toolset** (strip shell/write_file/scheduler). ~20 LOC. | **S** |
| **prompt-injection scan** | Tier-1 regexes (§4b) | Port the 8 threat + 5 exfil patterns (~50 LOC TS module), run at job-create. Secret-var regex ports verbatim. | **S** |
| **base_url exfil** | `_validate_cron_base_url` (§4c) | `new URL(baseUrl).hostname === providerHostname`; refuse off-host pairing. ~15 LOC at create. | **S** |
| gateway-lifecycle guard | `check_gateway_lifecycle` (§4f) | Port the 4-branch regex, swap `hermes gateway`→`mya gateway`. ~15 LOC. | **S** |

### P2 — reliability / observability

| Gap | hermes reference | mya port |
|---|---|---|
| ephemeral run history | `cron_runs`/`save_job_output` | Persist RunRecords to memory SQLite (already a dep). `cron_runs` table, prune to N. |
| separate delivery_error | `mark_job_run(delivery_error)` | Track agent-fail vs deliver-fail independently. |
| empty-response soft-fail | `success && !response → failed` | Add the check before `complete`. |
| heartbeat liveness | `ticker_heartbeat` + `ticker_last_success` | Two files for `mya cron status` — distinguishes dead vs failing ticker. |
| atomic persistence | `_save_jobs_unlocked` (§5) | `fs.mkdtemp`+`writeFile`+`fsyncSync`+`renameSync`. ~20 LOC. (Optional flock if multi-replica.) |
| TZ offset-migration | §5 repair | Only if mya stores TZ-aware ISO (not UTC `Z`). Defer unless TZ-config-change is a real scenario. |

### Defer (feature-tier / over-engineered for single-process mya)
- **Tier-2 skill-assembled scan + tirith** — premature without skills / homograph-URL attacks.
- **parallel/sequential pool split + RW lock** — mya's `AgentPool` already bounds concurrency; no process-global env mutation.
- **multi-machine `claim_job_for_fire`** — single-process mya doesn't need it.
- **delivery fan-out (telegram/discord/…), `[SILENT]`, continuable threads, context_from, workdir, skills, no_agent, snapshot drift** — capabilities, not defects. Land when mya adds channels/platforms.

---

## 7. The non-negotiables (if porting nothing else)

1. **D2**: sweep `await`s the agent turn before `complete()` — mirror the existing
   `cronRunNow`. The RunRecord must reflect reality. (S)
2. **D3**: persist `nextRunAt`; grace-windowed catch-up (fire-once + fast-forward).
   Fixes the #33315 infinite-defer and silent-skip. (M)
3. **disabled-toolset strip**: cron-fired turns never get the scheduler tool. (XS)
4. **management API auth**: wsToken or Unix socket. (S)

Everything else is defense-in-depth that can land in later passes. The hermes
design's central insight: **unattended execution is elevated privilege** — the
entire §4 stack exists because "cron jobs run without a user present to approve it."
