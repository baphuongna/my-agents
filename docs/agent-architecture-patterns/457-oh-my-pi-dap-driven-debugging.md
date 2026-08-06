# Hướng QO: DAP-Driven Debugging — agent debug qua DAP đặt breakpoint, step tới frame lỗi

> **Nguồn gốc:** oh-my-pi (pi-coding-agent); Debug Adapter Protocol (DAP); "agent attaches DAP, sets real breakpoint, steps to error frame"; "programmatic debugging vs printf-spray"; "continue/stepIn/stepOut/evaluate"
> **Coupling:** 🟡 — thêm DAP-session lifecycle layer vào tool dispatch (spawn debug adapter, điều khiển từ tool)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/dap + dap-server sẵn — chưa có agent-driven breakpoint/step loop)
> **Effort:** 3-4 tuần

## Nguồn gốc

**oh-my-pi** (pi-coding-agent) hướng tới agent **tự debug**: thay vì đọc stack-trace rồi đoán (printf-spray), agent **attach DAP session** tới process lỗi, **đặt breakpoint thật** tại frame lỗi, **step** từng dòng tới chỗ biến sai, **evaluate** biến tại điểm dừng. **Debug Adapter Protocol** (DAP — chuẩn VS Code) cho phép client gửi `setBreakpoints` / `stepIn` / `stepOut` / `next` / `evaluate` / `stackTrace` tới debug adapter (lldb-dap, debugpy, js-debug) như debugger tương tác. Nguyên tắc: **debugging = first-class tool**, không phải "chạy test rồi đọc log". Agent đặt breakpoint có chủ đích (biết symbol/line từ stack-trace), step tới khi quan sát được biến lệch, rồi sửa. Khác **117 toolchain-feedback** (compile/test loop) — QO là **interactive stepping**; khác **053 deterministic-replay** (replay to fix point) — QO là **live stepping tại điểm lỗi**.

## Mô tả

mya DAP-driven debugging: (1) **Attach**: khi agent gặp lỗi (exception/test-fail), launch debug adapter (lldb-dap cho Rust/native, debugpy cho Python, js-debug cho Node) attach tới process hoặc spawn mới với debug. (2) **Breakpoint**: agent parse stack-trace → đặt breakpoint tại frame lỗi (file:line hoặc symbol). (3) **Step**: `continue` tới breakpoint → `stepIn`/`stepOver` từng dòng → `evaluate` biến tại mỗi điểm dừng. (4) **Diagnose**: agent so sánh giá trị biến thực vs mong đợi → tìm gốc rễ. (5) **Fix**: sửa code tại điểm lệch. mya có `packages/dap` + `dap-server` (DAP server-side) — QO thêm **DAP client-side** (agent điều khiển debug session) + **stack-trace → breakpoint mapper** + **step-evaluate loop**.

## Kiến trúc

```
  AGENT gặp lỗi: "AssertionError at parser.rs:142, token=null"
        │
        ▼
  ┌─── DAP ATTACH ─────────────────────────────────────┐
  │  launch debug adapter (lldb-dap) attach to process  │
  │  or re-run with --debug-brk                         │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── STACK-TRACE → BREAKPOINT MAPPER ────────────────┐
  │  parser.rs:142  → setBreakpoints                    │
  │  (symbol "parse_token" if line fuzzy)               │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── STEP-EVALUATE LOOP ─────────────────────────────┐
  │  continue → HIT breakpoint at parser.rs:142         │
  │  evaluate("token")   → "null"  (LEAK!)              │
  │  evaluate("lexer.peek()") → "EOF" (root cause)      │
  │  stackTrace → caller feed() returned empty early    │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── FIX ────────────────────────────────────────────┐
  │  agent: "feed() exits on EOF without setting EOF    │
  │   flag — token stays null"                          │
  │  → edit feed() to set token=EOF_SENTINEL           │
  │  → re-run test → pass                               │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/dap — DAP protocol types/wire (nền — QO = client điều khiển)
// ✅ packages/dap-server — DAP server-side impl (nền — QO = client-side)
// ✅ 117 toolchain-feedback — build/test loop (nền — QO interactive)
// ✅ read/grep — inspect source (nền — QO dùng để tìm symbol)

// ❌ THIẾU: DAP client (agent launch/attach adapter, send DAP requests)
// ❌ THIẾU: stack-trace → breakpoint mapper (trace frame → file:line/symbol)
// ❌ THIẾU: step-evaluate loop (continue/stepIn/evaluate tại điểm dừng)
// ❌ THIẾU: adapter registry (lldb-dap / debugpy / js-debug chọn theo ngôn ngữ)
```

## Implementation

```typescript
// packages/agent/src/dap-debug.ts (MỚI)
interface Breakpoint { file: string; line: number; condition?: string }

class DapDebugClient {
  constructor(private send: (req: DapRequest) => Promise<DapResponse>) {}

  async attach(adapter: 'lldb-dap' | 'debugpy' | 'js-debug', pid?: number): Promise<void> {
    // launch/attach debug adapter via 288 dap + 322 tool-spawn
  }

  async setBreakpoint(bp: Breakpoint): Promise<{ verified: boolean }> {
    const r = await this.send({ command: 'setBreakpoints', args: { source: { path: bp.file },
      breakpoints: [{ line: bp.line, condition: bp.condition }] } });
    return { verified: r.body.breakpoints[0]?.verified ?? false };
  }

  async continueAndStep(evalExprs: string[]): Promise<{ stopped: boolean; vars: Record<string, unknown> }> {
    await this.send({ command: 'continue', args: { threadId: 1 } });
    // poll for stopped event (breakpoint hit)
    const vars: Record<string, unknown> = {};
    for (const expr of evalExprs) {
      const r = await this.send({ command: 'evaluate', args: { expression: expr, frameId: 0 } });
      vars[expr] = r.body.result;
    }
    return { stopped: true, vars };
  }
}

// Stack-trace → breakpoint
function traceToBreakpoint(trace: string): Breakpoint | null {
  const m = trace.match(/at\s+(\S+)\s+\((.+):(\d+)/);   // "at parse_token (parser.rs:142)"
  if (!m) return null;
  return { file: m[2], line: Number(m[3]) };
}

// Usage:
// const dbg = new DapDebugClient(dapTransport);
// await dbg.attach('lldb-dap', childPid);
// const bp = traceToBreakpoint(errorTrace);        // parser.rs:142
// await dbg.setBreakpoint(bp);
// const { vars } = await dbg.continueAndStep(['token', 'lexer.peek()']);
// → { token: 'null', 'lexer.peek()': 'EOF' } → root cause
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tìm gốc rễ chính xác (evaluate biến thực tại điểm dừng) | ❌ Cần adapter phù hợp (mỗi ngôn ngữ 1 adapter) |
| ✅ Nhanh hơn printf-spray (step tới frame lỗi trực tiếp) | ❌ Overhead (spawn adapter + attach ~ 100-500ms) |
| ✅ Agent quan sát state runtime (không đoán) | ❌ Async/non-deterministic khó step (race) |
| ✅ Nối 053 replay (replay tới điểm → QO step thêm) | ❌ Minified/optimized build khó map line |

## Khác các hướng gần

| | 117 Toolchain-Feedback | 053 Deterministic-Replay | QO: DAP-Driven-Debug |
|---|---|---|---|
| Cái gì | Build/test loop | Replay tới fix point | **Interactive stepping** |
| Cách | Chạy test, đọc output | Record+replay | **DAP breakpoint/step/eval** |
| Độ chính xác | Quan sát hậu quả | Quan sát tới điểm | **Quan sát biến tại điểm lỗi** |

## Khi nào chọn

- Agent debug lỗi khó (biến sai nhưng không rõ dòng nào)
- Có stack-trace + symbol/line (map được breakpoint)
- Ngôn ngữ có DAP adapter (Rust/Python/Node/C++)
- Nối packages/dap (wire protocol) + 117 toolchain-feedback (test trigger) + 053 deterministic-replay (replay tới điểm → QO step thêm); guard adapter availability + minified-build line mapping
