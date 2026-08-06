# Hướng PI: Session Branch Tree Reconstruction — tái dựng cây nhánh từ JSONL, suy lá active từ mục cuối

> **Nguồn gốc:** pi-session-manager (inspect.ts, trace.ts, entry parsing — parentId/branch); "branch tree reconstruction"; "active leaf inference"; "conversation forking"; "JSONL entry lineage"
> **Coupling:** 🟢 — thêm branch tree reconstruction vào session viewer/inspector
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (entry parsing với parentId/parentSession sẵn — chưa có tree build + active leaf inference trong mya)
> **Effort:** 1-1.5 tuần

## Nguồn gốc

**pi-session-manager** (`inspect.ts`, `trace.ts`) parse session JSONL → entries có `parentId` (link tới entry cha) và `parentSession` (header field, link tới session cha khi fork). Entry đầu (`entries[0]`) là **header** — chứa `version`, `parentSession` (null nếu root session). Mỗi entry có `id` + `parentId` → tạo thành **cây nhánh** (mỗi entry có thể có con khi user fork/branch). Active leaf = **entry cuối cùng** trong JSONL (suy luận: mục cuối = leaf hiện tại). `branch_summary` entry type đánh dấu điểm compaction/branch — khi rẽ nhánh, branch_summary tóm tắt nhánh cũ. `compaction` entry ghi `firstKeptEntryId` — biết entry nào được giữ sau compaction. Nguyên tắc: **session là cây, không phải list** — reconstruct tree từ parentId, suy leaf active từ entry cuối. Khác **423 PG lineage-recall** (recall scope theo branch) — PI là **tree reconstruction** (build cây từ JSONL).

## Mô tả

mya session branch tree reconstruction: load session JSONL → **reconstruct branch tree** — (1) **Parse entries**: mỗi entry có `id`, `parentId`, `type` (header, message, compaction, branch_summary, custom). (2) **Build tree**: parentId link → parent-child → build cây (root = header). (3) **Infer active leaf**: entry cuối trong JSONL = active leaf (đang ở đây). (4) **Identify branches**: `branch_summary` entry = điểm fork (nhánh mới tách từ nhánh cũ). (5) **Compaction tracking**: `compaction` entry `firstKeptEntryId` → biết prefix nào bị bỏ sau compaction. Agent có thể inspect "session này có bao nhiêu nhánh", "nhánh active là gì", "nhánh cũ nói gì" — reconstruct từ JSONL. mya có session viewer — PI thêm **branch tree builder** (parentId → tree + active leaf inference).

## Kiến trúc

```
  JSONL ENTRIES (session file):
  ┌──────────────────────────────────────────────────┐
  │ [0] header    { id:"h1", parentSession: null }    │ ← ROOT
  │ [1] message   { id:"m1", parentId: "h1" }         │
  │ [2] message   { id:"m2", parentId: "m1" }         │
  │ [3] branch_sum{ id:"b1", parentId: "m2",          │ ← FORK POINT
  │                 summary:"tried approach 1" }       │
  │ [4] message   { id:"m3", parentId: "b1" }         │ ← branch A
  │ [5] compaction{ id:"c1", parentId: "m3",          │
  │                 firstKeptEntryId: "b1" }           │
  │ [6] message   { id:"m4", parentId: "c1" }         │ ← ACTIVE LEAF (last)
  └──────────────────────────────────────────────────┘

  RECONSTRUCTED BRANCH TREE:
                         h1 (root)
                         │
                         m1
                         │
                         m2
                      ╭──┴──╮
                   b1(fork)  [implicit: m3 could fork too]
                   │
                   m3 (branch A)
                   │
                   c1 (compaction: firstKept=b1 → m1,m2 compressed)
                   │
                   m4 ← ACTIVE LEAF (last entry in JSONL)

  ACTIVE LEAF INFERENCE:
    entries[last].id = "m4" → active leaf = m4
    active path = h1 → m1 → m2 → b1 → m3 → c1 → m4

  COMPACTION TRACKING:
    c1.firstKeptEntryId = "b1" → entries before b1 (h1,m1,m2)
    are compressed into branch_summary, not individually visible
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session viewer / inspector (packages/core) — session display (nền — PI = tree builder)
// ✅ 423 PG lineage-recall — recall scope (nền — PI = tree reconstruction for recall)
// ✅ pi-session-manager inspect.ts + trace.ts (source/ — reference impl: parentId, parentSession)

// ❌ THIẾU: branch tree builder (parentId → tree structure)
// ❌ THIẾU: active leaf inference (last entry = active leaf)
// ❌ THIẾU: branch identification (branch_summary = fork point)
// ❌ THIẾU: compaction tracking (firstKeptEntryId → compressed prefix)
```

## Implementation

```typescript
// packages/agent/src/branch-tree.ts (MỚI — port từ pi-session-manager inspect pattern)
interface SessionEntry {
  id: string;
  parentId?: string;
  type: 'header' | 'message' | 'compaction' | 'branch_summary' | 'custom';
  timestamp: string;
  // type-specific fields
  summary?: string;           // branch_summary, compaction
  firstKeptEntryId?: string;  // compaction
}

interface BranchNode {
  entry: SessionEntry;
  children: BranchNode[];
  isBranchPoint: boolean;  // branch_summary = fork
  isCompaction: boolean;   // compaction entry
}

interface BranchTree {
  root: BranchNode;
  activeLeaf: BranchNode;        // inferred from last entry
  activePath: BranchNode[];      // root → activeLeaf
  branchPoints: BranchNode[];    // all fork points
}

// Reconstruct branch tree from JSONL entries
function reconstructTree(entries: SessionEntry[]): BranchTree {
  if (entries.length === 0) throw new Error('Empty session');

  // Build parentId → children map
  const childrenMap = new Map<string | undefined, SessionEntry[]>();
  for (const entry of entries) {
    const parent = entry.parentId;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent)!.push(entry);
  }

  // Build tree recursively from root (header = no parentId or parentId matches root)
  const root = buildNode(entries[0], childrenMap);

  // Infer active leaf = last entry in JSONL
  const lastEntry = entries[entries.length - 1];
  const activeLeaf = findNode(root, lastEntry.id)!;

  // Active path: root → activeLeaf
  const activePath = findPath(root, activeLeaf);

  // Collect branch points
  const branchPoints: BranchNode[] = [];
  collectBranchPoints(root, branchPoints);

  return { root, activeLeaf, activePath, branchPoints };
}

function buildNode(entry: SessionEntry, childrenMap: Map<string | undefined, SessionEntry[]>): BranchNode {
  const children = (childrenMap.get(entry.id) ?? []).map((c) => buildNode(c, childrenMap));
  return {
    entry,
    children,
    isBranchPoint: entry.type === 'branch_summary',
    isCompaction: entry.type === 'compaction',
  };
}

function findNode(node: BranchNode, id: string): BranchNode | undefined {
  if (node.entry.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function findPath(root: BranchNode, target: BranchNode): BranchNode[] {
  // BFS/DFS to find path root → target
  const path: BranchNode[] = [];
  function dfs(node: BranchNode): boolean {
    path.push(node);
    if (node === target) return true;
    for (const child of node.children) {
      if (dfs(child)) return true;
    }
    path.pop();
    return false;
  }
  dfs(root);
  return path;
}

// Usage:
// const tree = reconstructTree(parsedEntries);
// tree.activeLeaf  → entry cuối (đang ở đây)
// tree.activePath  → đường root → leaf
// tree.branchPoints → mọi điểm fork
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tree-aware (session là cây — hiểu fork/branch) | ❌ parentId required (nếu JSONL không có parentId → không build được) |
| ✅ Active leaf inference (last entry = leaf — đơn giản, đúng) | ❌ Implicit fork (fork không có branch_summary → khó detect) |
| ✅ Compaction tracking (firstKeptEntryId → biết prefix bị nén) | ❌ Tree phức tạp (deep nesting → path dài) |
| ✅ Branch inspection (xem nhánh cũ nói gì) | ❌ Ambiguity (nhiều leaf cùng thời gian → phải guess) |

## Khác các hướng gần

| | 423 PG Lineage-Recall | PI: Branch-Tree-Reconstruction |
|---|---|---|
| Cái gì | Recall scope theo branch | **Build cây từ JSONL** |
| Mục đích | Filter recall | **Visualize/inspect tree** |
| Active leaf | Given (session manager) | **Inferred (last entry)** |
| Compaction | ❌ | ✅ firstKeptEntryId tracking |

## Khi nào chọn

- Session có branch (user rẽ nhánh — parentId tracking)
- Muốn visualize/inspect branch tree (xem nhánh nào, active leaf gì)
- Muốn track compaction (firstKeptEntryId → biết prefix bị nén)
- Nối 423 PG lineage-recall (PI = tree reconstruction, PG = recall scoping trên tree đó) + session viewer (PI = tree view); guard parentId missing (JSONL không có parentId → fallback linear list)
