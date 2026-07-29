# Port Plan 5 — Web Plugin SDK + Slot Registry

> **Status:** DRAFT — analysis complete.
> **Sources:** Hermes vendored `source/hermes-agent/web/src/plugins/` (v0.19.0); mya web `packages/web/`.
> **CRITICAL:** There is **in-flight plugin work by the user**. This plan **extends** it — does not redesign.

---

## 1. Hermes design

### 1.1 Slot manifest — 30 slots (10 shell-wide + 20 page-scoped)
`source/hermes-agent/web/src/plugins/slots.ts:39-87`:
- **Shell-wide (10):** `backdrop`, `header-left`, `header-right`, `header-banner`, `sidebar`, `pre-main`, `post-main`, `footer-left`, `footer-right`, `overlay`.
- **Page-scoped (20):** sessions/analytics/logs/cron/skills/plugins/config/env/docs/chat × top/bottom.

### 1.2 Plugin registration API (`registry.ts:182-185`)
```ts
window.__HERMES_PLUGINS__.register(name, component)       // page/tab registration
window.__HERMES_PLUGINS__.registerSlot(plugin, slot, component)  // slot injection
```
`registerSlot` stores `{plugin, component}` keyed by slot name; re-registering same (plugin, slot) replaces (HMR-friendly). Multiple plugins populate same slot — render **stacked in registration order** (no priority).

### 1.3 Plugin SDK exposure — `exposePluginSDK()` (`registry.ts:107-150`)
`window.__HERMES_PLUGIN_SDK__` = `{ sdkVersion: "1.1.0", React, hooks{useState,...}, api, fetchJSON, authedFetch, buildWsUrl, components{Card,Badge,Button,...14}, utils{cn,timeAgo}, useI18n }`. Typed contract in `sdk.d.ts` (hand-authored ambient Window augmentation). Versioning: bump major on breaking changes; additive doesn't require bump.

### 1.4 PluginSlot component (`slots.ts:148-180`)
`useState`+`useEffect` (NOT `useSyncExternalStore`). Renders all registered in a `Fragment`, keyed by plugin name. `fallback` prop when empty. Re-renders on registry mutation.

### 1.5 Manifest schema (`types.ts:3-28`)
`{ name, label, description, icon, version, tab{path,position?,override?,hidden?}, slots?, entry, css?, has_api, integrity?, source }`.

### 1.6 Load lifecycle (`usePlugins.ts`)
Fetch manifests (`GET /api/dashboard/plugins`) → inject CSS `<link>` → inject JS `<script>` with **SRI integrity** → onload `notifyPluginRegistry()` → check NO_REGISTER error → onerror LOAD_FAILED. Dev-mode cache-busting for HMR.

---

## 2. mya current state (in-flight plugin work)

### 2.1 What ALREADY exists (8 source + 8 test files)
| File | Purpose | Citation |
|------|---------|----------|
| `lib/plugin-slots.ts` | Slot manifest — **18 slots** (4 shell + 14 page) | `:38-56` |
| `lib/plugin-registry.ts` | Slot + page registry store | `:104-134` (registerSlot), `:198-228` (pages) |
| `lib/plugin-manifest.ts` | Manifest types (minimal) | `:33-52` |
| `lib/plugin-routes.tsx` | Pure-data route/nav merging | `:49-127`, `:130-175` |
| `lib/usePlugins.ts` | Manifest fetch + script injection | `:19-68` |
| `components/PluginSlot.tsx` | Slot renderer | `:28-41` |
| `components/PluginPage.tsx` | Plugin page renderer | `:18-35` |
| `pages/PluginsPage.tsx` | Plugin admin / slot reference | `:45-122` |

### 2.2 mya slot manifest (18 slots)
Shell-wide (4): `sidebar:top`, `sidebar:bottom`, `header:start`, `header:end`.
Page-scoped (14): dashboard/sessions/skills/config/system/models/tools × top/bottom.

### 2.3 mya ADVANTAGES over Hermes (PRESERVE THESE)
1. **Priority-ordered slots** — `registerSlot(slot, component, priority)` with stable sort (`plugin-registry.ts:104-134`). Hermes is insertion-order only. **Do not regress.**
2. **`useSyncExternalStore`** with memoized snapshots — stable ref until mutation (`PluginSlot.tsx:29-32`, `plugin-registry.ts:99-106`). Hermes uses useState+useEffect (less efficient).
3. **Separate slot/page listener stores** — `emitSlots()` vs `emitPages()` prevent spurious cross-renders.
4. **Type-safe slot names** — `PluginSlotName` string-literal union + `isValidSlot` guard (`plugin-slots.ts:48-55`). Hermes accepts any string.
5. **Pure-data route merging** — `buildRoutes`/`buildNavItems` decoupled from registry (`plugin-routes.tsx`), unlike Hermes's inline App.tsx.

### 2.4 EXACT gap vs Hermes
| Gap | Hermes | mya | Evidence |
|-----|--------|-----|----------|
| **A. Window `registerSlot`** | ✅ | ❌ only `register` (pages) exposed | `App.tsx:90` |
| **B. Full SDK on window** | ✅ React+hooks+components+utils+api | ❌ only `window.React` + `register` | `App.tsx:86-94` |
| **C. SDK type contract** | ✅ `sdk.d.ts` | ❌ none | — |
| **D. SDK versioning** | ✅ `"1.1.0"` | ❌ none | — |
| **E. Shell slot mount points** | ✅ 7 in App.tsx | ❌ declared but NOT mounted in Sidebar/Header | grep: no PluginSlot in Sidebar/Header |
| **F. models/tools page slots** | N/A | ⚠️ declared but NOT mounted | only 5 pages mount PluginSlot (10 of 18 slots) |
| **G. Hermes shell slots** | backdrop, header-banner, pre-main, post-main, footer, overlay | ❌ not in manifest | `plugin-slots.ts:38-56` |
| **I. CSS injection** | ✅ | ❌ | `usePlugins.ts:38-50` |
| **J. SRI integrity** | ✅ | ❌ | `usePlugins.ts:43-52` |
| **K. Load error tracking** | ✅ | ❌ | — |
| **L. UI component library** | 35+ (`@nous-research/ui`) | ⚠️ 4 (Badge, Button, Card, Tooltip) | `components/ui/` |

**Slots actually mounted in mya:** DashboardPage, SkillsPage, SessionsPage, ConfigPage, SystemPage = 10 of 18 declared.

---

## 3. Port design

### 3.1 Principles
1. **Extend, don't replace.** `plugin-slots.ts`/`plugin-registry.ts`/`PluginSlot.tsx` are the foundation. Add to `KNOWN_SLOT_NAMES`, don't restructure.
2. **Preserve priority ordering** (superior to Hermes).
3. **Add the window SDK** — port `exposePluginSDK()` + `sdk.d.ts`, adapted to mya's (smaller) UI library.

### 3.2 Slot registry extension (`lib/plugin-slots.ts`)
Extend `KNOWN_SLOT_NAMES` 18 → ~30. Adopt Hermes shell slot names where clean, keep mya naming where established:
```ts
export const KNOWN_SLOT_NAMES = [
  // Shell (existing — MOUNT NEEDED in Sidebar/Header)
  "sidebar:top", "sidebar:bottom", "header:start", "header:end",
  // NEW shell (from Hermes):
  "backdrop", "header:banner", "main:pre", "main:post", "overlay",
  // Page-scoped (existing 14)
  "dashboard:top", "dashboard:bottom", "sessions:top", "sessions:bottom",
  "skills:top", "skills:bottom", "config:top", "config:bottom",
  "system:top", "system:bottom", "models:top", "models:bottom",  // ← MOUNT NEEDED
  "tools:top", "tools:bottom",                                    // ← MOUNT NEEDED
  // NEW page (from Hermes):
  "chat:top", "chat:bottom", "logs:top", "logs:bottom",
  "analytics:top", "analytics:bottom", "cron:top", "cron:bottom",
] as const;  // ~30 slots
```
> Skip `footer-left/right` (mya has no footer bar). Skip env/docs/plugins slots for now (lower-traffic). Add on demand.

### 3.3 Window SDK exposure (NEW `lib/plugin-sdk.ts`)
```ts
import React, { useState, useEffect, useCallback, useMemo, useRef, useContext, createContext } from "react";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Tooltip } from "@/components/ui";
import { registerSlot, registerPluginPage } from "@/lib/plugin-registry";

export const SDK_CONTRACT_VERSION = "1.0.0";

export function exposePluginSDK(): void {
  const w = window as unknown as Record<string, unknown>;
  w["__MYA_PLUGINS__"] = {
    register: registerPluginPage,
    registerSlot: ((slot: string, component: React.ComponentType, priority?: number) =>
      registerSlot(slot as never, component, priority)),
  };
  w["__MYA_PLUGIN_SDK__"] = {
    sdkVersion: SDK_CONTRACT_VERSION,
    React,
    hooks: { useState, useEffect, useCallback, useMemo, useRef, useContext, createContext },
    components: { Badge, Button, Card, Tooltip },
    utils: { cn },
  };
}
```

### 3.4 SDK type contract (NEW `lib/plugin-sdk.d.ts`)
Hand-authored ambient Window augmentation (same rationale as Hermes `sdk.d.ts:6-20` — not `typeof window`):
```ts
declare global {
  interface Window {
    __MYA_PLUGINS__?: { register(...); registerSlot(...); };
    __MYA_PLUGIN_SDK__?: { readonly sdkVersion: string; React: typeof React; hooks: {...}; components: Record<string, ComponentType>; utils: { cn }; };
  }
}
```

### 3.5 Mount points (wire existing declared slots)
- **`components/Header.tsx`** — add `<PluginSlot name="header:start" />` + `<PluginSlot name="header:end" />`.
- **`components/Sidebar.tsx`** — add `<PluginSlot name="sidebar:top" />` + `<PluginSlot name="sidebar:bottom" />`.
- **`pages/ModelsPage.tsx`** + **`pages/ToolsPage.tsx`** — add `:top`/`:bottom` (declared but unmounted).
- **`App.tsx`** — add `backdrop`/`overlay` slots; replace inline `__MYA_PLUGINS__` block (`:86-94`) with `exposePluginSDK()` call before render.

### 3.6 usePlugins enhancements (CSS + SRI + errors)
Extend `lib/usePlugins.ts` — CSS injection, SRI integrity, load-error tracking. `plugin-manifest.ts:52` index signature already allows `css`/`integrity` passthrough.

---

## 4. Files to touch / create
| Action | File |
|--------|------|
| EXTEND | `lib/plugin-slots.ts` (+~12 slots) |
| CREATE | `lib/plugin-sdk.ts` (`exposePluginSDK` + version) |
| CREATE | `lib/plugin-sdk.d.ts` (ambient Window) |
| CREATE | `lib/plugin-sdk.test.ts` |
| EXTEND | `lib/usePlugins.ts` (CSS + SRI + errors) |
| EXTEND | `lib/usePlugins.test.tsx` |
| EDIT | `App.tsx` (replace inline block → `exposePluginSDK()`; add backdrop/overlay slots) |
| EDIT | `components/Header.tsx` (header:start/end mounts) |
| EDIT | `components/Sidebar.tsx` (sidebar:top/bottom mounts) |
| EDIT | `pages/ModelsPage.tsx` + `pages/ToolsPage.tsx` (mount declared slots) |
| UPDATE | `pages/PluginsPage.tsx` (+test) — slot count display |
| UPDATE | `lib/plugin-slots.test.ts` — `toHaveLength(30)` |
| **NO CHANGE** | `lib/plugin-registry.ts`, `components/PluginSlot.tsx`, `lib/plugin-routes.tsx` (already complete) |

---

## 5. Effort & risk
**Effort: L** (largest UX-extensibility gap).

| Risk | Mitigation |
|------|------------|
| Colliding with user's in-flight plugin work | Plan extends existing files, not replaces. registry/slot/PluginSlot/routes marked NO CHANGE. |
| React render perf with many slots | mya's memoized `useSyncExternalStore` already handles this — each PluginSlot re-renders only on its slot's mutation. |
| Window global type safety | `sdk.d.ts` ambient must match runtime exactly; use `satisfies` in plugin-sdk.ts to catch drift. |
| `registerSlot` accepting arbitrary strings | Window-exposed must accept `string` (plugin-ecosystem custom slots, like Hermes); registry type-narrows internally + runtime `isValidSlot()` guard + console.warn for unknown. |
| UI library thin (4 vs 35+) | Separate effort. Expose what exists now; expand as library grows. |

---

## 6. Test plan (NO TEST = NO MERGE)
Vitest pool forks, jsdom.

| Test | File | What |
|------|------|------|
| Slot renders plugin | `plugin-slot.test.tsx` (existing) | ✅ already covered |
| Plugin load/unload | `plugin-slot.test.tsx` (existing) | ✅ already covered |
| Priority ordering | `plugin-slot.test.tsx` (existing) | ✅ already covered |
| **SDK exposure** | `plugin-sdk.test.ts` (NEW) | `exposePluginSDK()` sets `__MYA_PLUGINS__` (register+registerSlot) + `__MYA_PLUGIN_SDK__` (sdkVersion, React, hooks, components, utils) |
| **registerSlot via window** | `plugin-sdk.test.ts` (NEW) | `window.__MYA_PLUGINS__.registerSlot(...)` updates registry → renders in `<PluginSlot>` |
| **CSS injection** | `usePlugins.test.tsx` (extend) | manifest with `css` → `<link>` injected |
| **SRI integrity** | `usePlugins.test.tsx` (extend) | manifest with `integrity` → `script.integrity` + `crossOrigin` |
| **Load error** | `usePlugins.test.tsx` (extend) | `script.onerror` → load error state |
| **Slot count** | `plugin-slots.test.ts` (update) | `KNOWN_SLOT_NAMES.toHaveLength(30)` |
| **Shell slot mount** | `Header.test.tsx`/`Sidebar.test.tsx` | PluginSlot rendered at expected positions |

---

## 7. Honest assessment

### Should mya match Hermes's 30+ slots?
**No — not blindly.** Hermes's slot set reflects Hermes's page inventory (analytics, logs, cron, env, docs, chat). mya has a different (richer) page set (dashboard, events, models, tools, mcp, channels, webhooks, pairing, profiles, achievements, sync, collab, push). Define mya's own slot set, informed by Hermes's *categories* not exact names.

### Minimum Viable Plugin SDK (what mya ALMOST already has)
1. ✅ Slot registry with priority ordering (DONE)
2. ✅ PluginSlot component with reactive updates (DONE)
3. ✅ Plugin page routing (DONE)
4. ⬜ **Window-exposed `registerSlot`** — single highest-value gap. Without it, external plugin bundles can't inject into slots. (~2h)
5. ⬜ **Shell slot mount points** — wire the 4 already-declared shell slots into Header/Sidebar. (~1h)
6. ⬜ **Mount models/tools page slots** — already declared, add 4 `<PluginSlot>` tags. (~30min)

The full SDK (React/hooks/components/utils exposure) is the **next tier** — valuable for external plugin authors who don't want to bundle React, but not blocking for in-process/bundled plugins.

**Recommendation:** Ship MVP (items 4-6) first — ~half a day, unlocks the slot system end-to-end. Then iterate the SDK surface as the UI component library grows.

### mya is ALREADY superior in 3 design dimensions
- Priority-ordered slots (Hermes = insertion-order only).
- `useSyncExternalStore` memoized snapshots (Hermes = useState+useEffect).
- Type-safe slot names + pure-data routes.

Don't regress these when porting. The port is additive (window SDK + mount points + more slots), not a redesign.
