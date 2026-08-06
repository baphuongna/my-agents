# Hướng PK: Orchestrator Determinism Realm — sandbox cấm Date.now()/Math.random() qua VM determinism prelude

> **Nguồn gốc:** pi-dynamic-workflows (workflow.ts — DETERMINISM_PRELUDE, vm realm, Math.random/Date.now throw); "deterministic execution sandbox"; "VM prelude neutering"; "resume-safe determinism"; "nondeterminism guard"
> **Coupling:** 🟡 — workflow runtime chạy trong vm realm với determinism prelude (BẮT BUỘC nếu dùng PJ journaling)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (DETERMINISM_PRELUDE sẵn trong pi-dynamic-workflows — chưa port vào mya agent)
> **Effort:** 1-1.5 tuần

## Nguồn gốc

**pi-dynamic-workflows** (`workflow.ts`) chạy workflow script trong **vm realm** với `DETERMINISM_PRELUDE` — đoạn code chạy **trước** user script, **neuter** (vô hiệu hóa) các builtin nondeterministic: (1) `Math.random()` → throw (breaks resume — random value khác mỗi lần). (2) `Date.now()` → throw (timestamp khác mỗi lần). (3) `Date()` / `new Date()` (no-arg) → throw (no-arg = current time = nondeterministic). (4) `new Date(arg)` **vẫn hoạt động** (explicit timestamp = deterministic). Sử dụng vm realm's own `Math`/`Date`/`Reflect` (không host objects) → không host-Function escape. **Best-effort guard**: vm không phải security sandbox (injected bridge `.constructor` = host Function → determined script có thể bypass) — guard chống **accidental** nondeterminism từ trusted script (user/guided-LLM), không phải security wall. Nguyên tắc: **determinism = resume-safe** — nếu call nondeterministic, journal cache miss luôn (PJ không replay được). Khác **87 sandbox** (security sandbox) — PK là **determinism realm** (chống nondeterminism, không chống malicious).

## Mô tả

mya orchestrator determinism realm: workflow script chạy trong **vm realm** với determinism prelude — (1) **Prelude inject**: trước user script, inject code neuter `Math.random()`, `Date.now()`, `Date()`/`new Date()` (no-arg) → throw. (2) **Explicit OK**: `new Date("2024-01-01")`, `new Date(timestamp)` vẫn hoạt động (explicit = deterministic). (3) **Pass via args**: randomness/time phải truyền qua `args` (deterministic input), không lấy từ runtime. (4) **Best-effort**: vm realm dùng own Math/Date (không host escape) — guard accidental nondeterminism, không phải security wall. Kết quả: **resume-safe** — cùng script + cùng args → cùng output → journal cache valid (PJ replay hoạt động). mya có workflow runtime — PK thêm **vm realm + determinism prelude** (BẮT BUỘC nếu dùng PJ journaling).

## Kiến trúc

```
  WORKFLOW SCRIPT EXECUTION (vm realm):

  ┌─── VM REALM ──────────────────────────────────────────┐
  │                                                        │
  │  ┌── DETERMINISM PRELUDE (runs BEFORE user script) ──┐ │
  │  │                                                    │ │
  │  │  Math.random = () => {                             │ │
  │  │    throw new Error("Math.random() breaks resume"); │ │
  │  │  };                                                │ │
  │  │                                                    │ │
  │  │  const RealDate = Date;                            │ │
  │  │  const SafeDate = function(...a) {                 │ │
  │  │    if (!new.target) throw "Date() no-arg";         │ │
  │  │    if (a.length === 0) throw "new Date() no-arg";  │ │
  │  │    return Reflect.construct(RealDate, a, SafeDate);│ │
  │  │  };                                                │ │
  │  │  SafeDate.now = () => throw "Date.now()";          │ │
  │  │  globalThis.Date = SafeDate;                       │ │
  │  │                                                    │ │
  │  │  // new Date("2024-01-01") ✅ explicit = OK        │ │
  │  │  // new Date(timestamp)     ✅ explicit = OK       │ │
  │  │  // Date.now()              🔴 throw               │ │
  │  │  // Math.random()           🔴 throw               │ │
  │  │  // new Date()              🔴 throw (no-arg)      │ │
  │  └────────────────────────────────────────────────────┘ │
  │                                                        │
  │  ┌── USER SCRIPT ────────────────────────────────────┐ │
  │  │  agent("task")  // deterministic (no random/time)  │ │
  │  │  → same input → same output → cache valid ✅       │ │
  │  └────────────────────────────────────────────────────┘ │
  │                                                        │
  │  vm realm's own Math/Date/Reflect (no host escape)     │
  │  Best-effort: NOT security sandbox                     │
  │  (bridge.constructor = host Function → bypass possible)│
  └────────────────────────────────────────────────────────┘

  WHY: if agent() call is nondeterministic → journal cache miss
  always → PJ replay never works → no cost saving
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ workflow runtime (packages/agent) — workflow execution (nền — PK = determinism guard)
// ✅ 426 PJ call-index-journaling — journal+resume (nền — PK REQUIRES for PJ)
// ✅ pi-dynamic-workflows DETERMINISM_PRELUDE (source/ — reference impl)

// ❌ THIẘU: vm realm execution (workflow script in vm, not direct eval)
// ❌ THIẾU: determinism prelude (Math.random/Date.now throw)
// ❌ THIẾU: explicit-arg exception (new Date(arg) OK, new Date() throw)
// ❌ THIẾU: args-based nondeterminism (pass random/time via args, not runtime)
```

## Implementation

```typescript
// packages/agent/src/workflow-determinism.ts (MỚI — port từ pi-dynamic-workflows)
import vm from 'node:vm';

// Determinism prelude — runs BEFORE user script in vm realm
const DETERMINISM_PRELUDE = [
  '"use strict";',
  // Math.random → throw (breaks resume determinism)
  'Math.random = () => { throw new Error(' +
    '"Math.random() is unavailable in a workflow (it breaks resume); ' +
    'pass randomness via args or vary by index"); };',
  '{',
  '  const RealDate = Date;',
  '  const fail = (w) => { throw new Error(w + ' +
    '" is unavailable in a workflow (it breaks resume); pass a timestamp via args"); };',
  '  const SafeDate = function (...a) {',
  '    if (!new.target) fail("Date()");',           // Date() no-arg → throw
  '    if (a.length === 0) fail("new Date()");',     // new Date() no-arg → throw
  '    return Reflect.construct(RealDate, a, SafeDate);', // new Date(arg) → OK
  '  };',
  '  SafeDate.UTC = RealDate.UTC;',                  // static methods OK
  '  SafeDate.parse = RealDate.parse;',
  '  SafeDate.now = () => fail("Date.now()");',      // Date.now → throw
  '  SafeDate.prototype = RealDate.prototype;',
  '  globalThis.Date = SafeDate;',                   // replace global Date
  '}',
].join('\n');

// Run workflow script in vm realm with determinism prelude
async function runDeterministic<T>(
  script: string,
  args: Record<string, unknown>,
  bridges: Record<string, unknown>, // injected agent(), checkpoint(), etc.
): Promise<T> {
  const fullScript = DETERMINISM_PRELUDE + '\n' + script;

  // Create vm context (realm) with own Math/Date/Reflect
  const context = vm.createContext({
    ...bridges,
    args,            // nondeterminism passed via args (deterministic input)
    console,         // allow logging
    JSON, Math: vm.runInContext('Math', vm.createContext({})), // realm's own
  });

  try {
    const result = vm.runInContext(fullScript, context);
    return result as T;
  } catch (e) {
    // Determinism violation caught (Math.random/Date.now called)
    throw new Error(`Workflow determinism violation: ${(e as Error).message}`);
  }
}

// Usage:
// await runDeterministic(workflowScript, { seed: 42, timestamp: '2024-01-01' }, {
//   agent: agentFn,    // injected bridge
//   checkpoint: ckFn,
// });
// If script calls Math.random() → throw immediately
// If script calls new Date("2024-01-01") → OK (explicit = deterministic)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Resume-safe (deterministic → journal cache valid → PJ replay hoạt động) | ❌ vm realm overhead (createContext mỗi run) |
| ✅ Catch accidental nondeterminism (Math.random/Date.now → throw ngay) | ❌ NOT security sandbox (determined script bypass via constructor) |
| ✅ Explicit-arg exception (new Date(arg) OK — deterministic time) | ❌ False positive (legit Date.now usage → throw — phải pass via args) |
| ✅ Realm isolation (own Math/Date — không host escape) | ❌ Debugging harder (vm context — stack trace khác host) |

## Khác các hướng gần

| | 87 Agent-Sandbox | PK: Determinism-Realm |
|---|---|---|
| Mục đích | Security (chống malicious) | **Determinism (chống nondeterminism)** |
| Math.random | Allow | **Throw** |
| Date.now | Allow | **Throw** |
| Security wall | ✅ (isolation) | ❌ (best-effort — bypass possible) |

## Khi nào chọn

- Workflow dùng PJ journaling (determinism BẮT BUỘC cho cache replay)
- Workflow script từ user/guided-LLM (có thể accidental Math.random/Date.now)
- Muốn resume-safe (cùng input → cùng output → cache valid)
- Nối 426 PJ call-index-journaling (PK là precondition — PJ requires determinism) + 87 agent-sandbox (PK ≠ security — nếu cần security, dùng 87); guard false positive (legit Date.now → phải refactor pass via args)
