# Hướng AET: Test-Run Parser Detector — regex riêng từng runner, parse passed/failed/errors để tự chuyển phase TDD

> **Nguồn gốc:** pi-extensions | **Coupling:** 🟢 — parser thuần, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn eval tiers; thiếu runner-specific parsers) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions** (src/test-run-detector.ts): **detector nhận diện output test runner** bằng **regex riêng từng runner** — vitest / jest / pytest / go test / cargo test — rồi **parse passed/failed/errors** để **tự động chuyển phase TDD** mà **không cần model phán đoán**. Mỗi runner có format output khác nhau (vitest `Test Files 10 passed`, pytest `===== 3 failed, 7 passed =====`, go test `ok pkg 0.5s`, cargo test `test result: ok. 12 passed`) — một regex chung không bắt được; detector chọn đúng regex theo runner.

Giá trị: (1) **deterministic** — chuyển phase TDD dựa trên số liệu thật, không để LLM đoán "có vẻ pass"; (2) **không tốn token** — parse thuần regex; (3) **chuẩn hóa** — mọi runner về chung `TestSummary { passed, failed, errors, durationMs }`; (4) **feedback loop khép kín** — agent biết chính xác phase (fail → đỏ → sửa; pass → xanh → refactor).

## Mô tả

Với mya, pattern = **test output parser chuẩn hóa** gắn vào loop: (1) **runner registry** — map runner → regex set: vitest/jest (`Tests:\s*(\d+) passed`), pytest (`(\d+) failed, (\d+) passed`), go (`^(ok|FAIL)\s+(\S+)`), cargo (`test result: (ok|FAILED). (\d+) passed`); (2) **detect runner** — heuristic từ lệnh đã chạy (argv: `vitest run`, `pytest`, `go test`, `cargo test`) + fallback scan output; (3) **parse → TestSummary** thống nhất; (4) **phase gate** — nối với loop: fail ≠ 0 → phase "red" (sửa), fail = 0 → "green" (refactor), errors > 0 → "broken" (hạ tầng test lỗi — khác fail); (5) nơi gắn — mya đã có `packages/eval` (harness + tiers) và tools chạy test — parser này có thể dùng chung cho eval + agent loop. Đây là pattern **deterministic signal extraction**: chuyển output văn bản thành tín hiệu số cho điều khiển vòng lặp.

## Kiến trúc (ASCII)

```
  LỆNH TEST (argv: vitest run / pytest / go test / cargo test)
    ▼ DETECT RUNNER (heuristic argv + fallback scan output)
  vitest │ jest │ pytest │ go test │ cargo test
    ▼ PARSE (regex riêng từng runner)
  ├─ "Tests: 10 passed, 2 failed"   ──► {passed:10, failed:2}
  ├─ "3 failed, 7 passed"           ──► {passed:7,  failed:3}
  ├─ "ok pkg 0.5s"                  ──► {passed:1,  failed:0}
  └─ "test result: ok. 12 passed"   ──► {passed:12, failed:0}
    ▼ TestSummary { passed, failed, errors, durationMs }
    ▼ PHASE GATE (TDD — không cần model đoán)
  failed>0 → red · failed=0 → green · errors>0 → broken
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval/src/harness.ts + tiers.ts — eval harness (nơi parse test output)
// ✅ packages/tools/src/codeexec.ts — code-exec bridge (chạy lệnh test)
// ✅ packages/tools/src/output-compress.ts — reducers (pattern parse stdout)
// ✅ packages/core/src/loop.ts — vòng agent (nơi chèn phase gate)
// ✅ packages/core/src/budget.ts — budget gate (mẫu gate trong loop)
// ❌ THIẾU: runner registry + regex riêng từng runner
// ❌ THIẾU: detect runner heuristic (argv + fallback)
// ❌ THIẾU: TestSummary → phase gate (red/green/broken)
```

## Implementation

```typescript
// packages/eval/src/test-run-detector.ts (NEW)
export interface TestSummary {
  passed: number;
  failed: number;
  errors: number;          // lỗi hạ tầng (import fail, timeout) — khác test fail
  durationMs?: number;
}

export type TestRunner = "vitest" | "jest" | "pytest" | "go" | "cargo";

const RUNNER_HINTS: Array<[TestRunner, RegExp]> = [
  ["vitest", /\bvitest\b/],
  ["jest", /\bjest\b/],
  ["pytest", /\bpytest\b/],
  ["go", /\bgo\s+test\b/],
  ["cargo", /\bcargo\s+test\b/],
];

export function detectRunner(argv: readonly string[], output: string): TestRunner | null {
  for (const [runner, re] of RUNNER_HINTS) {
    if (argv.some((a) => re.test(a))) return runner;
    if (re.test(output)) return runner;
  }
  return null;
}

export function parseTestOutput(runner: TestRunner, output: string): TestSummary {
  switch (runner) {
    case "vitest":
    case "jest": {  // "Tests:  10 passed, 2 failed"
      const m = output.match(/Tests?:\s*(\d+)\s+passed,\s*(\d+)\s+failed/);
      if (m) return { passed: Number(m[1]), failed: Number(m[2]), errors: 0 };
      break;
    }
    case "pytest": {  // "===== 3 failed, 7 passed ====="
      const m = output.match(/(\d+)\s+failed,\s*(\d+)\s+passed/);
      if (m) return { passed: Number(m[2]), failed: Number(m[1]), errors: 0 };
      break;
    }
    case "go": {  // "ok pkg 0.5s" / "FAIL pkg 0.2s"
      const m = output.match(/^(ok|FAIL)\s+(\S+)\s+([\d.]+)s/m);
      if (m) return { passed: m[1] === "ok" ? 1 : 0, failed: m[1] === "FAIL" ? 1 : 0, durationMs: Number(m[3]) * 1000 };
      break;
    }
    case "cargo": {  // "test result: ok. 12 passed; 0 failed"
      const m = output.match(/test result:\s*(\w+)\.\s*(\d+)\s+passed;\s*(\d+)\s+failed/);
      if (m) return { passed: Number(m[2]), failed: Number(m[3]), errors: m[1] === "FAILED" ? Number(m[3]) : 0 };
      break;
    }
  }
  return { passed: 0, failed: 0, errors: 1 };   // không parse được → errors (broken)
}

/** Phase gate TDD — deterministic, không cần model phán đoán. */
export function tddPhase(s: TestSummary): "red" | "green" | "broken" {
  if (s.errors > 0) return "broken";   // hạ tầng lỗi — khác test fail
  return s.failed > 0 ? "red" : "green";
}
// Nối loop: chạy test → parseTestOutput → tddPhase → điều hướng turn
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic — không để model đoán pass/fail | ❌ Regex theo format runner — đổi version format phải sửa |
| ✅ Không tốn token (parse thuần) | ❌ Runner mới (mocha, xunit…) cần thêm registry |
| ✅ Chuẩn hóa TestSummary cho mọi runner | ❌ Output ANSI màu/prefix làm regex lệch (cần strip) |
| ✅ Nối eval + loop dùng chung | ❌ Không parse được → errors — cần fallback rõ |

## Khác các hướng gần

| | AET Test Parser | AEV Verification Gates |
|---|---|---|
| Trọng tâm | Parse kết quả test | Chặn tiến khi gate fail |
| Cơ chế | Regex theo runner | Gate check + execSync |
| Quan hệ | Nguồn tín hiệu cho AEV | Tiêu thụ TestSummary |

## Khi nào chọn

- Agent chạy TDD loop — cần biết phase red/green chắc chắn
- Đa runner (TS + Python + Go + Rust) trong cùng workspace
- Đã có eval harness + codeexec — thêm parser chuẩn hóa
- Muốn tiết kiệm token + deterministic thay vì để model đọc output