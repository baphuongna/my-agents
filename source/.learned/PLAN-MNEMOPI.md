# PLAN: Rebuild Memory theo mnemopi pattern

> SQLite IS the store. RAM chỉ là cache. Theo pattern oh-my-pi/mnemopi.

## Nguyên tắc

1. **SQLite là store chính** — không còn Brain Maps in-memory
2. **FTS5 native** — không còn RetrievalEngine in-memory index
3. **node:sqlite** (Node 22 built-in) — zero dependency, FTS5 đã verify
4. **Schema theo mnemopi** — working_memory + episodic_memory + facts + FTS5 triggers
5. **Lifecycle theo mnemopi** — Weibull decay + tier degradation + consolidation
6. **Bỏ** brain.jsonl, Brain.facts Map, RetrievalEngine.index, UnifiedStore, BrainStore

## Cấu trúc file mới

```
packages/memory/src/
├── sqlite-db.ts          ← node:sqlite wrapper (WAL, pragmas, transaction)
├── sqlite-schema.ts      ← CREATE TABLE + FTS5 + triggers (theo mnemopi)
├── sqlite-store.ts       ← CRUD: INSERT/SELECT/UPDATE qua SQLite
├── sqlite-recall.ts      ← FTS5 MATCH + BM25 + temporal decay + veracity
├── sqlite-consolidate.ts ← working→episodic + tier degradation + Weibull
├── weibull.ts            ← Per-type decay curves (copy từ mnemopi)
├── types.ts              ← TypeScript types cho memory records
├── manager.ts            ← REWRITE: thin wrapper gọi sqlite-store/recall
├── index.ts              ← REWRITE: export API mới
└── (xóa: brain.ts, tree.ts, rrf.ts, retrieve.ts, store.ts, brain-store.ts, lifecycle.ts, backends.ts)
```

## Phases

### Phase 1: SQLite foundation (~300 LOC)

**File mới: `sqlite-db.ts`**
```typescript
// node:sqlite wrapper
import { DatabaseSync } from "node:sqlite";

export function openDB(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}
```

**File mới: `sqlite-schema.ts`**
- `initSchema(db)` — tạo tất cả tables + FTS5 + triggers
- Tables: `working_memory`, `episodic_memory`, `facts`, `triples`, `scratchpad`
- FTS5: `fts_working`, `fts_episodes`, `fts_facts` (content-synced với triggers)
- Indexes: theo mnemopi (idx_wm_session, idx_wm_unconsolidated, idx_em_tier, etc.)
- `addColumnIfMissing()` helper cho schema migration

### Phase 2: Store layer (~250 LOC)

**File mới: `sqlite-store.ts`**

```typescript
// INSERT vào working_memory (trigger tự sync FTS5)
storeWorking(db, { content, source, sessionId, importance, memoryType, veracity })

// INSERT vào episodic_memory (trigger tự sync FTS5)
storeEpisodic(db, { content, source, summaryOf, tier, importance })

// INSERT vào facts + triples
storeFact(db, { subject, predicate, object, confidence })

// UPDATE consolidated_at (mark working memory as consolidated)
markConsolidated(db, id, episodicId)

// UPDATE recall_count + last_recalled
recordRecall(db, ids)

// UPDATE tier (degradation)
degradeTier(db, id, newTier)

// DELETE / supersede
supersede(db, oldId, newId)
```

### Phase 3: Recall pipeline (~200 LOC)

**File mới: `sqlite-recall.ts`**

```typescript
// FTS5 MATCH query → BM25 ranking native SQLite
recall(db, query, { topK, sessionId, scope }) → MemoryHit[]

// Pipeline:
// 1. FTS5 search trên fts_working + fts_episodes (UNION)
// 2. JOIN với working_memory/episodic_memory để lấy metadata
// 3. Filter: superseded_by IS NULL, valid_until > now
// 4. Score: bm25(rank) + importance + weibull temporal decay
// 5. Veracity weight: stated=1.0, inferred=0.7, tool=0.5
// 6. MMR diversity rerank (Jaccard similarity)
// 7. Update recall_count + last_recalled
```

SQL query chính:
```sql
SELECT wm.id, wm.content, bm25(fw) AS rank, wm.importance, wm.veracity, wm.timestamp, wm.memory_type
FROM fts_working fw
JOIN working_memory wm ON wm.id = fw.id
WHERE fts_working MATCH ?1
  AND wm.superseded_by IS NULL
  AND (wm.valid_until IS NULL OR wm.valid_until > datetime('now'))
ORDER BY rank
LIMIT ?2
```

### Phase 4: Consolidation + Lifecycle (~200 LOC)

**File mới: `sqlite-consolidate.ts`**

```typescript
// Consolidation: working_memory (old) → episodic_memory
consolidate(db, { sessionId, maxAge }) → { consolidated, episodicId }

// Pipeline:
// 1. SELECT unconsolidated working_memory WHERE age > threshold
// 2. Group by (source, memory_type)
// 3. Concatenate content → summary text
// 4. INSERT INTO episodic_memory
// 5. UPDATE working_memory SET consolidated_at = now

// Tier degradation: tier 1 → 2 → 3 (content compression)
degradeOldMemories(db) → { degraded }

// Weibull-based purge
purgeExpired(db) → { purged }
```

**File mới: `weibull.ts`** — copy nguyên từ mnemopi (per-type decay params)

### Phase 5: Manager rewrite (~150 LOC)

**File mới: `manager.ts`** (REWRITE)

```typescript
export class MemoryManager {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = openDB(dbPath);
    initSchema(this.db);
  }

  record(fact: FactInput): Fact {
    return storeWorking(this.db, fact);
  }

  recall(query: string, opts?: RecallOpts): MemoryHit[] {
    return recall(this.db, query, opts);
  }

  consolidate(): ConsolidateResult {
    return consolidate(this.db);
  }

  close(): void {
    this.db.close();
  }
}
```

### Phase 6: Wire vào TUI + cleanup (~100 LOC)

- `shared-instances.ts`: tạo MemoryManager với `~/.mya/memory/memory.db`
- `mya-bridge.ts`: `before_agent_start` gọi `manager.recall()` (FTS5), `turn_end` gọi `manager.consolidate()`
- `pi-main.ts`: pass manager
- Xóa: brain.ts, tree.ts, rrf.ts, retrieve.ts, store.ts, brain-store.ts, lifecycle.ts
- Xóa: brain.jsonl (migration: đọc cũ → INSERT vào SQLite)

### Phase 7: Migration + tests (~200 LOC)

**Migration script:**
- Đọc `~/.mya/memory/brain.jsonl` (nếu tồn tại) → INSERT vào SQLite
- Đọc `~/.mya/memory/archivist.md` (nếu tồn tại) → INSERT vào SQLite

**Tests:**
- `sqlite-schema.test.ts` — schema init, column migration
- `sqlite-store.test.ts` — CRUD operations
- `sqlite-recall.test.ts` — FTS5 search, BM25 ranking, temporal decay, veracity
- `sqlite-consolidate.test.ts` — working→episodic, tier degradation, Weibull purge
- `manager.test.ts` — end-to-end integration

## Ước tính

| Phase | LOC | Tests | Files |
|---|---|---|---|
| 1. SQLite foundation | 300 | 5 | sqlite-db.ts, sqlite-schema.ts |
| 2. Store layer | 250 | 8 | sqlite-store.ts |
| 3. Recall pipeline | 200 | 8 | sqlite-recall.ts |
| 4. Consolidation | 200 | 6 | sqlite-consolidate.ts, weibull.ts |
| 5. Manager rewrite | 150 | 4 | manager.ts (rewrite) |
| 6. Wire + cleanup | 100 | 0 | shared-instances.ts, mya-bridge.ts |
| 7. Migration + tests | 200 | 5 | migration + test files |
| **Total** | **~1400** | **~36** | **8 new + 4 rewrite + 7 delete** |

## Thứ tự thực thi

Phase 1→2→3 (foundation + store + recall) = có thể test độc lập
Phase 4 (consolidation) = cần Phase 2
Phase 5 (manager) = cần Phase 1-4
Phase 6 (wire) = cần Phase 5
Phase 7 (migration + cleanup) = cuối

Mỗi phase xong → build + test + review → commit → tiếp.

## Thay đổi so với hiện tại

| Hiện tại | Sau |
|---|---|
| Brain.facts Map (RAM) | `working_memory` table (SQLite) |
| Brain.takesMap Map (RAM) | `episodic_memory` table (SQLite) |
| Brain.pagesMap Map (RAM) | (bỏ — episodic tier 2/3 thay thế) |
| brain.jsonl (append-only) | SQLite WAL (durable, crash-safe) |
| RetrievalEngine.index (RAM) | FTS5 native (SQLite) |
| brain-store.ts (JSONL persistence) | SQLite INSERT (native) |
| rrf.ts (in-memory BM25) | FTS5 bm25() function (native) |
| weibull: không có | weibull.ts (per-type decay curves) |
| LifecycleManager.tick() | sqlite-consolidate.ts |
| 13 domains | Bỏ (SQLite thay thế tất cả) |
