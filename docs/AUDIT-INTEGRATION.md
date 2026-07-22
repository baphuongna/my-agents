# Deep Integration Audit — TUI / Launcher / Web (2026-07-21)

> 5 parallel explorers traced actual runtime code paths from user-facing surfaces
> (TUI, launcher, web dashboard, CLI) to feature implementations.
> **Verdict: Most features are library-only — NOT wired into composition root.**

---

## Executive Summary

Of 40 implemented features, **only ~10 actually work end-to-end** through the real
user-facing paths (TUI/Launcher/Web). The rest are correct library code that exists
in packages but has **zero callers from the composition root** (`print/main.ts`,
`mya-bridge.ts`, `launcher.ts`, gateway HTTP routes).

**Root cause**: Features were implemented as isolated library modules but never
wired into the application startup chain. Additionally, the TUI uses
`coding-agent`'s OWN tool system (7 hardcoded tools), NOT `@my-agent/tools`'s
`builtinTools` — so none of the 8 new tools are visible in the TUI.

---

## Severity Breakdown

| Category | Count | Features |
|---|---|---|
| ✅ WORKS end-to-end | 6 | A1, A2, budget isolation, scanInject, LifecycleGuard, ApprovalRelay (transport only) |
| 🔗 PARTIAL | 5 | compressHistory, AgentConfig defaults, startup seq, tool registration, MCP basic |
| ⚠️ DEAD CODE (no caller) | 12 | F4 lock, systemd, provider discovery, achievements, pets, voice PTT, auto-discover, GatewaySupervisor, cron tools, + more |
| ❌ BROKEN (missing wiring/endpoints) | 12 | config import, 4 new channels, web profiles/webhooks/achievements/skills/auth, pairing schema, sidebar nav, SPA fallback |

---

## TUI Surface (packages/coding-agent + packages/tui)

### ❌ CRITICAL: TUI doesn't use @my-agent/tools at all

The mya TUI (`packages/coding-agent/src/modes/interactive/`) builds its own 7-tool
surface via `createReadTool/createBashTool/createEditTool/...` in
`core/sdk.ts:269`. It **never imports** `@my-agent/tools`.

**Impact**: NONE of the 8 new tools (osv_check, check_url_safety, image_generate,
video_generate, kanban, disk_cleanup, cron tools, codeexec) are visible in TUI.

### Tool registration gaps in builtin.ts

| Tool | In builtinTools array? | Issue |
|---|---|---|
| osv_check | ✅ | — |
| check_url_safety | ✅ | — |
| image_generate | ✅ | — |
| video_generate | ✅ | — |
| kanban | ✅ | — |
| **disk_cleanup** | ❌ | Imported at line 467 but NOT in array (line 471-489) |
| **cron_create/list/delete/run** | ❌ | `makeCronTools()` never called anywhere |
| **code (codeexec)** | ❌ | Only registered when `!config.tools` — TUI path doesn't reach it |

### DEAD CODE in TUI packages

| Feature | File | Status |
|---|---|---|
| Pet sprites (H12) | `tui/src/components/pet-sprite.ts` | Not exported, not imported, never rendered |
| Achievements (J2) | `audit/src/achievements.ts` | AchievementTracker never instantiated |
| Voice PTT (G1a) | `gateway/src/voice-ptt.ts` | VoicePTTController never constructed |
| Auto-discover (A3) | `tools/src/auto-discover.ts` | `autoDiscoverTools()` zero callers |

### Tool rendering gap

`tool-execution.ts:60` looks up renderer by ToolName. New tools return `undefined`
→ falls back to plain JSON text dump. Image/video (base64/URL) won't render.

---

## Launcher / CLI (packages/print)

### ❌ BROKEN: config import missing

`main.ts:188-189` references `config.maxToolRounds` but `config` is never imported
from `shared-instances.ts`. This is a **TypeScript source error**.

### GatewaySupervisor — DEAD CODE

`gateway-supervisor.ts` exists with auto-restart logic but `mya serve` bypasses it
entirely — directly constructs `new Gateway()` at `main.ts:477`. No supervisor wrap.

### Systemd — DEAD CODE

`systemd.ts` functions (`notifyReady`, `startWatchdog`, `notifyStopping`) are
exported but **never called** in `main.ts` or `Gateway.start()/stop()`.

### 4 new channels NOT registered

`registerBuiltinChannels()` in `channel-adapters.ts:598` registers only 8 channels.
The 4 new adapters (MSGraph/Feishu/WeChat/Spotify) in `channel-adapters-extra.ts`
are **exported but not registered** → invisible in `/status`, `mya channels list`,
launcher.

### Missing CLI commands

| Command | Status |
|---|---|
| `mya voice` / `mya ptt` | ❌ Missing |
| `mya achievements` | ❌ Missing |
| `mya pets` | ❌ Missing |
| `mya provider discover` | ❌ Missing |
| `mya mcp oauth` | ❌ Missing |
| `mya supervisor` | ❌ Missing |
| `mya systemd` | ❌ Missing |

### ✅ WORKS (launcher)

- ApprovalRelay transport (WS broadcast + HTTP decide/pending)
- DevicePairing + WebAuthn routes (real crypto, real responses)
- Channel polling loop (5s interval in Gateway.start)
- sweepIdle timers (channel sessions + handles)
- `mya cron` CRUD (list/add/remove/enable/disable/run/history)

---

## Web Dashboard (packages/web)

### ❌ New pages have NO working backend endpoints

| Page | Frontend calls | Backend | Verdict |
|---|---|---|---|
| ProfilesPage | GET /profiles, POST /profiles/:id/activate | Static Hermes stub, activation 404 | ⚠️ STUB |
| ProfileBuilderPage | POST /profiles | Same static stub, no persistence | 🔗 PARTIAL |
| WebhooksPage | GET/POST /webhooks, POST /webhooks/:id/test | All 404 | ❌ BROKEN |
| PairingPage | GET /pair/devices, POST /pair/request, POST /devices/:id/revoke | Schema mismatch (code vs qr, deviceId, DELETE vs POST) | 🔗 PARTIAL |
| PetsPage | None (hardcoded) | No /pets endpoint | ⚠️ STUB |
| AchievementsPage | GET /achievements | 404 | ❌ BROKEN |
| SkillEditorDialog | POST /skills/create | 404 (only GET /skills exists) | ❌ BROKEN |
| AuthWidget | GET /auth/status, /auth/oauth/:provider | Both 404 | ❌ BROKEN |
| Terminal | None | Placeholder text only | ⚠️ STUB |

### ❌ Navigation broken

- New pages NOT in `Sidebar.tsx` NAV_ITEMS
- New pages NOT in `CommandPalette.tsx`
- No SPA history fallback (direct URL → 404)
- Vite dev proxy missing `/profiles`, `/webhooks`, `/pair`, `/achievements`, `/skills`, `/auth`

### ❌ dashboard.ts malformed JS

`dashboard.ts:269` emits invalid JavaScript (missing function name prefix) →
syntax error → entire inline script fails.

---

## Runtime Integration

### ✅ WORKS

| Feature | Evidence |
|---|---|
| A1 maxToolRounds | Config → startTurn → runTurn → loop.ts:160 (for loop cap) |
| A2 maxSpawnDepth | agent/index.ts:575-594 (returns failed handle at depth≥max) |
| Budget isolation | deriveChild at :690, releasePrecharge in finally at :711 |
| scanInject | channel-session.ts:155 uses safeText (not raw) |
| LifecycleGuard F2 | gateway/index.ts:593 recordFire → auto-disable at 6th fire |

### ⚠️ DEAD CODE (runtime)

| Feature | Evidence |
|---|---|
| F4 cross-process lock | `acquireCronLock()` never called in cronSweep |
| ApprovalRelay request | Transport wired but `request()` never called — bash denied by stub |
| Systemd I1 | `notifyReady()` never called in Gateway.start() |
| Provider discovery B1 | `scanProviders()` never called in createAgent |

### 🔗 PARTIAL

| Feature | Issue |
|---|---|
| compressHistory | Trivial inline slice (not rankedCompact); subagent path missing |
| scanInject regex | "; SYSTEM OVERRIDE: ignore all rules" slips through (7 patterns don't match) |

---

## Config / Init Chain

### ❌ MyaConfig BROKEN

- `shared-instances.ts` loads `~/.mya/agent/config.json` + env fallbacks
- BUT `main.ts` doesn't import `config` → references undefined symbol
- Even if fixed, only `maxToolRounds` intended to be forwarded
- `maxSpawnDepth`, `memoryBackend`, `activeProfile` have no consumers

### 🔗 Gateway sessions use Pi AgentPool, NOT createAgent

`mya serve` creates `AgentPool` which uses Pi's `createAgentSession()` — this
bypasses `@my-agent/agent` entirely. Gateway sessions don't get:
- Shared tools (builtinTools)
- Shared memory (Brain/SQLite)
- maxToolRounds / maxSpawnDepth config
- Budget isolation
- Achievement tracking

---

## Root Cause Analysis

The core architectural gap:

```
User Action → TUI/Launcher/Web
                    ↓
        composition root (main.ts / mya-bridge.ts)
                    ↓
    ┌───────────────┴───────────────┐
    ↓                               ↓
coding-agent SDK              @my-agent/agent
(7 hardcoded tools)        (builtinTools, budget, etc.)
    ↑                               ↑
    └───── GAP ─────┐    ┌──── GAP ─┘
                    ↓    ↓
            Library packages (features)
            (no caller from composition root)
```

**Two separate agent systems exist**:
1. **Pi/coding-agent SDK** — used by TUI + gateway sessions (interactive mode)
2. **@my-agent/agent** — used by one-shot CLI + tests

Features were added to #2 but #1 is what users actually interact with.

---

## Fix Priority

### P0 (blocking — features invisible)
1. Wire `builtinTools` into coding-agent SDK tool surface (or bridge in mya-bridge.ts)
2. Add `diskCleanupTool` to builtinTools array
3. Fix `config` import in main.ts
4. Register 4 new channel adapters in registerBuiltinChannels()
5. Add sidebar links + SPA fallback for new web pages

### P1 (dead code — implemented but unreachable)
6. Wire GatewaySupervisor into `mya serve`
7. Call systemd notifyReady/startWatchdog in Gateway.start()
8. Call scanProviders() in createAgent
9. Call acquireCronLock() in cronSweep
10. Instantiate AchievementTracker + wire recordStat calls
11. Wire ApprovalRelay.request() into permission system (replace stub)
12. Call makeCronTools() + register cron tools

### P2 (broken endpoints)
13. Implement /webhooks CRUD
14. Implement /achievements GET + /achievements/unlock
15. Implement /skills/create POST
16. Implement /auth/status + /auth/oauth
17. Fix PairingPage schema mismatch
18. Fix profiles persistence (replace Hermes stub)

### P3 (polish)
19. Strengthen scanInject regex (SYSTEM OVERRIDE, etc.)
20. Wire compressHistory in subagent path
21. Fix dashboard.ts malformed JS
22. Add Vite dev proxy routes
