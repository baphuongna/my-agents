# Hướng LI: Flaky Test Stabilization — ổn định test flaky, retry, quarantine

> **Nguồn gốc:** Google "Where do Google's flaky tests come from?"; "Test flakiness" research; retry/quarantine strategies; hermetic testing; "test sharding"; non-determinism taxonomy
> **Coupling:** 🟡 — chạm test-runner + CI
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (vitest + test harness sẵn — thiếu flaky detector + auto-retry + quarantine + root-cause)
> **Effort:** 3-4 tuần

## Nguồn gốc

Flaky test (Google research): test lúc pass lúc fail **cùng code** — non-determinism. Nguyên nhân: race condition, time-dependence (Date.now), order-dependence, shared state, network, randomness. Strategies: (1) **retry** — chạy lại N lần, nếu pass ≥ once → flag flaky; (2) **quarantine** — tách flaky test khỏi critical path (không block CI) nhưng theo dõi; (3) **hermetic** — isolate (no network, frozen time, fixed seed); (4) **root-cause** — phân loại non-determinism → fix. Google: ~16% test flaky ở một thời điểm. Cốt lõi: **flaky phá tin tưởng CI** — detect → retry → quarantine → fix.

## Mô tả

mya flaky stabilization: vitest runner (5,370 tests) → (1) **detect** — test pass/fail khác nhau giữa runs → flag flaky; (2) **retry** — rerun flaky N lần (AGENTS.md: pool:forks); (3) **quarantine** — tách flaky (not block) nhưng track; (4) **root-cause** — phân loại: time? (dùng setTimeProvider AGENTS.md), shared state? (isolate), order? (shuffle); (5) **fix** — hermetic. Nối AGENTS.md (time tests = setTimeProvider, mkdtempSync), vitest.config (pool:forks).

## Kiến trúc

```
  CI RUN (vitest)
     │
     ▼
  ┌──────────────────────────────────────────────────────┐
  │  TEST RESULTS                                        │
  │  run 1: test_X FAIL                                  │
  │  run 2: test_X PASS  ← FLAKY!                        │
  │  run 3: test_X FAIL  ← confirmed flaky (2/3 fail)    │
  └──────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌──────────────────┐    ┌──────────────────────────┐
  │ RETRY (immediate)│    │ QUARANTINE               │
  │ rerun N=3 times  │    │ move to flaky-quarantine │
  │ if majority pass │    │ does NOT block CI        │
  │ → treat as pass  │    │ but tracks for fix       │
  │ (log flaky)      │    └──────────────────────────┘
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────────────────────────────────────────┐
  │  ROOT-CAUSE CLASSIFY (non-determinism taxonomy)      │
  │  · time-dependent? → setTimeProvider (AGENTS.md)     │
  │  · shared state?   → mkdtempSync isolate             │
  │  · order-dependent?→ shuffle runs                    │
  │  · race?           → hermetic (no concurrency)       │
  │  · random?         → fixed seed                      │
  └──────────────────┬───────────────────────────────────┘
                     ▼
              FIX → hermetic → de-quarantine
```

```
mya: vitest + test harness sẵn — thiếu flaky detector + auto-retry + quarantine + root-cause classifier
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ vitest (pool:forks) — test runner (sẵn, AGENTS.md)
// ✅ setTimeProvider — frozen time (AGENTS.md — fixes time-flakiness)
// ✅ mkdtempSync — temp isolation (AGENTS.md — fixes state-flakiness)
// ✅ scripts/tool-test-harness.mjs — test harness (sẵn)

// ❌ THIẾU: flaky detector (cross-run pass/fail diff)
// ❌ THIẾU: auto-retry (rerun N → majority vote)
// ❌ THIẾU: quarantine (separate flaky from blocking CI)
// ❌ THIẾU: root-cause classifier (which non-determinism?)
```

## Implementation

```typescript
// scripts/flaky-stabilize.mjs (NEW)
interface RunResult { testId: string; pass: boolean; runIndex: number; error?: string; }

export class FlakyStabilizer {
  private history = new Map<string, boolean[]>(); // testId → [pass/pass/...]

  record(r: RunResult): void {
    const arr = this.history.get(r.testId) ?? [];
    arr[r.runIndex] = r.pass;
    this.history.set(r.testId, arr);
  }

  // Detect: passed at least once AND failed at least once = flaky
  detectFlaky(): string[] {
    return [...this.history.entries()]
      .filter(([, results]) => results.includes(true) && results.includes(false))
      .map(([id]) => id);
  }

  // Retry: rerun flaky test N times, majority vote
  async retryWithVote(testId: string, runner: () => Promise<boolean>, n = 3): Promise<boolean> {
    const results: boolean[] = [];
    for (let i = 0; i < n; i++) results.push(await runner());
    const passes = results.filter(Boolean).length;
    return passes >= Math.ceil(n / 2); // majority
  }

  // Root-cause classify (suggest fix)
  classify(testId: string, error?: string): string {
    if (error?.includes("Date") || error?.includes("time")) return "time → setTimeProvider";
    if (error?.includes("EEXIST") || error?.includes("ENOENT")) return "shared-state → mkdtempSync isolate";
    if (error?.includes("race") || error?.includes("concurrent")) return "race → hermetic";
    return "unknown → manual investigate";
  }

  // Quarantine: write flaky list to file (CI reads → non-blocking)
  async quarantine(flakyIds: string[], path: string): Promise<void> {
    await writeFile(path, JSON.stringify(flakyIds));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ CI tin cậy (flaky không block — Google) | ❌ Retry hides real bug (false pass) |
| ✅ Detect sớm (cross-run diff) | ❌ Quarantine debt accumulates (unfixed pile) |
| ✅ Root-cause → fix đúng (taxonomy) | ❌ Hermetic effort (isolate network/time) |
| ✅ setTimeProvider/mkdtempSync (AGENTS.md) sẵn | ❌ Race conditions hard to fix |

## Khác các hướng gần

| | 322 Chaos-Agents | 323 Load-Testing | LI: Flaky Stabilization |
|---|---|---|---|
| Mục | Phá có chủ đích | Bão hòa | **Ổn định test non-deterministic** |
| Khi | Prod chaos | Before ship | **CI mỗi run** |
| Fix | Tolerate fault | Capacity | **Hermetic (time/isolate/seed)** |

## Khi nào chọn

- Test suite có flaky (lúc pass lúc fail) — phá tin CI
- CI bị block bởi test không tin cậy → quarantine
- Cần root-cause (time? state? order?) → fix đúng
- Nối vitest (AGENTS.md) + 322 chaos + 323 load-testing
