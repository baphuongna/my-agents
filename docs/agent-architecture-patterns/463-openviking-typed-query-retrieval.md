# Hướng QU: Typed Query Retrieval — phân tích ý định sinh câu hỏi type 0-5 gọi find/search từng loại

> **Nguồn gốc:** OpenViking (context database, viking://); "typed query intent classification"; "query type 0-5 routing to find/search/ls/tree"; "directory-recursive retrieval"; "observable retrieval trajectory"; "intent → query-type → backend"
> **Coupling:** 🟢 — thêm query-classifier layer trước find/search/grep dispatch
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (find/grep + search-index sẵn — chưa có intent→query-type classifier + per-type backend)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenViking** là **context database** cho AI agent — lưu memory/resource/skill như **virtual filesystem** dưới `viking://`, agent **duyệt** bằng `ls`/`tree`/`find` thay vì query vector-store đen. **Directory-recursive retrieval**: vector-search tìm directory điểm cao nhất rồi drill-down từng lớp. **Typed query retrieval** mở rộng: **phân tích ý định** user-query → **phân loại type 0-5**, mỗi type **gọi backend phù hợp** (find path / grep content / semantic vector / directory-browse / ls structure / tree overview). Nguyên tắc: **không mọi câu hỏi là "search"** — "file parser ở đâu?" = find path (type 1), "đoạn code xử lý null?" = grep content (type 2), "khái niệm X là gì?" = semantic vector (type 3). Định tuyến đúng backend = chính xác + ít token. Khác **197 hybrid-search-reranking** (rank results) — QU là **intent routing**; khác **083 tool-discovery** (find tool) — QU là **find code/memory**.

## Mô tả

mya typed query retrieval: (1) **Intent classify**: user-query → **type 0-5** — 0: exact-path lookup, 1: find-by-name, 2: grep-by-content, 3: semantic-vector, 4: directory-browse, 5: tree-overview. (2) **Route**: mỗi type → backend (type 0 read, type 1 find, type 2 grep, type 3 search-index/vector, type 4 ls+drill, type 5 tree). (3) **Execute**: chạy backend, trả kết quả. (4) **Observable**: mỗi query lưu trajectory (path nào duyệt) → debug khi sai. mya có `find` + `grep` + `search-index` (vector/semantic) — QU thêm **intent classifier** (query → type 0-5) + **type→backend router** + **trajectory log**.

## Kiến trúc

```
  USER QUERY: "where's the parser?" / "code handling null?" / "what is auth?"
        │
        ▼
  ┌─── INTENT CLASSIFIER (query → type 0-5) ───────────┐
  │                                                       │
  │  "parser.rs" exact          → TYPE 0 (exact path)     │
  │  "where's the parser?"       → TYPE 1 (find by name)  │
  │  "code handling null token?" → TYPE 2 (grep content)  │
  │  "what is the auth flow?"    → TYPE 3 (semantic vec)  │
  │  "show me src/ structure"    → TYPE 4 (dir browse)    │
  │  "overview of packages/"     → TYPE 5 (tree)          │
  └───────────────────────┬─────────────────────────────┘
                          │ (type)
                          ▼
  ┌─── TYPE → BACKEND ROUTER ───────────────────────────┐
  │  type 0 → read_file(path)                             │
  │  type 1 → find(name="parser")          ← path search  │
  │  type 2 → grep(pattern="null.*token")  ← content      │
  │  type 3 → search-index(query="auth flow") ← semantic  │
  │  type 4 → ls(dir) + drill-down          ← browse      │
  │  type 5 → tree(dir, depth=2)            ← overview    │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── EXECUTE + TRAJECTORY LOG ─────────────────────────┐
  │  run backend → results                               │
  │  log trajectory: [type=1, found src/parser.rs]       │
  │  → observable: debug khi kết quả sai                  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ find — path/filename search (nền — QU type 1)
// ✅ grep — content search (nền — QU type 2)
// ✅ packages/tools/search-index — vector/semantic (nền — QU type 3)
// ✅ read — exact path (nền — QU type 0)

// ❌ THIẾU: intent classifier (query → type 0-5)
// ❌ THIẾU: type→backend router (dispatch đúng tool)
// ❌ THIẾU: trajectory log (query path → debug observable)
// ❌ THIẾU: directory-browse composite (type 4: ls + drill-down)
```

## Implementation

```typescript
// packages/agent/src/typed-query.ts (MỚI)
type QueryType = 0 | 1 | 2 | 3 | 4 | 5;

interface QueryResult { type: QueryType; trajectory: string[]; items: unknown[] }

function classifyIntent(query: string): QueryType {
  if (/^[\w./-]+\.\w+$/.test(query.trim())) return 0;      // exact path "parser.rs"
  if (/where|find.*file|path|filename/i.test(query)) return 1;
  if (/code.*handling|function|variable|pattern|grep/i.test(query)) return 2;
  if (/what is|explain|concept|how does/i.test(query)) return 3;
  if (/show.*structure|browse|list|contents of/i.test(query)) return 4;
  if (/overview|tree|big picture|map of/i.test(query)) return 5;
  return 2; // default content search
}

async function routeQuery(
  type: QueryType,
  query: string,
  backends: { find: F; grep: G; search: S; read: R; ls: L; tree: T },
): Promise<QueryResult> {
  const trajectory: string[] = [`type=${type}`];
  switch (type) {
    case 0: { const f = await backends.read(query); trajectory.push(`read(${query})`); return { type, trajectory, items: [f] }; }
    case 1: { const r = await backends.find(query); trajectory.push(`find(${query})`); return { type, trajectory, items: r }; }
    case 2: { const r = await backends.grep(query); trajectory.push(`grep(${query})`); return { type, trajectory, items: r }; }
    case 3: { const r = await backends.search(query); trajectory.push(`search-index(${query})`); return { type, trajectory, items: r }; }
    case 4: { const r = await backends.ls(query); trajectory.push(`ls(${query})`); return { type, trajectory, items: r }; }
    case 5: { const r = await backends.tree(query); trajectory.push(`tree(${query})`); return { type, trajectory, items: r }; }
  }
}

// Usage:
// const type = classifyIntent(userQuery);     // → 2 (content)
// const result = await routeQuery(type, userQuery, tools);
// result.trajectory  // ["type=2", "grep(null.*token)"] → observable debug
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chính xác (đúng backend cho đúng intent) | ❌ Classifier sai (find khi cần grep) |
| ✅ Ít token (find rẻ hơn vector-search) | ❌ Ambiguous query (vừa path vừa concept) |
| ✅ Observable (trajectory → debug kết quả sai) | ❌ 6 type có thể thiếu (hybrid query không khớp) |
| ✅ Nối find/grep/search-index (tận dụng sẵn) | ❌ Maintenance (thêm backend → thêm type) |

## Khác các hướng gần

| | 197 Hybrid-Reranking | 083 Tool-Discovery | QU: Typed-Query |
|---|---|---|---|
| Cái gì | Rank results | Find tool | **Intent → backend routing** |
| Input | Results list | Task | **User query** |
| Output | Reranked | Tool name | **type 0-5 → find/grep/search** |

## Khi nào chọn

- Agent tìm code/memory nhiều kiểu (path/content/semantic/structure)
- Muốn chính xác + ít token (route đúng backend)
- Cần debug (trajectory observable khi kết quả sai)
- Nối find (type 1) + grep (type 2) + search-index (type 3) + read (type 0) + ls/tree (type 4/5); guard classifier accuracy (ambiguous → hỏi user) + cover all 6 types; kết hợp 197 reranking cho type 3 (semantic → rerank)
