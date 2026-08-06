# Hướng CH: Agent Topology — chọn cấu trúc liên kết giữa các agents

> **Nguồn gốc:** "A Taxonomy of Hierarchical Multi-Agent Systems" (arXiv 2508.12683, 2025); surveys orchestration (2026)
> **Coupling:** 🟢 — topology là cấu hình, đổi không đụng agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (intercom+kanban sẵn; thiếu topology config layer)
> **Effort:** 1 tuần

## Nguồn gốc

Agent topology — **cấu trúc liên kết** giữa agents, phân loại theo: **control hierarchy** (ai điều khiển ai), **information flow** (tin chảy thế nào), **delegation** (ai giao việc cho ai) (arXiv 2508.12683, 2025). Các hình chính: **star** (1 coordinator trung tâm — mọi thứ qua nó), **hierarchical** (cây — manager/worker), **mesh** (ngang hàng — ai nói với ai), **ring/sequential** (chuyền tay), **federation** (các nhóm độc lập họp mặt). Khác các hướng "cơ chế" (handoff, gossip, blackboard...) — topology là **lớp cấu trúc bên trên**: cùng 1 cơ chế handoff có thể chạy star hoặc mesh. Bài toán: **chọn đúng topology cho workload** — star đơn giản nhưng nghẽn 1 điểm; mesh linh hoạt nhưng khó debug; hierarchical scale tốt nhưng cứng nhắc.

## Mô tả

mya khai báo **topology** cho nhóm agents (giống AAAA/CCC chạy trên nền nào): mặc định **star** (triage là coordinator — hiện tại gần vậy) — khi workload đổi: nhiều chuyên gia ngang hàng → **mesh** (intercom direct); quy trình dây chuyền (review chain) → **ring**; team lớn → **hierarchical** (supervisor GG + subagents XX). Topology config = 1 file (nối HHHH spec): nodes + edges + ai nói với ai qua kênh nào (intercom/blackboard/stigmergy). Đổi topology = đổi config, không đổi agent. Đo bằng: latency (đường chéo dài quá), nghẽn (star coordinator overloaded — JJJ), chi phí message (mesh spam — SS).

## Kiến trúc

```
  STAR (default)        HIERARCHICAL        MESH             RING
     triage                sup                 A──B          A→B→C→A
      / | \                / \                 │╲│
     A  B  C             w1  w2                C─D
  đơn giản            scale tốt           linh hoạt       dây chuyền
  nghẽn 1 điểm        cứng nhắc           khó debug       ít băng thông

  TOPOLOGY CONFIG (nối HHHH spec):
  nodes: [triage, A, B, C]
  edges: { triage: [A,B,C] }        // star → mesh: edges đầy đủ
  channel: intercom                 // hay blackboard (LL) / stigmergy (T)
```

```
mya: intercom (channel) + kanban (delegation) + GG/XX (hierarchical) SẴN
     thiếu: topology config + router giữa các hình + metrics so sánh
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/intercom — channel (mesh/star đều chạy được)
// ✅ packages/print/src/role-subagent-spawn.ts — worker (hierarchical)
// ✅ GG supervisor + UU escalation — cây phân cấp
// ✅ packages/tools/src/kanban-sqlite.ts — delegation trung tâm (star-ish)
// ✅ JJJ observability — đo latency/nghẽn để chọn topology

// ❌ THIẾU: topology config layer (khai báo nodes/edges — nối HHHH)
// ❌ THIẾU: metric-driven chọn hình (đo nghẽn → đề xuất mesh)
// ❌ THIẾU: chuyển topology runtime (không đụng agent)
```

## Implementation

```typescript
// packages/intercom/src/topology.ts (NEW)
type Topology = "star" | "hierarchical" | "mesh" | "ring";

interface TopoConfig {
  kind: Topology;
  nodes: AgentId[];
  edges: Array<[AgentId, AgentId]>;      // ai nói với ai
  channel: "intercom" | "blackboard" | "stigmergy";
}

function routeMessage(cfg: TopoConfig, from: AgentId, to: AgentId): Path {
  switch (cfg.kind) {
    case "star": return viaCoordinator(from, to);          // qua triage
    case "mesh": return direct(from, to);                  // intercom trực tiếp
    case "hierarchical": return viaSupervisor(from, to);   // GG
    case "ring": return viaRing(from, to);                 // chuyền tay
  }
}

// JJJ metrics → đề xuất đổi topology: star nghẽn → mesh; debug khó → star
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chọn đúng hình cho workload — không "1 kích cỡ" | ❌ Đổi hình đổi hành vi (debug lại — JJJ bù) |
| ✅ Config-level: đổi topology không đụng agent | ❐ Nghẽn/đường chéo phải đo được (JJJ) |
| ✅ Star bắt đầu an toàn, mesh khi cần tốc độ | ❌ Mesh spam messages (SS chặn) |
| ✅ Nối HHHH spec + BBB cards | ❌ Topology phức = ẩn lỗi (trailing edge) |

## Khác các hướng gần

| | CCC Handoff | AAA Gossip | IIII: Topology |
|---|---|---|---|
| Cấp độ | Cơ chế chuyển quyền | Cơ chế lan truyền | **Cấu trúc liên kết** |
| Quyết định | Ai kế tiếp | Lan cho ai | **Ai nói với ai (edges)** |
| Mối quan hệ | Chạy trên topology | Chạy trên topology | **Lớp trên cùng** |

## Khi nào chọn

- Nhiều agent, chưa rõ ai nên nói với ai
- Star đang nghẽn (triage quá tải — JJJ đo)
- Muốn khai báo cấu trúc 1 nơi (HHHH spec)
- Đã có intercom + GG/XX — chỉ cần config layer