# Hướng WC: Batch Op Normalization — batch tool chuẩn hóa ops read/write/edit/bash thành một cú gọi struct (alias o/c/e/p resolve + JSON edits)

> **Nguồn gốc:** pi-agent-flow (batch op normalization); "batch tool normalizes read/write/edit/bash ops into single struct call"; "alias o/c/e/p resolve"; "JSON edits in one call"; "reduce round-trips via op batching" | **Coupling:** 🟡 — thêm batch-op tool vào tool dispatch (normalize 4 op types) | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (read/write/edit/bash tools sẵn — chỉ cần batch wrapper) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-agent-flow** giảm **round-trips** (mỗi tool call = 1 LLM turn) bằng **batch tool**: agent emit **một struct call** chứa **nhiều ops** — read, write, edit, bash — được **chuẩn hóa** (normalized) rồi **thực thi tuần tự** trong 1 turn. Aliases rút gọn: **o**=open(read), **c**=create(write), **e**=edit, **p**=process(bash). Edits dùng **JSON format** (path + old/new) thay vì text literal. Nguyên tắc: **one call, many ops, normalized** — giảm turn count, tăng throughput. Khác single-op-per-call (1 turn/tool call) — WC **batch multiple ops**; khác compound-tool (tool phức tạp) — WC **composition of existing simple tools**.

## Mô tả

mya batch op normalization: (1) **Batch tool**: 1 tool nhận `ops: Op[]` array. (2) **Op types**: read (o), write (c), edit (e), bash (p) — mỗi op normalized thành struct. (3) **Alias resolve**: `o`/`c`/`e`/`p` → full type. (4) **JSON edits**: edit op = `{path, edits: [{old, new}]}` (JSON, không text literal). (5) **Sequential exec**: chạy ops tuần tự, collect results → 1 ToolResult array. mya có read/write/edit/bash tools — WC thêm **batch wrapper** + **alias resolver** + **op normalizer**.

## Kiến trúc

```
  AGENT (1 call, nhiều ops)
  ┌─── batch({ops: [...]}) ─────────────────────────────────┐
  │  ops: [                                                    │
  │    {op:"o", path:"src/a.ts"},           // read           │
  │    {op:"e", path:"src/b.ts",            // edit (JSON)    │
  │     edits:[{old:"foo",new:"bar"}]},                      │
  │    {op:"c", path:"src/c.ts",content:"export const X"},  // write│
  │    {op:"p", cmd:"npm test"}              // bash          │
  │  ]                                                         │
  └───────────────┬─────────────────────────────────────────┘
                  │ (normalize: alias resolve + JSON validate)
                  ▼
  ┌─── NORMALIZE → EXECUTE (tuần tự) ───────────────────────┐
  │  1. read("src/a.ts")        → ToolResult                  │
  │  2. edit("src/b.ts", [...]) → ToolResult                  │
  │  3. write("src/c.ts", ...)  → ToolResult                  │
  │  4. bash("npm test")        → ToolResult                  │
  │  → collect [r1, r2, r3, r4] → 1 ToolResult[] return       │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools read (find.ts/ls.ts) — read tool (nền — WC op "o")
// ✅ packages/tools hashline-edit.ts — edit tool (nền — WC op "e")
// ✅ packages/tools dispatch.ts — tool dispatch (nền — WC batch ở đây)
// ✅ packages/tools codeexec.ts — bash/exec (nền — WC op "p")

// ❌ THIẾU: batch-op tool (1 call → nhiều ops)
// ❌ THIẾU: alias resolver (o/c/e/p → read/write/edit/bash)
// ❌ THIẾU: op normalizer (struct uniform + JSON edits)
```

## Implementation

```typescript
// packages/tools/src/batch-op.ts (MỚI)

type Op =
  | { op: 'o' | 'read'; path: string }
  | { op: 'c' | 'write'; path: string; content: string }
  | { op: 'e' | 'edit'; path: string; edits: { old: string; new: string }[] }
  | { op: 'p' | 'bash'; cmd: string };

interface ToolResult { ok: boolean; output: string }

const ALIAS: Record<string, string> = { o: 'read', c: 'write', e: 'edit', p: 'bash' };

class BatchOpTool {
  constructor(
    private tools: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>,
  ) {}

  // normalize: alias resolve → full type
  private normalize(op: Op): { type: string; args: Record<string, unknown> } {
    const type = ALIAS[op.op] ?? op.op;
    if (type === 'read') return { type, args: { path: op.path } };
    if (type === 'write') return { type, args: { path: op.path, content: op.content } };
    if (type === 'edit') return { type, args: { path: op.path, edits: op.edits } };
    return { type, args: { cmd: op.cmd } };  // bash
  }

  // run: batch ops tuần tự → collect results
  async run(input: { ops: Op[] }): Promise<{ ok: boolean; output: ToolResult[] }> {
    const results: ToolResult[] = [];
    for (const op of input.ops) {
      const { type, args } = this.normalize(op);
      const tool = this.tools[type];
      if (!tool) { results.push({ ok: false, output: `unknown op: ${type}` }); continue; }
      try {
        const result = await tool(args);
        results.push(result);
        if (!result.ok) break;  // fail-fast: dừng nếu op lỗi
      } catch (e) {
        results.push({ ok: false, output: String(e) });
        break;
      }
    }
    return { ok: results.every(r => r.ok), output: results };
  }
}
// Usage:
// const batch = new BatchOpTool({read, write, edit, bash});
// const res = await batch.run({ops:[
//   {op:'o', path:'a.ts'},
//   {op:'e', path:'b.ts', edits:[{old:'x',new:'y'}]},
//   {op:'p', cmd:'npm test'}
// ]});
// // → 1 call, 3 ops, results[] — giảm round-trips
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fewer round-trips (1 call → nhiều ops) | ❌ Fail-fast risk (1 op lỗi → dừng cả batch) |
| ✅ Compact alias (o/c/e/p ngắn hơn full name) | ❌ Error granularity (khó biết op nào fail) |
| ✅ JSON edits (structured, không text literal) | ❌ Atomicity (không rollback op đã chạy) |
| ✅ Higher throughput (LLM ít turn hơn) | ❌ Complexity (agent phải compose ops đúng) |

## Khác các hướng gần

| | Single op per call | Compound tool | WC: Batch-Op-Normalization |
|---|---|---|---|
| Ops/call | 1 | 1 (complex) | **N (read/write/edit/bash)** |
| Round-trips | N | 1 | **1** |
| Alias | ❌ | ❌ | **o/c/e/p** |

## Khi nào chọn

- Agent cần nhiều op liên tiếp (read→edit→test) → giảm round-trips
- Muốn compact syntax (alias o/c/e/p + JSON edits)
- LLM turn count cao → batch giảm throughput bottleneck
- Nối packages/tools dispatch.ts + hashline-edit.ts + codeexec.ts + read tools; guard fail-fast-policy (dừng hay continue khi op lỗi — configurable), op-validation (validate struct trước exec), và atomicity-option (rollback support nếu cần); WC = batch op normalization, kết hợp packages/tools dispatch (reuse existing tools) + 600 WB structured-json (JSON edits relate) + 557 UK lean-ndjson (batch = structured output relate)
