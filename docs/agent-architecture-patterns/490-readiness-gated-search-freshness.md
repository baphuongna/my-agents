# Hướng RV: Readiness-Gated Search Freshness — daemon sở hữu indexing, search đọc index cũ, wait cho readiness

> **Nguồn gốc:** ctx (ctx.rs; daemon-semantic-indexing-spec; "daemon-owned indexing"; "search is interactive read path"; "serve current indexes"; freshness modes background/off/wait; "wait for requested readiness then search or fail")
> **Coupling:** 🟡 — tách indexing (daemon background) khỏi search (foreground read), thêm freshness gate
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (search + indexing sẵn — chưa có daemon-owned indexing + freshness background/off/wait)
> **Effort:** 2-3 tuần

## Nguồn gốc

**ctx** (ctx.rs) tách rõ **indexing** (background infrastructure) khỏi **search** (interactive read path). Vấn đề: nếu `ctx search` chạy inline history-refresh + lexical-refresh + semantic-projection + embedding mỗi lần → **chậm** (search block chờ index). Giải pháp: **daemon sở hữu indexing** — daemon chạy nền, refresh index liên tục; **search chỉ đọc current indexes** (không tự refresh), trả nhanh. **Freshness** tách khỏi retrieval mode: (1) **background** (default) — serve current index + poke daemon làm việc nếu cần (không chờ). (2) **off** — serve current index, KHÔNG start/poke/wait daemon (đọc cũ, im lặng). (3) **wait** — chờ daemon đạt readiness yêu cầu rồi search (hoặc fail với lỗi rõ). **Readiness** = ước lượng thời gian (lexical ~14ph, semantic ~45ph) — `ctx setup` trả prompt nhưng không block. Nguyên tắc: **indexing là hạ tầng nền, search là read nhanh** — search không embed/refresh inline. Khác **403 OM windowed-history** (window query) — RV **freshness gate indexing**; khác **191 GI kv-cache** — RV **index freshness, không cache**.

## Mô tả

mya readiness-gated search freshness: (1) **Daemon**: chạy nền, sở hữu indexing (history/lexical/semantic refresh, embedding). (2) **Search foreground**: chỉ đọc current indexes, trả nhanh — KHÔNG inline refresh/project/embed. (3) **Freshness mode**: `background` (serve + poke daemon), `off` (serve, im lặng), `wait` (chờ readiness → search/fail). (4) **Readiness estimate**: daemon báo tiến độ + ETA (lexical/semantic). (5) **Signal**: search optional poke daemon work (background) hoặc chờ (wait). mya có search + indexing — RV thêm **daemon-owned indexing** + **freshness gate** (search không tự index).

## Kiến trúc

```
  ┌─── DAEMON (background, owns indexing) ──────────────┐
  │  history-refresh → lexical index (FTS)               │
  │  semantic-projection → embed → vector index          │
  │  readiness tracker:                                  │
  │    lexical:  60% (ETA ~6ph)                          │
  │    semantic: 30% (ETA ~30ph)                         │
  │  (chạy nền liên tục, KHÔNG block search)             │
  └───────────────────────┬─────────────────────────────┘
                          │ writes indexes
                          ▼
                 ┌─── CURRENT INDEXES ───┐
                 │  lexical (FTS)  v17   │
                 │  semantic (vec) v12   │
                 └───────────┬───────────┘
                             │ read (không refresh inline)
                             ▼
  ┌─── ctx search (foreground, READ path) ──────────────┐
  │  freshness mode?                                     │
  │                                                       │
  │  ┌─ background (default) ─────────────────────┐     │
  │  │  serve current indexes                       │     │
  │  │  poke daemon (start work if needed) — KHÔNG chờ │   │
  │  │  → trả nhanh (index cũ, daemon refresh nền)  │     │
  │  └─────────────────────────────────────────────┘     │
  │  ┌─ off ───────────────────────────────────────┐     │
  │  │  serve current indexes                       │     │
  │  │  KHÔNG start/poke/wait daemon (im lặng)      │     │
  │  └─────────────────────────────────────────────┘     │
  │  ┌─ wait ──────────────────────────────────────┐     │
  │  │  chờ daemon đạt readiness yêu cầu            │     │
  │  │  → search (index fresh) hoặc FAIL (lỗi rõ)   │     │
  │  └─────────────────────────────────────────────┘     │
  └───────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ search (packages/*) — retrieval (nền — RV = foreground read, không inline refresh)
// ✅ indexing — build index (nền — RV = daemon owns, background)
// ✅ 403 OM windowed-history-retrieval — window query (đối chiếu — RV = freshness gate)
// ✅ 191 GI kv-semantic-cache — cache (đối chiếu — RV = index freshness)

// ❌ THIẾU: daemon (background owns indexing, refresh liên tục)
// ❌ THIẾU: freshness modes (background/off/wait) trong search
// ❌ THIẾU: readiness tracker (ETA lexical/semantic)
// ❌ THIẾU: search-no-inline-refresh invariant (chỉ đọc, không embed/project)
```

## Implementation

```typescript
// packages/agent/src/readiness-search.ts (MỚI)
type Freshness = "background" | "off" | "wait";
type Retrieval = "hybrid" | "semantic" | "lexical";

interface Readiness { lexical: number; semantic: number; lexicalEta: number; semanticEta: number; }
interface Daemon {
  getStatus(): Readiness;
  poke(): void;                          // start/continue work (background)
  waitFor(kind: "lexical" | "semantic", timeoutMs: number): Promise<boolean>;
}

class SearchService {
  constructor(private daemon: Daemon, private lexical: LexicalIndex, private semantic: SemanticIndex) {}

  // search = READ path — KHÔNG inline refresh/project/embed
  async search(query: string, opts: { retrieval?: Retrieval; freshness?: Freshness; timeoutMs?: number }): Promise<Result[]> {
    const fresh = opts.freshness ?? "background";
    const retr = opts.retrieval ?? "hybrid";

    if (fresh === "background") this.daemon.poke();                 // poke — không chờ
    if (fresh === "off") { /* serve, im lặng — KHÔNG poke/wait */ }
    if (fresh === "wait") {
      const needLex = retr === "hybrid" || retr === "lexical";
      const needSem = retr === "hybrid" || retr === "semantic";
      const ok = await this.daemon.waitFor(needSem ? "semantic" : "lexical", opts.timeoutMs ?? 60_000);
      if (!ok) throw new Error("search: daemon not ready within timeout (use freshness=background to serve stale)");
    }

    // chỉ ĐỌC current indexes
    if (retr === "lexical") return this.lexical.query(query);
    if (retr === "semantic") return this.semantic.query(query);
    return fuseRerank(this.lexical.query(query), this.semantic.query(query));   // hybrid
  }

  // setup: KHÔNG block chờ full readiness — báo ETA rồi về
  setup(): { records: number; readiness: Readiness } {
    this.daemon.poke();
    return { records: countRecords(), readiness: this.daemon.getStatus() };
  }
}

// Usage:
// await svc.search("test failure", { freshness: "background" });  // serve stale + poke daemon
// await svc.search("test failure", { freshness: "off" });         // serve stale, im lặng
// await svc.search("test failure", { freshness: "wait", timeoutMs: 30_000 });  // chờ hoặc fail
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Search nhanh (chỉ read, không inline refresh/embed) | ❌ Cần daemon chạy nền (process management) |
| ✅ Indexing không block search (background) | ❌ Serve stale (background đọc index cũ) |
| ✅ wait mode đảm bảo fresh (hoặc fail rõ) | ❌ wait có thể timeout (fail thay vì serve) |
| ✅ Freshness tách retrieval mode (hybrid/semantic/lexical) | ❌ Readiness estimate có thể sai (ETA) |

## Khác các hướng gần

| | 403 Windowed-History | 191 KV-Semantic-Cache | RV: Readiness-Search |
|---|---|---|---|
| Cái gì | Window query | Cache output reuse | **Freshness gate indexing** |
| Indexing | Inline | N/A | **Daemon owns (background)** |
| Search | Query window | Cache lookup | **Read current index (background/off/wait)** |

## Khi nào chọn

- Search chậm vì mỗi lần tự refresh/embed inline
- Muốn indexing chạy nền (daemon), search chỉ đọc nhanh
- Cần 3 chế độ freshness: background (serve + poke), off (serve im lặng), wait (chờ/fail)
- Nối search (RV = foreground read) + indexing (RV = daemon background owns); guard search-no-inline invariant (KHÔNG refresh/project/embed trong search path) + daemon lifecycle (start/stop/health) + wait-timeout (fail rõ thay vì treo) + readiness estimate (ETA lexical/semantic cho setup prompt)
