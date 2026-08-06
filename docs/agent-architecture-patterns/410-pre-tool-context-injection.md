# Hướng OT: Pre-Tool Context Injection — hooks PreToolUse chèn ngữ cảnh file đang đọc vào prompt

> **Nguồn gốc:** agentmemory (PreToolUse hooks); "inject context before tool execution"; "pre-tool context enrichment"; "memory-aware tool hooks"; "file-context injection on read"
> **Coupling:** 🟡 — thêm PreToolUse hook layer + context injection
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (lifecycle-hooks + tool-dispatch sẵn — chưa có pre-tool context injection hook)
> **Effort:** 2-3 tuần

## Nguồn gốc

**agentmemory** có hook **PreToolUse**: **trước khi** agent gọi tool (vd read_file), hook **inject ngữ cảnh liên quan** vào prompt. Vd agent định đọc `auth.ts` → hook tra memory → inject "Lần trước auth.ts có bug X, đã fix Y" vào context trước khi tool chạy. Nguyên tắc: **tool không chạy trong chân không** — inject memory/provenance liên quan đến đối tượng tool **trước** khi thực thi giúp agent quyết định tốt hơn. Khác **292 lifecycle-hooks** — OT là **context-injection** chuyên dụng pre-tool; khác **403 OM windowed-history** — OT inject **theo tool target** (file/symbol) chứ không theo query.

## Mô tả

mya pre-tool context injection: (1) **Hook PreToolUse**: intercept tool call trước dispatch. (2) **Resolve target**: parse tool args → target (file path, symbol, query). (3) **Lookup memory**: tra memory/provenance liên quan target. (4) **Inject context**: thêm memory vào prompt trước khi tool chạy. mya có `292 lifecycle-hooks` + `170 context-engineering` — OT thêm **pre-tool context-injector**.

## Kiến trúc

```
  AGENT DECISION: read_file("src/auth.ts")
        │
        ▼
  ┌─── PreToolUse HOOK (intercept) ─────────────────────┐
  │  before dispatch → resolve target: "src/auth.ts"     │
  └───────────────────────┬───────────────────────────────┘
                          │ target
                          ▼
  ┌─── MEMORY LOOKUP (by target) ──────────────────────┐
  │  memory store → facts about "src/auth.ts":          │
  │    · "auth.ts had bug #142 (timeout), fixed 2024-03"│
  │    · "auth.ts uses OAuth2, depends on session.ts"   │
  │    · provenance: last edited by agent-run #87       │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── CONTEXT INJECTION ──────────────────────────────┐
  │  prompt += `[PRE-TOOL CONTEXT for auth.ts]          │
  │    · Bug #142 (timeout) đã fix                      │
  │    · OAuth2, phụ thuộc session.ts                   │
  │    · Lần sửa cuối: run #87]                         │
  │                                                     │
  │  → LLM thấy context TRƯỚC khi đọc file              │
  │    → quyết định / chú ý đúng                        │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
              TOOL DISPATCH (read_file runs with context)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 292 lifecycle-hooks — event hooks (nền — OT = PreToolUse chuyên dụng)
// ✅ 170 context-engineering — context mgmt (nền — OT inject pre-tool)
// ✅ 355 MQ provenance — source trace (nền — OT inject provenance)
// ✅ tool-dispatch — tool execution (nền — OT hook trước dispatch)

// ❌ THIẕU: PreToolUse hook (intercept before dispatch)
// ❌ THIẕU: target resolver (tool args → file/symbol/query)
// ❌ THIẕU: context injector (memory → prompt pre-tool)
```

## Implementation

```typescript
// packages/agent/src/hooks/pre-tool-context.ts (MỚI)
interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

interface MemoryFact {
  target: string;    // file path / symbol
  text: string;
  provenance?: string;
}

class PreToolContextInjector {
  constructor(
    private store: Map<string, MemoryFact[]>,  // target → facts
  ) {}

  // Hook: called before tool dispatch
  hookPreToolUse(call: ToolCall): string | null {
    const target = this.resolveTarget(call);
    if (!target) return null;

    const facts = this.store.get(target);
    if (!facts || facts.length === 0) return null;

    const lines = facts.map(f => `  · ${f.text}${f.provenance ? ` (${f.provenance})` : ''}`);
    return `[PRE-TOOL CONTEXT for ${target}]\n${lines.join('\n')}`;
  }

  // Resolve tool target from args
  private resolveTarget(call: ToolCall): string | null {
    // read_file / edit → file path
    if (call.args.path) return call.args.path as string;
    if (call.args.file) return call.args.file as string;
    // grep → pattern
    if (call.args.pattern) return `pattern:${call.args.pattern}`;
    return null;
  }
}

// Wiring with 292 lifecycle-hooks:
// hooks.before('tool-call', (call: ToolCall) => {
//   const ctx = injector.hookPreToolUse(call);
//   if (ctx) prompt.append(ctx);   // inject before dispatch
// });

// Usage:
// const inj = new PreToolContextInjector(memoryStore);
// agent reads src/auth.ts →
//   hook injects "Bug #142 fixed, OAuth2, depends session.ts"
//   → LLM aware before reading
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent biết context trước khi dùng tool | ❌ Latency (lookup mỗi tool call) |
| ✅ Tránh lặp lỗi (inject "đã bug ở đây") | ❌ Noise (inject không liên quan → distract) |
| ✅ Provenance-aware (ai sửa cuối) | ❌ Target resolve miss (tool args phức tạp) |
| ✅ Nối 292 hooks (reuse) + 355 provenance | ❌ Prompt phình (nhiều fact → token tăng) |

## Khác các hướng gần

| | 292 Lifecycle-Hooks | 403 OM Windowed-History | 170 Context-Engineering | OT: Pre-Tool-Inject |
|---|---|---|---|---|
| Cái gì | Event hooks | Include chat window | Context mgmt | **Inject trước tool** |
| Trigger | Any event | Memory query | Context build | **PreToolUse** |
| Target | ❌ | query | ❌ | ✅ file/symbol |
| Timing | Post/Pre | Search | Build | **Before dispatch** |

## Khi nào chọn

- Tool thao tác file/symbol (read/edit/grep) cần context lịch sử
- Muốn agent tránh lặp lỗi (inject "đã bug")
- Cần provenance-aware (ai sửa cuối, khi nào)
- Nối 292 lifecycle-hooks (hook base) + 355 MQ provenance (inject source) + 170 context-engineering; guard latency (cache lookup) + noise (cap injected facts)
