# Hướng CW: Dynamic Tool Selection — chọn subset tool tối ưu cho từng turn

> **Nguồn gốc:** "Dynamic Tool Selection for AI Agents — Solving Context Management" (lunar.dev 2026); solo.io MCP progressive disclosure 2026
> **Coupling:** 🟡 — chèn router tool, cần danh mục metadata
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (registry OO sẵn; thiếu selector)
> **Effort:** 1-2 tuần

## Nguồn gốc

Dynamic tool selection: **thay vì nhét toàn bộ tool list vào prompt, chọn subset liên quan cho mỗi turn** — lunar.dev 2026: "Dynamic tool selection enables agents to work with massive tool libraries that would otherwise exceed context window limits"; solo.io 2026: tools "appear, disappear, or even change during runtime — the tool list itself is dynamic". Cách làm: **tool index metadata** (name + 1-line + tags) → **selector** (embedding query ↔ tool description, hoặc router model nhỏ — PPPP) → top-k tools đưa vào turn. Khác **VVVV progressive disclosure** (agent tự mở theo nhu cầu trong task-flow) — dynamic selection là *chủ động chọn subset trước mỗi turn* (ngang với intent); khác **RR few-shot** (chọn từ star-few manually) — XXXX do router tự chọn + scale được hàng trăm tools. Tương tự DD (chọn model) — XXXX chọn *tool*.

## Mô tả

mya selector (trước mỗi LLM turn — packages/ai + OO): (1) **tool index** — registry giữ metadata embedding (name, mô tả, tags, điều kiện); (2) **select** — embed user intent + task state → top-k (k tùy ngưỡng token — VVVV liên quan); (3) **tool pool** — k core tools (luôn có: file/exec/bash/kanban) + top-k chọn; (4) **fallback** — agent thấy thiếu tool → gọi "list_more_tools(tag)" → mở rộng (nối FFFF discovery); (5) **đo** — hit tool đúng turn (trace QQQQ → tinh chỉnh selector). Kết hợp: subset nhỏ → context ngắn (MMMM cache + WWWW ít nén) → rẻ + chính xác. MCP tools (80+) của mya chính là lý do — không thể nhét hết.

## Kiến trúc

```
  TOOL INDEX (OO registry metadata + embedding: name/desc/tags)
        │
  TURN: intent + state ──► embed
        │
        ▼
  SELECTOR top-k = CORE (file/exec/kanban — luôn có)
                + top-k intent (embedding similarity)
        │
        ▼
  PROMPT (chỉ subset) ──► LLM turn (context ngắn — MMMM/WWWW lợi)
        │ agent thiếu tool
        ▼
  list_more_tools(tag) ──► mở rộng pool (FFFF discovery phối)
        │
        ▼
  đo: hit tool đúng turn (QQQQ trace) → tinh chỉnh metadata/selector
```

```
mya: OO registry SẴN (80+ tools) — đang nhét TOÀN BỘ vào prompt
     thiếu: tool index metadata + selector top-k
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools OO — registry (mô tả/tags — nền index)
// ✅ PPPP local — router nhỏ chọn tool (rẻ)
// ✅ VVVV disclosure — mở spec khi chọn tool (phối hợp)
// ✅ QQQQ trace — đo hit tool (tinh chỉnh)
// ✅ FFFF discovery — list_more_tools (mở rộng)
// ✅ MMMM cache — subset ổn định → cache tốt

// ❌ THIẾU: metadata embedding + selector top-k
// ❌ THIẾU: pool management (core + intent mix)
// ❌ THIẾU: metric tool-hit (QQQQ)
```

## Implementation

```typescript
// packages/ai/src/tool-selector.ts (NEW)
interface ToolIndex { embed(t: ToolSpec): Float64Array; }

function selectTools(index: ToolIndex, intent: string, state: TaskState, k = 12): ToolSpec[] {
  const core = CORE_TOOLS;                       // file/exec/kanban luôn có
  const relevant = topK(index, embed(intent, state), k - core.length);
  return [...core, ...relevant];                 // subset cho turn
}

// agent thiếu tool → list_more_tools(tag) (FFFF):
//   mở rộng top-k theo tag — không cần reload toàn bộ
// hy vọng: subset ổn định → MMMM prefix cache hit cao
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Scale trăm tools không vỡ context (lunar 2026) | ❐ Selector sai → agent thiếu tool (cần list_more) |
| ✅ Context ngắn → rẻ + latency thấp (MMMM/WWWW) | ❌ Metadata embedding thêm hạ tầng |
| ✅ Tool list "động theo runtime" (solo.io 2026) | ❌ Intent-embed suy diễn (state thay đổi theo turn) |
| ✅ Nối FFFF (mở rộng) + QQQQ (đo) | ❌ Core tools lỡ thiếu → task chết giữa |

## Khác các hướng gần

| | RR Few-Shot | VVVV Disclosure | XXXX: Dynamic Select |
|---|---|---|---|
| Chọn tool bởi | Star-few manual | Agent tự mở (task-flow) | **Router chủ động (mỗi turn)** |
| Quy mô | Ít | Medium | **Trăm tools** |
| Mối quan hệ | Gần | Phối (mở spec) | **Cấp teo prompt trước** |

## Khi nào chọn

- Nhiều tools (MCP 80+) vượt context window
- Token cost cao mỗi turn (SS)
- Đã có registry + embedding (memory) — thêm selector
- Chấp nhận cơ chế list_more_tools fallback (FFFF)