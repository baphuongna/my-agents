# Hướng TB: Branch-Atlas Session-Tree UI — atlas map trực quan toàn bộ cây session-branch, navigate+replay

> **Nguồn gốc:** pi-session-manager (`branch tree`, `datasets.rs`, `model_config`, session-branch tree, `cass-independence-policy`); "session branch tree reconstruction"; "visual atlas of full branch tree"; "navigate + replay branch"; "branch independence policy" | **Coupling:** 🟡 — thêm session-tree atlas (visualize toàn bộ cây branch, navigate + replay node) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (session/branch persist sẵn — chưa có tree-atlas view + navigate/replay) | **Effort:** 4-5 tuần

## Nguồn gốc

**pi-session-manager** quản lý **session-branch tree**: mỗi session có thể **fork branch** (đoạn khám phá, "what-if") → tạo cây branch (main + nhánh). Vấn đề: cây phình to → khó theo dõi nhánh nào ở đâu, cấu trúc ra sao. **Branch Atlas** là **bản đồ trực quan** toàn bộ cây session-branch: node = session/branch point, edge = fork/continue. User **navigate** (zoom/pan, click node → xem metadata), **replay** (click branch → replay transcript đoạn đó), thấy **independence** (branch tách độc lập, không đè main). Nguyên tắc: **toàn cảnh cây + drill-down** — atlas cho cái nhìn tổng thể, click để vào chi tiết/replay. Khác **425 session-branch-tree** (reconstruct data) — TB là **visual atlas UI**; khác transcript thuần — TB **spatial tree map**.

## Mô tả

mya branch-atlas session-tree UI: (1) **Tree build**: từ session/branch persist → build cây (node = session segment/branch point, edge = fork/continue). (2) **Atlas render**: visualize cây (layout — dendrogram/force-directed), node mang metadata (turn range, summary, status). (3) **Navigate**: zoom/pan, click node → inspect metadata, collapse/expand subtree. (4) **Replay**: click branch → replay transcript đoạn đó (xem agent đã làm gì). (5) **Independence**: branch tách độc lập highlight (fork point rõ). mya có session/branch persist — TB thêm **tree builder** + **atlas renderer** + **replay navigator**.

## Kiến trúc

```
  SESSION-BRANCH TREE (persist):
  main ──── A ──┬── B (explore) ── D
                └── C (what-if) ── E
        │
        ▼
  ┌─── ATLAS RENDER (visual tree map) ───────────────────┐
  │        ┌─ B ─ D                                         │
  │   A ───┤            (fork point highlight)             │
  │        └─ C ─ E                                         │
  │  node = session segment (turn range, summary, status)  │
  └───────────────────────┬─────────────────────────────┘
                          │ (click node)
                          ▼
  ┌─── NAVIGATE + REPLAY ────────────────────────────────┐
  │  click B → inspect: "explore parser fix (turn 5-12)"    │
  │  replay → xem transcript đoạn B                         │
  │  collapse/expand subtree                                │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent session/branch persist — branch store (nền — TB build tree)
// ✅ 425 session-branch-tree reconstruction — tree data (nền — TB visualize)
// ✅ transcript/log — replay source (nền — TB replay branch)

// ❌ THIẾU: tree builder (persist → node/edge graph)
// ❌ THIẾU: atlas renderer (layout + visual tree map)
// ❌ THIẾU: navigate (zoom/pan/click inspect)
// ❌ THIẾU: replay navigator (click branch → replay transcript)
```

## Implementation

```typescript
// packages/web/src/branch-atlas.ts (MỚI)
interface TreeNode { id: string; parentId: string | null; forkPoint: boolean; turnRange: [number, number]; summary: string; status: 'active' | 'merged' | 'abandoned' }
interface TreeEdge { from: string; to: string; kind: 'continue' | 'fork' }

class BranchAtlas {
  constructor(
    private loadTree: () => Promise<{ nodes: TreeNode[]; edges: TreeEdge[] }>,
    private loadTranscript: (nodeId: string) => Promise<string>,
  ) {}

  // build tree from persist
  async build(): Promise<{ nodes: TreeNode[]; edges: TreeEdge[] }> {
    return this.loadTree(); // session/branch → graph
  }

  // layout (dendrogram — main spine, branches branch out)
  layout(nodes: TreeNode[], edges: TreeEdge[]): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>();
    const roots = nodes.filter(n => n.parentId === null);
    let y = 0;
    const place = (node: TreeNode, depth: number) => {
      pos.set(node.id, { x: depth * 120, y: (y++) * 60 });
      const children = edges.filter(e => e.from === node.id).map(e => e.to);
      for (const c of children) place(nodes.find(n => n.id === c)!, depth + 1);
    };
    roots.forEach(r => place(r, 0));
    return pos;
  }

  // replay: click node → transcript
  async replay(nodeId: string): Promise<string> {
    return this.loadTranscript(nodeId);
  }
}

// Usage (web UI):
// const { nodes, edges } = await atlas.build();
// const pos = atlas.layout(nodes, edges);
// render tree map; click node → atlas.replay(nodeId) → transcript view
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Toàn cảnh cây branch (không lạc nhánh) | ❌ Layout complexity (cây lớn → render nặng) |
| ✅ Navigate dễ (click node → inspect) | ❌ Tree phình (nhiều branch → clutter) |
| ✅ Replay branch (xem agent làm gì ở nhánh) | ❌ Replay cost (load transcript dài) |
| ✅ Fork point rõ (independence highlight) | ❌ Stale tree (branch cũ chưa prune) |

## Khác các hướng gần

| | 425 Session-Branch-Tree | Transcript view | TB: Branch-Atlas |
|---|---|---|---|
| Cái gì | Reconstruct data | Linear log | **Visual tree atlas map** |
| View | Data | 1D | **2D spatial tree** |
| Navigate | ❌ | Scroll | **zoom/pan/click + replay** |

## Khi nào chọn

- Session có nhiều branch (fork khám phá/what-if) — cần toàn cảnh
- Muốn navigate + replay branch dễ (click → transcript)
- Cần thấy fork point / independence rõ
- Nối packages/agent session/branch persist + 425 session-branch-tree (data) + transcript (replay); guard layout scalability (cây lớn → collapse/cluster), tree pruning (branch cũ/stale), và replay performance (lazy load transcript); TB = visual atlas UI cho session-branch tree, kết hợp 425 (reconstruction)
