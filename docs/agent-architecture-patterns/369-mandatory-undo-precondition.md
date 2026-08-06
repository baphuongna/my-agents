# Hướng NE: Mandatory Undo Precondition — undo record persisted TRƯỚC khi ghi, không undo → từ chối

> **Nguồn gốc:** pi-hashline-edit-pro (undo_last_replace); "write-ahead log" (WAL); "transactional undo" / "shadow paging"; "two-phase commit" (2PC); "pre-commit journaling"; "durability guarantee" (ACID)
> **Coupling:** 🟡 — thêm undo journal vào edit pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (edit tool + git sẵn — chưa có precondition-guaranteed undo)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Write-Ahead Log** (WAL — database): ghi log TRƯỚC khi apply → crash recovery. pi-hashline-edit-pro áp dụng: undo record được persist **trước** khi file được ghi. Nếu undo record không persist được → edit bị **từ chối** (`[E_UNDO_UNAVAILABLE]`), file không bị đụng. Guarantees: **mọi edit đã apply đều có thể undo**. Giống **shadow paging**: snapshot cũ trước khi ghi mới. Giống **two-phase commit**: phase 1 = persist undo, phase 2 = apply edit — nếu phase 1 fail → abort toàn bộ. Khác **242 memory-rollback** (rollback memory state) — NE là **precondition** (không thể edit nếu không thể undo).

## Mô tả

mya mandatory undo precondition: trước khi ghi edit vào file, runtime persist undo record (snapshot nội dung cũ + hash anchors cũ) vào hash-store. Nếu persist fail → **refuse edit** (`[E_UNDO_UNAVAILABLE]`). Mọi edit đã apply → undo-able 1 lần (`undo_last_replace`). Nếu file bị modified bên ngoài giữa edit và undo → refuse (`[E_UNDO_STALE]`). Nối 368 hash-anchored (undo restore cả anchors) + 317 cross-agent-txn (compensate = undo).

## Kiến trúc

```
  AGENT calls replace("szJ"→"hi")
        │
        ▼
  ┌─── UNDO PRECONDITION (phase 1) ──────────────┐
  │                                               │
  │  1. Capture undo record:                      │
  │     { path, oldContent, oldAnchors,           │
  │       timestamp }                              │
  │                                               │
  │  2. PERSIST to hash-store (SQLite):            │
  │     · disk full?     → [E_UNDO_UNAVAILABLE]   │
  │     · permission?    → [E_UNDO_UNAVAILABLE]   │
  │     · store corrupt? → [E_UNDO_UNAVAILABLE]   │
  │                                               │
  │  ✅ persisted → proceed to phase 2            │
  │  ❌ failed    → REFUSE edit (file untouched)  │
  └────────────────────┬──────────────────────────┘
                       │ phase 1 OK
                       ▼
  ┌─── APPLY EDIT (phase 2) ─────────────────────┐
  │  temp-file → rename (atomic write)            │
  │  · write fail? → restore previous undo record │
  │                  (never destroy earlier undo) │
  └────────────────────┬──────────────────────────┘
                       │
                       ▼
  RESULT: edit applied + guaranteed undo-able
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 368 hash-anchored-editing — hash store (nền — NE dùng store cho undo)
// ✅ 317 cross-agent-txn — compensate (nền — undo = compensate)
// ✅ git — version control (nền — nhưng không per-edit instant undo)
// ✅ 253 change-preview-diff — diff (nền — undo shows reverse diff)

// ❌ THIẾU: undo record persisted before write (precondition)
// ❌ THIẾU: [E_UNDO_UNAVAILABLE] refuse on persist failure
// ❌ THIẾU: [E_UNDO_STALE] refuse if file modified externally
// ❌ THIẾU: undo_last_replace (single-level per-file undo)
```

## Implementation

```typescript
// packages/agent/src/undo-precondition.ts (NEW)
interface UndoRecord {
  path: string;
  oldContent: string;
  oldAnchors: Map<string, string>; // line → hash
  timestamp: number;
  contentHash: string; // snapshot integrity check
}

class UndoPreconditionEditor {
  private undoHistory = new Map<string, UndoRecord>(); // per-file, single-level

  // Precondition: persist undo BEFORE write. Refuse if undo unavailable.
  replace(path: string, newContent: string): { ok: boolean; error?: string } {
    const oldContent = this.readFileSync(path);

    // PHASE 1: persist undo record
    const undoRecord: UndoRecord = {
      path,
      oldContent,
      oldAnchors: this.captureAnchors(path),
      timestamp: Date.now(),
      contentHash: this.hash(oldContent),
    };

    if (!this.persistUndo(undoRecord)) {
      return { ok: false, error: '[E_UNDO_UNAVAILABLE] — cannot persist undo; edit refused' };
    }

    // PHASE 2: apply edit (atomic temp-file → rename)
    try {
      this.atomicWrite(path, newContent);
    } catch (e) {
      // write failed → restore previous undo record (never destroy earlier history)
      this.restorePreviousUndo(path);
      return { ok: false, error: `[E_WRITE_FAILED] ${(e as Error).message}` };
    }

    return { ok: true };
  }

  // Undo last replace — refuse if file modified externally
  undoLastReplace(path: string): { ok: boolean; error?: string } {
    const record = this.undoHistory.get(path);
    if (!record) return { ok: false, error: '[E_NOTHING_TO_UNDO]' };

    // Stale check: file modified since last replace?
    const current = this.readFileSync(path);
    if (this.hash(current) !== record.contentHash && this.wasModifiedExternally(path, record.timestamp)) {
      return { ok: false, error: '[E_UNDO_STALE] — file modified externally since last replace' };
    }

    this.atomicWrite(path, record.oldContent);
    this.restoreAnchors(path, record.oldAnchors);
    this.undoHistory.delete(path);
    return { ok: true };
  }

  private persistUndo(record: UndoRecord): boolean {
    try { this.undoHistory.set(record.path, record); this.flushStore(); return true; }
    catch { return false; } // disk full / permission → false
  }
  private restorePreviousUndo(path: string): void { /* keep prior record intact */ }
  private flushStore(): void { /* SQLite WAL persist */ }
  private readFileSync(p: string): string { return ''; /* impl */ }
  private atomicWrite(p: string, c: string): void { /* temp → rename */ }
  private hash(s: string): string { return ''; }
  private captureAnchors(p: string): Map<string, string> { return new Map(); }
  private restoreAnchors(p: string, a: Map<string, string>): void {}
  private wasModifiedExternally(p: string, ts: number): boolean { return false; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Mọi edit guarantee undo-able (durability) | ❌ Persist overhead (write undo before every edit) |
| ✅ Fail-safe: disk full → refuse (not corrupt) | ❌ Single-level undo (only last replace) |
| ✅ External modification detected (`E_UNDO_STALE`) | ❌ Write failure path complexity |
| ✅ Crash recovery (undo survived in SQLite) | ❌ Per-file history (cross-file undo harder) |

## Khác các hướng gần

| | 242 Memory-Rollback | 317 Cross-Agent-Txn | 368 Hash-Anchored | NE: Undo Precondition |
|---|---|---|---|---|
| Mục | Rollback memory | Compensate action | Stable addressing | **Persist undo trước ghi** |
| Khi | Sau event | Compensate | Apply time | **Precondition (before write)** |
| Guarantee | Memory revert | Txn compensate | Hash match | **Mọi edit = undo-able** |

## Khi nào chọn

- Cần guarantee mọi edit có thể hoàn tác (safety-critical editing)
- Agent edit file quan trọng (code production, config)
- Muốn fail-safe: nếu không thể undo → không edit
- Nối 368 hash-anchored (undo restore cả hash anchors) + 317 txn (undo = compensate)
