## Summary

<!-- Brief description of what this PR changes and why -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Refactor / cleanup
- [ ] Documentation

## Invariant checklist (spec §18)

<!-- Check all that apply. Reviewers will verify. -->

- [ ] **#10 Single time helper**: No `Date.now()` / `SystemTime::now()` outside `core/time.ts` / `natives/time`
- [ ] **#18 Minimal core**: This PR does NOT add code to `packages/core/` — OR it includes a "why-not-a-package" justification below
- [ ] **#19 No cross-transport imports**: Transports (`tui`, `rpc`, `sdk`, `print`) don't import each other
- [ ] **#20 No process exit in natives**: Napi functions return `NativeResult<T>`, never `abort!`/`process::exit`

### Core addition justification (if applicable)

<!-- If this PR adds code to packages/core/src/, explain why it can't be a separate package. -->

## Verification

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `npm run lint:deps` passes
- [ ] `npm run lint:core-size` passes (if touching packages/core/)
- [ ] `mya "hello"` responds (if touching agent runtime)
