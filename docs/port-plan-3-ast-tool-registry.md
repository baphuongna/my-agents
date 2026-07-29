# Port Plan 3 — AST Self-Registering Tool Discovery (Hermes → mya)

> **Status:** DRAFT — plan only; no code changed.
> **Source:** Hermes `tools/registry.py` (v0.19.0) · **Target:** mya `packages/tools`.

---

## 1. Hermes design — AST self-registration convention

Hermes tools register themselves by **module-level side effect**. Adding a tool = drop a `tools/<name>_tool.py` calling `registry.register(...)` at top level — no import list to edit.

### 1.1 Registry singleton + import side-effect
`source/hermes-agent/tools/registry.py`:
- Singleton `registry = ToolRegistry()` at module bottom.
- `register(...)` (`:225`) stores `ToolEntry` keyed by name, inside `_lock`, bumps `_generation`. Plain top-level statement executed on import.

### 1.2 Discovery — AST prefilter + dynamic import
`discover_builtin_tools()` (`:67`):
1. Globs `tools/*.py`, excludes `__init__.py`, `registry.py`, `mcp_tool.py`.
2. `_module_registers_tools(path)` (`:34`): cheap substring prefilter (`"registry"` + `"register"`), then `ast.parse` + `_is_registry_register_call()` (`:24`) checks **only module-body** for top-level `registry.register(...)` Expr→Call→Attribute(attr=register)→Name(id=registry).
3. `importlib.import_module(mod_name)` (`:88`) — **the import triggers the module-level `registry.register(...)` side effect**. Import failures logged, not fatal.

### 1.3 Convention in a tool file (`session_search_tool.py:1061-1063`)
```python
from tools.registry import registry, tool_error
registry.register(name="session_search", toolset="session_search", schema=..., handler=..., ...)
```
Helper modules (no top-level register) are correctly skipped by the AST filter. Hermes reports **99 tool files**; only the self-registering subset is imported.

### 1.4 Tests guarding the convention
`tests/tools/test_registry.py:356,370,387` — discovers all real self-registering modules; skips helper modules; always excludes `mcp_tool.py`.

---

## 2. mya current state — explicit registry, manual array

### 2.1 ToolRegistry + ToolImpl (`packages/tools/src/registry.ts`)
- `ToolImpl` = `{ meta: Tool; run(args, ctx): Promise<ToolResult> }`. `tool.run()` (NOT `.invoke()`). `ok()`/`err()` build `ToolResult`.
- `ToolRegistry.register(impl)` — per-agent instance (NO singleton), explicit call (NO import side effect).

### 2.2 The single registration surface: `builtinTools`
`packages/tools/src/builtin.ts:380`:
```ts
export const builtinTools: ToolImpl[] = [
  readTool, writeTool, editTool, replaceTool, bashTool, globTool, grepTool,
  lsTool, findTool, screenCaptureTool, screenFindTool,
  browserNavigateTool, browserSnapshotTool, browserClickTool, browserTypeTool,
  browserScrollTool, browserBackTool, browserPressTool, browserScreenshotTool,
  osvCheckTool, urlSafetyTool, imageGenTool, videoGenTool, kanbanTool, diskCleanupTool,
];   // 25 tools
```
Consumed by `agent/src/index.ts:353` `for (const t of config.tools ?? builtinTools) toolRegistry.register(t);`.

### 2.3 The exact gap
1. **Adding a tool requires editing builtin.ts** (import line + array entry). Forgetting either silently omits the tool (esbuild tree-shakes it out — no build error).
2. **Removing a tool** = reverse edit; leftover imports become unused.
3. **Count duplicated in a test:** `builtin-completeness.test.ts:74` hardcodes `.toBe(25)` — manual sync tax on every add/remove.

### 2.4 CRITICAL FINDING — existing `auto-discover.ts` is DEAD CODE
`packages/tools/src/auto-discover.ts` exists + exported from `index.ts:91`, but:
- Returns `string[]` (export **names**, not `ToolImpl[]`) → cannot feed `register()`.
- Loose regex, no AST/tsc backing.
- Never wired into the agent registration path.
A stub from a prior PLAN-FEATURES A3 spike, never finished. **Any port must replace or complete it.**

### 2.5 Partial precedent: barrel aggregation
`web/browser/index.ts:1243` aggregates `browserTools: ToolImpl[]`; `web/search/index.ts:222` aggregates `searchTools`. The codebase already tolerates one module exporting many tools.

---

## 3. Port design — build-time codegen (recommended) + runtime scan for SDK

### 3.1 The core constraint: esbuild single-file bundling
mya ships as `dist/mya.js` (single esbuild bundle, `scripts/bundle.mjs`). After bundling, **no separate tool files on disk to scan**. Hermes's `importlib.import_module()` is impossible post-bundle. But esbuild statically resolves `import` statements → a generated index of static imports IS bundled. The TS equivalent of Hermes's runtime scan is **build-time codegen**.

### 3.2 Option comparison
| Option | "Just add a file"? | Survives esbuild? | TS-strict? | Complexity |
|--------|---|---|---|---|
| **A. Build-time codegen** | ✅ | ✅ (static imports) | ✅ | M |
| B. Manual barrel `index.ts` | ⚠️ partial (one line/tool) | ✅ | ✅ | S |
| C. Runtime `fs.readdir` (dead auto-discover) | ✅ | ❌ (bundle has no files) | ❌ | M |
| D. `import.meta.glob` (Vite) | ✅ | ❌ (esbuild lacks it) | ⚠️ | L |

**Recommendation: Option A (build-time codegen) primary; Option C (runtime fs scan) retained only for SDK/`MYA_TOOLS_DIR` plugin path.**

### 3.3 Convention (Option A)
Each tool module exports `export const xxxTool: ToolImpl` (most already do: readTool, osvCheckTool, kanbanTool, diskCleanupTool, screenCaptureTool, browserNavigateTool…). A build-time script scans `packages/tools/src/**/*.ts` for these exports + `ToolImpl[]` barrel arrays, emits `builtin.generated.ts` with static imports + the `builtinTools` array. The port mostly **formalizes an existing pattern** and removes the hand-maintained array.

### 3.4 Codegen script sketch — `scripts/gen-builtin-tools.mjs`
Uses the `typescript` AST API (already a dev dep) — the faithful TS analog of Hermes's `ast.parse` + `_is_registry_register_call`. Detects `export const X: ToolImpl` (single) + `export const Xs: ToolImpl[]` (spread). Emits:
```ts
// AUTO-GENERATED — DO NOT EDIT. Re-run `npm run gen:tools`.
import type { ToolImpl } from "./registry.js";
import { readTool } from "./read.js";
import { osvCheckTool } from "./osv-check.js";
import { browserTools } from "./web/browser/index.js";  // spread
// ...
export const builtinTools: ToolImpl[] = [
  readTool, osvCheckTool, ...browserTools, /* ... */
];
```
Generated file is **committed** (like package-lock.json), regenerated by `prebuild`. Chain into `package.json` scripts. CI check: `npm run gen:tools && git diff --exit-code` fails on drift.

### 3.5 Type safety after codegen (false-green guard)
1. Generated file is typechecked by `tsc` (in `tsconfig` includes) → bad import fails the build. **Stronger than Hermes** (Python has no equivalent).
2. Codegen uses TS-API typechecker to verify each candidate export is assignable to `ToolImpl` before emitting.
3. `builtin-completeness.test.ts` becomes a structural contract (not a count).

### 3.6 Runtime scan for SDK/plugins (Option C, retained + completed)
Rewrite dead `auto-discover.ts` into a real `loadCustomTools(reg, dir)` using dynamic `import()` — the mya equivalent of Hermes's `importlib.import_module`, but explicit (caller passes registry, no global singleton mutation). SDK/`MYA_TOOLS_DIR` only (source tree present, unbundled).

---

## 4. Files to touch
| File | Change |
|------|--------|
| `scripts/gen-builtin-tools.mjs` | **NEW** — TS-AST codegen |
| `packages/tools/src/builtin.generated.ts` | **NEW (generated, committed)** |
| `packages/tools/src/builtin.ts` | **EDIT** — remove hand-maintained array (`:380`); keep definitions; re-export from generated |
| `packages/tools/src/auto-discover.ts` | **EDIT** — rewrite dead name-only scanner → real `loadCustomTools(reg, dir)` |
| `packages/tools/src/index.ts` | **EDIT** — re-export `builtinTools` from generated; export `loadCustomTools` |
| `packages/tools/src/builtin-completeness.test.ts` | **EDIT** — drop `.toBe(25)`; structural + core-set assertions |
| `packages/tools/src/registry-discovery.test.ts` | **NEW** — convention discovery tests |
| `package.json` (root) | **EDIT** — `"gen:tools"` + chain into `prebuild` |
| `packages/agent/src/index.ts` | **NO CHANGE** (still imports `builtinTools`) |
| `packages/print/src/mya-bridge.ts` | **NO CHANGE** |

---

## 5. Effort & risk
**Effort: M.** Mechanics are small (one codegen script + one generated file + test updates), but TS-AST symbol detection + spread arrays + prebuild wiring + migrating 25 exports without breaking the suite is careful work.

**Risks:**
1. **Bundling (high-impact, low-likelihood):** forgetting `gen:tools` before bundle. Mitigated by chaining in package.json + CI drift check.
2. **False-green typecheck:** codegen emits bad import → tsc catches it (file in tsconfig). TS-API typecheck in generator adds a second layer. Stronger than current state.
3. **Convention drift:** dynamically-built tools (e.g. `composio.ts:143` `const impl: ToolImpl = {...}` inside a function) correctly excluded (not static top-level exports) → registered explicitly as today. Composio path unaffected.
4. **Circular import:** generated file imports from `./registry.js` (type-only, erased) + tool modules (already import `ok`/`err` without cycles). No new cycle.

---

## 6. Test plan (NO TEST = NO MERGE)

### `packages/tools/src/registry-discovery.test.ts` (NEW) `[unit]`
- "new tool discovered by convention": temp `*.tool.ts` exporting `export const tempTool: ToolImpl` → codegen includes it → importing yields registered tool.
- "removing a file removes the tool": delete temp → regenerate → absent.
- "helper module not treated as tool": file with only a function (no ToolImpl const) → skipped.
- "spread array exports flattened": `export const group: ToolImpl[] = [a,b]` → both in output.
- "generated file is type-valid": `builtinTools` is `ToolImpl[]` with no `undefined` (noUncheckedIndexedAccess).

### `builtin-completeness.test.ts` (EDITED) `[unit]`
Replace `.toBe(25)` with: every entry has `meta.name` + `run` + `requiredMode`; no duplicate names; core set present (read/write/edit/bash/glob/grep/ls/find/replace) **without** pinning total. Optional `toMatchSnapshot(sorted names)`.

### `auto-discover.test.ts` (EDITED)
`loadCustomTools(reg, dir)` registers real ToolImpls via dynamic import; garbage files skipped; `isToolImpl` guard rejects non-tools.

### Generator idempotency + drift (CI)
- `gen-builtin-tools.mjs` run twice = byte-identical.
- CI: `npm run gen:tools && git diff --exit-code` on `builtin.generated.ts`.

---

## 7. Honest assessment

**Partially worth it. Benefit is real but smaller than in Hermes — mya has 25 tools (stable), not 99 (growing).**

**What mya gains:**
- Removes the manual count-sync tax (hardcoded `.toBe(25)` + array + test on every add/remove).
- Formalizes an existing convention (most tools already `export const xxxTool: ToolImpl`).
- Closes the dead-code gap (`auto-discover.ts` exported but useless — finish or delete).
- Better SDK/plugin DX (`MYA_TOOLS_DIR`): real loader lets users drop tools without touching core.

**What mya pays:**
- New build step + generated file (determinism surface, CI drift check).
- Post-bundle, runtime discovery impossible — headline Hermes property ("just add a file, runtime finds it") only holds at **build** time, not runtime in the shipped `mya` binary.

**Recommendation:** Do Option A as a DX/consistency improvement, not a scale fix:
1. Build-time codegen for the bundled CLI (only approach surviving esbuild + TS-strict).
2. Runtime `loadCustomTools` for SDK/`MYA_TOOLS_DIR` only (replace dead auto-discover).
3. Do NOT introduce a global singleton or import side-effects — mya's per-agent ToolRegistry + explicit `register()` is a deliberate design (better testability, no hidden global state). Preserve it.
4. If minimal change preferred, **Option B (centralized barrel)** gives ~80% benefit at S effort with zero new tooling — a legitimate fallback for 25 tools.

**Bottom line:** For mya's current size, this is a *nice-to-have refactor*, not a scaling necessity. Strongest justification = closing the `auto-discover.ts` dead-code gap + removing the brittle hardcoded-count test.
