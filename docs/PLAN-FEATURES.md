# mya Feature Adoption Plan — From Hermes Comparison

> Generated: 2026-07-21
> Source: `docs/mya-vs-hermes-features.md` §15 Top Recommendations
> Status: **PROPOSED** — awaiting user prioritization

## Executive Summary

5 priorities identified from the mya-vs-Hermes feature comparison. After code recon:

| # | Feature | Effort | ROI | Status |
|---|---|---|---|---|
| 1 | **IterationBudget per-subagent** | S (~80 LOC) | HIGH | **NEW** — not started |
| 2 | **Plugin providers với lazy install** | L | HIGH | **NEW** — biggest provider gap |
| 3 | **Cron ordering fix** | — | — | **ALREADY DONE** ✅ (false alarm in comparison) |
| 4 | **Cron catch-up grace window** | S (~40 LOC) | MEDIUM | **PARTIAL** — mya fires-once+advances; grace window is a behavioral choice |
| 5 | **ProfileSwitcher + per-island** | L | HIGH | **STUB** — gateway endpoint exists, UI missing |

**Revised priority order** (after recon):
1. IterationBudget (S, HIGH) — fastest win
2. Cron grace window (S, MEDIUM) — small, optional
3. ProfileSwitcher (L, HIGH) — biggest UX gap
4. Plugin providers (L, HIGH) — biggest capability gap
5. ~~Cron ordering~~ — already correct

**Recommended batch**: Do #1 + #2 first (both S, ~1 session each), then #5 or #4 (both L, multi-session).

---

## Priority 1: IterationBudget per-subagent

### Why
mya subagents currently have **no iteration cap** — they can loop until token budget exhausts or model times out. Hermes has `agent/iteration_budget.py` with thread-safe `consume(refund)` per agent (parent=90, sub=50). This is the **#1 deepest single gap** from the comparison.

### Current state (evidence)
- `packages/core/src/budget.ts` — `BudgetConfig` is **token-USD only** (`total`, `reserved`, `spend(Cost)`)
- `packages/agent/src/index.ts:455-535` — `runSubagentTurn()` runs turns until budget.exhausted() or signal abort; **no turn counter**
- `packages/core/src/budget.test.ts` — 54 lines, no iteration tests
- `grep -r "IterationBudget\|iteration_budget"` → **0 matches** (confirmed absent)

### Design

**Option A (preferred): Extend BudgetConfig with iteration tracking**
- Add `maxIterations` to `BudgetConfig` (0 = unlimited)
- Add `consumeIteration(): boolean` method — decrements counter, returns false if exhausted
- Add `releaseIterations(n)` — refund on abort (mirrors `releasePrecharge`)
- Reuse the existing `RootState`/`ChildRecord` tree structure

**Option B: Separate IterationTracker class**
- Cleaner separation but duplicates the tree-accounting pattern
- More LOC, more surface area

→ **Choose A** for minimal blast radius.

### Files to change

| File | Change | LOC |
|---|---|---|
| `packages/core/src/types.ts` | Add `maxIterations?` to `BudgetConfig`; add `consumeIteration`, `releaseIterations`, `iterationsRemaining` to interface | +15 |
| `packages/core/src/budget.ts` | Extend `RootState` with `iterationsUsed`; add `consumeIteration`/`releaseIterations` to `makeBudget`; cap in `deriveChild` | +35 |
| `packages/core/src/budget.test.ts` | Test: parent cap, sub cap, refund on abort, exhausted check | +40 |
| `packages/agent/src/index.ts` | In `runSubagentTurn`: call `budget.consumeIteration()` before each turn; abort if false | +8 |
| `packages/agent/src/subagent.test.ts` | Test: subagent aborts at iteration cap | +20 |

**Total: ~118 LOC** (S effort, ~2-3 hours)

### Implementation steps

1. **types.ts**: Add to `BudgetConfig`:
   ```ts
   maxIterations: number;        // 0 = unlimited
   consumeIteration: () => boolean;  // false = exhausted
   releaseIterations: (n: number) => void;  // refund on abort
   iterationsRemaining: () => number;
   ```

2. **budget.ts**: Extend `RootState`:
   ```ts
   interface RootState {
     // ...existing...
     iterationsUsed: number;
     iterationsCap: number;  // 0 = unlimited
   }
   ```
   In `makeBudget`, add:
   ```ts
   consumeIteration: () => {
     if (node.unlimited || node.root.iterationsCap === 0) return true;
     if (node.root.iterationsUsed >= node.root.iterationsCap) return false;
     node.root.iterationsUsed++;
     return true;
   },
   releaseIterations: (n) => { node.root.iterationsUsed = Math.max(0, node.root.iterationsUsed - n); },
   iterationsRemaining: () => node.unlimited || node.root.iterationsCap === 0
     ? Infinity : Math.max(0, node.root.iterationsCap - node.root.iterationsUsed),
   ```

3. **createBudget**: Add `maxIterations` param (default 0 = unlimited; subagent default 50).

4. **agent/index.ts runSubagentTurn**: Before `runTurn`, add:
   ```ts
   if (!budget.consumeIteration()) {
     throw new Error("iteration budget exhausted");
   }
   ```

5. **AgentConfig**: Add `subagentMaxIterations?: number` (default 50).

### Tests
- `budget.test.ts`: consume hits cap → false; release refunds; unlimited always true
- `subagent.test.ts`: spawn subagent with cap=2, verify it aborts after 2 turns
- Existing 1824 tests still pass (backward compatible — default 0 = unlimited)

### Risks
- **Low**: backward compatible (default unlimited)
- Thread-safety not needed (JS single-threaded; async is fine)
- Subagents sharing parent budget means parent cap applies globally — may want per-subagent isolated budget (use `deriveChild`)

---

## Priority 2: Plugin providers with lazy install

### Why
mya has **8 hard-coded providers**; Hermes has **30+ plugin providers** with lazy install. This is the **biggest capability gap**. However, it's L effort and touches the provider architecture deeply.

### Current state (evidence)
- `packages/ai/src/index.ts` — `ProviderRegistry` is a Map; providers are explicitly constructed in `createAgent`
- `grep "registerProvider"` → 0 matches (no plugin registration API)
- No `packages/ai/plugins/` directory
- `packages/pkg/src/index.ts` — `PackageHost` exists for extensions/skills but NOT providers

### Design

**Declarative plugin manifest** (Hermes-style dataclass → TS interface):
```ts
interface PluginProviderManifest {
  id: string;                    // "deepinfra", "fireworks", ...
  displayName: string;
  npmPackage: string;            // "@mya/provider-deepinfra"
  baseUrl: string;
  envVar: string;                // "DEEPINFRA_API_KEY"
  models: ModelSpec[];
  authScheme: "bearer" | "oauth-pkce" | "none";
  allowlistEntry: string;        // must be in MYA_PLUGIN_ALLOWLIST
}
```

**Lazy install flow**:
1. `MYA_PLUGIN_ALLOWLIST=deepinfra,fireworks` env var
2. On `createAgent`, scan `~/.mya/plugins/providers/` for manifests
3. For each allowlisted provider, check if npm package installed
4. If not, `npm install --prefix ~/.mya/plugins <pkg>` (gated by allowlist)
5. Register in `ProviderRegistry`

### Files to change

| File | Change | LOC |
|---|---|---|
| `packages/ai/src/plugin-provider.ts` | **NEW** — `PluginProviderManifest`, `loadPluginProvider`, `scanPlugins` | +150 |
| `packages/ai/src/index.ts` | Export `PluginProviderRegistry`; auto-scan in `ProviderRegistry` constructor | +60 |
| `packages/ai/src/lazy-install.ts` | **NEW** — allowlist check, npm install wrapper | +80 |
| `packages/ai/src/plugin-provider.test.ts` | **NEW** — manifest parse, allowlist gate, mock install | +100 |
| `packages/pkg/src/index.ts` | Extend `PackageHost` to support `provider` kind (4th kind after extensions/skills/templates/themes) | +40 |
| `docs/plugin-providers.md` | **NEW** — how to write + register a plugin provider | +80 |

**Total: ~510 LOC** (L effort, ~1-2 days)

### Implementation steps

1. **Phase A — Manifest + scan (no install yet)**:
   - Define `PluginProviderManifest` interface
   - `scanPlugins(dir)`: read `*.json` manifests from `~/.mya/plugins/providers/`
   - `ProviderRegistry.registerPlugin(manifest)`: construct adapter from manifest
   - Test: scan a fixture dir, verify registration

2. **Phase B — Lazy install**:
   - `lazyInstall(manifest, allowlist)`: check allowlist → `npm install` → require
   - `MYA_PLUGIN_ALLOWLIST` env gate (security: no arbitrary install)
   - Cache installed packages in `~/.mya/plugins/node_modules/`

3. **Phase C — Provider plugin SDK**:
   - `createPluginProvider(manifest, httpClient)` helper for plugin authors
   - Example plugin: `@mya/provider-deepinfra` (standalone package)

4. **Phase D — Wiring**:
   - `createAgent`: if `config.pluginProviders !== false`, scan + register
   - CLI: `mya providers list` / `mya providers install <id>`

### Tests
- Manifest parse/validation
- Allowlist gate (rejects non-allowlisted)
- Mock npm install (stub child_process)
- End-to-end: scan fixture → register → use provider

### Risks
- **MEDIUM**: npm install at runtime is slow + security-sensitive
- Mitigation: allowlist required, install gated behind explicit opt-in
- Version pinning: pin major version in manifest

---

## Priority 3: Cron ordering fix — ❌ ALREADY DONE

### Recon finding
The comparison report claimed mya has a "mark-before-async bug". **This is incorrect.** Evidence:

```ts
// packages/cron/src/index.ts:331-362 — dueAndAdvance()
if (job.nextRunAt <= now) {
  const next = computeNextFire(...)?.getTime();  // compute next FIRST
  job.nextRunAt = next;                          // advance BEFORE firing
  this.dirty = true;
  out.push(job);                                 // then queue for fire
}
```

And `complete()` (line 250): re-anchors `nextRunAt` off **completion** time (post-exec), not pre-exec.

The gateway (`packages/gateway/src/index.ts:535-614`) calls:
1. `dueAndAdvance()` — advances nextRunAt
2. `claim(job.id, workerId)` — atomic claim
3. Execute (async turn / shell)
4. `complete(runId, "succeeded"|"failed")` — post-exec mark

**This is the correct Hermes pattern.** No change needed.

### Action
- Update `docs/mya-vs-hermes-features.md` §9 to mark cron ordering as ✅ parity (not ❌)
- No code change

---

## Priority 4: Cron catch-up grace window

### Why
mya fires a cron job **exactly once** when it's past due, regardless of HOW past due. Hermes uses a grace window (`MIN_GRACE=120s, MAX_GRACE=7200s`): if a job is older than the grace window, it's **skipped** (not fired). This prevents firing very stale jobs after long downtime (e.g., a job due every 5 min, server down 3 days → don't fire 864 stale runs; fire once or skip).

### Current state
mya's `dueAndAdvance()`:
```ts
if (job.nextRunAt <= now) {
  // ALWAYS fires — no staleness check
  job.nextRunAt = next;  // advances to next future
  out.push(job);
}
```

This is **infinite grace** (always fire once). Hermes uses **finite grace** (skip if too stale).

### Design decision
This is a **behavioral choice**, not a bug:
- **Infinite grace (current)**: always run the missed job once — safer for important jobs
- **Finite grace (Hermes)**: skip very stale jobs — prevents stale-data hazards

**Recommendation**: Add `graceMs` per-job (default `Infinity`; configurable). If `now - job.nextRunAt > graceMs`, skip + advance.

### Files to change

| File | Change | LOC |
|---|---|---|
| `packages/cron/src/index.ts` | Add `graceMs?: number` to `CronJob`; skip-if-stale check in `dueAndAdvance` | +15 |
| `packages/cron/src/cron.test.ts` | Test: stale job skipped, fresh job fires | +25 |

**Total: ~40 LOC** (S effort, ~1 hour)

### Implementation

```ts
// In dueAndAdvance(), after `if (job.nextRunAt <= now)`:
const staleness = now - job.nextRunAt;
const grace = job.graceMs ?? Infinity;
if (staleness > grace) {
  // Too stale — skip this fire, advance to next
  const next = computeNextFire(job.schedule, new Date(now), job.timezone)?.getTime();
  if (next == null) { job.enabled = false; this.dirty = true; continue; }
  job.nextRunAt = next;
  this.dirty = true;
  continue;  // skip — do NOT push to out
}
```

Add `graceMs?: number` to `CronJob` interface (default undefined = Infinity).

### Hermes grace computation (reference)
```python
def _compute_grace_seconds(cron_expr):
    interval = croniter(cron_expr).get_next()
    grace = min(max(interval / 2, 120), 7200)  # clamp [120, 7200]
    return grace
```

mya equivalent: compute from `computeNextFire` delta. But simpler: just use a fixed default (e.g., 1 hour) or let user set per-job.

### Tests
- Job with `graceMs: 60_000`, `nextRunAt` 2 min ago → **skipped**, nextRunAt advanced
- Job with `graceMs: 60_000`, `nextRunAt` 30s ago → **fires**
- Job with no `graceMs` → always fires (backward compat)

### Risks
- **LOW**: backward compatible (default Infinity = current behavior)
- Edge: user might expect stale jobs to fire — document clearly

---

## Priority 5: ProfileSwitcher + per-island config

### Why
Hermes has full multi-profile ("islands") — per-profile `HERMES_HOME`, cron, skills, `.env`, API keys. mya has **only a stub** (`/profiles/active` returns `{name:"default"}`). This is the **biggest UX gap** in the web dashboard.

### Current state (evidence)
```ts
// packages/gateway/src/index.ts:1493
if (url.pathname === "/profiles/active") return send(200, { name: "default" });
// packages/gateway/src/index.ts:330
"/profiles": { profiles: [{ name: "default", description: "Default profile", is_default: true }] },
```
- No profile store, no per-profile isolation
- Web has no ProfileSwitcher, no ProfileProvider, no ProfileKeyedRoutes

### Design

**Profile = isolated config island**:
```
~/.mya/
  profiles/
    default/       ← current single-profile (backward compat)
      config.toml
      cron.json
      auth.json
      memory/
    work/
      config.toml
      cron.json
      ...
    personal/
      ...
  profiles.json    ← registry: { active: "default", profiles: [...] }
```

**Gateway**:
- `GET /profiles` → list profiles
- `GET /profiles/active` → current active
- `POST /profiles/switch` → switch active (remounts scheduler, reloads config)
- `POST /profiles/create` → create new profile (5-step wizard data)
- `DELETE /profiles/:name` → delete (refuse if active or last)

**Web**:
- `ProfileProvider` context — wraps app, provides `activeProfile`, `switchProfile()`
- `ProfileSwitcher` — sidebar dropdown
- `ProfileScopeBanner` — header bar showing active profile
- `ProfileKeyedRoutes` — remounts pages on switch (prevents stale-target writes)
- `ProfilesPage` — list + create + delete
- `ProfileBuilderPage` — 5-step wizard (identity, model, skills, MCP, review)

### Files to change

| File | Change | LOC |
|---|---|---|
| `packages/gateway/src/profiles.ts` | **NEW** — ProfileStore, switch, create, delete | +200 |
| `packages/gateway/src/index.ts` | Wire profile endpoints; profile-aware config loading | +80 |
| `packages/cron/src/index.ts` | Profile-aware cron store path (`profiles/<name>/cron.json`) | +30 |
| `packages/web/src/contexts/ProfileProvider.tsx` | **NEW** — context + hook | +80 |
| `packages/web/src/components/ProfileSwitcher.tsx` | **NEW** — sidebar dropdown | +60 |
| `packages/web/src/components/ProfileScopeBanner.tsx` | **NEW** — header banner | +30 |
| `packages/web/src/components/ProfileKeyedRoutes.tsx` | **NEW** — key=profile remount wrapper | +25 |
| `packages/web/src/pages/ProfilesPage.tsx` | **NEW** — list + manage | +120 |
| `packages/web/src/pages/ProfileBuilderPage.tsx` | **NEW** — 5-step wizard | +200 |
| `packages/web/src/lib/api.ts` | Add `api.profiles()` methods | +30 |
| `packages/web/src/components/Sidebar.tsx` | Add ProfileSwitcher slot | +10 |
| `packages/web/src/App.tsx` | Wrap with ProfileProvider; use ProfileKeyedRoutes | +15 |
| Tests (gateway + web) | Profile CRUD, switch, remount | +150 |

**Total: ~1030 LOC** (L effort, ~2-3 days)

### Implementation steps

**Phase A — Backend profile store** (Day 1):
1. `profiles.ts`: `ProfileStore` class — manages `~/.mya/profiles.json` + per-profile dirs
2. Methods: `list()`, `getActive()`, `switch(name)`, `create(data)`, `delete(name)`
3. On switch: reload cron scheduler from new profile's `cron.json`
4. Gateway endpoints: `GET/POST /profiles/*`

**Phase B — Web context + switching** (Day 1-2):
5. `ProfileProvider`: fetches active profile, provides switch()
6. `ProfileSwitcher`: dropdown in sidebar (calls `POST /profiles/switch`)
7. `ProfileScopeBanner`: shows active profile name in header
8. `ProfileKeyedRoutes`: `<Routes key={activeProfile}>` — forces remount

**Phase C — Profile management UI** (Day 2-3):
9. `ProfilesPage`: table of profiles (name, description, active, default)
10. `ProfileBuilderPage`: 5-step wizard:
    - Step 1: Identity (name, description, icon)
    - Step 2: Model (default provider + model)
    - Step 3: Skills (select from available)
    - Step 4: MCP (server URLs)
    - Step 5: Review + create

**Phase D — Isolation** (Day 3):
11. Per-profile `config.toml` loading
12. Per-profile `auth.json` (separate API keys per profile)
13. Per-profile cron store path
14. Per-profile memory dir

### Tests
- ProfileStore CRUD
- Switch reloads cron scheduler
- Web: ProfileProvider fetches, switch POSTs, routes remount
- Backward compat: no profiles.json → single "default" profile (current behavior)

### Risks
- **MEDIUM**: switching profiles mid-session could lose state — ProfileKeyedRoutes handles this
- Migration: existing `~/.mya/` → `~/.mya/profiles/default/` (symlink or move)
- Backward compat: if no `profiles.json`, behave as single-profile (current)

---

## Sequencing Recommendation

### Batch 1: Quick wins (1 session, ~3 hours)
- ✅ Priority 1: IterationBudget (~118 LOC)
- ✅ Priority 4: Cron grace window (~40 LOC)
- ✅ Fix comparison doc (Priority 3 already done)
- **Total**: ~158 LOC + tests, all backward compatible

### Batch 2: Profile system (2-3 sessions)
- Priority 5: ProfileSwitcher + per-island (~1030 LOC)
- Depends on: nothing (self-contained)
- Unblocks: multi-tenant use cases

### Batch 3: Plugin providers (2-3 sessions)
- Priority 2: Plugin providers (~510 LOC)
- Depends on: PackageHost (exists)
- Unblocks: 30+ provider parity with Hermes

### Not needed
- ~~Priority 3: Cron ordering~~ — already correct

---

## Verification gates (each priority)

Every priority must pass:
1. `npx vitest run --pool forks` → 1824+ tests pass (no regressions)
2. `npm run bundle` → bundle succeeds
3. `npx tsc -b packages/<pkg>` → type-check passes
4. New tests written + passing
5. `git commit` with conventional commit message
6. Restart gateway: `setsid node dist/mya.js serve --port 3999 > /tmp/mya-gw.log 2>&1 &`
7. E2E smoke test via `MYA_PORT=3999 node dist/mya.js <cmd>`

---

## Open questions for user

1. **Batch order**: Do Batch 1 first (quick wins), or jump to Batch 2/3?
2. **Priority 4 grace default**: `Infinity` (current behavior, backward compat) or `3600_000` (1hr, Hermes-like)?
3. **Priority 5 migration**: auto-migrate `~/.mya/` → `~/.mya/profiles/default/` or require manual?
4. **Priority 2 scope**: full plugin SDK (Phase A-D) or just manifest+scan (Phase A only)?
