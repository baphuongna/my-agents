# Migration Plan: Vendored pi Fork → Real npm Packages

**Status**: Ready for execution
**Prerequisite doc**: `docs/migration-vendored-to-real-pi.md` (feasibility research)
**Goal**: Delete vendored pi source packages, depend on real `@earendil-works/pi-*` npm packages.

---

## Overview

| Phase | Scope | Files | Effort | Risk |
|-------|-------|-------|--------|------|
| 0 | Version upgrade 0.80.6 → 0.83.0 | 2 | 0.5 day | Low |
| 1 | Import path migration (pi-agent-core + pi-ai) | ~55 | 1 day | Medium |
| 2 | SDK wrapper + extension loader aliases | 2 | 0.5 day | High |
| 3 | Delete pi-agent-src + pi-ai-src | 0 | 0.5 day | Low |
| **Core total** | | **~59** | **~2.5 days** | |
| 4 | TUI migration | ~60 | 1 day | High |
| 5 | vendored/ cleanup | 1 | 0.5 day | Low |
| **Grand total** | | **~120** | **~4.5 days** | |

---

## Phase 0: Version Prerequisites

### 0.1 — Pin exact versions in root `package.json`

**File**: `package.json`

```diff
- "@earendil-works/pi-coding-agent": "^0.80.6",
- "@earendil-works/pi-tui": "^0.80.6",
+ "@earendil-works/pi-coding-agent": "0.83.0",
+ "@earendil-works/pi-agent-core": "0.83.0",
+ "@earendil-works/pi-ai": "0.83.0",
+ "@earendil-works/pi-tui": "0.83.0",
```

### 0.2 — Install

```bash
npm install
```

### 0.3 — Verify

```bash
node -e "console.log(require('@earendil-works/pi-agent-core/package.json').version)"  # → 0.83.0
node -e "console.log(require('@earendil-works/pi-ai/package.json').version)"          # → 0.83.0
node -e "const {setDefaultStreamFn} = require('@earendil-works/pi-agent-core'); console.log(typeof setDefaultStreamFn)"  # → function
```

### Gate AC0
- [ ] `@earendil-works/pi-agent-core@0.83.0` resolves in `node_modules/`
- [ ] `@earendil-works/pi-ai@0.83.0` resolves in `node_modules/`
- [ ] `setDefaultStreamFn` importable from `@earendil-works/pi-agent-core`
- [ ] Existing test suite still passes (no behavior change yet)

---

## Phase 1: Import Path Migration (pi-agent-core + pi-ai)

### 1.1 — Bulk search-replace (EXCLUDE loader.ts)

**Scope**: All `.ts` files in `packages/coding-agent/src/` EXCEPT `core/extensions/loader.ts`
(the loader needs manual editing — see Phase 2).

```bash
# Find affected files (exclude loader.ts + tests)
FILES=$(grep -rlE '@my-agent/(pi-agent-core|pi-ai)' packages/coding-agent/src/ \
  --include="*.ts" | grep -v test | grep -v "extensions/loader.ts")

# Replace — order matters: pi-agent-core first (longer prefix), then pi-ai (catches subpaths)
sed -i 's|@my-agent/pi-agent-core|@earendil-works/pi-agent-core|g' $FILES
sed -i 's|@my-agent/pi-ai|@earendil-works/pi-ai|g' $FILES
```

**Import patterns covered** (all are prefix-matched by the two sed rules):
| Old | New |
|-----|-----|
| `@my-agent/pi-agent-core` | `@earendil-works/pi-agent-core` |
| `@my-agent/pi-ai` | `@earendil-works/pi-ai` |
| `@my-agent/pi-ai/compat` | `@earendil-works/pi-ai/compat` |
| `@my-agent/pi-ai/oauth` | `@earendil-works/pi-ai/oauth` |
| `@my-agent/pi-ai/bun-oauth` | `@earendil-works/pi-ai/bun-oauth` |
| `@my-agent/pi-ai/providers/all` | `@earendil-works/pi-ai/providers/all` |
| `@my-agent/pi-ai/bedrock-provider` | `@earendil-works/pi-ai/bedrock-provider` |

**Files affected**: ~55 files (32 pi-agent-core + 44 pi-ai, overlap = ~55 unique)

**Also catches**:
- `declare module "@my-agent/pi-agent-core"` in `messages.ts:70` → `@earendil-works/pi-agent-core` ✓

### 1.2 — Update coding-agent package.json dependencies

**File**: `packages/coding-agent/package.json`

```diff
  "dependencies": {
+   "@earendil-works/pi-agent-core": "0.83.0",
+   "@earendil-works/pi-ai": "0.83.0",
    "@my-agent/ai": "*",
    "@my-agent/tui": "*",
    "@my-agent/core": "*"
  }
```

### 1.3 — Remove tsconfig project references

**File**: `packages/coding-agent/tsconfig.json`

```diff
  "references": [
-   { "path": "../pi-ai-src" },
-   { "path": "../pi-agent-src" },
    { "path": "../tui" }
  ]
```

(Keep `../tui` reference — that's Phase 4.)

### Gate AC1
- [ ] `grep -r '@my-agent/pi-agent-core' packages/coding-agent/src/ | grep -v loader.ts | grep -v test` → 0 hits
- [ ] `grep -r '@my-agent/pi-ai' packages/coding-agent/src/ | grep -v loader.ts | grep -v test` → 0 hits
- [ ] `npx tsc --noEmit -p packages/coding-agent/tsconfig.json` → 0 errors (excluding pre-existing)
- [ ] `npx vitest run packages/coding-agent/ --testTimeout=5000` → 0 failures

---

## Phase 2: SDK Wrapper + Extension Loader

This phase handles the two files that CANNOT be blanket-sed'd.

### 2.1 — sdk.ts: Verify extensionFactories wrapper

**File**: `packages/coding-agent/src/core/sdk.ts`

The current sdk.ts already wraps `DefaultResourceLoader` with `extensionFactories`:

```typescript
// Line ~188 (after Phase 1 sed):
resourceLoader = new DefaultResourceLoader({
  cwd, agentDir, settingsManager,
  extensionFactories: options.extensionFactories
});
```

**Action**: Verify `DefaultResourceLoader` (now from `@earendil-works/pi-agent-core`) accepts `extensionFactories` in its options. The real pi 0.83.0's `DefaultResourceLoaderOptions` has this field (confirmed in research).

If the import path was already changed by Phase 1 sed (sdk.ts imports `DefaultResourceLoader` from `@my-agent/pi-agent-core` → now `@earendil-works/pi-agent-core`), this should just work.

**Verify**: `grep "DefaultResourceLoader" packages/coding-agent/src/core/sdk.ts` — import should be from `@earendil-works/pi-agent-core`.

### 2.2 — loader.ts: Manual alias update (CRITICAL)

**File**: `packages/coding-agent/src/core/extensions/loader.ts`

This file has THREE layers that need different treatment:

#### Layer A — Top-level imports (CHANGE source, lines 10-14)

```diff
- import * as _bundledPiAgentCore from "@my-agent/pi-agent-core";
+ import * as _bundledPiAgentCore from "@earendil-works/pi-agent-core";
  import type { Provider } from "@my-agent/pi-ai";  // NOTE: type-only, see below
- import * as _bundledPiAiCompat from "@my-agent/pi-ai/compat";
+ import * as _bundledPiAiCompat from "@earendil-works/pi-ai/compat";
- import * as _bundledPiAiOauth from "@my-agent/pi-ai/oauth";
+ import * as _bundledPiAiOauth from "@earendil-works/pi-ai/oauth";
- import * as _bundledPiAiProviders from "@my-agent/pi-ai/providers/all";
+ import * as _bundledPiAiProviders from "@earendil-works/pi-ai/providers/all";
```

**Line 11** (type-only import):
```diff
- import type { Provider } from "@my-agent/pi-ai";
+ import type { Provider } from "@earendil-works/pi-ai";
```

#### Layer B — VIRTUAL_MODULES (KEEP old keys + ADD new keys, lines 48-71)

**Keep** all existing `@my-agent/*` and `@mariozechner/*` keys (backward compat for extensions).

**Add** new `@earendil-works/*` keys that point to the same modules:

```typescript
const VIRTUAL_MODULES: Record<string, unknown> = {
  // === KEEP existing (backward compat) ===
  "@my-agent/pi-agent-core": _bundledPiAgentCore,
  "@my-agent/tui": _bundledPiTui,
  "@my-agent/pi-ai": _bundledPiAiCompat,
  "@my-agent/pi-ai/compat": _bundledPiAiCompat,
  "@my-agent/pi-ai/oauth": _bundledPiAiOauth,
  "@my-agent/pi-ai/providers/all": _bundledPiAiProviders,
  "@mariozechner/pi-agent-core": _bundledPiAgentCore,
  "@mariozechner/pi-tui": _bundledPiTui,
  "@mariozechner/pi-ai": _bundledPiAiCompat,
  "@mariozechner/pi-ai/compat": _bundledPiAiCompat,
  "@mariozechner/pi-ai/oauth": _bundledPiAiOauth,
  "@mariozechner/pi-ai/providers/all": _bundledPiAiProviders,
  "@earendil-works/pi-coding-agent": _bundledPiCodingAgent,
  "@mariozechner/pi-coding-agent": _bundledPiCodingAgent,

  // === ADD new (forward compat) ===
  "@earendil-works/pi-agent-core": _bundledPiAgentCore,
  "@earendil-works/pi-tui": _bundledPiTui,
  "@earendil-works/pi-ai": _bundledPiAiCompat,
  "@earendil-works/pi-ai/compat": _bundledPiAiCompat,
  "@earendil-works/pi-ai/oauth": _bundledPiAiOauth,
  "@earendil-works/pi-ai/providers/all": _bundledPiAiProviders,
};
```

#### Layer C — getAliases() (UPDATE specifiers, lines 82-140)

The `resolveWorkspaceOrImport` calls try workspace paths first, then fall back to npm resolution. After deleting vendored packages, workspace paths won't exist — must update specifiers.

```diff
- const piAgentCoreEntry = resolveWorkspaceOrImport("agent/dist/index.js", "@my-agent/pi-agent-core");
+ const piAgentCoreEntry = resolveWorkspaceOrImport("agent/dist/index.js", "@earendil-works/pi-agent-core");
```

```diff
- const piTuiEntry = resolveWorkspaceOrImport("tui/dist/index.js", "@my-agent/tui");
+ const piTuiEntry = resolveWorkspaceOrImport("tui/dist/index.js", "@earendil-works/pi-tui");
```

```diff
- const piAiCompatEntry = resolveWorkspaceOrImport("ai/dist/compat.js", "@my-agent/pi-ai/compat");
+ const piAiCompatEntry = resolveWorkspaceOrImport("ai/dist/compat.js", "@earendil-works/pi-ai/compat");
```

```diff
- const piAiOauthEntry = resolveWorkspaceOrImport("ai/dist/oauth.js", "@my-agent/pi-ai/oauth");
+ const piAiOauthEntry = resolveWorkspaceOrImport("ai/dist/oauth.js", "@earendil-works/pi-ai/oauth");
```

```diff
- const piAiProvidersEntry = resolveWorkspaceOrImport("ai/dist/providers/all.js", "@my-agent/pi-ai/providers/all");
+ const piAiProvidersEntry = resolveWorkspaceOrImport("ai/dist/providers/all.js", "@earendil-works/pi-ai/providers/all");
```

**Keep** the `_aliases` object keys as-is (`@my-agent/*`, `@mariozechner/*`) — these are runtime alias names for jiti, not import specifiers.

**Add** new alias entries:
```typescript
_aliases["@earendil-works/pi-agent-core"] = piAgentCoreEntry;
_aliases["@earendil-works/pi-tui"] = piTuiEntry;
_aliases["@earendil-works/pi-ai"] = piAiCompatEntry;
_aliases["@earendil-works/pi-ai/compat"] = piAiCompatEntry;
_aliases["@earendil-works/pi-ai/oauth"] = piAiOauthEntry;
_aliases["@earendil-works/pi-ai/providers/all"] = piAiProvidersEntry;
```

### Gate AC2
- [ ] `npx tsc --noEmit -p packages/coding-agent/tsconfig.json` → 0 new errors
- [ ] Extension loading works in dev mode: `MYA_BIN= node -e "..."` (load a test extension)
- [ ] `npx vitest run packages/coding-agent/ --testTimeout=5000` → 0 failures
- [ ] `npm run bundle` → exit 0

---

## Phase 3: Delete Vendored Packages

### 3.1 — Delete source directories

```bash
rm -rf packages/pi-agent-src/
rm -rf packages/pi-ai-src/
```

### 3.2 — Update root package.json workspace (if needed)

Check if `packages/pi-agent-src` and `packages/pi-ai-src` are listed in workspace `packages` array:

```bash
grep -n "pi-agent-src\|pi-ai-src" package.json
```

If listed, remove them from the workspace array.

### 3.3 — Full verification

```bash
# Typecheck
node scripts/typecheck.mjs

# Full test suite
npx vitest run --testTimeout=5000

# Bundle
npm run bundle

# Smoke test the binary
dist/mya.js --version
dist/mya.js --help
```

### Gate AC3
- [ ] `packages/pi-agent-src/` does not exist
- [ ] `packages/pi-ai-src/` does not exist
- [ ] `node scripts/typecheck.mjs` → exit 0 (excluding pre-existing baseline)
- [ ] `npx vitest run --testTimeout=5000` → 0 failures (6400+ tests)
- [ ] `npm run bundle` → exit 0
- [ ] `dist/mya.js --version` → prints version

---

## Phase 4: TUI Migration (DEFERRED — can be separate PR)

### 4.1 — Bulk search-replace

**Scope**: All `.ts` files in `packages/coding-agent/src/` (including loader.ts aliases).

```bash
# Find affected files
FILES=$(grep -rl '@my-agent/tui' packages/coding-agent/src/ --include="*.ts" | grep -v test | grep -v "extensions/loader.ts")

# Replace
sed -i 's|@my-agent/tui|@earendil-works/pi-tui|g' $FILES
```

**Files affected**: ~60 files (64 import lines)

**Also catches**:
- `declare module "@my-agent/tui"` in `keybindings.ts:60` → `@earendil-works/pi-tui` ✓

### 4.2 — Update loader.ts (manual)

- Change import line 16: `from "@my-agent/tui"` → `from "@earendil-works/pi-tui"`
- Add `"@earendil-works/pi-tui": _bundledPiTui` to VIRTUAL_MODULES
- Update `resolveWorkspaceOrImport` call for tui
- Add `"@earendil-works/pi-tui"` to `_aliases`

### 4.3 — Update coding-agent dependencies

**File**: `packages/coding-agent/package.json`

```diff
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.83.0",
    "@earendil-works/pi-ai": "0.83.0",
+   "@earendil-works/pi-tui": "0.83.0",
    "@my-agent/ai": "*",
-   "@my-agent/tui": "*",
    "@my-agent/core": "*"
  }
```

### 4.4 — Remove tsconfig reference

**File**: `packages/coding-agent/tsconfig.json`

```diff
  "references": [
-   { "path": "../tui" }
  ]
```

### 4.5 — Delete tui package

```bash
rm -rf packages/tui/
```

### 4.6 — Update root package.json workspace

Remove `packages/tui` from workspace array if listed.

### Gate AC4
- [ ] `grep -r '@my-agent/tui' packages/coding-agent/src/ | grep -v loader.ts | grep -v test` → 0 hits
- [ ] `packages/tui/` does not exist
- [ ] TUI renders correctly (visual smoke test)
- [ ] Full test suite passes

---

## Phase 5: vendored/ Cleanup (DEFERRED)

### 5.1 — Fix shared-instances.ts require path

**File**: `packages/print/src/shared-instances.ts:236`

```diff
- const mod = requireFn(`../../../vendored/pi-ai/dist/providers/${cfg.providerId}.js`);
+ const mod = requireFn(`@earendil-works/pi-ai/dist/providers/${cfg.providerId}.js`);
```

**Note**: `createRequire(import.meta.url)` resolves bare specifiers from node_modules. Verify this works with the real package path. If not, use:

```typescript
const piAiPath = require.resolve("@earendil-works/pi-ai");
const piAiDir = path.dirname(piAiPath);
const mod = requireFn(path.join(piAiDir, "providers", `${cfg.providerId}.js`));
```

### 5.2 — Delete vendored/ directory

```bash
# Check what's in vendored/ first
ls vendored/

# Delete pi-related vendored dirs
rm -rf vendored/pi
rm -rf vendored/pi-agent-core
rm -rf vendored/pi-ai
```

### Gate AC5
- [ ] `shared-instances.ts` loads providers from `@earendil-works/pi-ai`
- [ ] Council provider detection works
- [ ] `vendored/pi*` directories deleted

---

## Rollback Strategy

### If Phase 1-2 fails (import resolution)

```bash
git checkout -- .
npm install  # restores 0.80.6
```

### If Phase 3 fails (after deleting packages)

```bash
# Restore deleted packages from git
git checkout -- packages/pi-agent-src/ packages/pi-ai-src/
npm install
```

### Safety: commit after each phase

```bash
# After Phase 0
git add -A && git commit -m "migration: pin @earendil-works/pi-* at 0.83.0"

# After Phase 1
git add -A && git commit -m "migration: remap pi-agent-core + pi-ai imports to @earendil-works/*"

# After Phase 2
git add -A && git commit -m "migration: update sdk wrapper + extension loader aliases"

# After Phase 3
git add -A && git commit -m "migration: delete vendored pi-agent-src + pi-ai-src"

# After Phase 4
git add -A && git commit -m "migration: remap tui imports + delete packages/tui"

# After Phase 5
git add -A && git commit -m "migration: cleanup vendored/ directory"
```

---

## Verification Commands Cheat Sheet

```bash
# Check for remaining vendored imports (should be 0 after each phase)
grep -rn '@my-agent/pi-agent-core' packages/coding-agent/src/ --include="*.ts" | grep -v test | grep -v loader.ts
grep -rn '@my-agent/pi-ai' packages/coding-agent/src/ --include="*.ts" | grep -v test | grep -v loader.ts
grep -rn '@my-agent/tui' packages/coding-agent/src/ --include="*.ts" | grep -v test | grep -v loader.ts

# Per-package typecheck
npx tsc --noEmit -p packages/coding-agent/tsconfig.json

# Honest typecheck (all packages)
node scripts/typecheck.mjs

# Full test suite
npx vitest run --testTimeout=5000

# Bundle
npm run bundle

# Binary smoke test
MYA_BIN=$(pwd)/dist/mya.js dist/mya.js --version
```

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Type resolution differs (.ts source → .d.ts dist) | Run typecheck immediately after Phase 1 |
| Extension loader aliases break silently | Test extension loading in dev + bundle mode |
| `extensionFactories` option missing from real pi | Already in `DefaultResourceLoaderOptions` (verified) |
| `resolveWorkspaceOrImport` workspace paths fail | Falls back to `import.meta.resolve()` (npm resolution) |
| Bundle includes wrong pi version | Verify `dist/mya.js` imports from `@earendil-works/pi-*` |
| Test snapshots reference old import paths | Update snapshots after Phase 1 |

---

## Post-Migration Benefits

1. **No sync burden** — pi updates = `npm update @earendil-works/pi-coding-agent`
2. **Always current** — no fork lag (currently 0.82.0 fork vs 0.83.0 real)
3. **Clean dependency tree** — pi is a proper npm dependency, not vendored source
4. **Smaller monorepo** — delete ~200+ vendored source files
5. **Agent-agnostic ready** — pi is a swappable engine, not embedded source
