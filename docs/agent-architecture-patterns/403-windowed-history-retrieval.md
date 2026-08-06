# Hướng OM: Windowed History Retrieval — include-window query trước hybrid search

> **Nguồn gốc:** mem0 (include_window / include_messages param); "message-last / time-based / full window"; "context-aware memory recall"; "recency window before vector search"; "conversation context injection"
> **Coupling:** 🟢 — thêm window-include param vào memory query layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session-history + memory retrieval sẵn — chưa có include-window param trên query)
> **Effort:** 1-2 tuần

## Nguồn gốc

**mem0** expose param `include_window` trên query search: ngoài trả về memory match (vector + BM25), hệ thống **gắn kèm ngữ cảnh hội thoại** xung quanh memory đó. Có 3 chế độ window: (1) **message-last** — chỉ message cuối cùng chứa memory (mặc định, nhẹ); (2) **time-based** — tất cả message trong khoảng thời gian T quanh timestamp của memory; (3) **full** — toàn bộ lịch sử hội thoại liên quan. Nguyên tắc: **memory trừu tượng không đủ** — cần **ngữ cảnh gốc** (câu nói thật của user) để LLM hiểu *tại sao* memory đó được ghi. Khi query "thích nhà hàng nào" → ngoài memory "user thích sushi" → include window trả thêm câu chat gốc "Anh thích sushi vì …". Khác **182 FI conversational-memory** — OM là **window-include param** trên retrieval; khác **356 MR time-aware-retrieval** — OM inject **raw conversation context** chứ không chỉ re-rank theo time.

## Mô tả

mya windowed history retrieval: thêm param `includeWindow` vào memory search query. (1) **Search** hybrid (vector + BM25) → trả top-k memories. (2) **Resolve window**: cho mỗi memory hit → tìm message gốc trong session-history → include N message quanh nó theo chế độ (`message-last` / `time-based` / `full`). (3) **Inject** raw conversation vào context prompt bên cạnh memory tóm tắt. mya có `350 session-history-indexing` + `197 GO hybrid-search` — OM thêm **window-resolver** + `includeWindow` param.

## Kiến trúc

```
  USER QUERY: "Nhà hàng nào hợp?"
        │
        ▼
  ┌─── HYBRID SEARCH (197 GO) ─────────────────────────┐
  │  query embed + BM25 → top-k memories:               │
  │    hit-1: "user thích sushi"  (ts: 2024-03-10)       │
  │    hit-2: "user ghét cay"     (ts: 2024-03-08)       │
  └───────────────────────┬─────────────────────────────┘
                          │ includeWindow: 'time-based' (±5 min)
                          ▼
  ┌─── WINDOW RESOLVER ────────────────────────────────┐
  │  hit-1 ts=03-10 14:22 → tìm trong session-history:  │
  │    [14:20] user: "Cuối tuần rảnh không?"            │
  │    [14:22] user: "Anh thích sushi vì tươi"  ◄── GỐC │
  │    [14:24] agent: "Gợi ý Sushi Samba…"              │
  │                                                     │
  │  → gắn raw context quanh memory tóm tắt             │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── CONTEXT INJECTION ──────────────────────────────┐
  │  Prompt nhận:                                       │
  │    MEMORY: "user thích sushi"                       │
  │    CONTEXT (window): [14:22] "Anh thích sushi vì…"  │
  │  → LLM hiểu LÝ DO, không chỉ fact khô               │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 350 session-history-indexing — lịch sử có timestamp (nền — OM resolves window)
// ✅ 197 GO hybrid-search — vector + BM25 (nền — OM = include-window trên search)
// ✅ 182 FI hierarchical-memory — memory layer (nền)
// ✅ 356 MR time-aware-retrieval — re-rank theo time (nền — OM inject raw chat)

// ❌ THIẾU: includeWindow param trên memory query
// ❌ THIẾU: window resolver (memory hit → raw message ± N)
// ❌ THIẾU: time-based / full window mode selector
```

## Implementation

```typescript
// packages/agent/src/memory/windowed-retrieval.ts (MỚI)
type WindowMode = 'message-last' | 'time-based' | 'full';

interface WindowedMemoryHit {
  memory: string;           // tóm tắt
  timestamp: number;
  context: string[];        // raw messages trong window
}

interface WindowedQuery {
  query: string;
  includeWindow: WindowMode;
  windowMessages?: number;  // ± N messages (time-based / message-last)
  windowDurationMs?: number;// ± T ms (time-based)
}

class WindowedRetrieval {
  constructor(
    private search: (q: string, k: number) => Promise<{ memory: string; timestamp: number }[]>,
    private history: { ts: number; role: string; content: string }[],  // 350 session-history
  ) {}

  async retrieve(q: WindowedQuery): Promise<WindowedMemoryHit[]> {
    const hits = await this.search(q.query, 5);
    return hits.map(h => ({
      memory: h.memory,
      timestamp: h.timestamp,
      context: this.resolveWindow(h.timestamp, q),
    }));
  }

  private resolveWindow(ts: number, q: WindowedQuery): string[] {
    switch (q.includeWindow) {
      case 'message-last':
        // chỉ message cuối cùng ≤ ts chứa memory
        return this.lastMessageAt(ts);
      case 'time-based': {
        const half = (q.windowDurationMs ?? 300_000) / 2;
        return this.history
          .filter(m => m.ts >= ts - half && m.ts <= ts + half)
          .map(m => `[${new Date(m.ts).toISOString().slice(11, 16)}] ${m.role}: ${m.content}`);
      }
      case 'full':
        return this.history.map(m => `${m.role}: ${m.content}`);
    }
  }

  private lastMessageAt(ts: number): string[] {
    const sorted = [...this.history].sort((a, b) => a.ts - b.ts);
    const idx = sorted.findIndex(m => m.ts >= ts);
    const m = sorted[idx] ?? sorted[sorted.length - 1];
    return m ? [`${m.role}: ${m.content}`] : [];
  }
}

// Usage:
// const hits = await retrieval.retrieve({
//   query: 'nhà hàng hợp', includeWindow: 'time-based', windowDurationMs: 600_000,
// });
// hits.forEach(h => prompt += `MEMORY: ${h.memory}\nCONTEXT: ${h.context.join('\n')}`);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ LLM hiểu lý do gốc (không chỉ fact khô) | ❌ Context phình (full-window → token tăng) |
| ✅ time-based linh hoạt (± T phút quanh hit) | ❌ Window join cost (tìm message theo ts) |
| ✅ message-last nhẹ (chỉ 1 message, tiết kiệm) | ❌ History staleness (session cũ → window miss) |
| ✅ Nối 350 session-history (reuse timestamp) | ❌ Privacy (raw chat full → leak nhiều hơn) |

## Khác các hướng gần

| | 182 FI Hierarchical | 356 MR Time-Aware | 197 GO Hybrid-Search | OM: Windowed-History |
|---|---|---|---|---|
| Cái gì | Memory phân cấp | Re-rank theo time | Vector + BM25 | **Include raw chat window** |
| Window | ❌ | ❌ | ❌ | ✅ message-last/time/full |
| Raw chat | ❌ | ❌ | ❌ | ✅ inject ngữ cảnh gốc |
| Param | ❌ | ❌ | ❌ | ✅ includeWindow |

## Khi nào chọn

- Memory tóm tắt cần ngữ cảnh gốc để LLM hiểu lý do
- Session-history có timestamp đầy đủ (350)
- Muốn linh hoạt window: message-last (nhẹ) / time-based (cân bằng) / full (đầy đủ)
- Nối 350 session-history-indexing (window source) + 197 GO hybrid-search (search base) + 356 MR time-aware; guard token cost (full-window phình nhanh) + privacy (raw chat leak)
