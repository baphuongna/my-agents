# Contributing to my-agent

## Adding a package

1. `mkdir packages/<name>/src`
2. Create `package.json` (private, type:module, deps on `@my-agent/core` etc.)
3. Create `tsconfig.json` (extends `../../tsconfig.base.json`, references deps)
4. Add to root `tsconfig.json` references + run `npm install`
5. Implement `src/index.ts` (public API)
6. Write tests (`packages/<name>/src/*.test.ts`)
7. `npm run build && npm run typecheck`

## Package conventions

- **ESM only** (`"type": "module"`, `.js` import specifiers in TS).
- **Strict TS**: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, discriminated unions.
- **No `Date.now()` outside `core.time`** (invariant #10 — injectable for tests).
- **No `require()` in ESM** — use named imports from `node:fs` etc.
- **No backticks in JSDoc comments inside template literals** — JS comments don't nest; a `/* */` inside `/** */` closes early (R42 lesson).
- **Rust gate**: only put code in Rust if ≥1 of: trust boundary, hot loop, determinism, platform parity.

## Review process

Every tier goes through 3 review rounds before the next:
- **Round 1**: bug-hunt (correctness + security + contract violations).
- **Round 2**: deeper edge cases + the fixes from R1.
- **Round 3**: full regression sweep (all test suites + typecheck + clippy).

Key lesson (R24, reinforced across R37–R44): **read actual code, don't trust summaries.** ~30% of findings from early "shallow" rounds were false positives; deep-read rounds found real bugs (budget double-count, sandbox bypass, double-pay).

## Testing

Each package has co-located test files (`packages/<name>/src/*.test.ts`). Run the full suite:

```sh
npx vitest run                 # all tests (~5,370 tests across 282 files)
npx vitest run <file>          # one test file
npx vitest run --testTimeout=5000
```

All tests must pass before merge — **NO TEST = NO MERGE**.

## Commit style

One concern per commit. The commit message documents:
- What was built/fixed
- Which § section of the SPEC it implements
- Verification (test counts, regression sweep)
