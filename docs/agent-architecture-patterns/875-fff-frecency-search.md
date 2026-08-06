# Hướng AGQ: FFF Frecency Search — bundled FFF index cho find/grep với frecency-aware ranking (file hay chạm nổi lên sớm), cursor store phân trang grep, cache tách khỏi core

> **Nguồn gốc:** pi-pretty | **Coupling:** 🟡 — bind vào find/grep tool + native indexer | **Agent-agnostic:** ✅ (search infra thuần) | **Code sẵn:** ⚠️ (mya có frecency.ts + code-index.ts + find/grep, nhưng KHÔNG có bundled FFF index frecency-ranked) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-pretty** bundle **FFF** (Fast File Finder) — một indexer tạo cache index cho find/grep. Điểm mạnh: **frecency-aware ranking** — file **hay chạm** (recently + frequently accessed) nổi lên **sớm** trong kết quả (frecency = frequency × recency decay). Grep result dùng **cursor store phân trang** (không load hết vào memory). Dữ liệu cache nằm dưới `~/.pi/agent/pi-pretty/fff/` **tách khỏi core** — core không biết FFF tồn tại, chỉ thấy interface find/grep.

Nguyên tắc: **frecency ranking** (file dùng nhiều + gần đây lên đầu); **cursor pagination** cho grep lớn; **cache tách core** (extension sở hữu storage riêng); **index bên ngoài core** (bundled native, optional).

## Mô tả

Với mya, packages/tools có `frecency.ts` (frecency logic — test `frecency.test.ts`), `find.ts`/`grep` và packages/memory có `code-index.ts` (mtime-incremental indexing SQLite + embeddings). mya **đã có nền frecency + indexing**, nhưng **chưa có** FFF-style: (1) **bundled indexer** cho find/grep thuần (không embedding), (2) **frecency-ranked find** (file hay chạm lên đầu), (3) **cursor pagination** cho grep result. Pattern này tăng tốc find/grep cảm giác — file người dùng hay mở nổi trước.

## Kiến trúc (ASCII)

```
  find/grep tool
       │
       ▼
  FffService (bundled FFF index, cache ~/.pi/agent/pi-pretty/fff/)
       │  frecency: score = frequency × recencyDecay(now - lastTouch)
       ▼
  ranked results (file hay chạm lên đầu)
       │  grep: cursor store phân trang (lấy page N, không load hết)
       ▼
  ── cache TÁCH CORE: core chỉ thấy find/grep interface, không biết FFF
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/frecency.ts — frecency logic (test: frecency.test.ts)
// ✅ packages/tools/src/find.ts — find tool
// ✅ packages/memory/src/code-index.ts — mtime-incremental SQLite index + embeddings
// ⚠️ KHÔNG có FFF bundled indexer cho find/grep thuần (không embedding)
// ❌ KHÔNG có cursor pagination cho grep result lớn
```

## Implementation

```typescript
// packages/tools/src/fff-service.ts (NEW)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface FffEntry { path: string; hits: number; lastTouch: number; }
const HALF_LIFE_MS = 7 * 24 * 3600 * 1000;        // recency decay 1 tuần

export class FffService {
  private index = new Map<string, FffEntry>();
  private readonly cacheDir = join(homedir(), ".pi", "agent", "pi-pretty", "fff");

  isAvailable(): boolean { return true; }          // bundled → luôn sẵn (xem AGR fallback)

  touch(p: string, now = Date.now()): void {
    const e = this.index.get(p) ?? { path: p, hits: 0, lastTouch: now };
    e.hits += 1; e.lastTouch = now; this.index.set(p, e);
  }

  /** Frecency score: frequency × recency decay. File hay chạm + gần đây → cao. */
  score(e: FffEntry, now = Date.now()): number {
    const age = now - e.lastTouch;
    return e.hits * Math.pow(0.5, age / HALF_LIFE_MS);
  }

  rank(paths: string[], now = Date.now()): string[] {
    return [...paths].sort((a, b) => {
      const sa = this.score(this.index.get(a) ?? { path: a, hits: 0, lastTouch: 0 }, now);
      const sb = this.score(this.index.get(b) ?? { path: b, hits: 0, lastTouch: 0 }, now);
      return sb - sa;
    });
  }

  /** Grep cursor pagination: trả page N, không load hết. */
  page(matches: string[], cursor: number, size = 50): { items: string[]; next: number | null } {
    const items = matches.slice(cursor, cursor + size);
    const next = cursor + size < matches.length ? cursor + size : null;
    return { items, next };
  }

  persist(): void { mkdirSync(this.cacheDir, { recursive: true }); writeFileSync(join(this.cacheDir, "index.json"), JSON.stringify([...this.index.values()])); }
}
// find/grep → fff.rank(paths); cache TÁCH CORE (chỉ FffService biết cacheDir).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ File hay chạm nổi lên đầu (UX tốt) | ❌ Index phải build + duy trì (overhead) |
| ✅ Cursor pagination → grep lớn không OOM | ❌ Cache tách → core cần graceful fallback (xem AGR) |
| ✅ Cache tách core — extension sở hữu storage | ❌ Frecency decay cần tune HALF_LIFE |

## Khác các hướng gần

| | AGQ FFF Frecency | AGR SDK Fallback | code-index.ts |
|---|---|---|---|
| Trọng tâm | Ranking find/grep theo frecency | Degrade khi thiếu FFF | Index code mtime + embedding |
| Cơ chế | frequency × recency + cursor | isAvailable → SDK path | SQLite mtime-incremental |
| Quan hệ | Nối search UX | Nối robustness | Nối semantic index |

## Khi nào chọn

- find/grep chậm / kết quả không theo ý (file cần không lên đầu)
- Cần cursor pagination cho grep result lớn
- Muốn frecency ranking (file dùng nhiều + gần đây lên đầu)
- Guard: cache tách core, frecency decay tune, fallback SDK khi FFF fail (AGR)
