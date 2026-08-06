# Hướng RU: Deterministic Rollup Semantic Corpus — corpus ngữ nghĩa không LLM: lite_turn + rollup từ metadata

> **Nguồn gốc:** ctx (ctx.rs; daemon-semantic-indexing-spec; "primary semantic corpus is lite_turn + deterministic rollups"; "lite_turn = one user message + last assistant message before next user"; "no LLM used"; "deterministic, functional documents from structured metadata")
> **Coupling:** 🟢 — corpus builder pure (không LLM) chèn vào indexing pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (semantic search/indexing sẵn — chưa có deterministic lite_turn + rollup corpus, không LLM)
> **Effort:** 2-3 tuần

## Nguồn gốc

**ctx** (ctx.rs) xây corpus ngữ nghĩa để **local semantic search** (embedding + vector retrieval) mà **không cần LLM** để tạo document. Nguyên tắc: **corpus phải deterministic + functional** — tạo từ **metadata có sẵn**, không "inferred important findings" hay summarization (gây drift). Corpus gồm 2 phần: (1) **`lite_turn`** — mỗi turn = **1 user message + assistant message cuối cùng trước user message kế tiếp** (đầy đủ ý turn, không tràn). (2) **Deterministic rollups** — document chức năng tạo từ metadata: **file rollup** (touched paths + change kinds cho session), **command rollup** (preview + status + exit code), **error rollup** (dòng chứa marker deterministic `error`/`failed`/`panic`/`exception`/`traceback`). **No LLM**: embedding trên corpus deterministic này, không summarization. Lợi ích: corpus nhỏ, tái tạo được, không drift, local backfill nhanh. Khác **422 PF deterministic-compactor** (nén context) — RU **tạo document ngữ nghĩa deterministic**; khác **462 QN micro-compaction** (LLM summary) — RU **no LLM**.

## Mô tả

mya deterministic rollup semantic corpus: (1) **Indexing pipeline**: import session → build corpus document → embed → vector store. (2) **lite_turn document**: mỗi turn = user msg + last assistant msg → 1 document embedding. (3) **File rollup**: session touched files → document "session touched X (added), Y (modified)". (4) **Command rollup**: command preview + status + exit → document "ran `npm test` (exit 1)". (5) **Error rollup**: dòng có deterministic markers (error/failed/panic) → document. (6) **No LLM**: pure deterministic (metadata → document), embed local. (7) **Stable doc IDs**: ID deterministic từ content → backfill idempotent. Kết quả: corpus semantic **nhỏ + reproducible + no drift** để hybrid search. mya có semantic search — RU thêm **deterministic corpus builder**.

## Kiến trúc

```
  SESSION EVENTS (user/assistant/tool/command/file/error metadata)
        │
        ▼
  ┌─── CORPUS BUILDER (deterministic — NO LLM) ──────────┐
  │                                                       │
  │  ① lite_turn (per turn):                              │
  │     turn N = [user_msg_N] + [last assistant_msg trước  │
  │              user_msg_{N+1}]                           │
  │     → document: "user: ... assistant: ..."             │
  │                                                       │
  │  ② file rollup (per session):                         │
  │     touched paths + change kinds                      │
  │     → document: "session touched parser.rs (modified),│
  │                  auth.ts (added)"                     │
  │                                                       │
  │  ③ command rollup (per session):                      │
  │     preview + status + exit code                      │
  │     → document: "ran `npm test` exit 1 (failed)"      │
  │                                                       │
  │  ④ error rollup (per session):                        │
  │     dòng chứa markers (error/failed/panic/exception/   │
  │     traceback)                                         │
  │     → document: "error: ImportError at line 42"       │
  │                                                       │
  │  stable doc-id = hash(content) → idempotent backfill   │
  └───────────────────────┬───────────────────────────────┘
                          ▼
  EMBED (local model — KHÔNG LLM summarization)
                          ▼
  VECTOR STORE (corpus semantic nhỏ + deterministic)
                          ▼
  HYBRID SEARCH: lexical (FTS) + semantic (vector) → fuse/rerank
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ semantic search/indexing (packages/*) — embedding + vector (nền — RU = corpus builder)
// ✅ 422 PF deterministic-context-compactor — deterministic nén (đối chiếu — RU = document ngữ nghĩa)
// ✅ 462 QN micro-compaction — LLM summary (đối chiếu — RU = no LLM)
// ✅ 197 hybrid-search-reranking — fuse lexical+semantic (nền — RU = corpus cho semantic)

// ❌ THIẾU: lite_turn builder (user + last assistant trước user kế)
// ❌ THIẾU: deterministic rollups (file/command/error từ metadata)
// ❌ THIẾU: stable doc-id (hash content → idempotent backfill)
// ❌ THIẾU: no-LLM guarantee (embed corpus deterministic, không summarization)
```

## Implementation

```typescript
// packages/agent/src/semantic-corpus.ts (MỚI)
interface Event { role: "user" | "assistant"; content: string; files?: string[]; command?: string; exitCode?: number; }
interface CorpusDoc { id: string; type: "lite_turn" | "file_rollup" | "command_rollup" | "error_rollup"; text: string; sessionId: string; }

const ERROR_MARKERS = ["error", "failed", "panic", "exception", "traceback"];

function hash(s: string): string {                 // stable doc-id
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `doc_${h >>> 0}`;
}

// build corpus deterministic (NO LLM) từ session events
function buildCorpus(sessionId: string, events: Event[]): CorpusDoc[] {
  const docs: CorpusDoc[] = [];

  // ① lite_turn: mỗi turn = user msg + last assistant trước user kế
  const userTurns = events.map((e, i) => e.role === "user" ? i : -1).filter(i => i >= 0);
  for (let t = 0; t < userTurns.length; t++) {
    const userIdx = userTurns[t];
    const nextUserIdx = t + 1 < userTurns.length ? userTurns[t + 1] : events.length;
    // last assistant trong window [userIdx, nextUserIdx)
    let lastAssistant: Event | null = null;
    for (let i = userIdx; i < nextUserIdx; i++)
      if (events[i].role === "assistant") lastAssistant = events[i];
    const text = `user: ${events[userIdx].content}\nassistant: ${lastAssistant?.content ?? ""}`;
    docs.push({ id: hash(text), type: "lite_turn", text, sessionId });
  }

  // ② file rollup: touched paths + change kinds
  const files = new Set<string>();
  for (const e of events) for (const f of e.files ?? []) files.add(f);
  if (files.size) {
    const text = `session touched: ${[...files].join(", ")}`;
    docs.push({ id: hash(text), type: "file_rollup", text, sessionId });
  }

  // ③ command rollup: preview + status + exit
  for (const e of events) {
    if (e.command) {
      const text = `ran \`${e.command}\` exit ${e.exitCode ?? 0} (${e.exitCode ? "failed" : "ok"})`;
      docs.push({ id: hash(text), type: "command_rollup", text, sessionId });
    }
  }

  // ④ error rollup: dòng chứa deterministic markers
  for (const e of events) {
    const lines = e.content.split("\n").filter(l => ERROR_MARKERS.some(m => l.toLowerCase().includes(m)));
    if (lines.length) {
      const text = lines.slice(0, 10).join("\n");
      docs.push({ id: hash(text), type: "error_rollup", text, sessionId });
    }
  }

  return docs;   // embed mỗi doc → vector store (NO LLM summarization)
}

// Usage:
// const docs = buildCorpus("sess-1", events);   // deterministic corpus
// for (const d of docs) vectorStore.upsert(d.id, await embed(d.text));  // local embed
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Corpus nhỏ + reproducible (deterministic, no LLM) | ❌ Không có "insight" (chỉ metadata, không summarization) |
| ✅ No drift (functional doc, không inferred finding) | ❌ lite_turn có thể thiếu context (chỉ 2 msg/turn) |
| ✅ Local backfill nhanh (idempotent stable doc-id) | ❌ Rollup phụ thuộc metadata chất lượng |
| ✅ Hybrid search (lexical + semantic fuse) | ❌ Error markers heuristic (false positive) |

## Khác các hướng gần

| | 422 Deterministic-Compactor | 462 Micro-Compaction | RU: Rollup-Corpus |
|---|---|---|---|
| Cái gì | Nén context deterministic | LLM summary per-turn | **Document ngữ nghĩa no-LLM** |
| LLM | ❌ | ✅ | **❌ (metadata → doc)** |
| Output | Context nén | Summary | **Corpus embed (lite_turn + rollup)** |

## Khi nào chọn

- Muốn semantic search local mà không tốn LLM tạo document
- Cần corpus deterministic (reproducible, no drift, idempotent backfill)
- Chấp nhận metadata-only corpus (không "insight" summarization)
- Nối semantic search (RU = corpus builder) + 197 hybrid (RU = corpus cho semantic side); guard no-LLM invariant (embed corpus deterministic, KHÔNG summarization) + lite_turn window (user + last assistant trước user kế, đủ ý turn) + error-marker heuristic (false positive → refine marker list) + stable doc-id (hash content, idempotent backfill)
