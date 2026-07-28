# Typecheck Baseline & the False-Green Fix

> Why `npm run typecheck` used to be a **false green**, what it is now, and the
> pre-existing error backlog.

## The bug: root typecheck checked ZERO files

The root `tsconfig.json` uses `"files": []` + `references` (25 project refs).
In **non-build mode**, `tsc --noEmit` with `"files": []` checks **zero** files —
`references` are only followed by `tsc -b` (build mode). So the old
`"typecheck": "tsc --noEmit"` passed trivially while hiding every per-package
type error. This shipped a real bug: a `TS2352` cast error in
`packages/memory/src/brain-sqlite-store.ts` (Dig 3 Phase B) was invisible to the
root typecheck and only caught by a cold review running per-package `tsc`.

Why not just `tsc --build --noEmit`? It's **broken** here: build mode requires
referenced composite projects to emit, so `--noEmit` throws `TS6310` ("Referenced
project may not disable emit") for every inter-package reference and never
type-checks source. `tsc -b` (incremental) is also unreliable — exit 0 when the
`tsbuildinfo` cache is warm. Only `tsc -b --force` is fully honest (but emits
artifacts and is slow).

## The fix: per-package typecheck (`scripts/typecheck.mjs`)

`npm run typecheck` now runs `tsc --noEmit -p packages/<pkg>/tsconfig.json` per
package (concurrency-limited) and aggregates. It is **honest** — exits non-zero
if any package has errors.

| Command | Scope | Catches new errors? |
|---------|-------|---------------------|
| `npm run typecheck` | all packages | ✅ (honest; red until backlog cleared) |
| `npm run typecheck:owned` | project-owned (excludes vendored coding-agent/pi-ai-src/pi-agent-src) | ✅ |
| `node scripts/typecheck.mjs --pkg memory` | one package (fast dev loop) | ✅ |
| `node scripts/typecheck.mjs --json` | machine-readable | ✅ |

**Proven:** planting `const x: number = "bad"` in a clean package is reported
(1 error), and removed returns to clean. The false-green is gone.

## Pre-existing backlog (census)

`npm run typecheck:owned` today (vendored excluded):

**17 clean packages** (0 errors): acp, agent, channels, collab, council, dap,
dap-server, desktop, natives, pkg, rpc, secrets, signing, skills, sync, tts, tui.

**13 packages with errors:**

| Package | Errors | Notes |
|---------|-------:|-------|
| print | 1784 | ⚠️ **mostly vendored-dep noise** — print imports `coding-agent`/`pi-ai-src` *source* directly (not compiled `.d.ts`), so ~1755 of these are vendored errors surfacing through print's imports. Print's **own source** has ~29. |
| prompts | 37 | 26 src + 11 test |
| memory | 11 | all test files |
| tools | 9 | all test files |
| audit | 6 | all test files |
| core | 6 | all test files |
| gateway | 4 | all test files |
| x402 | 4 | all test files |
| eval | 3 | all test files |
| workflows | 2 | src files |
| ai | 1 | src file |
| cron | 1 | test file |
| web | 1 | config (baseUrl) |

**Vendored (excluded by `--owned`):** `coding-agent` (~1556), `pi-ai-src` (~302),
`pi-agent-src` (~139) ≈ **~1997 errors (93% of the total `tsc -b --force` count
of ~2149)**. These are forked pi code the project does not own type-by-type.

**Real project-owned errors** (excluding print's vendored-dep noise): **~120**,
concentrated in `prompts` (src) + assorted **test files**. These are the
actionable backlog.

## How to use it

- **Dev fast loop:** `node scripts/typecheck.mjs --pkg <your-pkg>` — sub-second,
  checks one package. (This is what caught every Dig 3 issue.)
- **Before commit/PR:** `npm run typecheck:owned` — full project-owned sweep in
  ~13s. Don't expect green yet (backlog); watch that YOUR package's count didn't
  increase.
- **CI gate (future):** a regression gate would snapshot this baseline and fail
  only on *new* errors. Not built yet — the honest script is the prerequisite.

## Known limitations / follow-ups

1. **print's 1784 noise** is because print reaches into vendored `coding-agent`
   source. Fixing print's `tsconfig` (e.g., `paths` to compiled output, or
   excluding vendored imports) would collapse print to ~29 real errors — a
   separate effort.
2. **Vendored packages** (coding-agent/pi-ai-src/pi-agent-src) lack
   `composite: true` and are not type-clean; they're excluded by `--owned`.
3. **Unreferenced composite packages** (channels, signing, dap-server, desktop)
   have `composite: true` but aren't in root `references` — possibly accidental
   omissions worth adding.
