# Hướng LA: Incremental KB Build — xây knowledge base tăng dần từ session

> **Nguồn gốc:** Incremental indexing (Elasticsearch/Lucene); "continual learning"; "Lessons Learned" KM; distillation pipelines; "Knowledge distillation for agents"; versioned embeddings
> **Coupling:** 🟡 — chạm memory + distill + indexing pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (distill + memory + embed sẵn — thiếu incremental indexer + dedup-via-embed + versioned KB)
> **Effort:** 3-4 tuần

## Nguồn gốc

Incremental indexing (Lucene): index thêm record mới **mà không rebuild toàn bộ** — append + merge segment. Continual learning: model học dần từ new data (không retrain). "Lessons Learned" (KM): sau mỗi session, rút **lesson** → thêm vào KB → session sau có sẵn. Agent distillation: từ raw session log (dài, nhiễu) → **distill** thành fact ngắn (skill, fact, correction). Versioned embeddings: khi embed model đổi, version-tag để re-compute lazily (326). Cốt lõi: **KB không build 1 lần** — nó lớn dần qua từng session: extract lesson → dedup → index → version.

## Mô tả

mya incremental KB: sau mỗi session (hoặc batch) → (1) **extract** lessons từ session log (LLM distill raw → fact); (2) **dedup** — embed fact mới, so cosine với KB hiện có, nếu gần → merge thay vì thêm trùng (165); (3) **index** — append vào vector store + keyword index (incremental, không rebuild); (4) **version** — tag với session ID + embed model version → trace origin + lazy re-embed khi model đổi (326). Nối 112 learning-from-corrections (lesson source), 165 dedup, 326 embedding-model-switch.

## Kiến trúc

```
  SESSION ENDS (raw log: turns, tool calls, corrections)
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  EXTRACT / DISTILL (LLM)                             │
  │  raw session → candidate facts:                      │
  │   · skill: "use --frozen-lockfile for CI"            │
  │   · correction: "test.ts needs .test.ts suffix"      │
  │   · fact: "project uses vitest pool:forks"           │
  └──────────────────┬───────────────────────────────────┘
                     │ candidate facts
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  DEDUP (embed cosine vs existing KB — 165)           │
  │  new fact embed → search KB top-1                    │
  │    cosine > 0.92? → MERGE (update existing)          │
  │    else           → ADD new                          │
  └──────────────────┬───────────────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  INDEX (incremental — append, no full rebuild)       │
  │  · vector store: append embedding                    │
  │  · keyword index: add tokens                         │
  │  · version tag: { sessionId, embedModel, class }     │
  └──────────────────────────────────────────────────────┘
                     │
                     ▼
              KB GROWS incrementally (next session benefits)
```

```
mya: distill + memory + embed sẵn — thiếu incremental indexer + dedup-on-insert + versioned KB
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 112 learning-from-corrections — lesson extraction (documented)
// ✅ 165 memory-dedup — dedup concept (documented)
// ✅ packages/memory — embed + retrieve (sẵn)
// ✅ distill pipeline (validate-distill-run.mjs) — distill tool (sẵn)

// ❌ THIẾU: incremental indexer (append-only, no rebuild)
// ❌ THIẾU: dedup-on-insert (cosine check before add)
// ❌ THIẾU: versioned KB (session origin + embed model tag)
// ❌ THIẾU: batch distill (process N sessions → facts)
```

## Implementation

```typescript
// packages/memory/src/incremental-kb.ts (NEW)
import { embed } from "@my-agent/core";

interface KBFact {
  id: string;
  text: string;
  sessionId: string;
  embedModel: string;
  class: string;
  embedding: number[];
}

export class IncrementalKB {
  private facts: KBFact[] = [];
  constructor(private model: ModelProvider, private embedModelVersion: string) {}

  // After session — extract + dedup + index
  async ingestSession(sessionLog: string, sessionId: string): Promise<number> {
    // 1. Extract candidate facts (LLM distill)
    const raw = await this.model.generate(
      `Extract reusable facts/skills/corrections from this session (JSON array):\n${sessionLog}`
    );
    const candidates: string[] = JSON.parse(raw);

    let added = 0;
    for (const text of candidates) {
      const emb = await embed(text);
      // 2. Dedup: cosine check against existing
      const dup = this.nearest(emb, 0.92);
      if (dup) {
        dup.text = await this.mergeFacts(dup.text, text); // merge instead of add
        continue;
      }
      // 3. Index (incremental append)
      this.facts.push({ id: cryptoId(), text, sessionId, embedModel: this.embedModelVersion, class: "useful", embedding: emb });
      added++;
    }
    return added;
  }

  private nearest(emb: number[], threshold: number): KBFact | null {
    let best: KBFact | null = null; let bestSim = 0;
    for (const f of this.facts) {
      const sim = cosine(emb, f.embedding);
      if (sim > bestSim) { bestSim = sim; best = f; }
    }
    return bestSim >= threshold ? best : null;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ KB lớn dần qua session — "lessons learned" | ❌ Distill cost (LLM call per session) |
| ✅ Incremental — không rebuild toàn bộ (Lucene) | ❌ Dedup sai → fact trùng hoặc merge nhầm |
| ✅ Versioned — trace origin + lazy re-embed (326) | ❌ KB drift (bad lessons accumulate) |
| ✅ Next session có sẵn knowledge | ❌ Quality control (bad fact hard to remove later) |

## Khác các hướng gần

| | 112 Corrections | 165 Dedup | LA: Incremental KB |
|---|---|---|---|
| Mục | Lưu correction | Bỏ trùng | **Xây KB tăng dần** |
| Từ đâu | User correction | Insert time | **Session log → distill** |
| Version | ❌ | ❌ | **✅ session + embed model** |

## Khi nào chọn

- Muốn KB tự lớn qua từng session ("continual learning")
- Raw session log nhiều — cần distill → fact ngắn tái dùng
- Embed model có thể đổi → cần version + lazy re-embed (326)
- Nối 112 corrections + 165 dedup + 326 embedding-switch + 314 conflict-merge
