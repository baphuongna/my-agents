# Migration Feasibility: Vendored pi Fork → Real npm Package

**Status**: Mechanically feasible. No hard API blockers at target version 0.83.0.
**Verdict**: Proceed with phased migration (Phases 0–3 = core, ~3 days; Phases 4–5 = deferred cleanup, ~1.5 days).
**Last updated**: 2026-07-30

---

## TL;DR

| Question | Answer |
|----------|--------|
| Is migration technically possible? | **Yes** — at version 0.83.0, all exported symbols used by coding-agent exist in the real package. |
| Are there hard blockers? | **No** — every gap is version-driven (0.80.6 installed vs 0.83.0 needed) or a mechanical import-path rename. |
| What's the critical prerequisite? | **Upgrade to 0.83.0** — current local install is 0.80.6, which is missing 4 exports. |
| How many files are affected? | ~58 files in `packages/coding-agent/` for pi-agent-core/pi-ai. ~50+ more for TUI (Phase 4). |
| Is the export surface identical? | **Yes** — fork `src/index.ts` is byte-for-byte export-equivalent to real 0.83.0 `dist/index.d.ts` for both sub-packages. |

---

## 1. Current State

### 1.1 Vendored fork packages

| Directory | Workspace name | Source type | Version marker |
|-----------|---------------|-------------|----------------|
| `packages/pi-agent-src/` | `@my-agent/pi-agent-core` | Raw TS source (`main: src/index.ts`) | `0.1.0` |
| `packages/pi-ai-src/` | `@my-agent/pi-ai` | Raw TS source (`main: src/index.ts`) | `0.1.0` |
| `packages/tui/` | `@my-agent/tui` | Raw TS source (`main: src/index.ts`) | `0.80.6` |

### 1.2 Real npm package

| Package | Installed version | Spec in root `package.json` | Target version |
|---------|-------------------|-----------------------------|----------------|
| `@earendil-works/pi-coding-agent` | `0.80.6` | `^0.80.6` | **0.83.0** (exact) |

**⚠️ Critical**: The local `node_modules` install resolves to 0.80.6, which lacks 4 exports needed by the codebase (see §4). The global install at 0.83.0 has all exports. Migration requires upgrading first.

### 1.3 Export surface equivalence (verified)

`packages/pi-agent-src/src/index.ts` is export-equivalent to `@earendil-works/pi-agent-core@0.83.0/dist/index.d.ts`. Every `export *` and named export matches. Same for `packages/pi-ai-src/src/index.ts` vs `@earendil-works/pi-ai@0.83.0/dist/index.d.ts`.

---

## 2. Import Scope

### 2.1 Which packages import from pi

**Only `packages/coding-agent/` imports from the vendored fork.** No other workspace package (`gateway`, `print`, `memory`, `cron`, `web`, `agent`, `tui`, etc.) has direct pi imports. Verified across all `packages/*/src/**/*.ts`.

**Exception**: `packages/print/src/shared-instances.ts:236` dynamically `require()`s `vendored/pi-ai/dist/providers/*.js` — a compiled dist copy, not an import from the workspace package. This is a separate concern (Phase 5).

### 2.2 Import sub-paths used by coding-agent

| Sub-path | Usage |
|----------|-------|
| `@my-agent/pi-agent-core` (main) | Agent core types, tools, session API |
| `@my-agent/pi-ai` (main) | Model/provider types |
| `@my-agent/pi-ai/compat` | Extension compatibility types |
| `@my-agent/pi-ai/oauth` | OAuth auth types |
| `@my-agent/pi-ai/providers/all` | All provider definitions |
| `@my-agent/pi-ai/bedrock-provider` | Bedrock-specific provider |
| `@my-agent/pi-ai/bun-oauth` | Bun runtime OAuth flow |

All seven sub-paths must resolve from the real `@earendil-works/pi-ai` package. Verification needed: the real package's `exports` map must include these sub-paths.

---

## 3. Hidden Migration Touch-Points (not obvious from import grep)

These sites do not show up in `grep "@my-agent/pi"` but **must** be updated:

### 3.1 Missing dependency declarations

`packages/coding-agent/package.json` does NOT declare any pi package as a dependency. The fork resolves only through npm workspace hoisting. After migration:

```json
"dependencies": {
  "@earendil-works/pi-agent-core": "0.83.0",
  "@earendil-works/pi-ai": "0.83.0",
  "@my-agent/ai": "*",
  "@my-agent/tui": "*",
  "@my-agent/core": "*"
}
```

**Verified**: current `package.json` lists only `@my-agent/ai`, `@my-agent/tui`, `@my-agent/core`.

### 3.2 TypeScript project references

`packages/coding-agent/tsconfig.json` references the vendored source projects:

```json
"references": [
  { "path": "../pi-ai-src" },
  { "path": "../pi-agent-src" },
  { "path": "../tui" }
]
```

The `pi-ai-src` and `pi-agent-src` references must be removed. The `tui` reference is part of Phase 4. The real npm packages ship compiled `.d.ts` — TypeScript resolves types without project references.

**Verified**: confirmed in `packages/coding-agent/tsconfig.json`.

### 3.3 `tsconfig.base.json` — no path mappings

`tsconfig.base.json` has NO `paths` mapping for `@my-agent/pi-*`. This is good — there is nothing to clean up here. npm resolution works as-is.

**Verified**: read `tsconfig.base.json` — no `paths` key exists.

### 3.4 Declaration merging (2 sites)

Two `declare module` augmentation sites target fork module names and must be renamed:

| File | Line | Current module name | Target module name |
|------|------|---------------------|-------------------|
| `packages/coding-agent/src/core/messages.ts` | ~70 | `@my-agent/pi-agent-core` | `@earendil-works/pi-agent-core` |
| `packages/coding-agent/src/core/keybindings.ts` | ~60 | `@my-agent/tui` | `@earendil-works/pi-tui` |

**Verified**: confirmed both sites by reading source.

### 3.5 Extension loader dual-aliasing

`packages/coding-agent/src/core/extensions/loader.ts` maps three package-name families in both `VIRTUAL_MODULES` and `getAliases()`:

- `@my-agent/pi-agent-core`, `@my-agent/pi-ai`, `@my-agent/tui`
- `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-tui`
- `@earendil-works/pi-coding-agent` (already mapped)

After migration, `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` (with sub-paths) must be added to both maps. The existing `@my-agent/*` and `@mariozechner/*` aliases should be **retained** for backward compatibility with existing extension files.

### 3.6 sdk.ts MYA-specific customizations

The fork's `sdk.ts` is NOT a verbatim copy of real pi's `sdk.ts`. It has two MYA-specific additions:

1. `extensionFactories?: InlineExtension[]` field on `CreateAgentSessionOptions` — passes to `DefaultResourceLoader` internally
2. `export type { AgentSession }` re-export

The real pi 0.83.0's `CreateAgentSessionOptions` does NOT have `extensionFactories`. Callers must pass it to `DefaultResourceLoader` directly:

```typescript
const resourceLoader = new DefaultResourceLoader({ extensionFactories });
const session = createAgentSession({ resourceLoader, ... });
```

**Recommended**: Keep MYA's `sdk.ts` as a thin wrapper that accepts `extensionFactories` and internally constructs the `DefaultResourceLoader`. This preserves the caller API.

### 3.7 Print package dynamic require

`packages/print/src/shared-instances.ts:236` hard-codes `vendored/pi-ai/dist/providers/*.js`:

```typescript
const mod = requireFn(`../../../vendored/pi-ai/dist/providers/${cfg.providerId}.js`);
```

If `vendored/` is deleted, this breaks. Update to `@earendil-works/pi-ai/dist/providers/` or use a proper import. This is Phase 5.

**Verified**: confirmed by reading the source.

---

## 4. Symbol Gap Analysis

### 4.1 Gap at target version (0.83.0): NONE

At version 0.83.0, every symbol used by coding-agent is exported by the real package. The fork's export surface is identical.

### 4.2 Gap at currently-installed version (0.80.6): 4 symbols missing

The local `node_modules` resolves to 0.80.6, which lacks:

| Symbol | Used by | In 0.80.6? | In 0.83.0? |
|--------|---------|------------|------------|
| `setDefaultStreamFn` | `sdk.ts` | ❌ | ✅ |
| `harness/skills.ts` exports | `index.ts` re-export | ❌ | ✅ |
| `harness/tools/index.ts` exports | `index.ts` re-export | ❌ | ✅ |
| `generateSummaryWithUsage` | compaction | ❌ | ✅ |

**Conclusion**: The only gap is version-driven, not API-driven. Upgrade to 0.83.0 eliminates all gaps.

### 4.3 `extensionFactories` — not a missing export, but a missing option field

`CreateAgentSessionOptions` in real pi 0.83.0 does NOT have an `extensionFactories` field. However, `DefaultResourceLoaderOptions` does. This is a usage-pattern change, not a missing export. See §3.6.

---

## 5. API Evolution Mapping

The fork uses the **current pi API** (not the old `new Agent()` / `streamSimple()` pattern). This is because the fork tracks recent pi upstream. The key API constructs and their status:

| Construct | Status in real 0.83.0 | Notes |
|-----------|-----------------------|-------|
| `createAgentSession()` | ✅ Exported | Primary session creation API |
| `AgentSession` | ✅ Exported | Session type |
| `setDefaultStreamFn()` | ✅ Exported (at 0.83.0) | Stream function injection |
| `DefaultResourceLoader` | ✅ Exported | Resource loading, accepts `extensionFactories` |
| `ExtensionRunner` | ✅ Exported | Extension lifecycle |
| `InlineExtension` | ✅ Exported | Extension pattern: `(pi: MyaPiApi) => void` |
| `ModelRuntime` | ✅ Exported | Model runtime abstraction |
| `ModelRegistry` | ✅ Exported | Model registration |
| `readStoredCredential` | ✅ Exported | Credential access |
| `compact` | ✅ Exported | Conversation compaction |

**No old-API constructs remain** in the fork's export surface. The fork is current.

---

## 6. Extension System Compatibility

### 6.1 Pattern

MYA uses the `InlineExtension` pattern: an extension is a function `(pi: MyaPiApi) => void` that receives a typed API object and registers tools, hooks, etc.

### 6.2 Real pi extension exports

| Type | Exported by 0.83.0? |
|------|---------------------|
| `InlineExtension` | ✅ |
| `ExtensionFactory` | ✅ |
| `ExtensionRunner` | ✅ |
| `DefaultResourceLoader` | ✅ |

### 6.3 Event names

Extension hooks rely on event names (turn_start, turn_end, message_end, tool_call, tool_result, agent_settled, etc.). Since the fork's export surface matches 0.83.0 exactly, event names are compatible. No divergence detected.

### 6.4 Alias resolution

Extensions import from `@my-agent/pi-*`, `@mariozechner/pi-*`, or `@earendil-works/pi-*`. The loader currently handles all three. After migration, `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` aliases must be added. Existing aliases should be retained.

**Risk**: Extension loading happens through jiti alias mapping at runtime. Misconfigured aliases silently fail (extension loads but can't resolve internal imports). Must test extension loading in both dev (Node.js) and Bun binary modes.

---

## 7. Risk Register

| ID | Risk | Severity | Probability | Impact | Mitigation |
|----|------|----------|-------------|--------|------------|
| R1 | **Version mismatch**: local install is 0.80.6, missing 4 exports | 🔴 Critical | Certain if not addressed | Build failure | Pin exact `0.83.0` in root `package.json`, `npm install` |
| R2 | **Source→dist type resolution**: fork uses raw `.ts`, real ships `.d.ts`. TS features (declaration merging, generic inference) may resolve differently | ⚠️ High | Medium | Type errors | Run `tsc --noEmit` immediately after Phase 1 |
| R3 | **TUI coupling**: `@my-agent/tui` used in 50+ files, declaration merging, loader | ⚠️ High | Medium | 50+ file cascade | Phase TUI migration separately (Phase 4) |
| R4 | **Extension loader**: alias misconfiguration silently breaks extensions | ⚠️ High | Medium | Silent feature loss | Test extension loading in dev + Bun modes |
| R5 | **`extensionFactories`**: callers passing it to `createAgentSession()` directly will get TS error | ⚠️ Medium | Certain | Compile error | Move to `DefaultResourceLoader` construction |
| R6 | **Print dynamic require**: hard-coded `vendored/pi-ai/` path breaks if vendored/ deleted | ⚠️ Medium | Certain if vendored/ deleted | Print mode feature loss | Update path or use proper import (Phase 5) |

---

## 8. Unresolved Questions

| ID | Question | Why it matters | Resolution |
|----|----------|----------------|------------|
| U1 | Are `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` available as standalone npm packages, or only as transitive deps of `@earendil-works/pi-coding-agent`? | Determines whether coding-agent can declare direct deps | `npm view @earendil-works/pi-agent-core` |
| U2 | Does `npm-shrinkwrap.json` in `packages/coding-agent/` lock sub-package versions? | Could prevent version upgrade | Read `packages/coding-agent/npm-shrinkwrap.json` |
| U3 | Are there MYA-specific patches to fork source (beyond import name changes)? | Patches would be lost on migration | Diff fork `src/` against upstream pi at matching version |
| U4 | What package names do external user extensions import from? | Migration must not break existing extensions | Test with real-world extension files |
| U5 | Does real `@earendil-works/pi-tui@0.83.0` have breaking API changes vs fork at 0.80.6? | 50+ files affected | Diff `tui/src/index.ts` against 0.83.0 dist (Phase 4) |
| U6 | ~~Does `tsconfig.base.json` have path mappings?~~ | ~~Would override npm resolution~~ | **Resolved**: no `paths` key exists |

---

## 9. Scope Ambiguities (require leader confirmation)

| ID | Ambiguity | Recommended assumption |
|----|-----------|----------------------|
| A1 | Does "delete vendored pi" include `tui/` and `vendored/`? | Phase 1–3 = pi-agent-src + pi-ai-src only. Phase 4 = tui. Phase 5 = vendored/. |
| A2 | Exact `0.83.0` vs caret `^0.83.0`? | Pin exact `0.83.0` initially, relax after smoke testing. |
| A3 | Direct deps in coding-agent or transitive through pi-coding-agent? | Explicit direct deps — safer than transitive. |
| A4 | Keep `extensionFactories` convenience in sdk.ts wrapper? | Yes — thin wrapper preserves caller API. |
| A5 | Remove `@my-agent/*` and `@mariozechner/*` aliases from loader? | No — retain for backward compatibility. |

---

## 10. Migration Plan

### Phase 0: Version Prerequisites (0.5 day)

| Step | Action |
|------|--------|
| 0.1 | Update root `package.json`: `"@earendil-works/pi-coding-agent": "0.83.0"` |
| 0.2 | Add `"@earendil-works/pi-agent-core": "0.83.0"` and `"@earendil-works/pi-ai": "0.83.0"` to root deps (verify they're standalone packages first — U1) |
| 0.3 | `npm install` |
| 0.4 | Verify: `node -e "require('@earendil-works/pi-coding-agent/package.json').version"` returns `0.83.0` |

**Gate**: AC0.1–AC0.4 must pass before proceeding.

### Phase 1: Import Path Migration — pi-agent-core + pi-ai (1–2 days)

| Step | Action | Files |
|------|--------|-------|
| 1.1 | Replace `@my-agent/pi-agent-core` → `@earendil-works/pi-agent-core` | ~58 files in `packages/coding-agent/src/` |
| 1.2 | Replace `@my-agent/pi-ai` → `@earendil-works/pi-ai` (preserve all sub-paths) | Same files |
| 1.3 | Update `declare module` in `messages.ts` | 1 file |
| 1.4 | Add pi deps to `packages/coding-agent/package.json` | 1 file |
| 1.5 | Remove `pi-ai-src` + `pi-agent-src` from `tsconfig.json` references | 1 file |

**Gate**: `grep -r "@my-agent/pi-" packages/coding-agent/src/` returns 0 hits. `node scripts/typecheck.mjs` exits 0.

### Phase 2: SDK + Loader Reconciliation (0.5 day)

| Step | Action |
|------|--------|
| 2.1 | Update `sdk.ts`: keep `extensionFactories` field, internally construct `DefaultResourceLoader` |
| 2.2 | Update `loader.ts` `VIRTUAL_MODULES` + `getAliases()`: add `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai` sub-paths |
| 2.3 | Update `_bundledPiAgentCore` and `_bundledPiAiCompat` imports in `loader.ts` |
| 2.4 | Test extension loading in dev mode (jiti aliases resolve) |
| 2.5 | Test extension loading in Bun binary mode |

### Phase 3: Delete Vendored Packages (0.5 day)

| Step | Action |
|------|--------|
| 3.1 | Delete `packages/pi-agent-src/` |
| 3.2 | Delete `packages/pi-ai-src/` |
| 3.3 | Run full typecheck: `node scripts/typecheck.mjs` |
| 3.4 | Run full test suite: `npx vitest run --testTimeout=5000` (5,370+ tests) |
| 3.5 | Run bundle: `npm run bundle` |

### Phase 4: TUI Migration — DEFERRED (1 day)

| Step | Action |
|------|--------|
| 4.1 | Diff `packages/tui/src/index.ts` against `@earendil-works/pi-tui@0.83.0/dist/index.d.ts` |
| 4.2 | Replace `@my-agent/tui` → `@earendil-works/pi-tui` across 50+ files |
| 4.3 | Update `declare module` in `keybindings.ts` |
| 4.4 | Delete `packages/tui/` |
| 4.5 | Visual smoke test: launch `mya`, verify TUI renders |

### Phase 5: Vendored/ Cleanup — DEFERRED (0.5 day)

| Step | Action |
|------|--------|
| 5.1 | Update `shared-instances.ts:236` require path to `@earendil-works/pi-ai/dist/providers/` |
| 5.2 | Delete `vendored/pi`, `vendored/pi-agent-core`, `vendored/pi-ai` |
| 5.3 | Verify print mode council provider detection |

---

## 11. Effort Summary

| Phase | Scope | Effort | Risk |
|-------|-------|--------|------|
| Phase 0 | Version upgrade | 0.5 day | Low (mechanical) |
| Phase 1 | Import path migration | 1–2 days | Medium (type resolution) |
| Phase 2 | SDK + loader | 0.5 day | Medium (extension loading) |
| Phase 3 | Delete vendored | 0.5 day | Low (verification only) |
| **Core total** | | **3 days** | |
| Phase 4 | TUI migration | 1 day | High (50+ files) |
| Phase 5 | Vendored/ cleanup | 0.5 day | Low |
| **Grand total** | | **4.5 days** | |

---

## 12. Acceptance Criteria Checklist

### Phase 0
- [ ] AC0.1: Root `package.json` pins `@earendil-works/pi-coding-agent` at `0.83.0`
- [ ] AC0.2: `@earendil-works/pi-agent-core@0.83.0` resolves in `node_modules/`
- [ ] AC0.3: `@earendil-works/pi-ai@0.83.0` resolves in `node_modules/`
- [ ] AC0.4: `setDefaultStreamFn` importable from `@earendil-works/pi-agent-core`

### Phase 1
- [ ] AC1.1: Zero `@my-agent/pi-agent-core` in `packages/coding-agent/src/`
- [ ] AC1.2: Zero `@my-agent/pi-ai` in `packages/coding-agent/src/`
- [ ] AC1.3: `declare module "@earendil-works/pi-agent-core"` in `messages.ts`
- [ ] AC1.4: `tsconfig.json` has no `pi-ai-src` or `pi-agent-src` references
- [ ] AC1.5: `npx vitest run packages/coding-agent/test/` — 0 failures
- [ ] AC1.6: `node scripts/typecheck.mjs` — exit 0

### Phase 2
- [ ] AC2.1: `createAgentSession()` accepts `extensionFactories` via wrapper
- [ ] AC2.2: `loader.ts` maps `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`
- [ ] AC2.3: Extension loading works in dev mode
- [ ] AC2.4: Extension loading works in Bun binary mode

### Phase 3
- [ ] AC3.1: `packages/pi-agent-src/` deleted
- [ ] AC3.2: `packages/pi-ai-src/` deleted
- [ ] AC3.3: `npm run typecheck` — exit 0
- [ ] AC3.4: `npx vitest run --testTimeout=5000` — 0 failures
- [ ] AC3.5: `npm run bundle` — exit 0

---

## 13. Evidence Log

All findings independently verified against actual source files:

| Claim | Verification method | Evidence |
|-------|---------------------|----------|
| Fork export surface ≡ real 0.83.0 | Read fork `src/index.ts`, compared against global-install `dist/index.d.ts` | Every `export *` matches |
| Local install is 0.80.6 | Read `node_modules/@earendil-works/pi-coding-agent/package.json` | `"version": "0.80.6"` |
| 0.80.6 lacks `setDefaultStreamFn` | Grep sub-package `index.d.ts` at 0.80.6 | Not found |
| Real 0.83.0 has `setDefaultStreamFn` | Grep sub-package `index.d.ts` at 0.83.0 (global) | `export { setDefaultStreamFn }` |
| `CreateAgentSessionOptions` lacks `extensionFactories` | Read `sdk.d.ts` at 0.83.0 | Field absent; `DefaultResourceLoaderOptions` has it |
| 2 `declare module` augmentation sites | Read `messages.ts:65-80` and `keybindings.ts:55-65` | Both confirmed |
| coding-agent `package.json` lacks pi deps | Read `packages/coding-agent/package.json` | Only `@my-agent/{ai,tui,core}` listed |
| `tsconfig.json` references vendored projects | Read `packages/coding-agent/tsconfig.json` | `references` array confirmed |
| `tsconfig.base.json` has no `paths` | Read `tsconfig.base.json` | No `paths` key |
| Print package uses `vendored/pi-ai/` path | Read `shared-instances.ts:230-245` | `requireFn(\`../../../vendored/pi-ai/dist/providers/${cfg.providerId}.js\`)` |
| Only coding-agent imports from fork | Grep all `packages/*/src/**/*.ts` | No other package matches |
