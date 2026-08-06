# Hướng AGE: Recall Source-Evidence — mỗi observation/reflection có id 12 ký tự; recall tool truy về `sourceEntryIds` gốc trong ledger (message/custom_message/branch_summary) để agent kiểm chứng evidence, không phải semantic search

> **Nguồn gốc:** pi-observational-memory (src/session-ledger/recall.ts) | **Coupling:** 🟢 — recall + ledger lookup | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có memory retrieve/fts5 + store, thiếu sourceEntryIds evidence link) | **Effort:** 1 tuần

## Nguồn gốc

**pi-observational-memory** gán mỗi observation/reflection **id 12 ký tự** ổn định. **recall tool** không chỉ trả memory hit (semantic match) mà còn **truy về `sourceEntryIds` gốc** trong ledger — id của entry tạo ra observation đó (`message` / `custom_message` / `branch_summary`). Nhờ đó agent **kiểm chứng evidence**: không tin mù semantic search mà trace ngược về entry gốc xem memory đến từ đâu. Nguyên tắc: **memory có provenance — trace về source entry để verify**.

## Mô tả

mya recall-source-evidence: (1) **recall đã sẵn** — `packages/memory` sqlite-recall.ts (FTS5 recall, ranked hits, recall_count update); (2) **retrieve đã sẵn** — retrieve.ts (memory retrieval); (3) **store đã sẵn** — store.ts/brain-store.ts (memory persistence); (4) **sourceEntryIds** — mỗi memory lưu id entry gốc (message/custom_message/branch_summary); (5) **ledger lookup** — recall → hit → fetch source entry theo id → agent verify. Nối memory retrieve + grounding (governance-grounding.ts).

## Kiến trúc (ASCII)

```
  LEDGER (session entries)
   ├─ message (id: abc123def456)
   ├─ custom_message (id: xyz789...)
   └─ branch_summary (id: ...)
        │
        ▼  observation/reflection tạo ra → lưu SOURCE ENTRY IDS
  MEMORY STORE
   { id: 12char, content, sourceEntryIds: ["abc123def456", ...] }
        │
        ▼  recall(query) → FTS5 ranked hits
  HIT kèm sourceEntryIds
        │
        ▼  ledger lookup theo id
  agent nhận SOURCE ENTRY gốc → KIỂM CHỨNG EVIDENCE
  (không tin mù semantic, trace về gốc)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory sqlite-recall.ts — recall(db, query) FTS5 ranked + recall_count update
// ✅ packages/memory retrieve.ts — memory retrieval pipeline
// ✅ packages/memory store.ts/brain-store.ts — memory persistence
// ✅ packages/memory grounding.ts/governance-grounding.ts — grounding (nền provenance)

// ❌ THIẾU: sourceEntryIds field trên memory (provenance link)
// ❌ THIẾU: ledger lookup theo id trong recall result
// ❌ THIẾU: 12-char stable id cho observation/reflection
```

## Implementation

```typescript
// packages/memory/src/recall-evidence.ts (MỚI)
import { recall, type MemoryHit } from "./sqlite-recall.js";
export type EntryKind = "message" | "custom_message" | "branch_summary";
export interface LedgerEntry { readonly id: string; kind: EntryKind; content: string; ts: number; }
export interface EvidencedHit extends MemoryHit { sourceEntryIds: string[]; }
/** Recall + truy sourceEntryIds gốc để agent kiểm chứng. */
export function recallWithEvidence(
  db: Parameters<typeof recall>[0],
  query: string,
  fetchEntries: (ids: string[]) => LedgerEntry[],
): { hit: EvidencedHit; sources: LedgerEntry[] }[] {
  const hits = recall(db, query);
  return hits.map((hit) => {
    const ids = (hit as MemoryHit & { sourceEntryIds?: string[] }).sourceEntryIds ?? [];
    const evidenced: EvidencedHit = { ...hit, sourceEntryIds: ids };
    return { hit: evidenced, sources: fetchEntries(ids) };   // ledger lookup
  });
}
/** Sinh id 12 ký tự ổn định cho observation/reflection. */
export function newObservationId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent kiểm chứng evidence (trace về gốc) | ❌ sourceEntryIds phải persist nhất quán |
| ✅ 12-char id ổn định — reference dễ | ❌ Ledger lookup thêm query cost |
| ✅ Provenance — memory có nguồn rõ | ❌ Entry gốc bị xóa → dead link |

## Khác các hướng gần

| | AGE Recall Source-Evidence | sqlite-recall | grounding |
|---|---|---|---|
| Provenance | sourceEntryIds trace gốc | không | grounding check |
| Mục đích | Verify evidence | Semantic recall | Ground memory to source |
| Lookup | ledger theo id | FTS5 | reference |

## Khi nào chọn

- Agent cần kiểm chứng memory (không tin mù semantic)
- Muốn trace memory về entry gốc (message/summary)
- Cần provenance cho observation/reflection
- Guard: sourceEntryIds persist, 12-char id ổn định, dead-link handle (entry bị xóa)
