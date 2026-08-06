# Hướng PX: Active Memory Recall Subagent — main pause, subagent hồi ức đủ context

> **Nguồn gốc:** OpenClaw (active recall subagent); "retrieval-augmented turn split"; "dedicated recall worker"; "two-phase retrieval: gather then act"; "fetch-then-execute pattern"
> **Coupling:** 🟡 — cần subagent dispatch + memory recall pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagent + memory query sẵn — chưa có dedicated recall-worker + pause/resume protocol)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenClaw** tách **retrieval** khỏi **action**: thay vì main agent query memory inline (thường surface thiếu — agent không biết phải tìm gì khi chưa hiểu câu hỏi), 1 **recall subagent** chuyên trách được triệu gọi. Main agent **pause**, subagent nhận câu hỏi → **active recall**: tìm đa nguồn (vector, graph, procedural, file), tổng hợp thành context gọn, trả về main. Main **resume** với đủ context rồi mới hành động. Giống **two-phase retrieval** (gather-then-act) trong RAG nâng cao. Nguyên tắc: **tách nghĩ-tìm khỏi làm** — 1 agent chuyên tìm, 1 agent chuyên làm. Khác **88 hybrid-graph-vector** (retrieval engine) — PX là **orchestration pattern** (ai tìm, ai làm); khác **08 subagents** (delegate task) — PX delegate **retrieval only**.

## Mô tả

mya active recall subagent: khi main agent cần context, nó **pause** (đánh dấu turn pending) → spawn **recall subagent** với query + recall budget. Subagent **active recall**: (1) vector search (88), (2) graph traversal (89), (3) procedural memory (276), (4) file search (83). Subagent **rank + dedup + compress** → trả về **recall bundle** (chỉ cái liên quan, gọn). Main **resume** với bundle → hành động với đầy đủ context. Giống **402 OL diagnose** (read-only phase) nhưng PX là **retrieval phase** trước action phase. Nối 08 subagents + 88 hybrid-graph-vector + 89 shared-graph-memory.

## Kiến trúc

```
  MAIN AGENT (action agent):
  ┌──────────────────────────────────────┐
  │  user: "sửa bug auth như lần trước"   │
  │  → cần context: auth module + lịch sử │
  │                                        │
  │  ═══ PAUSE ═══ (turn pending)          │
  │  spawn recall subagent(query, budget)  │
  └───────────────┬────────────────────────┘
                  │
                  ▼
  ┌─── RECALL SUBAGENT (retrieval-only) ────┐
  │                                          │
  │  ① vector search (88): "auth bug fix"    │
  │     → 5 candidates                       │
  │  ② graph traversal (89): auth → deps     │
  │     → 3 related nodes                    │
  │  ③ procedural memory (276): auth-fix     │
  │     → 1 skill                            │
  │  ④ file search (83): auth.ts, auth.test  │
  │     → 2 files                            │
  │                                          │
  │  RANK + DEDUP + COMPRESS                 │
  │  → recall bundle (gọn, liên quan)        │
  └───────────────┬──────────────────────────┘
                  │ (recall bundle)
                  ▼
  ┌─── MAIN AGENT RESUME ───────────────────┐
  │  context enriched with recall bundle    │
  │  → hành động với đủ context             │
  │  → fix bug auth.ts                      │
  └──────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 08 subagents — subagent dispatch (nền — PX = recall-specific subagent)
// ✅ 88 hybrid-graph-vector-memory — vector + graph search (recall source)
// ✅ 89 shared-graph-memory — graph traversal (recall source)
// ✅ 276 procedural-memory — skill memory (recall source)
// ✅ 83 tool-discovery — file/tool search (recall source)

// ❌ THIẾU: dedicated recall-worker subagent (retrieval-only, no action tools)
// ❌ THIẾU: pause/resume protocol (main pause → recall → resume)
// ❌ THIẾU: recall bundle format (ranked + deduped + compressed)
// ❌ THIẾU: recall budget control (max sources, max tokens)
```

## Implementation

```typescript
// packages/agent/src/recall-subagent.ts (NEW)
interface RecallRequest {
  query: string;
  budget: { maxTokens: number; maxSources: number };
  sources: ('vector' | 'graph' | 'procedural' | 'files')[];
}

interface RecallBundle {
  items: RecallItem[];
  totalTokens: number;
}
interface RecallItem { source: string; content: string; score: number; }

class RecallSubagent {
  async recall(req: RecallRequest): Promise<RecallBundle> {
    const candidates: RecallItem[] = [];
    // Multi-source active recall
    for (const src of req.sources) {
      const results = await this.querySource(src, req.query, req.budget);
      candidates.push(...results);
    }
    // Rank by relevance score
    candidates.sort((a, b) => b.score - a.score);
    // Dedup by content similarity
    const deduped = this.dedup(candidates);
    // Compress to fit budget
    return this.compressToBudget(deduped, req.budget.maxTokens);
  }

  private async querySource(src: string, q: string, b: RecallRequest['budget']): Promise<RecallItem[]> {
    // Delegate to 88/89/276/83 based on src
    return [];
  }
  private dedup(items: RecallItem[]): RecallItem[] { return items; }
  private compressToBudget(items: RecallItem[], max: number): RecallBundle {
    let tokens = 0; const out: RecallItem[] = [];
    for (const item of items) {
      const t = Math.ceil(item.content.length / 4);
      if (tokens + t > max) break;
      out.push(item); tokens += t;
    }
    return { items: out, totalTokens: tokens };
  }
}

// Main agent pause/resume integration
async function pauseAndRecall(query: string): Promise<RecallBundle> {
  const subagent = new RecallSubagent();
  return subagent.recall({
    query,
    budget: { maxTokens: 4000, maxSources: 5 },
    sources: ['vector', 'graph', 'procedural', 'files'],
  });
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context đầy đủ (active recall đa nguồn trước khi hành động) | ❌ Latency (pause + recall round-trip) |
| ✅ Tách retrieval khỏi action (single responsibility) | ❌ Token overhead (recall subagent cũng tốn token) |
| ✅ Rank + dedup + compress (context gọn, liên quan) | ❌ Phức tạp orchestration (pause/resume protocol) |
| ✅ Budget control (giới hạn recall không tràn) | ❌ Cold start (recall subagent cần warm-up) |

## Khác các hướng gần

| | 88 Graph-Vector-Memory | 08 Subagents | 402 Request-Type | PX: Active-Recall |
|---|---|---|---|---|
| Trọng tâm | Retrieval engine | Delegate task | Classify intent | **Tách tìm khỏi làm** |
| Ai tìm | Main inline | Subagent (task) | — | **Recall subagent chuyên trách** |
| Phase | Single | Single | Single | **Two-phase (gather → act)** |

## Khi nào chọn

- Main agent thường surface thiếu context (không biết phải tìm gì khi chưa hiểu)
- Cần recall đa nguồn (vector + graph + procedural + files) rồi mới hành động
- Muốn tách retrieval (read-only) khỏi action (write)
- Nối 08 subagents + 88 hybrid-graph-vector + 89 shared-graph-memory + 276 procedural-memory
