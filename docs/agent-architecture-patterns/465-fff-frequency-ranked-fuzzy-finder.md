# Hướng QW: Frequency-Ranked Fuzzy Finder — path fuzzy cho typo, rank theo tần suất file đã đọc gần

> **Nguồn gốc:** fff (file search toolkit, frecency memory); "typo-resistant path search"; "frecency-ranked file access"; "smart-case auto-fuzzy fallback"; "frequency + recency ranking"; "warm-up from git touch history"
> **Coupling:** 🟢 — thêm frecency-scored fuzzy layer vào find tool (rank results)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (find + fuzzy-score sẵn — chưa có frecency index + git warm-up)
> **Effort:** 1-2 tuần

## Nguồn gốc

**fff** là **file search toolkit** cho human + AI agent: **typo-resistant path search** (query `IsOffTheRecord` tìm được snake_case `is_off_the_record`), **frecency memory** (file agent hay mở rank cao hơn), **smart-case auto-fuzzy fallback** (zero-match exact → retry fuzzy surface best approximate), **background watcher** + **in-memory content index**. **Warm-up**: boot từ git touch history (file hay commit = frecency init). Nguyên tắc: **frecency = frequency × recency** — file đọc gần + nhiều > file cũ + hiếm. Khác **find** thuần (chỉ glob) — QW là **fuzzy + ranked**; khác **463 typed-query** (intent routing) — QW là **ranking layer cho type 1 (find)**.

## Mô tả

mya frequency-ranked fuzzy finder: (1) **Fuzzy match**: query fuzzy qua toàn bộ path (typo-tolerant — `parsr` → `parser.rs`). (2) **Frecency index**: theo dõi mỗi file agent read (frequency count + last-access timestamp). (3) **Score**: `score = fuzzyMatchScore + frecencyBoost (freq × recencyDecay) + gitStatusBoost`. (4) **Smart-case**: exact match ưu tiên; zero-match → retry fuzzy surface best approximate. (5) **Warm-up**: boot index từ git log (file hay touch = frecency init). (6) **Weak-match detector**: flag scattered fuzzy noise (tránh flood context). mya có `find` + `fuzzy-score.ts` + `search-index` — QW thêm **frecency tracker** + **git warm-up** + **composite ranker** (fuzzy + frecency + git).

## Kiến trúc

```
  QUERY: "parsr" (typo, agent gõ sai)
        │
        ▼
  ┌─── FUZZY MATCH (typo-tolerant) ─────────────────────┐
  │  exact "parsr" → 0 match                              │
  │  fuzzy "parsr" → [src/parser.rs, lib/parsr_old.rs,    │
  │                   tests/parser.test.ts]                │
  └───────────────────────┬─────────────────────────────┘
                          │ (fuzzy candidates)
                          ▼
  ┌─── FRECENCY RANKER ─────────────────────────────────┐
  │  src/parser.rs        freq=42, last=2min → boost HIGH│
  │  tests/parser.test.ts freq=15, last=1h   → boost MED │
  │  lib/parsr_old.rs     freq=0,  last=30d  → boost 0   │
  │  + git: parser.rs touched 120 times (warm)           │
  └───────────────────────┬─────────────────────────────┘
                          │ (ranked)
                          ▼
  ┌─── RESULT (top = frecency-high) ─────────────────────┐
  │  1. src/parser.rs         ← agent vừa đọc, rõ ràng    │
  │  2. tests/parser.test.ts  ← liên quan                  │
  │  3. lib/parsr_old.rs      ← stale, weak match (drop)   │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools/find — path search (nền — QW rank results)
// ✅ packages/tools/fuzzy-score — fuzzy scoring (nền — QW dùng + frecency)
// ✅ packages/tools/search-index — in-memory index (nền — QW frecency store)
// ✅ bash git log — touch history (nền — QW warm-up)

// ❌ THIẾU: frecency tracker (freq count + last-access per file)
// ❌ THIẾU: composite ranker (fuzzy + frecency + git boost)
// ❌ THIẾU: smart-case auto-fuzzy fallback (zero exact → fuzzy retry)
// ❌ THIẾU: git warm-up (git log → frecency init)
// ❌ THIẾU: weak-match detector (drop scattered noise)
```

## Implementation

```typescript
// packages/tools/src/frecency-finder.ts (MỚI)
interface FrecencyEntry { path: string; freq: number; lastAccess: number }

class FrecencyFinder {
  private index = new Map<string, FrecencyEntry>();
  constructor(
    private fuzzyScore: (query: string, path: string) => number,
    private now: () => number,
  ) {}

  // record access (call from read tool)
  recordAccess(path: string): void {
    const e = this.index.get(path) ?? { path, freq: 0, lastAccess: 0 };
    e.freq++; e.lastAccess = this.now();
    this.index.set(path, e);
  }

  // warm-up from git log (file touch count → frecency init)
  async warmUp(gitLog: () => Promise<Map<string, number>>): Promise<void> {
    const touches = await gitLog();
    for (const [path, count] of touches) {
      this.index.set(path, { path, freq: count, lastAccess: 0 }); // recency=stale
    }
  }

  // composite rank
  search(query: string, allPaths: string[]): string[] {
    const DAY = 86_400_000;
    return allPaths
      .map(path => {
        const fuzzy = this.fuzzyScore(query, path);    // typo tolerance
        const f = this.index.get(path);
        const recency = f ? Math.exp(-(this.now() - f.lastAccess) / DAY) : 0;
        const frecency = f ? f.freq * recency : 0;
        return { path, score: fuzzy + frecency * 100 };  // combo boost
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.path);
  }
}

// Usage:
// finder.recordAccess('src/parser.rs');              // read hook
// const results = finder.search('parsr', allPaths);  // typo → ranked
// → ['src/parser.rs', 'tests/parser.test.ts']  (frecency-boosted)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Typo-tolerant (parsr → parser.rs) | ❌ Frecency cold-start (session mới → chưa có data) |
| ✅ File hay đọc rank cao (ít roundtrip) | ❌ Index memory (large repo → index phình) |
| ✅ Git warm-up (boot có frecency ngay) | ❌ Weak-match noise (fuzzy quá rộng → rác) |
| ✅ Nối find + fuzzy-score (tận dụng) | ❌ Frecency drift (file đổi tên → freq mất) |

## Khác các hướng gần

| | find (glob) | 463 QU Typed-Query | QW: Frecency-Fuzzy |
|---|---|---|---|
| Cái gì | Glob path match | Intent → backend | **Fuzzy + frecency rank** |
| Typo | ❌ | ❌ | **✅ (parsr→parser)** |
| Rank | Theo alphabet | Theo type | **Frecency (freq×recency)** |

## Khi nào chọn

- Agent hay gõ sai path (typo) hoặc query mơ hồ
- File lặp lại (agent đọc cùng file nhiều lần → rank cao)
- Repo lớn (cần rank top thay vì alphabet)
- Nối packages/tools/find + fuzzy-score + search-index; guard cold-start (git warm-up), weak-match detector (drop fuzzy noise), frecency drift (rename → re-index); QW là ranking layer cho 463 QU type 1 (find) — kết hợp tốt
