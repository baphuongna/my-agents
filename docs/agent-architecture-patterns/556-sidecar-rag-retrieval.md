# Hướng UJ: Sidecar RAG Retrieval — process riêng ingest chunk+embedding SQLite, agent gọi HTTP tool retrieve

> **Nguồn gốc:** claw-code `claw-rag-service` (separate process, chunk ingest, embedding storage SQLite, HTTP retrieval tool); "claw-rag-service separate process", "ingest chunks + embeddings SQLite", "agent calls HTTP tool retrieve_context POST /v1/query" | **Coupling:** 🟡 — thêm sidecar RAG service + HTTP tool | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (RAG + embeddings sẵn — chưa có sidecar process + HTTP tool) | **Effort:** 3-4 tuần

## Nguồn gốc

**claw-code** tách RAG ra **process riêng** `claw-rag-service` — không nhúng vào agent loop. Lý do: ingestion (chunk + embedding) là **heavy I/O + CPU** (đọc file, chunk, gọi embedding model, ghi SQLite); nếu chạy trong agent process → block agent turn. Sidecar chạy nền: **ingest** chunks (split file → đoạn nhỏ) + tính **embeddings** → lưu **SQLite** (vector store). Agent **không trực tiếp query** SQLite — mà gọi **HTTP tool** `retrieve_context` POST `/v1/query` với query text → sidecar trả relevant chunks. Nguyên tắc: **RAG isolation** — ingest nặng tách process, agent chỉ HTTP call nhẹ, không block turn.

## Mô tả

mya sidecar RAG retrieval: (1) **Sidecar process**: `rag-service` chạy nền, owns SQLite + embedding model. (2) **Ingest**: chunk file → embedding → SQLite (background, không block agent). (3) **HTTP tool**: agent tool `retrieve_context` → POST `/v1/query {query}` → sidecar search SQLite → return chunks. (4) **Decoupled**: agent không import RAG code, chỉ HTTP. mya có RAG (retrieve/embeddings/code-index) — UJ thêm **sidecar-process** + **http-server** + **retrieve-tool**.

## Kiến trúc

```
  ┌─── SIDECAR PROCESS: rag-service (nền) ──────────────────┐
  │                                                            │
  │  INGEST (background):                                      │
  │    file → chunk → embedding model → SQLite (vector store)  │
  │    (heavy I/O+CPU, KHÔNG block agent)                      │
  │                                                            │
  │  HTTP SERVER:  POST /v1/query {query}                      │
  │    → embedding(query) → SQLite ANN search → chunks          │
  │    → return JSON {chunks: [...]}                            │
  └───────────────▲──────────────────────────────▲───────────┘
                  │ HTTP                          │ HTTP
                  │                               │
  ┌─── INGEST TRIGGER ──────┐    ┌─── AGENT TOOL: retrieve_context ─┐
  │  file-change watcher     │    │  POST /v1/query {query}           │
  │  → POST /v1/ingest        │    │  → chunks injected to context     │
  │  → sidecar re-chunk       │    │  (HTTP call nhẹ, không block)     │
  └──────────────────────────┘    └────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory retrieve.ts — RAG retrieval (nền — UJ sidecar dùng logic này)
// ✅ packages/memory embeddings.ts — embedding (nền — UJ sidecar gọi)
// ✅ packages/memory code-index.ts — code index (nền — UJ ingest)
// ✅ packages/memory sqlite-store.ts — SQLite (nền — UJ vector store)
// ✅ packages/tools registry.ts — tool registry (nền — UJ HTTP tool register)

// ❌ THIẾU: sidecar-process (rag-service chạy nền)
// ❌ THIẾU: http-server (POST /v1/query, /v1/ingest)
// ❌ THIẾU: retrieve-tool (HTTP tool → POST /v1/query → chunks)
// ❌ THIẾU: process-lifecycle (spawn/manage/health-check sidecar)
```

## Implementation

```typescript
// packages/memory/src/rag-sidecar.ts (MỚI — HTTP server trong sidecar)
import { createServer } from 'node:http';

class RagSidecarServer {
  constructor(private port: number, private retrieve: (q: string) => Promise<string[]>) {}

  start(): void {
    const server = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/query') {
        const body = await this.readBody(req);
        const { query } = JSON.parse(body);
        const chunks = await this.retrieve(query);   // embedding + SQLite ANN
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ chunks }));
      }
    });
    server.listen(this.port);
  }
  private readBody(req): Promise<string> {
    return new Promise(resolve => { let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d)); });
  }
}

// packages/tools/src/retrieve-context-tool.ts (MỚI — agent-side HTTP tool)
async function retrieveContext(query: string, port: number): Promise<string[]> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/query`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const { chunks } = await res.json() as { chunks: string[] };
  return chunks;
}

// Usage:
// sidecar: new RagSidecarServer(9100, retrieve).start();  // nền, owns SQLite
// agent tool: const chunks = await retrieveContext("parseToken deps", 9100);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent không block (ingest nặng tách process) | ❌ Process management (spawn/health/restart sidecar) |
| ✅ RAG isolation (crash RAG không kill agent) | ❌ HTTP overhead (latency mỗi retrieve call) |
| ✅ Scalable (sidecar dùng nhiều embedding model) | ❌ Port conflict (nhiều sidecar) |
| ✅ Decoupled (agent không import RAG code) | ❌ SQLite concurrency (sidecar owns, agent không truy cập trực tiếp) |

## Khác các hướng gần

| | In-process RAG | External vector DB | UJ: Sidecar-RAG |
|---|---|---|---|
| Cái gì | RAG trong agent process | Pinecone/Weaviate | **Sidecar process + SQLite + HTTP** |
| Block agent | ✅ (ingest nặng) | ❌ (network) | **❌ (isolate process)** |
| Self-contained | ✅ | ❌ (external dep) | **✅ (local SQLite)** |

## Khi nào chọn

- RAG ingest nặng (chunk + embedding block agent turn)
- Muốn RAG isolation (crash không kill agent, restart độc lập)
- Cần self-contained (SQLite local, không external vector DB)
- Nối packages/memory retrieve.ts + embeddings.ts + code-index.ts + sqlite-store.ts + packages/tools registry.ts; guard sidecar-lifecycle (health-check + auto-restart), port-management (ephemeral port allocation, tránh conflict), và HTTP-timeout (agent không treo nếu sidecar chậm); UJ = sidecar RAG retrieval, kết hợp 544 TX debounced-memory (fact extract ngoài luồng) + packages/memory sqlite-store (vector store backend)
