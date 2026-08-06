# Hướng FY: Tool Orchestration Graph — LLM quản lý luồng tool: subset, song song, phụ thuộc

> **Nguồn gốc:** arXiv 2603.22862 "The Evolution of Tool Use in LLM Agents: From Single-Tool to Orchestrated" (dynamic tool subset, cross-tool dependency modeling, sequential + parallel scheduling, failure recovery); Union.ai "Planner Agent with Parallel Execution" (LLM tạo execution plan → orchestrate specialist agents); IBM "LLM Agent Orchestration" (manage + coordinate LLM với tools/APIs); LangChain "Plan-and-Execute Agents" (faster + cheaper — plan trước rồi execute)
> **Coupling:** 🟡 — runtime phải hỗ trợ graph tool (song song/phụ thuộc)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool pipeline + orchestrator sẵn; thiếu tool graph)
> **Effort:** 2-3 tuần

## Nguồn gốc

Tool orchestration: **không gọi tool lần lượt "ngẫu nhiên" — LLM vẽ graph: chọn subset tool, xác định phụ thuộc, chạy song song hay tuần tự, phục hồi lỗi** — arXiv 2603.22862: "dynamic tool subset selection, cross-tool dependency modeling, sequential and parallel scheduling, failure recovery" (4 trụ chính); Union: "planner agent uses LLM to generate an execution plan, then orchestrate specialist agents — parallel execution"; IBM: "managing and coordinating interactions between LLM and various tools/APIs"; LangChain: "plan-and-execute — faster, cheaper, more performant than previous designs" (tách plan khỏi execute — chạy theo kế hoạch có cấu trúc). Điểm khác **B orchestration** (điều phối agent) và **IIIIIII workflow-as-code** (graph định nghĩa bằng code CỨNG) — ZZZZZZZ *LLM quyết graph động*: (1) subset — chọn đúng tool cho task (không nạp hết — WWWWWW intent); (2) dependency — vẽ quan hệ giữa các tool call (kết quả tool A → input tool B — cross-tool arXiv); (3) scheduling — song song khi độc lập (Union parallel), tuần tự khi phụ thuộc (apxml multi-step flows); (4) recover — 1 tool lỗi: fallback/đi lại graph (NNNNNNN — failure recovery arXiv); (5) plan-execute split — LLM plan trước, executor chạy theo (LangChain cheaper); (6) budget — graph có ràng buộc cost/step (LLLLLLLL). Nối WWWWWW (intent — subset tool), IIIIIII (graph cứng — cạnh muốn động), B (chạy agent), NNNNNNN (recover lỗi), 178 (routing model theo step).

## Kiến trúc

```
  TASK → LLM PLAN (LangChain plan-and-execute: plan TRƯỚC, execute sau)
        │
        ▼
  TOOL SUBSET (arXiv 2603.22862 dynamic selection — đúng tool cần)
   · không nạp hết tool schemas (WWWWWW intent — chống rối)
        │
        ▼
  DEPENDENCY GRAPH (cross-tool modeling): out(tool A) → in(tool B)
        │
        ├── SONG SONG (Union parallel — các nhánh độc lập)
        ├── TUẦN TỰ (apxml multi-step — nhánh phụ thuộc)
        └── LỖI → recover: fallback/đi lại graph (failure recovery — arXiv)
        │
        ▼
  BUDGET (LLLLLLLL — step/cost) · ROUTE model per step (178)
```

```
mya: tool pipeline + orchestrator SẴN — thiếu: dynamic tool graph
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ Tool caller + NNN registry — gọi tool (nền)
// ✅ B orchestration — điều phối (chạy plan)
// ✅ WWWWWW intent — subset tool (chống rối — đã có hướng)
// ✅ NNNNNNN self-heal — recovery lỗi tool (nền)
// ✅ LLLLLLL budget + 178 model routing — ràng buộc chạy
// ✅ IIIIIII graph cứng — nền tư duy graph

// ❌ THIẾU: dynamic tool graph (LLM vẽ plan tool)
// ❌ THIẾU: cross-tool dependency modeling (arXiv)
// ❌ THIẾU: parallel scheduling (Union — chạy song song nhánh độc lập)
```

## Implementation

```typescript
// packages/tool-graph/src/plan.ts (NEW)
export class ToolGraph {
  async plan(task: Task): Promise<Graph> {
    const nodes = llm.chooseTools(task, subset(registry, task));  // arXiv dynamic subset
    return llm.link(nodes); // cross-tool dependency — out A → in B
  }
  async execute(g: Graph): Promise<Out> {
    return schedule(g, {                       // Union/arXiv scheduling
      parallel: independent(g),                // song song nhánh độc lập
      sequential: dependent(g), fallback: recover(g), // NNNNNNN failure recovery
    });
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nhanh + rẻ — plan trước, subset đúng (LangChain plan-and-execute) | ❌ LLM vẽ graph sai → chạy sai luồng |
| ✅ Song song khi độc lập — tiết kiệm thời gian (Union) | ❐ Quản lý phụ thuộc/budget phức tạp |
| ✅ Recovery từng node — lỗi không kéo cả plan (arXiv) | ❌ Plan thêm 1 bước LLM — latency |
| ✅ Xây trên WWWWWW + NNNNNNN + IIIIIII | ❌ Graph quá to — khó debug/giải thích |

## Khác các hướng gần

| | B Orchestration | IIIIIII Workflow-as-Code | ZZZZZZZ: Tool Graph |
|---|---|---|---|
| Người quyết | LLM agent | Code cứng | **LLM vẽ graph tool** |
| Mức | Agent | Workflow | **Tool call (subset/song song)** |
| Quan hệ | Chạy | Khung cứng | **Chạy trong 1 agent — động** |

## Khi nào chọn

- 1 task cần nhiều tool gọi nhau — có phụ thuộc (cross-tool)
- Có nhánh tool độc lập nên chạy song song (Union)
- Muốn tiết kiệm cost — plan trước gọi đúng tool (LangChain)
- Đã có NNN + WWWWWW + NNNNNNN — thêm dynamic graph