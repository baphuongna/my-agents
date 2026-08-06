# Hướng RF: Fuzzy Code Emulator — Chain-of-Code LM-augmented emulator chạy phần khả thi

> **Nguồn gốc:** Awesome-Code-as-Agent-Harness-Papers (Chain of Code: Reasoning with a Language Model-Augmented Code Emulator, ICML 2024, arXiv:2312.04474); "LM-augmented code emulator"; "emulate executable portion of code"; "LLM steps in where interpreter can't run"; "code as reasoning scaffold + LM as fallback executor"
> **Coupling:** 🟡 — thêm code-emulator layer vào agent reasoning (parse code → emulate + LM-fallback)
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (chưa có code emulator — cần parser + partial-executor + LM-fallback)
> **Effort:** 4-5 tuần

## Nguồn gốc

**Chain of Code** (ICML 2024): thay vì chỉ dùng LLM để **reason về** code (mental simulation dễ sai), dùng **LM-augmented code emulator** — (1) **Emulate**: phần code **executable** (số học, loop, logic đơn giản) chạy bằng **emulator chính xác** (không LLM). (2) **LM-fallback**: phần code **không executable** (gọi API external, fuzzy concept, natural-language branch) → **LLM step in** mô phỏng ("giả sử API trả X"). Kết quả: **phần khả thi chạy chính xác**, **phần mơ hồ LLM ước lượng** — tổng thể chính xác hơn pure-LLM-reasoning. Nguyên tắc: **code = reasoning scaffold** (cấu trúc) + **LM = fallback executor** (fill gap). Khác **077 dspy-compilation** (compile to code) — RF là **emulate code**; khác **081 test-time-compute** — RF là **code-grounded simulation**.

## Mô tả

mya fuzzy code emulator: (1) **Parse**: agent sinh code (hoặc đọc code cần predict output) → AST. (2) **Emulate**: chạy phần executable (arithmetic, control flow, pure function) bằng emulator chính xác (deterministic). (3) **LM-fallback**: khi gặp phần không executable (external call, fuzzy value, undefined behavior) → LLM ước lượng giá trị ("API `weather()` likely returns sunny"). (4) **Resume**: emulator tiếp tục với giá trị LLM-cung cấp. (5) **Output**: kết quả cuối = kết quả chính xác (executable) + ước lượng (fuzzy). mya có `296 ast-edit` + `packages/ai` — RF thêm **code emulator** (partial interpreter) + **executable/non-executable classifier** + **LM-fallback bridge**.

## Kiến trúc

```
  CODE (agent cần predict output / reason):
  def plan(budget, weather_api):
      cost = budget * 0.8          # ← EXECUTABLE (arithmetic)
      w = weather_api()             # ← NON-EXECUTABLE (external)
      if w == "sunny":              # ← branch on fuzzy
          return cost - 50          # ← EXECUTABLE
      else:
          return cost               # ← EXECUTABLE
        │
        ▼
  ┌─── CODE EMULATOR (partial interpreter) ──────────────┐
  │  cost = budget * 0.8        → EMULATE (exact: 80)     │
  │  w = weather_api()          → BLOCKED (non-executable)│
  └───────────────────────┬─────────────────────────────┘
                          │ (LM-fallback bridge)
                          ▼
  ┌─── LM-FALLBACK (step in where can't run) ────────────┐
  │  weather_api() → LM: "likely returns 'sunny' (summer)"│
  │  → w = "sunny" (LM-estimated)                          │
  └───────────────────────┬─────────────────────────────┘
                          │ (resume emulator)
                          ▼
  ┌─── RESUME EMULATE ────────────────────────────────────┐
  │  if w == "sunny": TRUE  → return cost - 50 = 80 - 50  │
  │  → result = 30  (executable exact + LM-estimated)     │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 296 ast-edit — AST parsing (nền — RF parse code → AST)
// ✅ packages/ai — LLM query (nền — RF LM-fallback)
// ✅ 117 toolchain-feedback — exec feedback (nền — RF partial exec)

// ❌ THIẾU: code emulator (partial interpreter, deterministic exec)
// ❌ THIẾU: executable/non-executable classifier (AST node → can-run?)
// ❌ THIẾU: LM-fallback bridge (blocked node → LLM estimate → resume)
// ❌ THIẾU: sandboxed partial-exec (safe run executable portion)
```

## Implementation

```typescript
// packages/agent/src/code-emulator.ts (MỚI)
type EmulResult = { status: 'done'; value: unknown } | { status: 'blocked'; reason: string; node: AstNode };

class FuzzyCodeEmulator {
  constructor(
    private interpret: (node: AstNode, env: Map<string, unknown>) => EmulResult,
    private isExecutable: (node: AstNode) => boolean,
    private lmEstimate: (node: AstNode, context: string) => Promise<unknown>,
  ) {}

  async emulate(ast: AstNode, env: Map<string, unknown>): Promise<{ value: unknown; fuzzy: string[] }> {
    const fuzzy: string[] = [];
    let node: AstNode | null = ast;
    // walk AST, emulate executable, LM-fallback blocked
    const result = this.interpret(ast, env);
    if (result.status === 'done') return { value: result.value, fuzzy };

    // blocked → LM-fallback
    if (this.isExecutable(result.node)) {
      // shouldn't block if executable — but external call (API) classified non-exec
    }
    const estimated = await this.lmEstimate(result.node, describeEnv(env));
    fuzzy.push(`${result.reason} → LM-estimated: ${JSON.stringify(estimated)}`);
    env.set(varName(result.node), estimated);
    // resume emulation with LM value
    const resumed = await this.emulate(ast, env);
    return { value: resumed.value, fuzzy: [...fuzzy, ...resumed.fuzzy] };
  }
}

// classifier: external call / API / fuzzy → non-executable
function isExecutable(node: AstNode): boolean {
  if (node.type === 'CallExpression' && EXTERNAL_APIS.has(node.callee)) return false; // weather_api, etc.
  if (node.type === 'MemberExpression' && /\bapi\b/i.test(node.string)) return false;
  return true; // arithmetic, control flow, pure = executable
}

// Usage:
// const ast = parseCode(codeString);                    // 296 ast
// const { value, fuzzy } = await emulator.emulate(ast, env);
// → { value: 30, fuzzy: ["weather_api blocked → LM: sunny"] }
// result = exact (executable) + LM-estimated (fuzzy)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chính xác hơn pure-LLM-reasoning (phần executable exact) | ❌ Emulator coverage (ngôn ngữ/feature hạn chế) |
| ✅ LM chỉ fill gap (không mô phỏng toàn bộ → ít sai) | ❌ LM-fallback sai (ước lượng external lệch) |
| ✅ Code scaffold (cấu trúc rõ, không hallucinate logic) | ❌ Side-effect code (I/O, mutation) khó emulate safe |
| ✅ Trace rõ (phần nào exact, phần nào fuzzy) | ❌ Complexity (parser + emulator + LM-bridge) |

## Khác các hướng gần

| | 077 DSPy-Compilation | 081 Test-Time-Compute | RF: Fuzzy-Code-Emulator |
|---|---|---|---|
| Cái gì | Compile → code | More reasoning steps | **Emulate code + LM-fallback** |
| Exec | ❌ (compile only) | ❌ (pure LM) | **✅ partial (exact + LM)** |
| Accuracy | Compile | Sampling | **Executable exact** |

## Khi nào chọn

- Agent cần predict code output / reason về code execution
- Code có cả phần exact (arithmetic) và fuzzy (external/concept)
- Muốn chính xác hơn pure-LLM mental-simulation (executable chạy exact)
- Nối 296 ast-edit (parse) + packages/ai (LM-fallback) + 117 toolchain-feedback (exec check); guard sandbox (partial-exec safe, no real side-effect), LM-fallback quality (ước lượng external hợp lý), và emulator coverage (support enough language features); RF = Chain-of-Code: emulator chính xác + LM fill gap = structured reasoning grounded in code
