# Hướng CB: Context Engineering — chủ động thiết kế context cho agent

> **Nguồn gốc:** arXiv 2603.15690 "Engineering Context, Structure, Evolution Entropy" (2026); cộng đồng 2025-2026
> **Coupling:** 🟢 — context là dữ liệu, đổi không đụng code
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory + prompts + skills sẵn; thiếu context policy layer)
> **Effort:** 2 tuần

## Nguồn gốc

Context engineering (2025-2026) — "context là sản phẩm cần thiết kế": không chỉ prompt, mà **toàn bộ context agent nhận được** — instructions, memory, retrieval, tool schema, dữ liệu không tin cậy (nối RRR) — được **thiết kế chủ động**: cái gì vào, cái gì ra, thứ tự, độ nén, độ tin cậy. arXiv 2603.15690: đo "evolution entropy" — context thay đổi thế nào qua các bước, điều khiển để ổn định. Khác **MM Memory Mgmt** (quản lý lưu trữ 3 tầng) — context engineering là **thiết kế luồng context vào model mỗi lượt** (ngân sách token, thứ tự ưu tiên, nén); khác **ZZZ DSPy** (tối ưu prompt) — context engineering rộng hơn: gồm memory/retrieval/tool/document.

## Mô tả

mya thay "nhét hết vào context" bằng **context policy layer** cho mỗi lượt suy nghĩ: budget context (SS: token trần per role — system/task/memory/tool), thứ tự ưu tiên (system + task luôn đầu, memory theo relevance, tool schemas nén), nén (rolling summary cho transcript cũ — MM tầng 1), độ tin cậy gắn nhãn (untrusted — RRR), loại trừ (prompt cache-friendly — NN: phần ổn định đứng đầu). Đo **entropy** (arXiv 2603.15690): context quá biến động (mỗi lượt thêm thứ mới) → agent mất ổn định; giữ phần lõi ổn định. Mỗi loại task có **context template** (package prompts) + policy (cái gì đủ/thiếu).

## Kiến trúc

```
  lượt suy nghĩ ──► CONTEXT ASSEMBLER (policy layer)
  │  budget theo role (SS): system 10% · task 30% · memory 30% · tools 20% · slack
  │  thứ tự ổn định: [system][task] — đầu (prompt cache NN)
  │  memory: chỉ phần relevant (MM tầng 2-3) + summary cũ (nén)
  │  tool schema: tối giản (ACI) — chỉ tool khả dụng (OO)
  │  dữ liệu ngoài: nhãn untrusted (RRR)
  │  entropy check: lõi có đổi không (arXiv 2603.15690)
  ▼
  context cuối ──► model
```

```
mya: MM (memory) + prompts (template) + OO (tool list) + RRR (tag) + NN (cache) SẴN
     thiếu: assembler + budget per role + entropy measurement
```

## mya ĐÃ CÓ (phần lớn)

```typescript
// ✅ packages/memory — 3 tầng (tầng 1 summary — nén sẵn)
// ✅ packages/prompts — templates (assembler thô)
// ✅ OO ToolRegistry — chỉ list tool khả dụng (giảm schema)
// ✅ NN cache layer — phần context ổn định đứng đầu (cache hit)
// ✅ SS budget — rate/token trần (nền cho per-role budget)

// ❌ THIẾU: context policy layer — assembler 1 nơi (hiện ráp rải rác)
// ❌ THIẾU: budget per role (system/task/memory/tool riêng)
// ❌ THIẾU: entropy measurement (đo độ biến động context giữa các lượt)
```

## Implementation

```typescript
// packages/core/src/context.ts (NEW)
interface ContextPolicy {
  budget: { system: number; task: number; memory: number; tools: number };
  stablePrefix: string[];          // system + task — đầu (cache NN + entropy ổn)
  compress: (old: Transcript) => string;   // MM tầng 1 rolling summary
}

function assembleContext(state: SessionState, p: ContextPolicy): Context {
  const system = p.stablePrefix.join("\n");                    // ổn định tuyệt đối
  const task = truncate(state.task, p.budget.task);            // task hiện tại
  const mem = selectRelevant(state.memory, state.task);        // MM relevance
  const tools = listPermittedTools(state.agent, state.task);   // OO
  const entropy = measureEntropy(state);                        // arXiv 2603.15690
  if (entropy > maxEntropy) compressStablePart(state);          // giảm biến động
  return { parts: [system, task, mem, tools], totalTokens: sum(p.budget) };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context ổn định → hành vi nhất quán (entropy thấp) | ❌ Policy tinh chỉnh theo từng loại task (công) |
| ✅ Cache hit cao (stable prefix) — cắt cost (NN) | ❌ Cắt nhầm phần quan trọng → quality giảm (eval đo) |
| ✅ Ráp từ khối đã có (MM/prompts/OO/RRR/NN) | ❌ Entropy đo cần instrument (JJJ) |
| ✅ Mỗi task có template + policy rõ | ❌ Over-engineering cho task ngắn |
| ✅ Hướng 2026 có nguồn (arXiv 2603.15690) | |

## Khác các hướng gần

| | MM Memory Mgmt | ZZZ DSPy | CCCC: Context Eng |
|---|---|---|---|
| Phạm vi | Lưu trữ (3 tầng) | Prompt tối ưu | **Toàn bộ context mỗi lượt** |
| Đối tượng | Memory | Module signature | Assembler + budget + entropy |
| Liên quan | Nguồn memory | Compile prompt | Điều phối tất cả |

## Khi nào chọn

- Session dài, context phình — model mất trọng tâm
- Tool list nhiều → schema chiếm token (cần OO filter + ACI)
- Muốn cache hit cao (context ổn định đầu)
- Đã có MM/prompts/OO/NN — thêm policy layer