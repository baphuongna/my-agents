# Hướng PG: Lineage-Scoped Recall — recall chỉ theo đường hội thoại đang hoạt động, scope:all vươn nhánh

> **Nguồn gốc:** pi-vcc (lineage.ts, recall-scope.ts, vcc-recall.ts); "lineage-scoped recall"; "branch-aware context retrieval"; "conversation path pruning"; "scope:lineage vs scope:all"
> **Coupling:** 🟢 — thêm lineage-scoping vào recall/context-retrieval layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (lineage.ts + recall-scope.ts sẵn trong pi-vcc — chưa có branch tree trong mya core)
> **Effort:** 1-1.5 tuần

## Nguồn gốc

**pi-vcc** (`lineage.ts`, `recall-scope.ts`) recall context theo nguyên tắc **lineage-scoped** — chỉ retrieve entries thuộc **đường hội thoại đang hoạt động** (active branch), không phải toàn bộ cây nhánh. `getActiveLineageEntryIds()` lấy `getBranch()` (đường active) → Set entry IDs thuộc nhánh đó. Nếu branch rỗng → fallback `getEntries()` (toàn bộ). `recall-scope.ts` định nghĩa 2 scope: (1) **lineage** (default) — chỉ entries trên active path (từ root → leaf hiện tại), (2) **all** — vươn nhánh, retrieve entries từ mọi branch (khi user muốn query cross-branch). Parse `scope:lineage` / `scope:all` từ query text. Nguyên tắc: **recall theo conversation path** — khi user rẽ nhánh, recall chỉ thấy đường hiện tại, tránh noise từ nhánh khác. Khác **82 memory-consolidation** (consolidate memory) — PG là **recall scoping**; khác **88 hybrid-graph-vector** (vector search) — PG là **lineage path filter**.

## Mô tả

mya lineage-scoped recall: khi agent recall context → **scope theo lineage** — (1) **Default (lineage)**: lấy active branch (đường từ root → leaf hiện tại) → chỉ entries thuộc nhánh đó → recall trong scope này (không noise từ nhánh khác). (2) **Explicit (all)**: user thêm `scope:all` vào query → recall từ mọi branch (cross-branch search). (3) **Fallback**: nếu branch rỗng (không có nhánh — single-path session) → dùng toàn bộ entries. Agent biết mình đang ở nhánh nào → recall **chỉ đường đó** — khi user rẽ nhánh và hỏi "recall về X", agent chỉ thấy entries trên nhánh hiện tại, không bị nhiễu bởi nhánh cũ. mya có recall/context layer — PG thêm **lineage scoping** (branch tree + scope filter).

## Kiến trúc

```
  SESSION BRANCH TREE:
                    ┌── Branch B (user rẽ nhánh: "thử cách khác")
                    │     ├── entry: "approach 2"
  root ──── A ──────┤     ├── entry: "edit file X"
                    │     └── entry: ← ACTIVE LEAF (đang ở đây)
                    │
                    └── Branch C (nhánh cũ)
                          ├── entry: "approach 1"
                          └── entry: "edit file Y"

  RECALL (scope:lineage — DEFAULT):
    active branch = B
    lineage IDs = {root, A, "approach 2", "edit file X", ACTIVE LEAF}
    → recall CHỈ entries thuộc branch B
    → Branch C entries KHÔNG xuất hiện (không noise)

  RECALL (scope:all — EXPLICIT):
    user query: "recall về file Y scope:all"
    → recall từ MỌI branch (B + C)
    → tìm thấy "edit file Y" từ Branch C

  FALLBACK (no branch):
    single-path session (không rẽ nhánh)
    getBranch() = [] → fallback getEntries() (toàn bộ)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ recall / context retrieval layer (packages/core, packages/memory) — nền
// ✅ 82 memory-consolidation — memory consolidation (nền — PG = recall scoping)
// ✅ pi-vcc lineage.ts + recall-scope.ts (source/ — reference implementation)

// ❌ THIẾU: branch tree (conversation → branch tree, active path tracking)
// ❌ THIẾU: lineage scope filter (recall chỉ active branch entries)
// ❌ THIẾU: scope:all parser (explicit cross-branch search)
// ❌ THIẾU: fallback logic (branch empty → all entries)
```

## Implementation

```typescript
// packages/agent/src/lineage-recall.ts (MỚI — port từ pi-vcc lineage.ts + recall-scope.ts)
type RecallScope = 'lineage' | 'all';

interface LineageEntry { id: string; }
interface SessionManager {
  getBranch(): LineageEntry[];     // active branch (root → current leaf)
  getEntries?(): LineageEntry[];   // all entries (fallback)
}

// Get IDs of entries on the active lineage (branch)
function getActiveLineageEntryIds(session: SessionManager): Set<string> {
  try {
    const branch = session.getBranch() ?? [];
    if (branch.length > 0) {
      return new Set(branch.map((e) => e.id).filter(Boolean));
    }
  } catch { /* fall through to fallback */ }
  try {
    const all = session.getEntries?.() ?? [];
    return new Set(all.map((e) => e.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

// Parse scope from query text: "recall about X scope:all"
const SCOPE_RE = /\bscope:(lineage|all)\b/i;
function parseRecallScope(text: string): { scope: RecallScope; text: string } {
  const match = text.match(SCOPE_RE);
  return {
    scope: match?.[1]?.toLowerCase() === 'all' ? 'all' : 'lineage',
    text: text.replace(SCOPE_RE, '').replace(/\s+/g, ' ').trim(),
  };
}

// Recall with lineage scoping
async function recallScoped(
  query: string,
  session: SessionManager,
  allEntries: Map<string, Entry>,
): Promise<Entry[]> {
  const { scope, text } = parseRecallScope(query);

  if (scope === 'all') {
    // Cross-branch: search all entries
    return vectorSearch(text, [...allEntries.values()]);
  }

  // Lineage (default): only active branch entries
  const lineageIds = getActiveLineageEntryIds(session);
  const branchEntries = [...allEntries.values()].filter((e) => lineageIds.has(e.id));
  return vectorSearch(text, branchEntries);
}

// Usage:
// const results = await recallScoped("recall about auth scope:all", session, entries);
// → scope:all searches all branches; default searches active branch only
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Noise reduction (recall chỉ active branch — không nhiễu nhánh cũ) | ❌ Miss cross-branch context (nhánh cũ có thông tin cần — phải `scope:all`) |
| ✅ Path-aware (agent biết đường mình đang đi) | ❌ Branch tree overhead (track branch mỗi entry) |
| ✅ Explicit escape hatch (`scope:all` khi cần cross-branch) | ❌ User phải biết `scope:all` (không tự nhiên) |
| ✅ Fallback safe (branch rỗng → all entries) | ❌ Branch tree phức tạp (fork/merge, deep nesting) |

## Khác các hướng gần

| | 82 Memory-Consolidation | 88 Hybrid-Graph-Vector | PG: Lineage-Recall |
|---|---|---|---|
| Cái gì | Consolidate memory | Vector + graph search | **Recall scope theo branch** |
| Scope | Toàn bộ memory | Toàn bộ graph | **Active lineage path** |
| Branch-aware | ❌ | ❌ | ✅ recall chỉ active branch |
| Cross-branch | N/A | N/A | ✅ `scope:all` explicit |

## Khi nào chọn

- Session có branch tree (user rẽ nhánh — "thử cách khác")
- Muốn recall không noise (chỉ active branch, không nhiễu nhánh cũ)
- Muốn escape hatch (`scope:all` khi cần cross-branch search)
- Nối 82 memory-consolidation (PG = recall scoping trên memory) + 88 hybrid-graph-vector (PG = path filter trước vector search); guard branch tree phức tạp (fork/merge — cần clear branch tracking)
