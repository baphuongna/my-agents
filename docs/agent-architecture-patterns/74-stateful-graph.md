# Hướng BV: Stateful Graph Orchestration — agent workflow như đồ thị trạng thái

> **Nguồn gốc:** LangGraph (LangChain, 2024-2026); Temporal plugin integration (2025)
> **Coupling:** 🟢 — node là module độc lập, graph nối chúng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (workflow runner sẵn; thiếu graph DSL + checkpoint per node)
> **Effort:** 2 tuần

## Nguồn gốc

Stateful graph orchestration (LangGraph — framework agent 2024-2026 phổ biến nhất): workflow là **đồ thị trạng thái** — **nodes** (agent step, tool call, human decision), **edges** (luồng điều khiển: normal, conditional — quyết định bằng LLM output), **shared state** (mọi node đọc/ghi), **checkpoint sau mỗi node** (crash = resume từ checkpoint, không chạy lại từ đầu), **interrupts** (dừng giữa graph chờ con người quyết định — HITL). Khác **AA Reactive Dataflow** (FRP — stream dữ liệu qua hàm thuần, không có state machine) — graph có *chu trình, điều kiện, checkpoint*; khác **TT Checkpoint** (thủ công) — checkpoint tự động per node; khác **DD Reconcile** (hướng infra/K8s) — graph hướng agent logic.

## Mô tả

mya định nghĩa tiến trình phức tạp thành **graph** (thay vì agent loop tuyến tính): nodes = các giai đoạn (analyze → plan → execute → review → fix); conditional edges = LLM quyết định đi nhánh nào (review fail → quay lại execute — **chu trình**, không phải pipeline 1 chiều); shared state = kanban task + findings; checkpoint sau mỗi node = resume an toàn (nối VVV durable + TT). Interrupts = dừng ở "approval node" chờ user quyết định rồi tiếp tục. `packages/workflows` runner (vm sandbox, SOP) đã có nền script hóa — graph là **lớp cấu trúc** trên runner: thay vì script tuyến tính, khai báo nodes/edges + state.

## Kiến trúc

```
                    ┌────────────────────────────┐
                    │       SHARED STATE          │ (kanban + findings + session)
                    └────────────────────────────┘
                              ▲
  [analyze] ──► [plan] ──► [execute] ──► [review] ──► done ✅
                              ▲            │
                              │            └─ fail (conditional edge)
                              └────────────┘ (chu trình — review quyết định quay lại)

  • nodes: agent/tool/human step — module độc lập
  • conditional edge: LLM chọn nhánh (review verdict)
  • checkpoint per node: crash → resume (TT/VVV)
  • interrupt: approval node dừng chờ user → tiếp tục
```

```
mya: packages/workflows (runner vm sandbox) + session JSONL (TT) sẵn
     thiếu: graph DSL (nodes/edges/state) + checkpoint per node + interrupt
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows — runner (vm sandbox, SOP script) — nền node execution
// ✅ session JSONL (TT) — checkpoint thô (nâng thành per-node)
// ✅ packages/tools/src/kanban-sqlite.ts — shared state (kanban task)
// ✅ packages/print/src/role-subagent-spawn.ts — node thực thi (subagent)

// ❌ THIẾU: graph DSL — khai báo nodes/edges/conditional (hiện script tuyến tính)
// ❌ THIẾU: checkpoint tự động sau mỗi node (resume không chạy lại)
// ❌ THIẾU: interrupt/HITL — dừng giữa graph chờ quyết định người
```

## Implementation

```typescript
// packages/workflows/src/graph.ts (NEW)
interface GraphNode { name: string; run(ctx: GraphCtx): Promise<NodeResult> }
interface GraphEdge {
  from: string;
  to: string | ((state: unknown, result: NodeResult) => string); // conditional
}

class StatefulGraph {
  constructor(private nodes: GraphNode[], private edges: GraphEdge[]) {}

  async run(initial: unknown, checkpoint?: Checkpoint): Promise<FinalState> {
    let node = checkpoint?.node ?? this.edges[0].from;    // resume từ checkpoint
    const state = checkpoint?.state ?? initial;
    while (node !== END) {
      const result = await this.nodes.find((n) => n.name === node)!.run(state);
      await saveCheckpoint(node, state, result);          // sau mỗi node (TT)
      node = this.route(node, state, result);             // normal hoặc conditional
      if (this.needsInterrupt(node)) await humanGate(node);  // HITL: chờ duyệt
    }
    return state;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chu trình + điều kiện — không gò vào pipeline 1 chiều | ❌ Graph phức → khó debug (JJJ trace bù) |
| ✅ Checkpoint per node tự động — resume không chạy lại | ❌ Shared state cần schema rõ (mọi node cùng đọc/ghi) |
| ✅ Interrupt/HITL chính là 1 node — không hack vào loop | ❌ Conditional edge do LLM — quyết định có thể loop vô hạn (SS chặn) |
| ✅ Runner sẵn — thêm lớp khai báo graph | ❌ Overhead cho task đơn giản (graph > tuyến tính) |
| ✅ Kết hợp VVV (durable) + TT (checkpoint) tự nhiên | |

## Khác các hướng gần

| | AA Reactive Dataflow | TT Checkpoint | WWW: Stateful Graph |
|---|---|---|---|
| Cấu trúc | Stream dữ liệu | Chuỗi step + save | **Đồ thị nodes/edges/state** |
| Chu trình | Không (DAG) | Không | **Có** (review → execute lại) |
| Điều kiện | Stream operator | Không | Conditional edge (LLM) |
| Checkpoint | Không | Thủ công | **Tự động per node** |

## Khi nào chọn

- Tiến trình có nhánh/vòng lặp (review-fix, retry-with-feedback) — pipeline 1 chiều không đủ
- Muốn HITL là node chính thức (approval giữa chừng)
- Muốn checkpoint tự động per node (nối VVV/TT)
- Đã có workflow runner — thêm graph DSL là bước ngắn