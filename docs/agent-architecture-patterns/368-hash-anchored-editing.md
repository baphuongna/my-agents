# Hướng ND: Hash-Anchored Editing — địa chỉ dòng bằng content-hash, stale anchor fail-closed

> **Nguồn gốc:** pi-hashline-edit-pro (pi-coding-agent extension); content-addressable storage (23); "line-addressable editing"; diff3 / structural patching; "capability tokens" / "generation tokens" (optimistic concurrency); xxHash content fingerprint
> **Coupling:** 🟡 — thay thế read/edit tool bằng hashline protocol
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (edit tool sẵn — chưa có hash-anchored addressing)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Content-addressable storage** (23 — CAS-DAG): địa chỉ = hash nội dung → không bao giờ nhầm. pi-hashline-edit-pro áp dụng nguyên lý này xuống **cấp dòng**: mỗi dòng được gắn 3-char content hash (xxHash32 → alphabet `A-Za-z0-9`, 62³ = 238.328 anchors). Thay vì `oldText`/`newText` (dễ match sai khi text trùng lặp), agent **tham chiếu dòng bằng hash**. Khi file đổi giữa lúc đọc và lúc edit → hash không khớp → **fail-closed** (`[E_STALE_ANCHOR]`), không bao giờ "close enough" silent relocation. Giống **optimistic concurrency** (280): hash = "token thế hệ" — nếu stale → reject. Khác **253 change-preview-diff** (preview trước khi apply) — ND là **assertion tại thời điểm apply** (hash phải khớp).

## Mô tả

mya hash-anchored editing: `read` trả về mỗi dòng dạng `HASH│content`. `edit` nhận `hash_range_inclusive` thay vì text. Trước khi apply, runtime verify hash khớp file hiện tại — mismatch → từ chối, yêu cầu re-read. Anchors ổn định: edit phần A không đổi hash phần B (persistent hash-store, SQLite). Dòng trùng lặp có hash duy nhất (collision resolution bằng bitset). Nối 253 change-preview (diff UX) + 290 precondition-checks (validate trước I/O).

## Kiến trúc

```
  AGENT reads file:
    ve7│function hello() {
    szJ│  console.log("world");
    kQm│}
        │
        │  (context window passage, other edits elsewhere…)
        │
        ▼
  AGENT calls replace:
    hash_range_inclusive: ["szJ","szJ"]
    content_lines: ["  console.log('hi');"]
        │
        ▼
  ┌─── ANCHOR VERIFY ─────────────────────────────┐
  │                                                │
  │  File line at "szJ" hash?                      │
  │    ✅ match → apply edit, rotate changed lines │
  │    ❌ stale  → [E_STALE_ANCHOR] → refuse       │
  │    ❌ multi   → [E_AMBIGUOUS_ANCHOR] → refuse  │
  │                                                │
  │  (never silent relocate to "close enough")     │
  └────────────────────────────────────────────────┘
        │
        ▼  (after successful edit)
  Persistent hash-store (SQLite):
    · unchanged lines → keep hash
    · changed lines   → fresh hash (collision-free)
    · "replace X with X" → reuse hash
```

```
mya: edit tool sẵn — chưa có hash-anchored addressing + persistent hash-store
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 23 content-addressable-dag — CAS concept (nền — ND áp dụng xuống dòng)
// ✅ 280 optimistic-concurrency — version token (nền — hash = token)
// ✅ 253 change-preview-diff — diff UX (nền — ND hiển thị post-edit diff)
// ✅ 290 tool-precondition-checks — validate trước I/O (nền)

// ❌ THIẾU: hash-anchored read (HASH│content per line)
// ❌ THIẾU: hash_range_inclusive replace (target by hash, not text)
// ❌ THIẾU: persistent hash-store (SQLite — stable anchors across edits)
// ❌ THIẾU: stale-anchor fail-closed + collision resolution
```

## Implementation

```typescript
// packages/agent/src/hash-edit.ts (NEW)
import xxhash from 'xxhash-wasm';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function hashLine(content: string): string {
  const canonical = content.replace(/\r/g, '').replace(/\s+$/, ''); // strip CR + trailing ws
  const h = xxhash.h32(canonical); // xxHash32 → number
  // map to 3-char string over 62-char alphabet
  let n = h >>> 0; // unsigned
  let out = '';
  for (let i = 0; i < 3; i++) { out = ALPHABET[n % 62] + out; n = Math.floor(n / 62); }
  return out;
}

interface AnchorStore {
  // persistent SQLite: content → assigned hash (collision-free via bitset)
  resolve(content: string, assigned: Set<string>): string;
}

class HashAnchoredEditor {
  constructor(private store: AnchorStore) {}

  read(path: string, lines: string[]): string {
    return lines.map((line) => {
      const base = hashLine(line);
      return `${this.store.resolve(line, new Set())}│${line}`;
    }).join('\n');
  }

  replace(path: string, fileLines: string[], hashRange: [string, string], contentLines: string[]): {
    ok: boolean; error?: string; result?: string[];
  } {
    // verify anchors against current file
    const startIdx = fileLines.findIndex((_, i) => this.hashAt(fileLines, i) === hashRange[0]);
    const endIdx = fileLines.findIndex((_, i) => this.hashAt(fileLines, i) === hashRange[1]);
    if (startIdx === -1 || endIdx === -1)
      return { ok: false, error: '[E_STALE_ANCHOR] — re-read for fresh anchors' };
    if (startIdx > endIdx)
      return { ok: false, error: '[E_BAD_OP] — range reversed, swap and retry' };

    // apply: splice content into range
    const newLines = [...fileLines.slice(0, startIdx), ...contentLines, ...fileLines.slice(endIdx + 1)];
    return { ok: true, result: newLines };
  }

  private hashAt(lines: string[], idx: number): string {
    return this.store.resolve(lines[idx]!, new Set());
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Stale context caught (hash mismatch → refuse) | ❌ Hash overhead (compute + store every line) |
| ✅ No silent wrong-location edits | ❌ Must re-read after every stale anchor |
| ✅ Stable anchors (edit A ≠ change hash B) | ❌ 238K line cap (hash space limit) |
| ✅ Collision-free (duplicate lines = unique hash) | ❌ Hash-store persistence (SQLite dependency) |

## Khác các hướng gần

| | 23 CAS-DAG | 280 Optimistic-Concurrency | 253 Change-Preview | ND: Hash-Anchored |
|---|---|---|---|---|
| Cấp | Toàn file/object | Toàn resource | Preview UI | **Cấp dòng (per-line hash)** |
| Verify | Hash object | Version/token | Human | **Hash tại apply time** |
| Stale | ❌ | Reject | Preview | **Fail-closed (`E_STALE_ANCHOR`)** |

## Khi nào chọn

- Agent edit file lớn với nhiều text trùng lặp (`}`, `import`)
- Cần guarantee không edit sai vị trí (stale context)
- Muốn anchors ổn định qua nhiều edit (không re-read liên tục)
- Nối 369 undo-precondition (undo record trước khi ghi) + 370 read-tracked-guard (read before edit)
