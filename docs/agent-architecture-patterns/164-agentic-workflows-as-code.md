# Hướng IIIIIII: Agentic Workflows as Code — workflow DAG/state machine định nghĩa bằng code

> **Nguồn gốc:** arXiv 2509.09915 "The (R)evolution of Scientific Workflows in the Agentic AI Era" (state machine loop — execution unit); Temporal "The Fallacy of the Graph" (durable execution — code not diagram); AWS Step Functions (outer loop for long-running AI workflows); MindStudio "Agentic Workflows: Conditional Logic, Branching, Loops"
> **Coupling:** 🟡 — runtime phải chạy được graph/state machine
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (orchestrator + workflow engine + versioning sẵn; thiếu graph runtime)
> **Effort:** 2-4 tuần

## Nguồn gốc

Workflow-as-code: **quy trình agent định nghĩa bằng code — DAG/state machine chạy được, không vẽ diagram** — arXiv 2509.09915: "Instead of focusing on the DAG, this representation focuses on the execution unit of workflows, the state machine loop"; Temporal "Fallacy of the Graph": "Durable Execution orchestrators let you use normal language constructs (conditionals, loops, exception handling) to schedule tasks dynamically — code, not a diagram"; AWS Step Functions: "state machine pauses execution, passes a unique task token, resumes only when service calls back" (outer loop cho AI workflow); MindStudio: conditional logic, branching, loops. Điểm khác **B orchestration** (mya điều phối agent tự do — LLM quyết bước tiếp) và **C pipeline** (stream data) — IIIIIII *định nghĩa trước bằng code*: workflow = graph rõ ràng (nodes/edges/state — DAG), mỗi node gọi agent/tool/service, conditional branch (state + điều kiện — MindStudio), loop (durable — Temporal: tạm dừng/token/resume), chạy lại từ điểm lỗi (durable state — Step Functions), versioning (FFFF — mỗi workflow là code có version). Nối B (chạy workflow), C (data), E (đồng bộ), 158 (pipeline event-driven), 148 (scheduled), GGGGGG (durable — rewind resume), TTTT (giải thích graph).

## Mô tả

mya workflows-as-code: (1) **graph DSL** — workflow viết bằng code (JSON/YAML hay TS builder — AWS: definition JSON/YAML managed): nodes (agent/tool/service call), edges, condition; (2) **state machine runtime** — executor chạy graph: mỗi node giữ state, đúng state → đúng bước tiếp (arXiv 2509.09915 state machine loop); (3) **conditional + loop** — branch theo kết quả node (MindStudio), loop có giới hạn; (4) **durable** — dừng giữa chừng (Step Functions task token — chờ agent/service callback), lỗi → resume từ node lỗi không chạy lại (Temporal durable execution); (5) **human approval node** — CCCC: node dừng chờ approve (Step Functions human approval workflow); (6) **version + test** — mỗi workflow có version (FFFF), PP eval cho từng workflow.

## Kiến trúc

```
  WORKFLOW = CODE (graph DSL — DAG/state machine)
   · nodes: agent/tool/service · edges · conditional (MindStudio)
   · loops (có giới hạn)
        │
        ▼
  EXECUTOR (state machine loop — arXiv 2509.09915)
   · node nào đúng state → chạy node đó (Step Functions)
        │
        ▼
  DURABLE: lỗi → RESUME từ node lỗi (Temporal — code not diagram)
   · dừng chờ: task token + callback (Step Functions outer loop)
   · human approval node (CCCC — dừng chờ approve)
        │
        ▼
  QUẢN LÝ: FFFF version (workflow là code) · PP eval per workflow
```

```
mya: B + C + 158 SẸN — thiếu: graph runtime + durable resume
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ B orchestration — điều phối (nền chạy workflow)
// ✅ C pipeline + 158 event-driven — data flow
// ✅ EEEE sync — nối đồng bộ
// ✅ 148 scheduled — lịch chạy workflow
// ✅ FFFFFF versioning — version workflow
// ✅ PP eval — test workflow
// ✅ CCCC HITL — approval node

// ❌ THIẾU: graph DSL (workflow-as-code builder)
// ❌ THIẾU: state machine runtime (node/state/transition)
// ❌ THIẾU: durable resume (Temporal — resume từ node lỗi)
```

## Implementation

```typescript
// packages/workflows/src/graph.ts (NEW)
export class Workflow {
  static define(b: Builder): Graph {
    return b.node("research", agent.act).node("write", agent.act)
      .branch("write", w => w.citations > 0 ? "review" : "retry")
      .humanApproval("publish"); // CCCC — dừng chờ approve
  }
  async run(g: Graph, input: Input): Promise<Out> {
    return executor.run(g, input); // state machine loop (arXiv 2509.09915)
  } // durable: lỗi node N → resume từ N (Temporal — code not diagram)
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Xác định — workflow rõ ràng, test được (FFFF + PP) | ❌ Ít linh hoạt — agent không tự quyết bước (B vẫn cần) |
| ✅ Durable — lỗi resume từ node, không chạy lại (Temporal) | ❐ Graph phức tạp khó bảo trì ("fallacy of the graph") |
| ✅ Human approval node giữa quy trình (Step Functions) | ❌ Học DSL + runtime — tốn công build |
| ✅ Xây trên B + C + FFFF | ❌ Loop vô hạn — cần giới hạn (MindStudio) |

## Khác các hướng gần

| | B Orchestration | 158 Pipeline | IIIIIII: Workflow-as-Code |
|---|---|---|---|
| Quyết định | LLM tự do | Event stream | **Code định nghĩa trước (graph)** |
| Độ xác định | Thấp | Cao | **Cao + durable** |
| Quan hệ | Chạy nó | Data vào | **Định nghĩa cấu trúc rõ ràng** |

## Khi nào chọn

- Quy trình agent ổn định, lặp lại — cần xác định + test được
- Workflow dài — cần durable resume (lỗi giữa chừng không chạy lại)
- Cần human approval giữa các bước (Step Functions pattern)
- Đã có B + C + FFFF — thêm graph DSL + state machine runtime