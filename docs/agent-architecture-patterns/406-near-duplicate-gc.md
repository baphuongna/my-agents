# Hướng OP: Near-Duplicate GC — xóa memory cũ similarity > threshold trước khi ghi mới

> **Nguồn gốc:** mem0 (deduplication / update logic); "near-duplicate garbage collection"; "similarity threshold before add"; "update vs add decision"; "memory consolidation on conflict"
> **Coupling:** 🟢 — thêm dedup-GC step trong memory add pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory-add + conflict-merge sẵn — chưa có near-dup similarity GC gate)
> **Effort:** 1-2 tuần

## Nguồn gốc

**mem0** khi add memory mới, **kiểm tra trùng lặp** với memory đã có: nếu similarity (cosine) > threshold (vd 0.85) → không ghi mới mà **update/merge** memory cũ (tránh trùng lặp memory). Quyết định 3 nhánh: (1) **similar > threshold** → update memory cũ (merge info); (2) **partial overlap** → ghi mới + link relation; (3) **no overlap** → ghi mới bình thường. Nguyên tắc: **memory store phình nếu không GC** — near-dup xóa/cập nhật giữ store gọn + nhất quán. Khác **314 LB knowledge-conflict-merge** — OP là **similarity-gate** (numeric threshold) trước; khác **407 OQ add-v3-phased** — OP là **dedup step đơn lẻ** trong pipeline add.

## Mô tả

mya near-duplicate GC: trong add pipeline, trước khi ghi memory mới: (1) **Embed** memory mới. (2) **Search** top-1 nearest trong store. (3) **Compare** similarity: nếu > threshold → **update/merge** (xóa cũ hoặc merge); nếu ≤ → ghi mới. (4) **Log** decision (update/new/merge). mya có `314 LB conflict-merge` + `351 append-only` — OP thêm **similarity-GC gate** quyết định update vs new.

## Kiến trúc

```
  NEW MEMORY: "user thích sushi vì tươi ngon"
        │
        ▼
  ┌─── EMBED NEW MEMORY ───────────────────────────────┐
  │  embedding new → vector                            │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── NEAREST SEARCH (top-1) ─────────────────────────┐
  │  existing: "user thích sushi"  cosine = 0.91       │
  └───────────────────────┬─────────────────────────────┘
                          │ similarity = 0.91
                          ▼
  ┌─── DEDUP DECISION GATE ────────────────────────────┐
  │                                                     │
  │  sim > 0.85 (threshold)?  → YES                     │
  │    → UPDATE/MERGE: xóa "user thích sushi"           │
  │      ghi "user thích sushi vì tươi ngon" (merged)   │
  │                                                     │
  │  0.5 < sim ≤ 0.85?        → LINK (ghi mới + relate) │
  │  sim ≤ 0.5?               → ADD NEW (ghi mới)       │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
              STORE STATE: gọn, không trùng lặp
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 314 LB knowledge-conflict-merge — merge facts mâu thuẫn (nền — OP = similarity gate trước)
// ✅ 351 append-only-memory — memory add (nền — OP GC trên add)
// ✅ 197 GO hybrid-search — nearest search (nền — OP search top-1)
// ✅ 312 KZ retention-policy — expiry/GC (nền — OP = near-dup GC)

// ❌ THIẾU: near-dup similarity check trên add
// ❌ THIẾU: threshold-configurable dedup gate (>threshold → update)
// ❌ THIẾU: update-vs-new decision logging
```

## Implementation

```typescript
// packages/agent/src/memory/near-dup-gc.ts (MỚI)
interface ExistingMemory {
  id: string;
  text: string;
  embedding: number[];
}

type DedupDecision = 'update' | 'link' | 'add-new';

class NearDuplicateGC {
  constructor(
    private store: Map<string, ExistingMemory>,
    private updateThreshold = 0.85,
    private linkThreshold = 0.5,
  ) {}

  // Decide: update nearest, link, or add new
  dedup(
    newText: string,
    newEmbedding: number[],
  ): { decision: DedupDecision; targetId?: string; similarity: number } {
    // find nearest existing
    let bestId: string | undefined;
    let bestSim = -1;
    for (const [id, mem] of this.store) {
      const sim = this.cosine(newEmbedding, mem.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = id;
      }
    }

    if (bestSim > this.updateThreshold) {
      return { decision: 'update', targetId: bestId, similarity: bestSim };
    }
    if (bestSim > this.linkThreshold) {
      return { decision: 'link', targetId: bestId, similarity: bestSim };
    }
    return { decision: 'add-new', similarity: bestSim };
  }

  // Apply decision: GC old + merge, or add new
  apply(
    decision: ReturnType<NearDuplicateGC['dedup']>,
    newText: string,
    newEmbedding: number[],
    merge: (old: string, fresh: string) => string,
  ): string {
    switch (decision.decision) {
      case 'update': {
        const old = this.store.get(decision.targetId!)!;
        const merged = merge(old.text, newText);
        this.store.delete(decision.targetId!);     // GC old duplicate
        const newId = `mem-${Date.now()}`;
        this.store.set(newId, { id: newId, text: merged, embedding: newEmbedding });
        return newId;
      }
      case 'link':
      case 'add-new': {
        const newId = `mem-${Date.now()}`;
        this.store.set(newId, { id: newId, text: newText, embedding: newEmbedding });
        return newId;
      }
    }
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }
}

// Usage:
// const gc = new NearDuplicateGC(store, 0.85, 0.5);
// const dec = gc.dedup(newText, newEmb);
// gc.apply(dec, newText, newEmb, (old, fresh) => `${old} (${fresh})`);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Store gọn (không near-dup phình) | ❌ Threshold tuning (quá cao → trùng; quá thấp → xóa nhầm) |
| ✅ Merge thay vì trùng (memory nhất quán) | ❌ Search cost mỗi add (nearest-1 lookup) |
| ✅ Decision log rõ (update/link/new) | ❌ Semantic trùng từ khác (cosine miss) |
| ✅ Nối 314 LB (merge) + 312 KZ (GC) | ❌ Concurrent add (race → 2 bản trùng) |

## Khác các hướng gần

| | 314 LB Conflict-Merge | 312 KZ Retention-Policy | 351 Append-Only | OP: Near-Dup-GC |
|---|---|---|---|---|
| Cái gì | Merge facts mâu thuẫn | Expiry TTL | ADD-only | **Similarity gate trên add** |
| Trigger | Conflict detected | Time expiry | Mỗi add | **Pre-add check** |
| Threshold | ❌ | ❌ | ❌ | ✅ cosine > T |
| GC old | Sometimes | ✅ expiry | ❌ never | ✅ delete + merge |

## Khi nào chọn

- Memory add thường xuyên (store phình nếu không dedup)
- Muốn merge thay vì trùng lặp (nhất quán)
- Threshold cosine rõ (update vs link vs new)
- Nối 314 LB knowledge-conflict-merge (merge logic) + 312 KZ retention-policy (expiry) + 197 GO (nearest search); guard threshold (A/B) + race (lock trên add)
