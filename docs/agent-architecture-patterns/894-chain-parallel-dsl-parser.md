# Hướng AHJ: Chain Parallel DSL Parser — parser xử lý step1 -> parallel(step3, step4) -> step5 với nested parallel groups, loop counts step1:3, quoted args và flag --with-context truyền output predecessor

> **Nguồn gốc:** pi-prompt-template-model | **Coupling:** 🟡 — DSL parser + workflow runtime | **Agent-agnostic:** ⚠️ (cần workflow primitives) | **Code sẵn:** ⚠️ (mya có workflows parallel/pipeline primitives, nhưng KHÔNG có DSL string parser) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-prompt-template-model** có **Chain DSL parser**: parse chuỗi `step1 -> parallel(step3, step4) -> step5` thành execution graph. Hỗ trợ: (1) **nested parallel groups** (parallel lồng nhau), (2) **loop counts** `step1:3` (chạy 3 lần), (3) **quoted args** `"prompt với space"`, (4) **flag `--with-context`** truyền output của predecessor step làm context. Parser biến text DSL thành DAG executor chạy tuần tự (chain `->`) + song song (parallel).

Nguyên tắc: **text DSL → DAG** (declarative workflow); **nested parallel** (group lồng); **loop counts** (repeat); **quoted args** (prompt có space); **context piping** (`--with-context` nối output predecessor).

## Mô tả

Với mya, packages/workflows `runner.ts` **đã có orchestration primitives** — `agent(goal)`, `parallel(tasks)`, `pipeline(stages)`, `phase(name)` (line 93+) chạy trong sandbox. Nhưng mya **chưa có** **DSL string parser** parse `step1 -> parallel(...) -> step5` thành graph: (1) nested parallel, (2) loop counts `step:3`, (3) quoted args, (4) `--with-context` piping. Pattern này cho phép user khai báo workflow dạng text ngắn thay vì viết JS sandbox.

## Kiến trúc (ASCII)

```
  DSL: step1 -> parallel(step3, step4) -> step5
                │
                ▼
  Parser → AST:
    Chain([
      Step("step1"),
      Parallel([Step("step3"), Step("step4")]),   // nested group
      Step("step5"),
    ])
                │
                ▼
  Executor:
    step1 → (step3 ‖ step4) → step5
    --with-context: output predecessor → context successor
    loop: step1:3 → chạy step1 ba lần
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows/src/runner.ts — parallel(tasks)/pipeline(stages)/agent(goal)/phase (line 93+)
// ✅ packages/workflows/src/orchestration.test.ts — parallel/pipeline semantics tested
// ✅ packages/workflows/src/rhai-runner.ts — Rhai script runner (DSL-ish)
// ⚠️ KHÔNG có text DSL parser (step1 -> parallel(...) -> step5)
// ❌ KHÔNG có nested parallel, loop counts, quoted args, --with-context piping
```

## Implementation

```typescript
// packages/workflows/src/chain-dsl.ts (NEW)
export type ChainNode =
  | { kind: "step"; name: string; args?: string[]; loop?: number; withContext?: boolean }
  | { kind: "parallel"; children: ChainNode[] };

/** Parse "step1 -> parallel(step3, step4) -> step5" → Chain AST. */
export function parseChain(dsl: string): ChainNode[] {
  return dsl.split("->").map((seg) => parseSegment(seg.trim())).filter(Boolean) as ChainNode[];
}

function parseSegment(seg: string): ChainNode | null {
  if (!seg) return null;
  if (seg.startsWith("parallel(") && seg.endsWith(")")) {
    const inner = seg.slice("parallel(".length, -1);
    const children = splitTopLevel(inner, ",").map((s) => parseSegment(s.trim())!).filter(Boolean);
    return { kind: "parallel", children };
  }
  // step1:3 "arg with space" --with-context
  const m = seg.match(/^([\w-]+)(?::(\d+))?\s*(.*)$/);
  if (!m) return null;
  const [, name, loop, rest] = m;
  const withContext = rest.includes("--with-context");
  const args = parseArgs(rest.replace("--with-context", "").trim());
  return { kind: "step", name: name!, loop: loop ? Number(loop) : undefined, withContext, args };
}

/** Split theo sep nhưng respect parens/quotes (nested-safe). */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []; let depth = 0; let quote = false; let cur = "";
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    else if (ch === "(" && !quote) depth++;
    else if (ch === ")" && !quote) depth--;
    if (ch === sep && depth === 0 && !quote) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseArgs(s: string): string[] {
  return (s.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, ""));   // quoted args
}

// Executor: chạy chain tuần tự, parallel = Promise.all, loop = repeat, withContext = pipe output.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Declarative workflow dạng text ngắn | ❌ Parser phức tạp (nested/quote/loop) — edge case nhiều |
| ✅ Nested parallel + loop + context piping | ❌ DSL riêng → user phải học syntax |
| ✅ Tái dụng workflows primitives (parallel/pipeline) | ❌ Debug DSL lỗi khó (cần good error span) |

## Khác các hướng gần

| | AHJ Chain-Parallel DSL | AHK Delegated Subagent | workflows runner.ts |
|---|---|---|---|
| Trọng tâm | Text DSL → DAG | Delegate chain step sang subagent | Orchestration primitives |
| Cơ chế | parser + parallel/loop/context | chain step → spawnSubagent + worktree | parallel/pipeline/agent |
| Quan hệ | Nối workflow DSL | Nối delegation | Nối workflow runtime |

## Khi nào chọn

- User muốn khai báo workflow dạng text ngắn (không viết JS)
- Cần nested parallel + loop + context piping
- Tái dụng workflows primitives (parallel/pipeline đã có)
- Guard: parser nested/quote-safe, loop count validate, error span rõ, sandbox execute
