# PLAN-FEATURES Deep Review v2 — Codebase Reality Check

> Reviewer: 3 parallel explorers verified every file path, interface, LOC estimate, and assumption against **actual code**
> Date: 2026-07-21
> Verdict: **6 wrong file paths, 4 massive LOC overestimates, 4 massive underestimates, 2 critical unwired spec requirements, sprint 3 sequencing broken**

---

## Executive summary

The v2 plan (spec-aligned) is architecturally correct but **factually wrong about the current codebase state**. Key discoveries:

| Finding | Impact |
|---|---|
| **E1 channels: 8/9 adapters already exist** | Sprint 4 LOC drops from ~900 → ~430 |
| **D1 memory: SQLite + Markdown already done** | Sprint 5 LOC drops from ~1000 → ~280 |
| **H1 profiles: ~1030 LOC estimate is half the real cost** | Sprint 3 LOC jumps from ~1030 → ~1800 |
| **scanInject is NOT wired into ANY channel** | Spec violation R27-15 — blocks E1/E2/E3 compliance |
| **6 plan file paths are wrong** | Would fail on first implementation attempt |
| **A1: `maxToolRounds=25` already exists** | IterationBudget may be redundant |

---

## 🔴 CRITICAL: Wrong file paths / assumptions

### A3 — AST tool discovery: entirely wrong model

| Plan says | Reality |
|---|---|
| Scan for `@Tool` decorator | ❌ No `@Tool` decorator exists anywhere |
| Scan for `registerTool()` calls | ❌ Actual API is `ToolRegistry.register(impl: ToolImpl)` |
| `is_available(config)` gate | ❌ Not in `Tool` interface (`core/src/types.ts:333`) |
| `MYA_TOOLS_DIR` env | ❌ Does not exist |
| Tools auto-discovered | ❌ Tools are **explicit exports** in `packages/tools/src/index.ts` (curated list) |

**Fix**: Either (a) extend the existing `builtin.ts` explicit-registration pattern, or (b) write a minimal jiti-style loader. Drop "AST discovery" framing — the codebase uses explicit registration.

### A5 — Recovery FSM: wrong target file

| Plan says | Reality |
|---|---|
| `packages/print/src/launcher.ts` is the supervisor | ❌ `launcher.ts` (1309 LOC) is a **TUI launcher** (client UI), NOT a process supervisor |
| Watchdog/respawn exists partially | ❌ Zero watchdog/respawn/recovery code anywhere |

**Fix**: Target a NEW module `packages/print/src/gateway-supervisor.ts`. Add ~150 LOC (not ~70).

### B1 — Provider packages: wrong semantics

| Plan says | Reality |
|---|---|
| `ProviderProfile` = declarative manifest | ❌ `ProviderProfile` (`core/src/types.ts:80-88`) is a **runtime stream interface**: `{ id, model, stream(), health() }` |
| Add `providers` to `PackageKind` | ❌ `PackageKind` = `"extensions"|"skills"|"prompt-templates"|"themes"` — adding `"providers"` is a §17 model change |
| `scanProviders()` function | ❌ Does not exist |

**Fix**: Define a NEW `ProviderPackageManifest` (separate from runtime `ProviderProfile`). Extend `PackageKind` with `"providers"` — document as a §17 evolution.

### C6 — Agent cron tools: wrong abstraction level

| Plan says | Reality |
|---|---|
| New `packages/cron/src/agent-tools.ts` | ❌ Cron management exists as **HTTP endpoints** (`/cron/jobs/:id/run`) + **CLI** (`cron-cli.ts`) + **Web API** — but NOT as `ToolImpl` the LLM calls |

**Fix**: This is a **Tool wrapper** over existing `CronScheduler` primitives, not new cron logic. ~150 LOC.

### D2 — Learning graph: wrong file path

| Plan says | Reality |
|---|---|
| `packages/memory/src/learning-graph.ts` | ❌ Doesn't exist |
| Build new graph from scratch | ⚠️ `packages/memory/src/graph.ts` exists (109 LOC) — but it's `TypedGraph` (entity→entity knowledge graph), NOT a "learning graph" (concept→concept) |

**Fix**: Either extend `TypedGraph` with learning edge types, or create sibling `learning-graph.ts`. ~350 LOC (more than plan's 250).

### G1a — Voice PTT: wrong STT location

| Plan says | Reality |
|---|---|
| `packages/tts/src/stt.ts` | ❌ Doesn't exist. STT lives at `packages/gateway/src/voice-stt.ts` (227 LOC, Whisper + Deepgram) |
| `packages/tts/src/` has STT | ❌ `packages/tts/src/index.ts` (162 LOC) is TTS-only |

**Fix**: STT already exists in gateway. G1a PTT controller is NEW work in `packages/gateway/src/voice-ptt.ts`. Reuse existing `voice-stt.ts`.

---

## 🟢 GOOD NEWS: Already done (LOC overestimates)

### E1 — Channels: 8/9 adapters already exist!

| Adapter | Status | Location | LOC |
|---|---|---|---|
| Telegram | ✅ Done | `channel-adapters.ts:32-101` | 69 |
| Discord | ✅ Done | `channel-adapters.ts:107-181` | 74 |
| Slack | ✅ Done | `channel-adapters.ts:187-265` | 78 |
| Email | ✅ Done | `channel-adapters.ts:271-315` | 44 |
| Webhook | ✅ Done | `channel-adapters.ts:321-355` | 34 |
| WhatsApp | ✅ Done | `channel-adapters.ts:361-432` | 71 |
| Signal | ✅ Done | `channel-adapters.ts:438-490` | 52 |
| Matrix | ✅ Done | `channel-adapters.ts:496-560` | 64 |
| VoiceCall (Twilio) | ✅ Done | `voice-call.ts` | 172 |

**What's actually missing**: Only scanInject wiring (~30 LOC) + E3 new channels (MSGraph/Feishu/WeChat/Lark).

**LOC revision**: ~900 → **~430** (scanInject + E3 only)

### D1 — Memory backends: SQLite + Markdown already done

| Backend | Status |
|---|---|
| SQLite (8 files) | ✅ **Fully done** (~1500 LOC: sqlite-db/schema/store/recall/consolidate/manager) |
| Markdown (`FileBackend`) | ✅ **Done** (`backends.ts` — durable, write-through) |
| Vector/embedding | ⚠️ **Partial** — exists as SQLite side-column (`embedding` BLOB), NOT as `MemoryBackend` impl |
| mem0 | ❌ Not done |

**LOC revision**: ~1000 → **~280** (mem0 + true markdown-with-frontmatter + vector-as-MemoryBackend)

### H10 — Pairing: backend fully done

`packages/secrets/src/pairing.ts` (265 LOC, X25519+HKDF+Ed25519) + gateway endpoints `/pair/*` all exist. Only UI needed (~150 LOC).

### H2 — i18n: already exists

`packages/web/src/lib/i18n.tsx` (183 lines, 41 keys, 2 locales en+vi). Plan's ~80 LOC is for **audit + fill gaps**, not building from scratch.

### F3 — Cron catch-up grace: partially done

`dueAndAdvance()` at `index.ts:331` already implements fire-once-and-advance. Only missing: `graceMs` threshold field (~40 LOC).

---

## 🔴 BAD NEWS: Underestimated features

### H1 — Profiles: real cost is ~1500-2000 LOC (not ~1030)

| Component | LOC |
|---|---|
| New `packages/profiles/` package (ProfileStore + schema) | ~400 |
| 8-12 gateway proxy endpoints | ~200 |
| Migration `~/.mya/` → `~/.mya/profiles/default/` | ~150 |
| ProfileBuilderPage (5-step wizard, Hermes = ~800 LOC per `web-ui-gap-analysis.md`) | ~800 |
| ProfileSwitcher + ProfileKeyedRoutes (remount) | ~200 |
| Prompt-cache tier-boundary integration | ~100 |
| **Total** | **~1850** |

### H4 — xterm terminal: ~600-800 LOC (not ~500)

Zero PTY code exists. Needs: gateway PTY spawn + WS route + typed events + security + xterm.js wrapper + ChatPage rework.

### H7 — Skill editor: ~500-700 LOC (not ~200)

SkillsPage is **read-only** (99 LOC, hardcoded array). Needs: backend CRUD endpoints + frontmatter validation + CodeMirror editor (~400 LOC) + SkillsPage rewrite.

### G1a — Voice PTT: ~400 LOC (not ~350)

STT exists but PTT controller + audio recorder + auxiliary agent glue + phase events + CLI/web integration all new.

---

## 🔴 CRITICAL: Unwired spec requirements

### scanInject NOT wired into channels (§12 R27-15)

**Spec mandates**: "Channel messages MUST pass through `scanInject` with `scope="context"` BEFORE entering history"

**Reality**: `scanInject` exists at `packages/prompts/src/inject.ts:49` but is **NOT imported anywhere in `packages/gateway/src/`**. Messages push directly to history at `channel-session.ts:151`:
```ts
session.history.push({ role: "user", text: msg.text, ts: msg.ts });
```

**Impact**: ALL channel messages bypass injection scanning. This is a **spec violation** that blocks E1/E2/E3 compliance.

**Fix**: ~30 LOC in `channel-session.ts` — wrap `msg.text` with `scanInject` before push. Must be done BEFORE E1/E2/E3 can claim spec compliance.

### ComponentHealth NOT registered in cron (inv #17)

`CronScheduler` does not register as `ComponentHealth`. No health events emitted. Boot doesn't check cron health.

**Fix**: F2 (lifecycle guard) should include ComponentHealth registration (~25 LOC).

### No keyring abstraction

`SecretRef{from:"keyring"}` referenced in spec (§14.2) — `SecretRef` type exists at `packages/secrets/src/index.ts:40` but no actual keyring backend. E2 per-platform identity depends on this.

---

## ⚠️ Partially done (reduces scope)

### A1 — IterationBudget may be redundant

`packages/core/src/loop.ts:163` already has `maxToolRounds = 25` (`opts.maxToolRounds`). This is a **tool-round cap** that already limits iterations.

**Decision needed**: 
- Option A: Add iteration dimension to `BudgetConfig` (plan's approach — semantic stretch since BudgetConfig is USD-based)
- Option B: Make `maxToolRounds` per-subagent (simpler, ~60 LOC vs ~120)
- Option C: Both (tool-round cap + turn cap as separate concepts)

### F2 — Lifecycle guard: partial

Cron already auto-disables jobs with impossible expressions (`index.ts:259`). Missing: restart-frequency tracking + ComponentHealth emission.

### C5 — URL safety: SSRF guard exists, phishing doesn't

`packages/tools/src/web/security-guard.ts` has `checkUrl()` — but it's **SSRF defense only** (blocks private IPs). It does NOT check phishing/malware domains (Safe Browsing/PhishTank).

**Fix**: Add phishing/malware check as a SECOND layer in `fetch.ts` after existing SSRF check. ~150-250 LOC (not ~50).

---

## Sprint sequencing problems

### Sprint 3 (Web Foundation) CANNOT start as written

| Feature | Blocker |
|---|---|
| H1 Profiles | Needs `packages/profiles/` package (doesn't exist) + migration + prompt-cache integration |
| H4 xterm | Needs PTY gateway infrastructure (zero code exists) |
| H7 Skill editor | Needs `/skills/*` CRUD endpoints (currently GET-only) |
| H8 Auth widget | Needs B2 MCP OAuth endpoints (Sprint 2, but no explicit dependency arrow) |

**Fix**: Split Sprint 3 into:
- **3a** (backend, ~1 week): ProfileStore package + `/skills/*` CRUD + B2 OAuth endpoints
- **3b** (frontend, ~1 week): ProfileBuilderPage + xterm + AuthWidget

### B2 must precede H8

Plan lists B2 in Sprint 2 but H8 in Sprint 3. H8's auth widget needs B2's OAuth endpoints. Add explicit dependency.

---

## Revised LOC estimates (consolidated)

| Group | Plan v2 LOC | Reality LOC | Delta | Reason |
|---|---|---|---|---|
| A1 | 120 | 60-120 | -0 to -60 | maxToolRounds exists; option B is cheaper |
| A2 | 60 | 120 | +60 | Needs parentId structural change |
| A3 | 80 | 100 | +20 | No @Tool; need explicit registration extension |
| A5 | 70 | 150 | +80 | New supervisor module, not launcher |
| B1 | 400 | 350 | -50 | PackageHost exists; but PackageKind change needed |
| B2 | 90 | 120 | +30 | Slightly more wiring |
| C1 | 300 | 350 | +50 | Greenfield |
| C3 | 220 | 200 | -20 | path-safety.ts reusable |
| C5 | 50 | 200 | +150 | SSRF exists; phishing/malware is new |
| C6 | 180 | 150 | -30 | Tool wrapper over existing cron |
| D1 | 1000 | 280 | **-720** | SQLite + Markdown already done |
| D2 | 250 | 350 | +100 | New concept, not just graph.ts |
| E1 | 900 | 430 | **-470** | 8 channels already exist |
| E2 | 200 | 190 | -10 | Accurate |
| E3 | 400 | 300 | -100 | Slightly generous |
| F1 | 30 | 25 | -5 | Accurate |
| F2 | 60 | 65 | +5 | Accurate |
| F3 | 40 | 40 | 0 | Accurate |
| F4 | 120 | 130 | +10 | Accurate |
| G1a | 350 | 400 | +50 | STT exists but PTT is new |
| H1 | 1030 | 1850 | **+820** | Full package + wizard + migration |
| H2 | 80 | 80 | 0 | Accurate |
| H3 | 200 | 200 | 0 | Accurate |
| H4 | 500 | 700 | **+200** | Zero PTY code |
| H5 | 150 | 150 | 0 | Accurate |
| H7 | 200 | 600 | **+400** | Backend CRUD + CodeMirror |
| H8 | 180 | 200 | +20 | B2 dependency |
| H9 | 120 | 250 | +130 | New WebhookRegistry |
| H10 | 150 | 150 | 0 | Backend done |
| H11-H14 | 170 | 170 | 0 | Accurate |
| I1 | 200 | 200 | 0 | Accurate |
| J1-J4 | 800 | 800 | 0 | Accurate |

**Revised grand total**: ~8,160 → **~8,810 LOC** (net +650, but major redistribution)

### Per-sprint revision

| Sprint | Plan v2 | Reality | Change |
|---|---|---|---|
| 1 (Security/Core) | 430 | 510 | +80 (A5, C5 revised up) |
| 2 (Providers/Tools) | 1030 | 1140 | +110 (C1, B2 revised up; C6 down) |
| 3a (Web backend) | — | 970 | **NEW SPLIT** |
| 3b (Web frontend) | 1990 | 1830 | -160 (H1/H4/H7 redistributed) |
| 4 (Channels/Voice) | 1670 | 1180 | **-490** (E1 massively reduced) |
| 5 (Memory/System) | 1570 | 1050 | **-520** (D1 massively reduced) |
| 6 (Polish) | 1450 | 1570 | +120 |
| 7 (Fun/UX) | 1020 | 1020 | 0 |

---

## Action items (priority order)

### Must fix before Sprint 1
1. **Wire scanInject into channels** (~30 LOC) — spec violation, blocks E1/E2/E3
2. **Fix 6 wrong file paths** (A3, A5, B1, C6, D2, G1a)
3. **Decide A1 approach**: BudgetConfig dimension vs per-subagent maxToolRounds
4. **Add parentId to SubagentHandle** (A2 structural change)

### Must fix before Sprint 3
5. **Split Sprint 3 into 3a (backend) + 3b (frontend)**
6. **Add B2→H8 dependency arrow**
7. **Spec ProfileStore schema** before implementation

### LOC re-baselining
8. **Reduce D1 from ~1000 → ~280** (SQLite + Markdown done)
9. **Reduce E1 from ~900 → ~430** (8 channels done)
10. **Increase H1 from ~1030 → ~1850** (full package cost)
11. **Increase H7 from ~200 → ~600** (backend + CodeMirror)
12. **Increase H4 from ~500 → ~700** (zero PTY code)
13. **Increase C5 from ~50 → ~200** (phishing/malware is new, SSRF exists)

### Spec compliance gaps
14. **Register CronScheduler as ComponentHealth** (F2)
15. **Implement keyring abstraction** (E2 depends on it)
16. **Wire ComponentHealth into all new features** (inv #17)
