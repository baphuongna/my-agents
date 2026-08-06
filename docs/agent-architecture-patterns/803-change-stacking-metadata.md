# Hướng ADW: Change Stacking Metadata — dependsOn/provides/requires/touches/parent cho change graph

> **Nguồn gốc:** OpenSpec | **Coupling:** 🟡 — metadata trên change, cần graph engine | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn memory graph; thiếu change graph CLI) | **Effort:** 2 tuần

## Nguồn gốc

**OpenSpec** proposal **add-change-stacking-awareness** thêm metadata cho change: **`dependsOn`** — source of truth cho **archive ordering** (change nào phải archive trước); **`provides` / `requires`** — **capability contracts** (không tạo implicit edge — chỉ edge khai báo rõ); **`touches`** — **advisory warning** (cảnh báo nhưng không chặn); **`parent`** — đánh dấu **split** (change con thuộc change cha).

CLI có **`change graph`** (hiển thị DAG) và **`change next`** — suggest **unblocked changes** theo **topological order**: chỉ những change không còn dependency chặn mới được gợi ý làm tiếp. Mục đích: cho phép **stacking** — nhiều change chồng nhau, làm song song an toàn vì biết thứ tự.

## Mô tả

Với mya, `packages/memory` có `graph.ts` + `TypedGraph` (nền graph engine). Pattern thêm: **ChangeGraph** trong `packages/workflows` (hoặc tools) — mỗi change là node với 4 loại edge (dependsOn/provides/requires/touches), **provides/requires là capability contract** — change A provides "auth-v2", change B requires "auth-v2" → edge tự suy từ capability chứ không cần khai tay. CLI `change graph` + `change next` dùng topological sort (đã có pattern trong core session-utils SessionTree?). `touches` chỉ advisory — cảnh báo file đụng nhau nhưng không chặn. Lưu metadata trong change spec (YAML — nối ADV file-based).

## Kiến trúc (ASCII)

```
  CHANGE (metadata)
    ├─ dependsOn: [C2]          — archive ordering (source of truth)
    ├─ provides:  ["auth-v2"]   — capability contract
    ├─ requires:  ["auth-v1"]   — capability contract (edge tự suy)
    ├─ touches:   ["src/x.ts"]  — advisory warning (không chặn)
    └─ parent:    "C1"          — split (change con)
            │
            ▼
  CHANGE GRAPH (DAG)
    C1 (parent)
    ├─ C2 dependsOn C1
    ├─ C3 provides auth-v2, requires auth-v1 (C1)
    └─ C4 touches src/x.ts (C2) — cảnh báo, không chặn
            │
            ▼
  CLI: change graph (vẽ DAG) · change next (topological order)
  → chỉ gợi ý change UNBLOCKED (không còn dependency chặn)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/graph.ts — TypedGraph (nền change graph)
// ✅ packages/memory/src/graph-knowledge.test.ts — graph tests
// ✅ packages/workflows — WorkflowContext (nơi gắn change metadata)
// ✅ packages/core/src/session-utils.ts — SessionTree (nền DAG/tree xử lý)
// ✅ packages/cron — cross-process-lock (an toàn khi nhiều change chạy)

// ❌ THIẾU: ChangeGraph với 4 loại edge (dependsOn/provides/requires/touches)
// ❌ THIẾU: capability matching (requires ↔ provides tự suy edge)
// ❌ THIẾU: CLI change graph + change next (topological order)
```

## Implementation

```typescript
// packages/workflows/src/change-graph.ts (NEW)
export interface ChangeMeta {
  id: string;
  dependsOn: string[];
  provides: string[];
  requires: string[];
  touches: string[];
  parent?: string;
}

export type EdgeKind = "dependsOn" | "requires" | "touches";

export class ChangeGraph {
  private nodes = new Map<string, ChangeMeta>();

  add(c: ChangeMeta): void { this.nodes.set(c.id, c); }

  /** provides/requires là capability contract — edge tự suy, không implicit */
  edges(id: string): Array<{ to: string; kind: EdgeKind }> {
    const c = this.nodes.get(id);
    if (!c) return [];
    const out: Array<{ to: string; kind: EdgeKind }> = [];
    for (const d of c.dependsOn) out.push({ to: d, kind: "dependsOn" });
    for (const r of c.requires) {
      for (const [otherId, other] of this.nodes) {
        if (other.provides.includes(r) && otherId !== id) out.push({ to: otherId, kind: "requires" });
      }
    }
    for (const t of c.touches) {
      for (const [otherId, other] of this.nodes) {
        if (other.touches.includes(t) && otherId !== id) out.push({ to: otherId, kind: "touches" });
      }
    }
    return out;
  }

  /** change next — unblocked theo topological order (dependsOn + requires) */
  next(): string[] {
    const done = new Set<string>();
    const result: string[] = [];
    let progress = true;
    while (progress && result.length < this.nodes.size) {
      progress = false;
      for (const [id, c] of this.nodes) {
        if (done.has(id)) continue;
        const blocked = c.dependsOn.some((d) => !done.has(d)) ||
          c.requires.some((r) => ![...this.nodes.values()].some((o) => o.provides.includes(r) && done.has(o.id)));
        if (!blocked) { done.add(id); result.push(id); progress = true; }
      }
    }
    return result; // touches KHÔNG chặn — chỉ advisory
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Stacking an toàn — biết thứ tự archive | ❌ Metadata phải khai đúng mới có giá trị |
| ✅ Capability contract — edge tự suy, hết implicit | ❌ Graph phức tạp với nhiều change |
| ✅ touches advisory — cảnh báo không chặn | ❌ provides/requires tên lệch → edge thiếu |
| ✅ change next gợi ý unblocked — song song được | ❌ parent/split cần convention rõ |

## Khác các hướng gần

| | ADW Change Stacking | ADX Split Scaffolding | ADG tmux Team |
|---|---|---|---|
| Trọng tâm | Metadata + graph | Chia change lớn | Worker song song |
| Cơ chế | dependsOn/provides/requires | parent + stub tasks | File state |
| Output | change next (topo order) | Child slices | Worker results |

## Khi nào chọn

- Nhiều change chồng nhau cần làm song song an toàn
- Archive phải đúng thứ tự (dependsOn)
- Đã có TypedGraph + workflows — thêm change metadata
- Muốn capability contract thay vì implicit edge