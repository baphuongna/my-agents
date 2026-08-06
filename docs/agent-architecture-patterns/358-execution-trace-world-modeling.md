# Hướng MT: Execution Trace World Modeling — agent viết code build world-model/simulator môi trường

> **Nguồn gốc:** WorldCoder (agent viết code → build world model from execution traces); "executable world model"; "learn-to-simulate"; "programmatic environment model"; "model-based RL with learned code"; "inductive program synthesis"; "trace-driven modeling"
> **Coupling:** 🟡 — agent thêm code-writing loop cho world model, ảnh hưởng planning
> **Agent-agnostic:** ⚠️ (cần tích hợp vào agent loop + tool exec)
> **Code sẵn:** ⚠️ (world-model 239 + dream-cycle + tool exec sẵn — chưa có code-generation world model)
> **Effort:** 4-6 tuần

## Nguồn gốc

**WorldCoder**: thay vì LLM "tưởng tượng" world model (239 IE — learned prediction), agent **viết code** (program) để mô hình môi trường. Mỗi execution trace (action → observation) → agent suy luận quy luật → **viết hàm** mô phỏng (`simulate(state, action) → state'`). Code world model **deterministic**, **inspectable** (đọc được logic), **verifiable** (chạy test so sánh prediction vs thực). **Inductive program synthesis**: từ examples (traces) → tổng hợp program. Nguyên tắc: **code là world model rõ ràng nhất** — không phải blackbox LLM, mà là **executable, debuggable, composable**. Khác **239 world-model** (LLM predict) — MT **code simulate**; khác **287 program-aided** (LLM dùng code tính toán) — MT **code là model môi trường**.

## Mô tả

mya execution trace world modeling: agent thu thập execution traces (tool call → result), suy luận quy luật môi trường → **viết code** world model (`packages/agent/world-model.ts`). VD: agent thấy `rm file` → file gone; `write file` → file exists → viết `simulate(state, {tool:'rm', path}) → {...state, files: state.files.filter(f => f !== path)}`. Code model **testable** (so sánh simulate vs actual observation) — nếu sai → agent **sửa code** (inductive loop). Nối 239 world-model (concept), 119 bounded-self-correction (fix model khi prediction sai), 287 program-aided (code execution), dream-cycle (offline model refinement). Agent "hiểu" môi trường qua **executable code**.

## Kiến trúc

```
  EXECUTION TRACES (tool call → observation)
   [{action: rm, path: X} → files: [..., no X]]
   [{action: write, path: Y} → files: [..., Y]]
       │
       ▼
  ┌─── INDUCTIVE SYNTHESIS ─────────────────────┐
  │                                             │
  │  Agent suy luận quy luật từ traces:         │
  │   "rm removes file, write creates file"     │
  │                                             │
  │  → WRITE CODE world model:                  │
  │  function simulate(state, action):          │
  │    if action.tool == 'rm':                  │
  │      return removeFile(state, action.path)  │
  │    if action.tool == 'write':               │
  │      return addFile(state, action.path)     │
  │                                             │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼
  ┌─── VERIFY (test simulate vs actual) ────────┐
  │                                             │
  │  predict(trace) vs actual observation       │
  │    ┌─────┴─────┐                           │
  │    │ MATCH      │ MISMATCH                  │
  │    └─────┬─────┘                           │
  └──────────┼─────────────────────────────────┘
             │              │
        MODEL OK       FIX CODE (inductive loop — 119)
             │              │
             ▼              ▼
  PLANNING: agent dùng simulate() để preview actions
  (cheaper/safer than real execution — như 239)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 239 IE world-model — concept (nền — MT là code version)
// ✅ packages/memory/src/dream-cycle.ts — offline consolidation (refine model)
// ✅ 119 bounded-self-correction — fix when prediction wrong (MT fix loop)
// ✅ 287 program-aided-lm — code execution (nền)
// ✅ 12 event-stream — execution traces (source)
// ✅ packages/tools — tool execution (trace source)

// ❌ THIẾU: trace collection (tool call → observation log for synthesis)
// ❌ THIẾU: inductive code synthesis (traces → world model code)
// ❌ THIẾU: model verification (simulate vs actual — test)
// ❌ THIẾU: model-driven planning (preview actions via simulate)
```

## Implementation

```typescript
// packages/agent/src/code-world-model.ts (NEW)
interface Trace {
  action: { tool: string; args: Record<string, unknown> };
  preState: Record<string, unknown>;
  observation: Record<string, unknown>;   // post-state
}

class CodeWorldModel {
  private modelCode = '';  // generated simulate() function source
  private simulateFn?: (state: unknown, action: unknown) => unknown;

  // Collect trace + attempt to refine model
  observe(trace: Trace): void {
    this.traces.push(trace);
    if (this.traces.length >= 5) this.refine();  // enough data → synthesize
  }

  // Inductive synthesis — write/update simulate() from traces
  async refine(): Promise<void> {
    const prompt = this.buildSynthesisPrompt(this.traces);
    const code = await this.llm.generate(prompt);  // agent writes simulate() code
    if (this.verify(code)) {                       // test against traces
      this.modelCode = code;
      this.simulateFn = new Function('state', 'action', code) as typeof this.simulateFn;
    } else {
      // MISMATCH → bounded self-correction (119): re-prompt with failure
    }
  }

  // Verify — does simulate match all recorded traces?
  private verify(code: string): boolean {
    const fn = new Function('state', 'action', code);
    return this.traces.every(t => {
      const predicted = fn({ ...t.preState }, t.action);
      return JSON.stringify(predicted) === JSON.stringify(t.observation);
    });
  }

  // Use model — preview action without executing (planning aid)
  predict(state: unknown, action: unknown): unknown | null {
    return this.simulateFn ? this.simulateFn(state, action) : null;
  }

  private traces: Trace[] = [];
  private llm: { generate(p: string): Promise<string> } = undefined as unknown as { generate(p: string): Promise<string> };
  private buildSynthesisPrompt(_t: Trace[]): string { return ''; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ World model inspectable/debuggable (code, not blackbox) (WorldCoder) | ❌ Code synthesis quality (LLM may generate buggy model) |
| ✅ Deterministic + testable (simulate vs trace) | ❌ Complex env hard to model in code |
| ✅ Cheaper planning (simulate, not real exec — 239) | ❌ Verify loop cost (test all traces) |
| ✅ Agent "hiểu" môi trường (code = explicit rules) | ❌ 4-6 tuần effort (synthesis + verify + planning) |

## Khác các hướng gần

| | 239 IE World Model | 287 Program-Aided | 119 Self-Correction | MT: Code World Model |
|---|---|---|---|---|
| Model | LLM predict (blackbox) | Code for calc | Fix logic | **Code IS model (inspectable)** |
| Verify | ❌ (LLM) | ❌ | ❌ | **✅ simulate vs trace** |
| Synthesis | ❌ | ❌ | ❌ | **✅ inductive from traces** |

## Khi nào chọn

- Môi trường có quy luật rõ (file system, shell, API) — code mô tả được
- Muốn world model inspectable/debuggable (không blackbox)
- Planning cần cheap simulation (predict trước khi act)
- Kết hợp 239 world-model (concept) + 119 self-correction (fix loop) + 287 program-aided (exec) + dream-cycle (offline refine); start with simple deterministic tools (file/shell)
