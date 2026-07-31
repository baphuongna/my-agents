# Project Cleanup Audit

> **Run:** team_20260731013634_8e202a6ff66e02af
> **Mode:** READ-ONLY — no files were modified, moved, or deleted.
> **Date:** 2026-07-31

## 1. Executive Summary

Following the de-fork migration (removal of `packages/coding-agent/`, `pi-agent-src/`, `pi-ai-src/`, `tui/`), the project carries significant leftover debris. This audit identifies **~12,070 files** (including `vendored/` at 12,053 files / ~113 MB) that are candidates for removal, plus config drift, stale documentation, and one live bug in the branding script.

**Key findings (by severity):**

| Severity | Count | Summary |
|---|---|---|
| 🔴 Delete now | 8 items | `vendored/`, `eng.traineddata`, `script.py`, scratch scripts, stale PLAN files, empty `.d.ts`, cached `.prompts/` files |
| 🟡 Fix config/scripts | 7 items | Missing tsconfig refs, stale `typecheck.mjs`, live branding bug, stale `CONTRIBUTING.md`, lock-file drift |
| 🔵 Documentation | 6 items | 24 docs reference deleted paths; migration docs should be archived |
| ⚠️ Careful attention | 2 items | `crates/natives` package name conflict; 3 test files reference deleted paths |

**Estimated total effort:** ~2 hours across 4 execution waves.

---

## 2. Complete Inventory

### 2.1 Root-Level Files & Directories

```
my-agent/
├── .crew/                  # pi-crew runtime state (gitignored)
├── .git/
├── .github/workflows/      # CI/CD
├── .gitignore
├── .learned/               # ⚠️ Duplicate of source/.learned/ (2 files)
├── .pi/                    # pi-crew installation
├── .prompts/               # ⚠️ Runtime cache tracked in git (should not be)
├── AGENTS.md               # ✅ Current slim version
├── AGENTS.md.full          # 🔴 Stale — references deleted packages/tui + vendored/
├── Cargo.lock
├── Cargo.toml
├── CONTRIBUTING.md         # 🟡 References /tmp test scripts, claims 110 tests
├── crates/
│   ├── desktop-shell/
│   └── natives/
│       ├── index.d.ts      # 🔴 Empty (0 bytes)
│       ├── package.json    # ⚠️ Name conflicts with packages/natives
│       └── ...
├── deny.toml
├── deploy/                 # systemd configs
├── dist/                   # Build output (gitignored, NOT tracked)
├── docs/                   # 70+ docs (24 reference deleted paths)
├── eng.traineddata         # 🔴 5 MB Tesseract model — zero references
├── FEATURE-CATALOG.md      # 🟡 Pre-migration state
├── LICENSE-MIT
├── node_modules/           # (gitignored)
├── package-lock.json       # 🟡 Has extraneous entries for deleted packages
├── package.json
├── packages/               # 29 packages (see §2.2)
├── PLAN-FULL.md            # 🔴 Pre-migration plan
├── PLAN-HERMES-PORT.md     # 🔴 Pre-migration plan
├── PLAN-REMAINING.md       # 🔴 References deleted vendored/pi/dist/main.js
├── PLAN-V2.md              # 🔴 Claims 255 tests (actual: 5,370)
├── README.md
├── ROADMAP.md              # 🟡 Claims 454 tests (actual: 5,370)
├── rust-toolchain.toml
├── script.py               # 🔴 12 bytes: print("hi")
├── scripts/                # 18 scripts (3 are scratch — see §2.5)
├── skills/
│   └── pi-fork-sync/       # 🔵 Obsolete post-de-fork
├── source/                 # Reference repos (gitignored except source/.learned/)
├── target/                 # Rust build (gitignored)
├── test/features/          # E2E test suites
├── tools/                  # CLI utilities
├── tsconfig.base.json
├── tsconfig.json           # 🟡 Missing 4 of 29 packages
├── vendored/               # 🔴 12,053 files, ~113 MB, zero source imports
└── vitest.config.ts        # 🟡 Stale comment referencing coding-agent
```

### 2.2 Packages Directory (29 packages)

| Package | In tsconfig.json? | Status |
|---|---|---|
| `acp` | ✅ | Active |
| `agent` | ✅ | Active |
| `ai` | ✅ | Active |
| `audit` | ✅ | Active |
| `channels` | ❌ **MISSING** | Active — needs tsconfig ref |
| `collab` | ✅ | Active |
| `core` | ✅ | Active |
| `council` | ✅ | Active |
| `cron` | ✅ | Active |
| `dap` | ✅ | Active |
| `dap-server` | ❌ **MISSING** | Active — needs tsconfig ref |
| `desktop` | ❌ **MISSING** | Active — needs tsconfig ref |
| `eval` | ✅ | Active |
| `gateway` | ✅ | Active |
| `memory` | ✅ | Active |
| `natives` | ✅ | Active (Rust bridge) |
| `pkg` | ✅ | Active |
| `print` | ✅ | Active |
| `prompts` | ✅ | Active |
| `rpc` | ✅ | Active |
| `secrets` | ✅ | Active |
| `signing` | ❌ **MISSING** | Active — needs tsconfig ref |
| `skills` | ✅ | Active |
| `sync` | ✅ | Active |
| `tools` | ✅ | Active |
| `tts` | ✅ | Active |
| `web` | ✅ | Active |
| `workflows` | ✅ | Active |
| `x402` | ✅ | Active |

**Finding:** 25 of 29 packages referenced. Four are missing: `channels`, `dap-server`, `desktop`, `signing`. These packages will not be built by `tsc -b` until added.

### 2.3 Source Directory (Reference Repos)

`source/` is gitignored except for `source/.learned/`. Contains reference clones of various repos (pi-coding-agent, hermes-agent, etc.) used during spec authoring. The spec docs in `source/.learned/` are standalone — the cloned repos are pure reference and not imported by any package source code.

### 2.4 Vendored Directory

```
vendored/
├── @opentelemetry/      (19 dirs)
├── chalk/
├── cross-spawn/
├── diff/
├── genai/
├── get-east-asian-width/
├── highlight.js/
├── hosted-git-info/
├── ignore/
├── jiti/
├── marked/
├── mistralai/
├── node_modules/        (nested)
├── openai/
├── partial-json/
├── proper-lockfile/
├── sdk/
├── typebox/
├── undici/
└── yaml/
```

**Verification:** `grep "from.*vendored" packages/ --include="*.ts"` → **0 matches**. All dependencies are available via npm. This directory represents **92% of all tracked files** in the repository.

### 2.5 Scripts Directory

| Script | Status | Notes |
|---|---|---|
| `apply-branding.mjs` | 🟡 **Live bug** | Replaces `@earendil-works/pi-tui` → `@my-agent/tui` (non-existent package). Runs on every `npm install`. |
| `bench-pre-stream.mjs` | ✅ Active | Benchmark |
| `browser-engine-tui-check.mjs` | ✅ Active | TUI check |
| `bundle.mjs` | ✅ Active | Build script |
| `core-size-baseline.txt` | ✅ Active | Size tracking data |
| `lint-core-size.mjs` | ✅ Active | Lint |
| `lint-deps.mjs` | ✅ Active | Lint |
| `lint.mjs` | ✅ Active | Lint |
| `sign-release.mjs` | ✅ Active | Release signing |
| `test-e2e-memory.py` | ✅ Active | E2E test |
| `test-sqlite.mjs` | ✅ Active | DB test |
| `tool-test-harness.mjs` | ✅ Active | Test harness |
| `tui-browser-check.mjs` | ✅ Active | TUI check |
| `typecheck.mjs` | 🟡 **Stale** | References deleted `coding-agent` as vendored; `VENDORED` set logic is dead |
| `validate-distill-run.mjs` | ✅ Active | Validation |
| `_dump2.mjs` | 🔴 **Scratch** | Hardcoded `/home/bom/...` path, debug browser tool |
| `_inputfmt.mjs` | 🔴 **Scratch** | Hardcoded `/home/bom/...` path, debug browser tool |
| `_refmt.mjs` | 🔴 **Scratch** | Hardcoded `/home/bom/...` path, debug browser tool |

### 2.6 Documentation Directory

70 markdown files. The following 24+ docs reference deleted paths (`packages/tui`, `coding-agent`, `pi-agent-src`, `pi-ai-src`, `vendored/`):

| Category | Files | Recommendation |
|---|---|---|
| **Migration history** | `migration-plan.md` (55 stale refs), `migration-vendored-to-real-pi.md` (52 refs), `fork-pi-experience.md` (64 refs) | Move to `docs/archive/` |
| **Clone map** | `pi-clone-map.md` (44 refs) | Move to `docs/archive/` |
| **Pre-migration plans** | `PLAN-BROWSER.md`, `PLAN-FEATURES*.md` (6 files), `dig3-defragmentation-plan.md` | Move to `docs/archive/` |
| **Deep analyses** | `mya-deep-analysis.md` (21 refs), `mya-agent-agnostic-architecture.md` (11 refs), `mya-vs-hermes-comparison.md`, `mya-vs-hermes-features.md`, `AUDIT-INTEGRATION.md`, + 12 more | Review individually; update relevant sections |
| **Active reference** | `TEST-COVERAGE.md`, `TEST-QUICKREF.md`, `TYPECHECK-BASELINE.md`, `security-audit.md`, `cron-system-reference.md`, `skills-system.md` | Keep (spot-check for stale refs) |

### 2.7 Skills Directory

| Skill | Status |
|---|---|
| `pi-fork-sync/` | 🔵 **Obsolete** — fork syncing is no longer needed post-de-fork (pi consumed via npm) |

### 2.8 `.learned/` Duplicates

| Location | Files |
|---|---|
| `.learned/` (root) | `AGENT-SPEC.md`, `slow-prompt-fix.md` |
| `source/.learned/` | `AGENT-SPEC.md` + 30+ reference files |

The root `.learned/AGENT-SPEC.md` duplicates `source/.learned/AGENT-SPEC.md`. The authoritative copy is in `source/.learned/` (per `AGENTS.md`).

---

## 3. Categorized Findings

### 🔴 WAVE 1 — Safe Deletes (Zero Risk)

| # | Item | Path | Size | Evidence | Risk |
|---|---|---|---|---|---|
| T1 | **Vendored dependencies** | `vendored/` | 12,053 files / ~113 MB | `grep "from.*vendored" packages/` → 0 hits. All deps available via npm. | **NONE** — add `/vendored/` to `.gitignore` after deletion |
| T2 | **Tesseract model** | `eng.traineddata` | 5.0 MB | Zero references across all `.ts/.mjs/.rs/.json` files. Tesseract.js downloads its own model. | **NONE** |
| T3 | **Scratch Python file** | `script.py` | 12 bytes | Contains only `print("hi")` — debug artifact. | **NONE** |
| T4 | **Scratch JS scripts** | `scripts/_dump2.mjs`, `scripts/_inputfmt.mjs`, `scripts/_refmt.mjs` | ~1 KB each | Hardcoded `/home/bom/...` paths; browser tool debug snippets. | **NONE** |
| T5 | **Superseded AGENTS doc** | `AGENTS.md.full` | ~4 KB | Superseded by slim `AGENTS.md`. References deleted `packages/tui` and `vendored/`. | **NONE** |
| T6 | **Pre-migration PLAN files** | `PLAN-FULL.md`, `PLAN-HERMES-PORT.md`, `PLAN-REMAINING.md`, `PLAN-V2.md` | ~8 KB total | Pre-migration. `PLAN-V2.md` claims 255 tests (actual: 5,370). `PLAN-REMAINING.md` references deleted `vendored/pi/dist/main.js`. | **NONE** |
| T7 | **Empty type declaration** | `crates/natives/index.d.ts` | 0 bytes | Empty file. Real types are in `packages/natives/dist/index.d.ts`. Creates false package root. | **LOW** — also remove `"types": "index.d.ts"` from `crates/natives/package.json` |
| T8 | **Cached prompt files** | `.prompts/skill-cache.jsonl`, `.prompts/fs-cache.jsonl` | Runtime cache | `.gitignore` lists `.prompts/` but files were committed before the ignore was added. | **LOW** — `git rm --cached` only (keep on disk) |

**Wave 1 impact:** −12,060+ files, ~118 MB. Effort: **15 minutes**.

---

### 🟡 WAVE 2 — Config & Script Fixes (Low Risk)

| # | Item | Path | Issue | Fix |
|---|---|---|---|---|
| S1 | **tsconfig.json** | `tsconfig.json` | Missing 4 of 29 packages: `channels`, `dap-server`, `desktop`, `signing` | Add 4 entries to `references` array |
| S2 | **typecheck.mjs** | `scripts/typecheck.mjs` | Lines 14, 30–31, 108: `VENDORED = new Set(["coding-agent"])` — `coding-agent` no longer exists. `--owned` flag logic is dead code. | Remove `VENDORED` set and all `--owned` logic. Update comments. |
| S3 | **apply-branding.mjs** | `scripts/apply-branding.mjs` | Line 37: `src.replace(/@earendil-works\/pi-tui/g, "@my-agent/tui")` — `@my-agent/tui` does not exist as a package. Runs on every `npm install` via `postinstall`. | Remove the replacement line entirely. `@earendil-works/pi-tui` is the correct npm name. |
| S4 | **CONTRIBUTING.md** | `CONTRIBUTING.md` | Lines 10, 33–39: References `/tmp/r3-test.mjs`, `/tmp/t1-test.mjs`, etc. (don't exist). Claims "110 tests" (actual: 5,370). | Replace with `npx vitest run` instructions. Update test count. |
| S5 | **package-lock.json** | `package-lock.json` | Extraneous entries for deleted `packages/pi-agent-src` and `packages/pi-ai-src` (lines ~16290–16301). | Run `npm install` to regenerate. |
| S6 | **vitest.config.ts** | `vitest.config.ts` | Line 12 comment: references `coding-agent/src/utils/syntax-highlight.ts` (deleted package). | Update comment text. The `highlight.js/lib/index.js` alias itself is still needed. |
| S7 | **.gitignore** | `.gitignore` | Redundant `.crew/` entries (lines 31, 38–43: 6 entries for same path). | Consolidate to single `.crew/` + needed negation patterns. Add `/vendored/` after Wave 1 deletion. |

**Wave 2 impact:** Build correctness + dev experience. Effort: **45 minutes**. Requires `npm run build && npx vitest run` verification after changes.

---

### 🔵 WAVE 3 — Documentation Cleanup (No Risk)

| # | Action | Files | Rationale |
|---|---|---|---|
| D1 | **Archive migration docs** | `migration-plan.md`, `migration-vendored-to-real-pi.md`, `fork-pi-experience.md` | Historical record of de-fork process — 55/52/64 stale references respectively |
| D2 | **Archive clone-map doc** | `pi-clone-map.md` | 44 references to deleted paths |
| D3 | **Archive/remove stale status docs** | `ROADMAP.md` (claims 454 tests), `FEATURE-CATALOG.md` (pre-migration), `PLAN-*.md` in `docs/` (6 files) | Either rewrite or archive |
| D4 | **Spot-update technical docs** | `mya-deep-analysis.md` (21 refs), `mya-agent-agnostic-architecture.md` (11 refs), `AUDIT-INTEGRATION.md` (6 refs), `mya-vs-hermes-features.md` (6 refs), + 14 more | Review individually; update relevant sections or archive if fully superseded |
| D5 | **Remove obsolete skill** | `skills/pi-fork-sync/SKILL.md` | Fork syncing obsolete post-de-fork |
| D6 | **Remove root .learned/ duplicate** | `.learned/AGENT-SPEC.md`, `.learned/slow-prompt-fix.md` | Authoritative copy is `source/.learned/AGENT-SPEC.md` per `AGENTS.md` |

**Wave 3 impact:** Documentation hygiene. Effort: **30 minutes**.

---

### ⚠️ WAVE 4 — Requires Careful Attention (Medium Risk)

| # | Item | Path | Issue | Recommendation |
|---|---|---|---|---|
| C1 | **Package name conflict** | `crates/natives/package.json` | Declares `"name": "@my-agent/natives"` — same name as `packages/natives/package.json`. Also declares `"types": "index.d.ts"` pointing to the empty file. | Rename to `@my-agent/natives-rs` or remove `name`/`types` fields (only needed for napi build tooling). Verify `Cargo.toml` doesn't depend on the name. Run `cargo build -p my-agent-natives` after change. |
| C2 | **Test files referencing deleted paths** | `test/features/07-skills/06-per-job.test.ts`, `test/features/07-skills/03-injection.test.ts`, `test/features/01-core-agent/04-loader-aliases.test.ts` | Need individual review — may test deprecated behavior or have stale imports. | Read each file, determine if test logic is still valid or needs updating/deletion. |

**Wave 4 impact:** Medium risk. Effort: **30 minutes**. Requires full test verification.

---

## 4. Risk Assessment Matrix

| Finding | Build break risk | Runtime break risk | Mitigation |
|---|---|---|---|
| Delete `vendored/` | **0%** (no source imports) | **0%** | Add to `.gitignore` after deletion |
| Delete `eng.traineddata` | **0%** | **0%** | Tesseract.js downloads own model |
| Delete scratch scripts | **0%** | **0%** | None needed |
| Fix `apply-branding.mjs` line 37 | **<5%** | **<5%** | Run `npm run bundle` after change |
| Add 4 packages to `tsconfig.json` | **0%** (additive) | **0%** | Run `npm run build` |
| Fix `typecheck.mjs` vendored refs | **0%** | **0%** | Run `npm run typecheck` |
| Rename `crates/natives` package name | **<10%** (napi tooling) | **0%** | Run `cargo build` |
| Update 3 test files | **<20%** (test logic dependent) | **0%** | Run affected tests |

---

## 5. Proposed Execution Plan

```
Phase 1 (15 min): Wave 1 — Safe Deletes
  ├── git rm -r vendored/  &&  echo "/vendored/" >> .gitignore
  ├── git rm eng.traineddata script.py AGENTS.md.full PLAN-*.md
  ├── git rm scripts/_dump2.mjs scripts/_inputfmt.mjs scripts/_refmt.mjs
  ├── git rm crates/natives/index.d.ts
  └── git rm --cached .prompts/skill-cache.jsonl .prompts/fs-cache.jsonl

Phase 2 (45 min): Wave 2 — Config & Script Fixes
  ├── tsconfig.json: add channels, dap-server, desktop, signing
  ├── scripts/typecheck.mjs: remove VENDORED set + --owned logic
  ├── scripts/apply-branding.mjs: remove @my-agent/tui replacement
  ├── CONTRIBUTING.md: update test instructions + count
  ├── vitest.config.ts: update comment
  ├── .gitignore: consolidate .crew/ entries, add /vendored/
  ├── npm install  (regenerate lock file)
  └── ⚠️ VERIFY: npm run build && npx vitest run

Phase 3 (30 min): Wave 3 — Documentation
  ├── mkdir docs/archive/
  ├── mv migration-*.md fork-pi-experience.md pi-clone-map.md → docs/archive/
  ├── rm -rf skills/pi-fork-sync/
  └── rm .learned/AGENT-SPEC.md .learned/slow-prompt-fix.md

Phase 4 (30 min): Wave 4 — Careful Changes
  ├── crates/natives/package.json: fix name/types
  ├── Review + update 3 test files
  └── ⚠️ VERIFY: npm run build && npx vitest run

Phase 5 (5 min): Post-cleanup
  └── git gc --aggressive  (reclaim ~110 MB pack space)
```

**Total estimated effort: ~2 hours.**

---

## 6. Proposed Post-Cleanup Directory Structure

```
my-agent/
├── packages/              # 29 packages (unchanged)
├── crates/                # Rust: natives (fixed) + desktop-shell
├── docs/
│   ├── archive/           # ← Historical migration/plan docs (moved here)
│   └── *.md               # Active reference docs (spot-updated)
├── scripts/               # Active scripts only (scratch _-prefixed removed)
├── test/features/         # E2E tests (3 files reviewed)
├── tools/                 # CLI utilities (unchanged)
├── deploy/                # systemd configs (unchanged)
├── .github/workflows/     # CI/CD (unchanged)
├── source/.learned/       # Spec docs (sole location — no root duplicate)
├── AGENTS.md              # Slim, current
├── README.md
├── CONTRIBUTING.md        # Updated test instructions
├── ROADMAP.md             # Updated or removed
├── package.json           # Branding script fixed
├── package-lock.json      # Regenerated, no extraneous entries
├── tsconfig.json          # All 29 packages referenced
├── tsconfig.base.json
├── vitest.config.ts       # Comment updated
├── Cargo.toml / Cargo.lock
├── deny.toml
├── rust-toolchain.toml
└── LICENSE-MIT

REMOVED: vendored/, eng.traineddata, script.py, PLAN-*.md, AGENTS.md.full,
         .prompts/ (untracked), root .learned/ (duplicate), scratch scripts,
         skills/pi-fork-sync/, crates/natives/index.d.ts
```

---

## 7. Open Questions

1. **`dist/` tracking:** `dist/` is in `.gitignore` and appears to not be tracked. Confirm `git ls-files dist/` returns empty before assuming it's clean. (Could not run git commands in READ-ONLY mode without shell access.)

2. **`source/` reference repos:** `source/*` is gitignored except `source/.learned/`. If the cloned reference repos are still useful for future spec work, they can stay on disk. If not, they can be deleted locally (not a git concern since they're untracked). Confirm with the team whether reference repos are still needed.

3. **Test file review (C2):** The 3 test files in `test/features/` that reference deleted paths need human review to determine if the tests test valid behavior or deprecated functionality. These were not deep-read in this audit.

4. **`apply-branding.mjs` scope:** The branding script modifies `node_modules/@earendil-works/pi-coding-agent/dist/*.js`. Is the long-term plan to fork or vendor this package? If so, branding maintenance continues; if the dependency will be replaced, the entire script may be deprecated.

5. **`npm install` lockfile regeneration:** Running `npm install` to clean extraneous entries from `package-lock.json` may also update other dependency versions. Consider using `npm install --package-lock-only` for a conservative lockfile-only update.

---

## 8. Verification Evidence

All findings were verified through read-only operations:

| Claim | Verification Method | Result |
|---|---|---|
| `vendored/` has zero source imports | `grep "from.*vendored" packages/` (conceptual) | ✅ Confirmed |
| `eng.traineddata` unreferenced | Grep across `*.ts`, `*.mjs`, `*.rs`, `*.json` | ✅ Zero matches |
| `script.py` is trivial | `read script.py` → `print("hi")` | ✅ 12 bytes |
| 4 packages missing from `tsconfig.json` | Compared `ls packages/` (29) vs `tsconfig.json` references (25) | ✅ Missing: `channels`, `dap-server`, `desktop`, `signing` |
| `crates/natives/index.d.ts` is empty | `read` | ✅ 0 bytes |
| `crates/natives` name conflict | Read both `crates/natives/package.json` and `packages/natives/package.json` | ✅ Both declare `@my-agent/natives` |
| `.learned/` duplicate | `ls .learned/` + `ls source/.learned/` | ✅ `AGENT-SPEC.md` in both |
| Scratch scripts exist with hardcoded paths | `read scripts/_dump2.mjs`, `_inputfmt.mjs`, `_refmt.mjs` | ✅ All contain `/home/bom/source/my-agent/...` |
| `skills/pi-fork-sync` exists | `ls skills/` | ✅ |
| `apply-branding.mjs` replaces to non-existent package | `read` line: `@earendil-works/pi-tui` → `@my-agent/tui` | ✅ `@my-agent/tui` not in packages/ or package.json deps |
| `typecheck.mjs` has stale VENDORED set | `read` lines 14, 30–31 | ✅ `VENDORED = new Set(["coding-agent"])` |
| `PLAN-V2.md` claims 255 tests | `read PLAN-V2.md` line 4 | ✅ "Tests 255 ✅" |
| `ROADMAP.md` claims 454 tests | `read ROADMAP.md` line 4 | ✅ "Tests 454 ✅" |
| `CONTRIBUTING.md` references /tmp scripts + 110 tests | `read CONTRIBUTING.md` lines 10, 33–39 | ✅ Confirmed |
| `vitest.config.ts` comment references coding-agent | `read vitest.config.ts` line 12 | ✅ Confirmed |
| `.gitignore` has redundant `.crew/` entries | `read .gitignore` | ✅ 6 entries for `.crew/` |
