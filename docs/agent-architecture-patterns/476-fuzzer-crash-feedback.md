# Hướng RH: Fuzzer Crash Feedback — fuzzer crash traces + static warnings gated vào verify loop

> **Nguồn gốc:** Papers (AutoSafeCoder); "fuzzer crash traces as feedback"; "static analysis warnings gated into verification"; "automated safety code generation with fuzzer + static checker"; "crash trace → fix → re-verify loop"
> **Coupling:** 🟡 — thêm fuzzer + static analyzer vào verify pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (code-exec + test runner sẵn — chưa có fuzzer + static warning feedback)
> **Effort:** 3-4 tuần

## Nguồn gốc

**AutoSafeCoder** paper kết hợp **fuzzer** (chạy input ngẫu nhiên → crash) + **static analyzer** (phát hiện warning không cần run) làm **feedback gate** cho agent code generation. Flow: agent viết code → **fuzzer run** (gen input → exec → crash traces) + **static scan** (lint/undefined/danger) → feedback (crash trace + warning list) → agent fix → **re-verify** (fuzz again + scan again). Nguyên tắc: **code an toàn = pass cả fuzz lẫn static** — fuzzer catch runtime crash (null deref, overflow), static catch code smell (unused, untyped, dangerous). Khác **084 llm-as-judge** (LLM chấm) — RH dùng **tool kiểm chứng** (fuzzer + scanner, deterministic); khác **475 PaT** (trial before plan) — RH là **verify after code**.

## Mô tả

mya fuzzer crash feedback: (1) **Agent writes code** → (2) **Fuzzer run**: gen fuzzing inputs (random/edge/property-based) → exec code → collect crash traces (segfault, panic, exception). (3) **Static scan**: run linter/analyzer (undefined, unused, dangerous patterns, type error). (4) **Feedback gate**: crash traces + static warnings → feed back to agent as structured feedback. (5) **Agent fixes** → (6) **Re-verify**: fuzz again + scan again → repeat until clean (no crash, no warning). mya có code-exec + test runner — RH thêm **fuzzer harness** (gen input → exec → crash) + **static scanner** (lint rules) + **feedback gate** (crash/warning → fix loop).

## Kiến trúc

```
  AGENT writes code: function parseConfig(raw)
        │
        ▼
  ┌─── FUZZER RUN ─────────────────────────────────────────┐
  │  gen inputs: null, "", "{}", 99999, "<script>", {a:..}  │
  │  exec parseConfig(input) for each                        │
  │  → CRASH: input=null → TypeError (cannot read .a)        │
  │  → CRASH: input=99999 → not a function                   │
  │  crash traces collected                                  │
  └───────────────────────┬─────────────────────────────────┘
                          │
  ┌─── STATIC SCAN ───────┴─────────────────────────────────┐
  │  linter: parseConfig uses `any` type (warning)            │
  │  analyzer: unreachable code after return (warning)        │
  │  type-check: raw.a without null check (error)             │
  │  warnings collected                                       │
  └───────────────────────┬─────────────────────────────────┘
                          │
                          ▼
  ┌─── FEEDBACK GATE (crash traces + warnings → agent) ─────┐
  │  FEEDBACK:                                                │
  │  [FUZZ] crash: input=null → TypeError at line 12          │
  │  [FUZZ] crash: input=99999 → not callable at line 8        │
  │  [STATIC] warning: `any` type on param raw                │
  │  [STATIC] error: raw.a without null check                  │
  │  → FIX THESE BEFORE PROCEEDING                            │
  └───────────────────────┬─────────────────────────────────┘
                          │ agent fixes
                          ▼
  ┌─── AGENT FIXES → RE-VERIFY ─────────────────────────────┐
  │  code fixed: add null guard, type param, remove dead code │
  │  → FUZZ again: no crash ✓                                 │
  │  → STATIC again: no warning ✓                             │
  │  → GATE PASSED ✓                                          │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ code-exec tool — run code (nền — RH = fuzz + scan on top)
// ✅ test runner — run tests (nền — RH = fuzzer = adversarial test gen)
// ✅ 084 llm-as-judge — verify (nền — RH = deterministic tool verify, not LLM)

// ❌ THIẾU: fuzzer harness (gen input → exec → crash trace)
// ❌ THIẾU: static scanner (lint rules → warnings)
// ❌ THIẾU: feedback gate (crash + warning → structured feedback → fix loop)
// ❌ THIẾU: re-verify loop (fix → fuzz again → scan again → pass/fail)
```

## Implementation

```typescript
// packages/agent/src/fuzzer-crash-feedback.ts (MỚI)
interface FuzzCrash {
  input: string;         // the crashing input
  error: string;         // error type
  trace: string;         // stack trace
  line?: number;
}
interface StaticWarning {
  rule: string;          // lint rule id
  severity: 'error' | 'warning';
  message: string;
  line: number;
}
interface VerifyResult {
  crashes: FuzzCrash[];
  warnings: StaticWarning[];
  passed: boolean;       // true = no crash + no error-level warning
}

class FuzzerCrashFeedback {
  // Generate fuzzing inputs (property-based / edge case)
  genFuzzInputs(): unknown[] {
    return [null, undefined, '', '{}', '[]', 0, -1, 999999999, '<script>', 'a'.repeat(10000), NaN, true, false, {}, [], { a: { b: { c: null } } }];
  }

  // Run fuzzer: exec target with fuzzing inputs → collect crashes
  async fuzz(
    target: (input: unknown) => unknown,
    inputs: unknown[] = this.genFuzzInputs(),
  ): Promise<FuzzCrash[]> {
    const crashes: FuzzCrash[] = [];
    for (const input of inputs) {
      try {
        target(input);
      } catch (err) {
        crashes.push({
          input: JSON.stringify(input).slice(0, 100),
          error: (err as Error).name,
          trace: (err as Error).stack?.slice(0, 500) ?? String(err),
        });
      }
    }
    return crashes;
  }

  // Static scan: run lint rules → collect warnings
  staticScan(code: string): StaticWarning[] {
    const warnings: StaticWarning[] = [];
    // Example rules (real impl would use eslint/ts-standard)
    const lines = code.split('\n');
    lines.forEach((line, i) => {
      if (line.includes(': any')) warnings.push({ rule: 'no-explicit-any', severity: 'warning', message: 'unexpected any type', line: i + 1 });
      if (/\beval\b/.test(line)) warnings.push({ rule: 'no-eval', severity: 'error', message: 'eval is dangerous', line: i + 1 });
    });
    return warnings;
  }

  // Verify gate: fuzz + scan → pass/fail
  async verify(target: (input: unknown) => unknown, code: string): Promise<VerifyResult> {
    const crashes = await this.fuzz(target);
    const warnings = this.staticScan(code);
    const passed = crashes.length === 0 && !warnings.some(w => w.severity === 'error');
    return { crashes, warnings, passed };
  }

  // Build feedback message for agent
  buildFeedback(result: VerifyResult): string {
    if (result.passed) return '✅ Verification passed — no crashes, no errors.';
    const parts: string[] = [];
    for (const c of result.crashes) parts.push(`[FUZZ] crash: input=${c.input} → ${c.error}`);
    for (const w of result.warnings) parts.push(`[STATIC ${w.severity}] ${w.rule}: ${w.message} (line ${w.line})`);
    return `❌ Verification failed — fix these:\n${parts.join('\n')}`;
  }
}

// Usage:
// const fcf = new FuzzerCrashFeedback();
// const result = await fcf.verify(parseConfig, code);
// if (!result.passed) {
//   feedback = fcf.buildFeedback(result);  // feed to agent
//   agent.fix(feedback);                   // agent fixes
//   re-verify...                           // loop until passed
// }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Catch runtime crash (fuzzer — null/edge/overflow) | ❌ Fuzz time (many inputs → exec slow) |
| ✅ Catch code smell (static — type/danger/unused) | ❌ False positive (static warning noisy) |
| ✅ Deterministic verify (tool-based, không LLM bias) | ❌ Fuzzer coverage (không fuzz hết = miss crash) |
| ✅ Auto-fix loop (crash → fix → re-verify) | ❌ Complexity (fuzzer + scanner + feedback gate) |

## Khác các hướng gần

| | 084 LLM-as-Judge | 475 PaT | RH: Fuzzer-Crash-Feedback |
|---|---|---|---|
| Verify bằng | LLM chấm | Trial probe | **Fuzzer + static scanner** |
| Khi | Đánh giá output | Trước plan | **Sau khi code** |
| Determinism | ❌ (LLM) | ✅ | ✅ (tool-based) |

## Khi nào chọn

- Code generation cần safety verify (catch crash + code smell)
- Muốn deterministic verify (không LLM bias — tool check)
- Cần auto-fix loop (crash/warning → fix → re-verify)
- Nối code-exec (RH = fuzz exec) + 084 llm-as-judge (RH = deterministic complement); guard fuzzer coverage (chọn input đại diện — edge + random + property) + false positive (filter static warning noise)
