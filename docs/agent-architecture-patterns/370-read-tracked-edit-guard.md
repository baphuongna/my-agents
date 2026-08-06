# Hướng NF: Read-Tracked Edit Guard — theo dõi nguồn đọc để chặn edit vùng chưa đọc

> **Nguồn gốc:** pi-lens (read-guard); "read-before-write" pattern; "spatial memory" / "provenance tracking"; "access-control by observation"; "tourist vs local knowledge"; "typed regions" (taint analysis); "context grounding requirement"
> **Coupling:** 🟡 — thêm read-tracker vào edit pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (read tool + edit tool sẵn — chưa có read-tracking guard)
> **Effort:** 2 tuần

## Nguồn gốc

**Read-before-write**: trong git, bạn `pull` trước khi `push` — không thì conflict. pi-lens áp dụng cho agent: **edit bị block/warn nếu agent chưa đọc file (hoặc vùng liên quan)**. Lý do: agent edit dựa trên **bản ghi cũ trong context** (stale snapshot) → edit sai. Giống **taint analysis**: vùng chưa đọc = "untrusted" → không được edit trực tiếp. Giống **provenance tracking**: mỗi edit cần "nguồn đọc" (read provenance) chứng minh agent biết nội dung hiện tại. Khác **368 hash-anchored** (verify hash tại apply time) — NF là **precondition** (phải read trước khi edit) + **range tracking** (đã đọc đúng vùng?).

## Mô tả

mya read-tracked edit guard: mỗi `read` tool call ghi lại {path, line-range, timestamp} vào read-log. Khi `edit` được gọi, guard kiểm tra: (1) file đã được read trong session? (2) line-range edit có nằm trong vùng đã read? (3) snapshot có stale (file đổi sau read)? Nếu fail → **block hoặc warn**. pi-lens phân biệt zero-read (chưa đọc gì) và stale-range (đọc rồi nhưng range không đủ). Nối 368 hash-anchored (hash verify sau read) + 103 agent-drift (stale context detection).

## Kiến trúc

```
  AGENT SESSION
  ┌──────────────────────────────────────────────────┐
  │  READ LOG (per-session, in-memory):               │
  │  ┌─────────────────────────────────────────────┐  │
  │  │ src/main.ts  lines 1-50   ts=1000           │  │
  │  │ src/util.ts   lines 1-120  ts=1050           │  │
  │  │ src/main.ts  lines 51-100 ts=1200 (re-read) │  │
  │  └─────────────────────────────────────────────┘  │
  │                                                   │
  │  AGENT calls edit(src/main.ts, lines 80-90)       │
  │         │                                         │
  │         ▼                                         │
  │  ┌─── READ-GUARD CHECK ───────────────────────┐  │
  │  │                                             │  │
  │  │  1. File read this session?                 │  │
  │  │     src/main.ts → ✅ (ts=1200)              │  │
  │  │                                             │  │
  │  │  2. Range [80-90] within read range?        │  │
  │  │     read: 1-50, 51-100 → ✅ covered         │  │
  │  │                                             │  │
  │  │  3. Stale? (file changed after last read?)  │  │
  │  │     mtime > ts=1200? → ❌ stale → WARN       │  │
  │  │     mtime ≤ ts=1200? → ✅ fresh             │  │
  │  │                                             │  │
  │  │  result: WARN (file modified by formatter   │  │
  │  │  since last read — re-read recommended)     │  │
  │  └─────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ read tool — đọc file (sẵn — NF track read calls)
// ✅ edit tool — sửa file (sẵn — NF guard trước khi apply)
// ✅ 368 hash-anchored-editing — hash verify (nền — NF + hash = double check)
// ✅ 103 agent-drift — stale detection (nền)
// ✅ 290 tool-precondition-checks — precondition pattern (nền)

// ❌ THIẾU: read-log (per-session tracking: path, range, timestamp)
// ❌ THIẾU: read-guard check (file read? range covered? stale?)
// ❌ THIẾU: zero-read block / stale-range warn
// ❌ THIẾU: auto-patch (suggest re-read on stale)
```

## Implementation

```typescript
// packages/agent/src/read-guard.ts (NEW)
interface ReadEntry {
  path: string;
  ranges: Array<{ start: number; end: number; timestamp: number }>;
}

class ReadTracker {
  private log = new Map<string, ReadEntry>();

  // Called on every read tool invocation
  recordRead(path: string, startLine: number, endLine: number): void {
    const entry = this.log.get(path) ?? { path, ranges: [] };
    entry.ranges.push({ start: startLine, end: endLine, timestamp: Date.now() });
    this.log.set(path, entry);
  }

  // Guard: check before edit — returns verdict
  checkEdit(path: string, editStart: number, editEnd: number, fileMtime: number): ReadGuardVerdict {
    const entry = this.log.get(path);
    if (!entry) {
      return { verdict: 'block', reason: 'zero-read: file never read this session — read it first' };
    }

    // Range coverage: is [editStart, editEnd] within any union of read ranges?
    const covered = this.isRangeCovered(entry.ranges, editStart, editEnd);
    if (!covered) {
      return { verdict: 'warn', reason: `stale-range: lines ${editStart}-${editEnd} not fully read — re-read this range` };
    }

    // Staleness: file modified after last relevant read?
    const lastRead = Math.max(...entry.ranges
      .filter(r => r.start <= editStart && r.end >= editEnd)
      .map(r => r.timestamp));
    if (fileMtime > lastRead) {
      return { verdict: 'warn', reason: 'stale: file modified since last read (formatter/external) — re-read before editing' };
    }

    return { verdict: 'pass' };
  }

  private isRangeCovered(ranges: Array<{ start: number; end: number }>, s: number, e: number): boolean {
    // merge overlapping ranges, then check coverage
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    let current = s;
    for (const r of sorted) {
      if (r.start > current) break;
      current = Math.max(current, r.end);
      if (current >= e) return true;
    }
    return current >= e;
  }
}

type ReadGuardVerdict = { verdict: 'pass' } | { verdict: 'block' | 'warn'; reason: string };
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn edit mù (zero-read → block) | ❌ False positive (read rồi nhưng guard không nhận) |
| ✅ Phát hiện stale (file đổi sau read → warn) | ❌ Overhead: track mỗi read call |
| ✅ Range-aware (edit dòng 80 cần read 80-90) | ❌ Auto-format gây stale warn liên tục |
| ✅ Nối 368 hash + 370 = defense-in-depth | ❌ Read-all-file bypass (read 1 dòng → toàn file?) |

## Khác các hướng gần

| | 368 Hash-Anchored | 103 Agent-Drift | 290 Precondition-Checks | NF: Read-Guard |
|---|---|---|---|---|
| Mục | Verify hash tại apply | Detect drift tổng | Validate input | **Track read → guard edit** |
| Khi | Apply time | Runtime | Pre-invoke | **Pre-edit (before write)** |
| Cấp | Per-line hash | Behavioral | Tool args | **Per-file, per-range** |

## Khi nào chọn

- Agent hay edit file chưa đọc (stale context → edit sai)
- Muốn force "read before edit" discipline
- Auto-format / formatter chạy sau write (stale warning)
- Nối 368 hash-anchored (double check: read-guard + hash-verify) + 371 impact-cascade (chẩn đoán sau edit)
