# Hướng AAE: RAM-First Indexing Pipeline — LZ4 compression + in-memory SQLite + Aho-Corasick để index kernel 28M LOC trong 3 phút

> **Nguồn gốc:** codebase-memory-mcp (README.md) | **Coupling:** 🟢 — pipeline index riêng, giải phóng memory sau | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có code-index bounded — chưa có RAM-first batch + LZ4 + AC automaton) | **Effort:** 2-3 tuần

## Nguồn gốc

**codebase-memory-mcp** dùng pipeline **RAM-first**: (1) **LZ4 compression** — nén nội dung trước khi lưu, giảm footprint; (2) **in-memory SQLite** — index nằm trong RAM (nhanh hơn disk I/O); (3) **fused Aho-Corasick pattern matching** — gộp nhiều pattern thành một automaton duyệt một lần. Kết quả: index **Linux kernel (28M LOC, 75K files) trong 3 phút**, sau đó **giải phóng memory** (flush xuống disk, drop in-memory state). Nguyên tắc: **làm việc trong RAM để nhanh, flush ra disk khi xong** — peak memory chấp nhận được vì có giới hạn thời gian.

## Mô tả

mya ram-first indexing pipeline: packages/memory code-index.ts hiện dùng **bounded incremental** (mỗi query index một batch — không freeze event loop). AAE thêm **batch mode**: worker_thread (đã có pattern trong embeddings.ts) chạy pipeline RAM-first — đọc file → LZ4 nén nội dung → insert in-memory SQLite → build Aho-Corasick automaton từ pattern set (import/function/symbol names) → duyệt mỗi file một lần. Xong → **flush xuống disk** (SQLite file + code-index.db) → **giải phóng RAM**. Giữ bounded cho interactive query; AAE dành cho "index everything" một lần (boot/CI).

## Kiến trúc

```
  FILES (75K files / 28M LOC)
        │
        ▼
  ┌─── RAM-FIRST PIPELINE (worker_thread) ─────────────┐
  │  1. read + LZ4 compress content (footprint ↓)       │
  │  2. insert in-memory SQLite (không disk I/O)        │
  │  3. build Aho-Corasick automaton (pattern fused)    │
  │  4. scan mỗi file 1 lần qua automaton               │
  │     → matches: import/function/symbol references    │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── FLUSH + RELEASE ────────────────────────────────┐
  │  5. flush in-memory SQLite → disk (.db)             │
  │  6. drop automaton + buffers → giải phóng RAM       │
  │  → sẵn sàng cho query (FTS5/BM25 từ disk)           │
  └──────────────────────────────────────────────────────┘
  KPI: 28M LOC / 75K files → 3 phút
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory code-index.ts — bounded incremental index (interactive)
// ✅ packages/memory embeddings.ts — worker_thread offload pattern (nền)
// ✅ packages/memory sqlite-db.ts — SQLite (nền in-memory `:memory:` mode)
// ✅ packages/tools search-index.ts — FTS/file index (nền query sau flush)
// ✅ packages/tools symbol-extractor.ts — symbol scan (nền pattern set)

// ❌ THIẾU: RAM-first batch pipeline (worker + in-memory + flush)
// ❌ THIẾU: LZ4 compression (hoặc lz4-native qua natives)
// ❌ THIẾU: Aho-Corasick automaton (fused multi-pattern scan)
```

## Implementation

```typescript
// packages/memory/src/ram-first-index.ts (NEW)

export interface IndexBudget { maxMemMb: number; targetMs: number }

/** Aho-Corasick automaton (MVP: trie + fail links, pattern set nhỏ gọn). */
export class AhoCorasick {
  private readonly goto: Map<number, Map<number, number>> = new Map([[0, new Map()]]);
  private readonly fail = new Map<number, number>([[0, 0]]);
  private readonly out = new Map<number, string[]>();
  private nextId = 1;

  add(pattern: string): void {
    let state = 0;
    for (const ch of pattern) {
      const c = ch.codePointAt(0)!;
      let g = this.goto.get(state)!;
      if (!g.has(c)) { g.set(c, this.nextId); this.goto.set(this.nextId, new Map()); this.nextId++; }
      state = this.goto.get(state)!.get(c)!;
    }
    (this.out.get(state) ?? this.out.set(state, []).get(state)!).push(pattern);
  }

  build(): void { /* BFS fail links — fused automaton */ }

  scan(text: string): string[] {
    const hits: string[] = [];
    let state = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0)!;
      while (state !== 0 && !this.goto.get(state)!.has(c)) state = this.fail.get(state)!;
      state = this.goto.get(state)!.get(c) ?? 0;
      for (const p of this.out.get(state) ?? []) hits.push(p);
    }
    return hits;
  }
}

/** RAM-first index: in-memory SQLite + LZ4 (native) + AC automaton → flush. */
export async function indexRamFirst(
  files: string[],
  patterns: string[],
  budget: IndexBudget,
): Promise<{ filesIndexed: number; hits: number; ms: number }> {
  const started = performance.now();
  // 1. worker_thread (không block event loop — pattern từ embeddings.ts)
  const ac = new AhoCorasick();
  for (const p of patterns) ac.add(p);
  ac.build();
  // 2. scan + LZ4-compress content vào in-memory SQLite (chạy trong worker)
  let hits = 0;
  for (const f of files) hits += ac.scan(f).length;
  // 3. flush SQLite → disk, drop buffers → giải phóng RAM
  return { filesIndexed: files.length, hits, ms: Math.round(performance.now() - started) };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Index repo khổng lồ (28M LOC) trong phút | ❌ Peak RAM cao trong lúc chạy (phải đo) |
| ✅ Aho-Corasick quét một lần mọi pattern | ❌ LZ4 native dep (hoặc fallback JS chậm) |
| ✅ In-memory SQLite nhanh hơn disk I/O | ❌ Flush crash → mất toàn bộ pass (không incremental) |
| ✅ Giải phóng RAM sau khi xong | ❌ Worker_thread + big arrays — cần chunk để tránh OOM |

## Khác các hướng gần

| | Bounded incremental | AAE: RAM-First Batch |
|---|---|---|
| Khi chạy | Mỗi query (interactive) | **Một lần (boot/CI)** |
| Memory | Thấp (batch nhỏ) | **Cao (toàn bộ trong RAM)** |
| Tốc độ | ~giây mỗi lần | **3 phút cho kernel** |
| Mối quan hệ | Interactive | **Bổ sung: index-everything** |

## Khi nào chọn

- Repo rất lớn cần index một lần (kernel-class) — interactive bounded không đủ
- Đã có worker_thread pattern (embeddings) + SQLite — ghép thành pipeline
- Guard: LZ4 native (Rust gate — hot inner loop), flush-point đều đặn (chống mất khi crash), KPI gate ms/mem, giải phóng RAM deterministic
