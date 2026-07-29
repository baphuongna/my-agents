# Port Plan 2 — Per-Subagent IterationBudget (Hermes → mya)

> **Status:** DRAFT — plan only; no code changed.
> **Source:** Hermes `agent/iteration_budget.py` (v0.19.0) · **Target:** mya `packages/core` + `packages/agent`.

---

## 1. Hermes design

### 1.1 What `IterationBudget` does
A thread-safe consume/refund integer counter that caps how many LLM API-call iterations an agent may make within a single `run_conversation` run.

**Source:** `source/hermes-agent/agent/iteration_budget.py`

- **Class** `IterationBudget` (`:17`) holds `max_total` (int), `_used` (int), `_lock = threading.Lock()` (`:33`).
- **`consume()`** (`:38`): acquires lock; returns `False` if `_used >= max_total` (exhausted); else `_used += 1`, returns `True`. The loop calls `consume()` once per iteration and exits when it returns `False`.
- **`refund()`** (`:46`): decrements `_used` if `> 0`. Used for turns that shouldn't count (programmatic `execute_code`, compression passes, context-length defers).
- **`used`** / **`remaining`** (`:52`, `:57`): lock-guarded reads (race-safety fix documented in `tests/run_agent/test_iteration_budget_race.py:1-13`).

### 1.2 Cap values
| Scope | Default | Source |
|---|---|---|
| **Parent** | **90** | `agent_init.py:458` |
| **Subagent** | **50** | `tools/delegate_tool.py:586` (`DEFAULT_MAX_ITERATIONS`), config key `delegation.max_iterations` |

Each subagent gets an **independent** budget (`delegate_tool.py:1405` passes `iteration_budget=None`; `agent_init.py:578` creates a fresh one). Config is authoritative over caller-supplied `max_iterations`.

### 1.3 Enforcement points
- **Per-turn reset:** `turn_context.py:476` creates a fresh budget at start of every `run_conversation`.
- **Loop condition + consume:** `conversation_loop.py:1009,1040-1045` — `consume()` returns False → `exit_reason = "budget_exhausted"` → break.
- **Grace call:** `conversation_loop.py:1009` grants exactly one extra API call after exhaustion.
- **Refund sites:** `conversation_loop.py:1485,1640,4993,5004,5029,5728` (execute_code, compression-defer, context-length locks).

---

## 2. mya current state

### 2.1 What exists: cost budget (USD), not iteration budget
`packages/core/src/budget.ts` = **tree-accounting USD budget** (`BudgetConfig`): `createBudget()`, `spend(cost)`, `deriveChild(alloc)`, `releasePrecharge()` (CC2 refund-on-terminal), `exhausted()`. Orthogonal to iteration counting.

### 2.2 What exists: per-turn tool-round cap (`maxToolRounds`)
`packages/core/src/loop.ts` — the `runTurn` FSM:
- `:209` `const maxRounds = opts.maxToolRounds ?? 25;`
- `:210` `for (let round = 0; round <= maxRounds; round++)`
- `:381-384` on exhaustion emits `Failed` with `reason: "exceeded maxToolRounds (25)"`.

**This IS the direct analogue of Hermes' `IterationBudget`.** Both bound provider→tool-call iterations within one agent run.

| Aspect | Hermes `IterationBudget` | mya `maxToolRounds` |
|---|---|---|
| Unit | API-call iterations | tool-exec rounds (= provider calls) |
| Parent default | 90 | 25 |
| Subagent default | **50 (separate)** | **25 (same as parent)** |
| Refund semantics | ✅ yes (6 sites) | ❌ none (hard counter) |

### 2.3 Subagent spawning — two paths
- **Path A (`@my-agent/agent`):** `index.ts:665` `spawnSubagent` → `runSubagentTurn()` (`:586`) calls `runTurn({...})` with `maxToolRounds: config.maxToolRounds` (`:614`) — **SAME cap as parent**. Derives a child cost budget (`:786`).
- **Path B (`@my-agent/coding-agent`):** `core/subagent.ts:71` → `session.prompt()` (pi's internal loop). **No `maxToolRounds` exposed.** Only guard = `MAX_SUBAGENT_DEPTH = 3` (`:10`).

### 2.4 The EXACT gap
1. **No separate per-subagent iteration cap** — parent and subagent share `config.maxToolRounds`.
2. **No refund semantics** — monotonically incrementing counter.
3. **coding-agent subagent path has no exposed iteration limit at all** (relies on pi's internal loop).
4. mya DOES have a hard per-turn safety bound (25), so subagents are NOT truly "unbounded" — but not independently configurable per-subagent.

---

## 3. Port design

### 3.1 Tier 1 (recommended, S) — configurable per-subagent cap
Preferable to porting Hermes' full class because mya's `maxToolRounds` already provides the core guarantee.

**AgentConfig** (`packages/agent/src/index.ts:~116`):
```ts
/** Per-subagent max tool rounds. Defaults to maxToolRounds when absent
 *  (identical to prior behavior). Ported from Hermes delegation.max_iterations. */
maxSubagentToolRounds?: number;
```

**Enforcement** in `runSubagentTurn` (`index.ts:614`):
```ts
maxToolRounds: config.maxSubagentToolRounds ?? config.maxToolRounds,
```
One-line semantic change; default preserves identical behavior.

**Config plumbing:** `MyaConfig` (`shared-instances.ts:~60`) + env `MYA_MAX_SUBAGENT_TOOL_ROUNDS` + forward in `print/src/main.ts:~282`.

### 3.2 Tier 2 (optional, M) — full IterationBudget + refund
New `packages/core/src/iteration-budget.ts`:
```ts
export interface IterationBudget {
  consume(): boolean; refund(): void; remaining(): number; readonly used: number;
}
export function createIterationBudget(maxTotal: number): IterationBudget {
  let used = 0;
  return {
    consume(): boolean { if (used >= maxTotal) return false; used++; return true; },
    refund(): void { if (used > 0) used--; },
    remaining(): number { return Math.max(0, maxTotal - used); },
    get used(): number { return used; },
  };
}
```
> **No threading lock needed** — mya's runTurn is single-threaded on the Node event loop. Hermes needed `threading.Lock` for `ThreadPoolExecutor` concurrent subagents.

Wire `iterationBudget?` into `RunTurnOptions` (`loop.ts:~82`); gate the loop:
```ts
const allowRound = ib ? ib.consume() : round <= maxRounds;
```
Default-identical when `iterationBudget` absent.

---

## 4. Files to touch
| File | Change | Risk |
|---|---|---|
| `packages/agent/src/index.ts` | Add `maxSubagentToolRounds?`; forward in `runSubagentTurn` | Low (additive optional) |
| `packages/print/src/shared-instances.ts` | Add to `MyaConfig` + env load | Low |
| `packages/print/src/main.ts` | Forward to `createAgent()` | Low |
| *(Tier 2)* `packages/core/src/loop.ts` | Add `iterationBudget?` to RunTurnOptions; gate loop | Medium (hot loop) |
| *(Tier 2)* `packages/core/src/iteration-budget.ts` | New file | Low |
| **Tests (mandatory)** | See §6 | — |

---

## 5. Effort & risk
- **Tier 1:** **S** — ~4 lines config + 1 line in runSubagentTurn.
- **Tier 2:** **M** — new type + loop integration + execute-tool refund + tests.
- **Default-identical:** all additions optional + `??` fallback → absent config = identical behavior.
- **What could break:** if `maxSubagentToolRounds` were ever forced to a non-undefined default, all existing subagent behavior changes → default to `undefined`. Adding `iterationBudget` gating to loop.ts touches hot path → gate behind `opts.iterationBudget ?`.
- **coding-agent (pi) path:** cannot easily receive an iteration cap without modifying pi's `AgentSession.prompt()` — **out of scope Tier 1**.

---

## 6. Test plan (NO TEST = NO MERGE)

### Tier 1 — new `packages/agent/src/subagent-rounds.test.ts`
- `[unit]` subagent respects `maxSubagentToolRounds` override (mock provider always emits tool calls → fails with "exceeded maxToolRounds (2)" not 5).
- `[unit]` subagent falls back to `maxToolRounds` when unset (cap == parent).
- `[smoke]` `MYA_MAX_SUBAGENT_TOOL_ROUNDS` env is read.

### Tier 2 — `packages/core/src/iteration-budget.test.ts`
- consume returns false when exhausted; refund restores; used reflects both; remaining == max−used; refund on zero is no-op.

### Tier 2 integration — `packages/core/src/loop.test.ts`
- `[real]` runTurn with `iterationBudget(2)` + always-tool-call mock → fails "iteration budget exhausted" after 2 rounds.
- `[real]` runTurn without iterationBudget → uses maxToolRounds (identical).
- `[real]` execute-tool refund → round didn't count.

---

## 7. Honest assessment

**Tier 1: YES, low-cost, real value.** Hermes' insight — subagents can/should have a different (often higher, since focused) iteration cap — is genuinely useful for autonomous multi-agent runs. 4 lines, default changes nothing.

**Tier 2: MARGINAL.** Refund semantics exist in Hermes largely because `execute_code` lets the model loop over tools programmatically. mya has an `execute` tool but the refund benefit is narrow. **Ship Tier 1 now; defer Tier 2 unless a concrete runaway-subagent incident occurs.**

**Edge cases:**
- `maxSubagentToolRounds = 0` → treat `<= 0` as "use parent default" or reject at config-load.
- Nested subagents (depth > 0): cap applies at every spawn depth (mya forwards same config to all depths — consistent with Hermes).
- Aborted subagents: mya's AbortController (`index.ts:740`) sets `aborted` before budget check — correct ordering.

**Alternatives:**
1. Do nothing (status quo): maxToolRounds=25 already bounds subagents. Acceptable if 25-round limit deemed sufficient.
2. Reuse USD `BudgetConfig` for iterations: rejected — conflates orthogonal dimensions, breaks §21 invariants.
3. Port Hermes' exact class (threading.Lock): rejected — no threads, lock is dead weight; maxToolRounds already provides the guarantee.
