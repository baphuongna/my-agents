# Hướng CK: Shared Graph Memory — nhiều agents cùng đọc/ghi 1 graph tri thức

> **Nguồn gốc:** "Multi-Agent Shared Graph Memory" (NODES AI 2026); arXiv 2602.05665 (2026)
> **Coupling:** 🟡 — chia sẻ qua store, không qua message
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory + intercom sẵn; thiếu graph store chung)
> **Effort:** 2-3 tuần

## Nguồn gốc

Multi-Agent Shared Graph Memory: nhiều agents cùng **đọc/ghi chung 1 graph-based memory** — tri thức chia sẻ trực tiếp, không qua message (NODES AI 2026 talk: "how multiple agents can reason over a common graph-based memory, resolution, versioning"). arXiv 2602.05665: graph memory vượt trội multi-session, multi-agent reasoning. Vấn đề cần giải: **resolution** (2 agent gọi cùng 1 thực thể khác tên — merge entity nào), **versioning** (ai đổi gì, quan hệ nào còn hiệu lực), **conflict** (2 agent ghi mâu thuẫn — ai thắng). Khác **KKKK** (memory *của 1 agent* dùng để suy luận) — LLLL là *memory dùng chung* (tri thức tổ, blackboard cấu trúc): khác **LL Blackboard** (message board vô cấu trúc — post tin) — LLLL là graph *có cấu trúc + resolution + versioning* (giống wiki có schema thay vì bảng tin). Khác **T stigmergy** (chia sẻ gián tiếp qua workspace) — LLLL chia sẻ *chủ động qua graph store*.

## Mô tả

mya có **graph store chung** (entity/edge, KKKK schema): mọi agent đọc trước khi hỏi (giảm intercom), ghi sau khi làm (tri thức tổ đọng lại). **Resolution**: entity registry — 2 agent nói "Dự án BOM" / "bom repo" → resolve về 1 entity (nối FFFF discovery registry — entity registry giống hệt). **Versioning**: edge có validFrom — ai đổi gì truy vết (audit VV + EEEE). **Conflict**: ghi mâu thuẫn → timestamp + role priority (agent chủ sở hữu domain thắng). Memory đọc trước (context cho CCCC) + ghi sau (tri thức dùng lại — mọi agent hưởng). Nối KKKK: LLLL = KKKK shared cho cả nhóm.

## Kiến trúc

```
           GRAPH STORE CHUNG (entity/edge, resolution, versioning)
                    ▲ read-before-ask │ write-after-do ▲
      ┌─────────────┴────────────┬─────────────┬─────────────┐
   agent A (dev)             agent B (ops)     agent C (data)
      │                            │                │
  đọc entity "svc-a"           resolve "svc A" ──► SAME (registry)
      │                            │                │
  ghi edge: svc-a ─owns─► deploy   └─ conflict: 2 ghi 1 entity
      ▼                              └─ resolution: role priority + ts
  versioning: ai đổi gì khi nào (audit VV) + validFrom (EEEE)

  Context pipeline: agent hỏi graph TRƯỚC (bớt intercom),
                    ghi graph SAU (tri thức dùng lại — KKKK schema)
```

```
mya: intercom (chia sẻ qua message) + memory (riêng) SẴN
     thiếu: graph store chung + resolution + conflict policy
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/intercom — chia sẻ qua message (giảm bớt nhờ LLLL)
// ✅ packages/memory + KKKK nền — schema entity/edge (mở rộng shared)
// ✅ VV audit + packages/audit — versioning ai đổi gì
// ✅ FFFF discovery — resolution pattern (entity registry tương tự)

// ❌ THIẾU: graph store shared (nhiều agent 1 store)
// ❌ THIẾU: entity resolution pipeline (same/different)
// ❌ THIẾU: conflict policy (role priority + timestamp)
```

## Implementation

```typescript
// packages/memory/src/shared-graph.ts (NEW)
interface SharedGraph {
  readEntity(name: string): Entity;                    // read-before-ask
  writeEdge(from: string, to: string, rel: string,
            { by: AgentId; at: Date; priority: Role }): WriteResult;
}

function resolve(a: string, b: string, reg: EntityRegistry): EntityId {
  return reg.lookup(a) ?? reg.lookup(b) ?? createMerged(a, b);  // FFFF style
}

function conflictPolicy(existing: Edge, incoming: Write): Edge {
  // ai ghi sau + role cao hơn thắng — ghi vào versioning (VV)
  return incoming.priority > existing.by.priority ? incoming : existing;
}

// context: graph đọc trước → intercom hỏi sau (tiết kiệm message — SS)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tri thức tổ — agent không hỏi lại nhau (giảm intercom) | ❌ Resolution/conflict phức tạp (NODES 2026) |
| ✅ Mọi agent hưởng tri thức đã học (không trùng EEEE) | ❌ Graph store = điểm nóng (JJJ đo, T quán) |
| ✅ Có cấu trúc + versioning hơn blackboard LL | ❌ Agent ghi rác → tri thức nhiễm |
| ✅ Versioning (VV) + resolution (FFFF) pattern có sẵn | ❌ Cần kỷ luật write-after-do |
| ✅ Nối KKKK schema — chỉ thêm shared layer | |

## Khác các hướng gần

| | LL Blackboard | T Stigmergy | LLLL: Shared Graph |
|---|---|---|---|
| Hình thức | Board vô cấu trúc | Workspace gián tiếp | **Graph có schema** |
| Cấu trúc | Không | Không | **Entity + edge + version** |
| Vấn đề riêng | — | — | **Resolution + conflict** |
| Mối quan hệ | LLLLLL khác: | LLLLLL khác: | **Cấu trúc hóa blackboard** |

## Khi nào chọn

- Nhiều agent cùng 1 domain (dev/ops/data) — tri thức trùng lặp
- Intercom hỏi đi hỏi lại cùng câu hỏi (JJJ đo được)
- Cần trace ai đổi tri thức gì (VV audit)
- Đã có KKKK + intercom — thêm shared layer + resolution