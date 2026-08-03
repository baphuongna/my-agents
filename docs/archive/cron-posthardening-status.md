# Cron Post-Hardening — Status & Parity Audit

Audit of mya's cron after the hardening (commits `017a9cc`→`076f6c2`) vs the plan
+ the references (hermes / mya-v1 / openhuman). Two questions: (1) what's left
unimplemented, (2) where mya stands vs the references.

---

## 1. Completeness — D1–D10 + phases

| Item | Status |
|---|---|
| D1 cronAdd wired | ✅ |
| D2 await-before-complete | ✅ |
| D3 catch-up (fire-once + advance) | ✅ |
| D4 unify cron.json path | ✅ |
| D5 obs fields (summary) | ✅ |
| D6 auth gate | ✅ |
| D7 cronHistory real (SQLite) | ✅ |
| D8 no same-minute double-fire | ✅ |
| **D9 timezone** | ⚠️ **PARTIAL** — parser supports it, but HTTP POST `/cron/jobs` doesn't forward `timezone`; CLI `add` has no TZ param. Only PATCH can set it. |
| D10 removeJob (cast hack gone) | ✅ |
| Phases 0A/0B/0C/1A/1B/2A/2B/2C/3B/3D/4A/4B | ✅ |

## 2. Plan-promised but SILENTLY DROPPED (genuinely "chưa thực hiện")

These were in the reviewed plan (rev 3) but did not land. They are real gaps to close:

| # | Item | Plan ref | Effort |
|---|---|---|---|
| **G1/2** | `MYA_CRON_UNSAFE_NO_AUTH` decoupling — `MYA_NO_WS_TOKEN` still opens cron mutations (C11 said never honor the WS bypass for mutations) | C11/AD3 | S |
| **G8** | approval_mode runtime-flip via `POST /config` (env-only now; R2-9 wanted runtime) | R2-9 | S |
| **G5** | `mya cron status` CLI — `heartbeatAge()` exists but unreachable | guardrail #3 | S |
| **G3** | mya-bridge `/cron` display reads its OWN scheduler singleton, not the gateway via HTTP (R2-7) → TUI shows empty/divergent jobs | R2-7 | M |
| **G10** | min-interval floor — `* * * * *` freely allowed (C10/3A said refuse unless explicit) | C10/3A | S |
| **G9** | Spike-0 e2e proof — deny-mode tool restriction is unit-tested only, not proven through the pool factory | R3 guardrail #1 | M |
| **D9** | timezone not forwarded in POST/CLI add | — | S |

Minor/cosmetic: G4 (`due()` vs `dueAndAdvance` display drift), G6 (`cronMaxConcurrent` not env-config), G7 (`summary()` O(jobs×runs)), G11 (CLI add no quarantine feedback).

## 3. Phase 5 — honestly DEFERRED (feature-tier, all 14 confirmed)

base_url/provider-host guard · provider/model snapshot · multi-machine `claim_job_for_fire`
· cross-process advisory lock · multi-platform delivery fan-out (telegram/discord/slack)
· `[SILENT]`/NO_REPLY suppression · continuable threads (`attach_to_session`) ·
`context_from` job chaining · per-job workdir · `no_agent` script-only mode · shell jobs (`JobType::Shell`)
· skills loading per-job · parallel/sequential pool split · tirith · Tier-2 skill scan · TZ offset-migration repair.

---

## 4. Parity vs references (post-hardening)

Legend: ✅ has · ⚠️ partial · ❌ lacks. (hermes = richest reference)

### Where mya MATCHES / EXCEEDS
- **Scheduling core**: 5-field cron, DOW/DOM OR, next-fire, timezone, on-interval, once — ✅ all refs.
- **At-most-once**: claim/lease + **persist-before-fire** (mya advances+persists BEFORE dispatch; hermes post-completion) — mya stricter across crashes.
- **Auth**: wsToken Bearer/cookie + CSRF Origin + `/ws-info` Bearer-only — matches hermes; **exceeds** mya-v1/openhuman (no prompt scan there).
- **Prompt-injection scan**: Tier-1 (12 patterns + exfil + invisible-unicode) at register/updateJob/**reconcile (file-load)** — matches hermes; **exceeds** Rust refs (none).
- **Deny-mode**: default read-only **allowlist** (read/glob/grep/ls/find) — stricter than hermes' per-job toolsets / Rust refs' tool exclusion.
- **max-jobs cap (50)** — **no reference has this** (mya unique).
- **Empty-response fail-closed** — mya fails; hermes delivers; Rust refs mark success. mya surfaces silent failures.
- **Durable run history** (SQLite `cron_runs` + `GET /runs` + `cron history`) — **exceeds hermes** (hermes has only last_status, no history table); matches Rust refs.
- **Heartbeat** (alive/success files) — matches hermes (identical design).

### Where mya LAGS (Phase 5, the real gaps for production richness)
- **Multi-platform delivery** (telegram/discord/slack/email) — ❌ WS-only. hermes + mya-v1 have it. **#1 gap.**
- **`[SILENT]`/NO_REPLY suppression** — ❌ every non-empty response delivered (spam). all refs have it.
- **Shell / `no_agent` jobs** — ❌ all jobs are LLM (watchdogs burn tokens). hermes (`no_agent`) + Rust (`JobType::Shell`) have it.
- **base_url/provider-host guard + snapshot drift** — ❌ (approve-mode exfil risk). hermes has both. Needs CronJob schema change.
- **Declarative config jobs** — ❌ (cron.json only). mya-v1 has `sync_declarative_jobs`.
- **Full `update` CLI** — ⚠️ (enable/disable only). all refs have full patch.
- **`status` CLI** — ❌ (heartbeat exists, no surface). hermes has `cron status`.
- **Cross-process lock** — ❌ (single-process; O_EXCL mitigates write-race). hermes/mya-v1 have advisory/DB locks.

---

## 5. Verdict

The **hardening scope (correctness + security, Phases 0–4) is complete** and mya now
**matches or exceeds the references on scheduling/at-most-once/auth/scan/deny-mode/history**.
The honest remaining work splits into two buckets:

- **Plan-promised but dropped (should fix — small)**: G1/2 (cron-auth decoupling),
  G5 (`cron status` CLI), G8 (approval runtime-flip), G3 (mya-bridge HTTP display),
  G10 (min-interval floor), G9 (deny-mode e2e proof), D9 (timezone forwarding).
- **Feature-tier (Phase 5, deferred)**: delivery richness (multi-platform + `[SILENT]`),
  shell/no_agent jobs, base_url/snapshot, declarative jobs — these move mya from
  "safe scheduler" toward "full scheduled-agent product" and need design decisions
  (which channels, CronJob schema) beyond the hardening scope.
