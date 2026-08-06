# Hướng ZG: Process-as-Code — process là real JavaScript async function(inputs, ctx); orchestrator chỉ làm được những gì code cho phép — quyền lực thuộc code, không thuộc prompt
> **Nguồn gốc:** babysitter (docs/user-guide/architecture.md) | **Coupling:** 🟡 — process định nghĩa bằng code trong workflows runner | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (workflows/runner.ts chạy JS async function — đúng pattern) | **Effort:** 1 tuần (mở rộng runner)

## Nguồn gốc

**babysitter** định nghĩa **process** không phải bằng prompt/markdown mà bằng **real JavaScript**: `async function process(inputs, ctx)` — function thật, chạy trong runtime, có quyền gọi tool, đọc ctx, trả result. Vì process là code: orchestrator **chỉ làm được những gì code cho phép** — nếu code không cho phép gọi tool X ở phase Y, agent không thể (prompt có nói cũng vô ích). Quyền lực thuộc **code**, không thuộc **prompt** — prompt chỉ hướng dẫn bên trong giới hạn code. Code còn test được, type-check được, version-control được. Nguyên tắc: **process-as-code — capability comes from code, not from words**.

## Mô tả

mya process-as-code: (1) **Process = JS module** — export default async function(inputs, ctx). (2) **ctx surface** — ctx.tools (tool executor), ctx.session, ctx.input, ctx.spawn (subagent), ctx.parallel (mya đã có). (3) **Capability enforcement** — runner giới hạn ctx; process chỉ gọi được tool runner cấp. (4) **Testable** — process là function thuần (có thể unit test với mock ctx). mya có workflows/runner.ts chạy đúng pattern (vm sandbox, SAFE_GLOBALS, ctx.tools) — ZG thêm **typed ctx contract** + **capability-limited tool surface** + **process test harness**.

## Kiến trúc

```
  PROCESS (file .ts — real code, không phải prompt)
  ┌────────────────────────────────────────────────┐
  │  export default async function(inputs, ctx) {   │
  │    const files = await ctx.tools.read(...)      │
  │    const plan = await ctx.spawn("plan...")      │
  │    await ctx.parallel.map(tasks)                │
  │    return { artifact, evidence }                │
  │  }                                              │
  └────────────────────┬───────────────────────────┘
                       ▼  (chạy trong runner)
  ┌─── ORCHESTRATOR (giới hạn bằng code) ──────────┐
  │  ctx.tools = toolExecutor (chỉ tool được cấp)   │
  │  ctx.spawn = A1 subagent (depth limit)          │
  │  ctx.parallel = deterministic parallel          │
  │  → process làm được GÌ = ctx cho phép           │
  └────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner.ts — runInNewContext + SAFE_GLOBALS (nền — ZG runtime)
// ✅ packages/workflows runner.ts — WorkflowContext { tools, provider, session, spawn } (nền — ZG ctx contract)
// ✅ packages/workflows runner.ts — ctx.parallel (nền — ZG deterministic parallel)
// ✅ packages/core loop.ts — runTurn (relate — ZG process gọi agent)
// ✅ packages/agent index.ts — createAgent/spawn subagent (nền — ZG ctx.spawn)

// ❌ THIẾU: typed ctx contract chuẩn hóa (ProcessInputs/ProcessContext types)
// ❌ THIẾU: capability-limited tool surface (process chỉ thấy tool được cấp)
// ❌ THIẾU: process test harness (mock ctx để unit test process)
```

## Implementation

```typescript
// packages/workflows/src/process-as-code.ts (MỚI)

interface ProcessInputs { [k: string]: unknown }
interface ProcessContext {
  tools: Record<string, (args: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>>;
  session: { id: string; cwd: string };
  input: unknown;
  spawn(goal: string, opts?: { allowedTools?: string[] }): Promise<string>;
  parallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]>;
}
type Process = (inputs: ProcessInputs, ctx: ProcessContext) => Promise<{ artifact: string[]; evidence: string[] }>;

// Capability-limited runner: chỉ expose tools được cấp — code quyết định quyền
async function runProcess(
  process: Process,
  inputs: ProcessInputs,
  allowedTools: string[],
  fullToolSet: Record<string, (args: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>>,
): Promise<{ artifact: string[]; evidence: string[] }> {
  const tools = Object.fromEntries(
    allowedTools.map(name => [name, fullToolSet[name]]).filter(([, fn]) => fn !== undefined),
  );
  const ctx: ProcessContext = {
    tools,                                   // process chỉ thấy tool trong allowedTools
    session: { id: inputs.sessionId as string, cwd: inputs.cwd as string },
    input: inputs,
    spawn: async (goal, opts) => spawnSubagent(goal, opts ?? {}),
    parallel: async (tasks) => Promise.all(tasks.map(t => t())),
  };
  return process(inputs, ctx);
}

async function spawnSubagent(goal: string, opts: { allowedTools?: string[] }): Promise<string> {
  // A1: agent spawn — depth limit, allowedTools passthrough
  return `subagent:${goal}`; // placeholder — nối packages/agent createAgent
}
// Usage:
// const out = await runProcess(myProcess, { cwd: "/repo", sessionId: "s1" }, ["read", "bash"], fullTools);
// → process gọi được gì = allowedTools (code), prompt nói gì không quan trọng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Capability từ code (prompt không vượt được) | ❌ Process viết code → cần dev skill (không phải ai cũng viết) |
| ✅ Test được (function + mock ctx) | ❌ vm sandbox không phải security boundary (phải tin process) |
| ✅ Type-check + version control | ❌ Process cứng hơn prompt (đổi flow cần sửa code) |
| ✅ Deterministic hơn (code ít mơ hồ) | ❌ Tool surface phải cấp đúng (cấp thiếu → process bó tay) |

## Khác các hướng gần

| | Process-as-Prompt | DSL (YAML flow) | ZG: Process-as-Code |
|---|---|---|---|
| Capability | Mềm (LLM tự hiểu) | Giới hạn cú pháp | **Code thật** |
| Test | Không | ⚠️ | **✅ unit test** |
| Linh hoạt | Cao | Thấp | **Cao (JS)** |

## Khi nào chọn

- Process có logic phức tạp (branch, retry, budget) cần code thật
- Muốn capability giới hạn bằng code không phải lời nhắc
- Cần test process (mock ctx) trước khi chạy thật
- Nối packages/workflows runner.ts + agent index.ts (spawn) + core loop.ts; guard ctx-surface (chỉ expose tool được cấp), process-trust (process = trusted code, không chạy untrusted), và determinism (ctx.parallel deterministic); ZG = process-as-code, kết hợp 679 ZC two-loops-control-plane (control loop chạy process) + 682 ZF evidence-driven-completion (process trả artifact+evidence)
