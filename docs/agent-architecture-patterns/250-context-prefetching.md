# Hướng IP: Context Prefetching — nạp trước tool/context, warm cache

> **Nguồn gốc:** CPU prefetching / speculative execution; KV cache warm-up (166 prompt-caching); CDN edge prefetch; "tool preloading" research; vLLM prefix caching
> **Coupling:** 🟡 — prefetch layer chèn trước agent turn, cần dự đoán context
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (prompt-cache 166 + semantic-cache 191 sẵn — thiếu predictive prefetch + tool preload)
> **Effort:** 2 tuần

## Nguồn gốc

Prefetching gốc từ CPU architecture — nạp data từ memory chậm vào cache nhanh **trước khi CPU cần** (speculative). CDN edge prefetch — nạp content gần user trước request. vLLM **prefix caching** — warm KV cache cho prompt prefix chung → turn sau rẻ hơn. Cho LLM agent: (1) **context prefetch** — dự đoán context nào agent sẽ cần (RAG chunks, files, memory facts) → nạp trước (embed sẵn, cache sẵn); (2) **tool preload** — khởi tạo tool connection trước khi agent gọi (MCP client warm, DB pool ready); (3) **KV warm** — prefix prompt cache (166) → turn đầu tiên đã có partial KV. Kết quả: latency giảm — agent không đợi cold fetch.

Khác **166 prompt-caching-layer** (cache prefix KV — *sau* lần đầu) — IP *nạp trước* (proactive, dự đoán). Khác **191 kv-semantic-cache** (cache semantic match) — IP nạp *context/tool* (không chỉ LLM KV). Nối **178 dynamic-model-routing** (route quyết định cache), **101 dynamic-tool-selection** (tool preload), **209 query-rewriting** (prefetch dựa trên rewritten query).

## Mô tả

mya context prefetching: (1) **predict** — dựa trên query/task type, dự đoán context cần (RAG chunks, files, tools); (2) **prefetch** — nạp trước: embed query → retrieve top-k RAG (warm), mở file dự đoán (file handle pool), khởi tạo MCP tool client (preload); (3) **warm cache** — prompt prefix cache (166) + semantic cache (191) đã warm khi agent gọi. mya đã có prompt-caching (166) + semantic-cache (191) — IP thêm **predictive prefetch layer** (dự đoán + preload trước turn).

## Kiến trúc

```
  USER QUERY: "fix the login bug in auth module"
        │
        │  ═══ PARALLEL (prefetch while LLM thinks) ═══
        ▼
  ┌──────────────────────────────────────────────┐
  │  PREFETCH PREDICTOR                            │
  │  "login bug + auth" → predict needs:           │
  │   · files: auth/login.ts, auth/session.ts      │
  │   · RAG: "login" chunks (warm embed)           │
  │   · tools: read, edit, test-runner (preload)   │
  │   · memory: recent auth facts (165)            │
  └──────┬───────────┬───────────┬────────────────┘
         │           │           │
         ▼           ▼           ▼
  ┌────────────┐ ┌──────────┐ ┌──────────────┐
  │ FILE       │ │ RAG      │ │ TOOL         │
  │ PREFETCH   │ │ PREFETCH │ │ PRELOAD      │
  │ open +     │ │ embed +  │ │ MCP client   │
  │ read ahead │ │ retrieve │ │ warm + DB    │
  │ (warm)     │ │ top-k    │ │ pool ready   │
  └────────────┘ └──────────┘ └──────────────┘
         │           │           │
         └─────┬─────┘           │
               ▼                 │
  ┌──────────────────┐           │
  │ KV CACHE WARM    │           │
  │ prefix cache     │           │
  │ (166) pre-filled │           │
  └──────────────────┘           │
               │                 │
         ═════╧═════════════════╧═════
               │
               ▼
  AGENT TURN STARTS → context ALREADY warm (no cold-fetch latency!)
```

```
mya: prompt-cache 166 + semantic-cache 191 sẵn — thiếu predictive prefetch + tool preload
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 166 prompt-caching-layer — prefix KV cache (warm — but reactive, after first)
// ✅ 191 kv-semantic-cache — semantic match cache (warm lookup)
// ✅ packages/memory — RAG retrieval (prefetch target)
// ✅ 101 dynamic-tool-selection — tool discovery (preload candidate)
// ✅ packages/tools — MCP client (preload connection)

// ❌ THIẾU: prefetch predictor (guess context/tools needed from query)
// ❌ THIẾU: file prefetch (read-ahead + handle pool warm)
// ❌ THIẾU: tool preload (MCP client warm before agent calls)
// ❌ THIẾU: RAG pre-retrieve (warm embed top-k before agent asks)
```

## Implementation

```typescript
// packages/agent/src/prefetch.ts (NEW)
interface PrefetchPrediction {
  files: string[];       // likely-needed file paths
  ragQueries: string[];  // likely RAG queries to warm
  tools: string[];       // tools to preload (MCP warm)
}

class ContextPrefetcher {
  constructor(private memory: MemoryStore, private toolRegistry: ToolRegistry) {}

  // Predict + prefetch in PARALLEL with agent reasoning
  async prefetch(query: string): Promise<void> {
    const pred = await this.predict(query);   // lightweight model / heuristic
    await Promise.all([
      ...pred.files.map((f) => this.warmFile(f)),        // read-ahead
      ...pred.ragQueries.map((q) => this.memory.retrieve(q)),  // warm RAG
      ...pred.tools.map((t) => this.toolRegistry.preload(t)),  // MCP warm
    ]);
  }

  private async predict(query: string): Promise<PrefetchPrediction> {
    // heuristic: extract keywords → match file paths + tool names
    // (or lightweight classifier trained on past query→context pairs)
    const keywords = extractKeywords(query);
    return {
      files: this.guessFiles(keywords),       // "login" → auth/login.ts
      ragQueries: keywords.slice(0, 3),
      tools: this.guessTools(keywords),       // "bug" → [read, edit, test]
    };
  }

  private async warmFile(path: string): Promise<void> {
    // pre-open + read into cache (OS page cache warm)
    try { await readFile(path); } catch { /* ignore — prefetch best-effort */ }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Latency giảm — no cold-fetch (CPU prefetch analogy) | ❌ Wrong prediction → wasted prefetch (bandwidth/memory) |
| ✅ Parallel (prefetch while LLM thinks — free time) | ❌ Complexity (predictor quality determines value) |
| ✅ Tool preload — MCP warm, no connection lag | ❌ Resource waste (prefetch unused = throwaway) |
| ✅ Nối prompt-cache 166 + semantic-cache 191 | ❌ Prediction model needs training data (cold start) |

## Khác các hướng gần

| | 166 Prompt Caching | 191 Semantic Cache | IP: Context Prefetching |
|---|---|---|---|
| Khi | Sau lần đầu (reactive) | Cache lookup | **Trước turn (proactive)** |
| Nạp | KV prefix | Semantic match | **File + RAG + tool** |
| Predict | ❌ | ❌ | **✅ guess context** |

## Khi nào chọn

- Latency nhạy cảm (turn đầu tiên chậm vì cold fetch)
- Query pattern lặp lại (predict được context cần — login bug → auth files)
- Agent gọi tool có connection lag (MCP cold start — preload)
- OK với occasional wasted prefetch (wrong prediction)
