# Hướng RJ: Transactional Action Sandbox — mọi ghi FS là transaction, rollback atomic qua snapshot

> **Nguồn gốc:** Papers (transactional agent actions); "FS writes as transactions with rollback"; "atomic snapshot before action"; "all-or-nothing file system operations"; "undo agent changes via snapshot restore"
> **Coupling:** 🟡 — thêm transaction layer wrap FS write operations
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (FS tools + edit sẵn — chưa có transaction wrapper + snapshot rollback)
> **Effort:** 3-4 tuần

## Nguồn gốc

**Transactional agent action** paper yêu cầu: mọi file system write của agent là **transaction** — hoặc **all committed** (mọi file ghi đúng) hoặc **all rolled back** (không file nào thay đổi). Trước khi agent execute batch action → **atomic snapshot** (copy FS state). Nếu action thành công → **commit** (snapshot discarded). Nếu fail hoặc partial → **rollback** (restore snapshot → FS về trạng thái pre-action). Nguyên tắc: **agent changes = reversible** — không bao giờ partial state (nửa file edit, nửa không) — snapshot guarantee atomicity. Khác **467 staged-memory** (memory staging) — RJ là **FS transaction**; khác undo-stack — RJ là **snapshot-based** (point-in-time restore, không phải inverse-op).

## Mô tả

mya transactional action sandbox: (1) **Snapshot**: trước batch action → atomic snapshot FS state (copy affected files to temp). (2) **Execute**: agent runs batch writes (edit file A, create file B, delete file C). (3) **Commit**: nếu tất cả thành công → commit (discard snapshot, changes permanent). (4) **Rollback**: nếu bất kỳ fail hoặc agent decide abort → restore snapshot (FS về pre-action — A/B/C như cũ). (5) **Nested transaction**: sub-action có nested snapshot (rollback sub不影响 parent). mya có FS tools + edit — RJ thêm **transaction manager** (snapshot → execute → commit/rollback).

## Kiến trúc

```
  AGENT wants batch action: [edit auth.ts, create test.ts, delete old.ts]
        │
        ▼
  ┌─── SNAPSHOT (atomic — before action) ────────────────────┐
  │  copy FS state to temp:                                    │
  │    auth.ts → snapshot/auth.ts (original content)            │
  │    old.ts  → snapshot/old.ts (in case deleted)              │
  │    test.ts → (not exist — record absence)                   │
  │  → SNAPSHOT ID: tx_001                                      │
  └──────────────────────────┬────────────────────────────────┘
                             │
                             ▼
  ┌─── EXECUTE (batch writes inside transaction) ────────────┐
  │  write auth.ts ← new content    → OK                       │
  │  create test.ts ← new file      → OK                       │
  │  delete old.ts                  → FAIL (permission denied) │
  │                                                             │
  │  → PARTIAL FAILURE (2/3 done, 1 failed)                    │
  └──────────────┬───────────────────────────┬────────────────┘
                 │ all OK                     │ any FAIL
                 ▼                            ▼
  ┌─── COMMIT ─────────────────┐  ┌─── ROLLBACK ──────────────┐
  │  discard snapshot tx_001    │  │  restore from tx_001:      │
  │  changes permanent          │  │    auth.ts ← original       │
  │  FS stays modified          │  │    test.ts ← delete (was    │
  │                             │  │      newly created)         │
  │                             │  │    old.ts ← keep (delete     │
  │                             │  │      failed anyway)         │
  │                             │  │  FS = pre-action state      │
  └─────────────────────────────┘  └─────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ FS tools (read/write/edit/delete) — (nền — RJ = wrap these in transaction)
// ✅ edit tool — file edit (nền — RJ = transactional edit)
// ✅ 467 staged-memory — staging (nền — RJ = FS-level transaction)

// ❌ THIẾU: snapshot manager (copy FS state → temp before action)
// ❌ THIẾU: transaction wrapper (batch writes → all-or-nothing)
// ❌ THIẾU: rollback (restore snapshot → FS pre-action)
// ❌ THIẾU: nested transaction (sub-action snapshot)
```

## Implementation

```typescript
// packages/agent/src/transactional-sandbox.ts (MỚI)
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

interface Snapshot {
  id: string;
  files: Map<string, { existed: boolean; content?: string }>; // path → original state
}

class TransactionalSandbox {
  private snapshots = new Map<string, Snapshot>();
  private tempDir: string;

  constructor() {
    this.tempDir = mkdtempSync(join(tmpdir(), 'mya-tx-'));
  }

  // Take atomic snapshot of affected files before action
  snapshot(filePaths: string[]): string {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const files = new Map<string, { existed: boolean; content?: string }>();
    for (const p of filePaths) {
      if (existsSync(p)) {
        files.set(p, { existed: true, content: readFileSync(p, 'utf-8') });
      } else {
        files.set(p, { existed: false }); // record absence for rollback
      }
    }
    this.snapshots.set(id, { id, files });
    return id;
  }

  // Execute batch writes inside transaction (all-or-nothing)
  async execute<T>(
    snapshotId: string,
    actions: Array<{ type: 'write' | 'delete'; path: string; content?: string }>,
  ): Promise<{ committed: boolean; result?: T; error?: string }> {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) return { committed: false, error: 'snapshot not found' };

    const performed: { path: string; type: 'write' | 'delete' }[] = [];
    try {
      for (const action of actions) {
        if (action.type === 'write' && action.content !== undefined) {
          writeFileSync(action.path, action.content);
          performed.push({ path: action.path, type: 'write' });
        } else if (action.type === 'delete') {
          if (existsSync(action.path)) unlinkSync(action.path);
          performed.push({ path: action.path, type: 'delete' });
        }
      }
      // All succeeded → commit (discard snapshot)
      this.snapshots.delete(snapshotId);
      return { committed: true };
    } catch (err) {
      // Any failed → rollback (restore snapshot)
      this.rollback(snapshotId, performed);
      return { committed: false, error: (err as Error).message };
    }
  }

  // Rollback: restore FS to pre-action state
  rollback(snapshotId: string, performed: { path: string; type: string }[]): void {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) return;
    for (const { path: p } of performed) {
      const original = snap.files.get(p);
      if (original?.existed && original.content !== undefined) {
        writeFileSync(p, original.content); // restore original
      } else if (!original?.existed && existsSync(p)) {
        unlinkSync(p); // was created in transaction → delete
      }
    }
    this.snapshots.delete(snapshotId);
  }

  // Explicit abort (agent decides to cancel)
  abort(snapshotId: string): void {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) return;
    // Revert all files in snapshot to original state
    for (const [p, orig] of snap.files) {
      if (orig.existed && orig.content !== undefined) {
        writeFileSync(p, orig.content);
      } else if (!orig.existed && existsSync(p)) {
        unlinkSync(p);
      }
    }
    this.snapshots.delete(snapshotId);
  }

  cleanup(): void {
    rmSync(this.tempDir, { recursive: true, force: true });
  }
}

// Usage:
// const tx = new TransactionalSandbox();
// const snapId = tx.snapshot(['auth.ts', 'old.ts']);
// const result = await tx.execute(snapId, [
//   { type: 'write', path: 'auth.ts', content: newCode },
//   { type: 'delete', path: 'old.ts' },
// ]);
// if (!result.committed) → rolled back automatically (FS = pre-action)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Atomicity (all-or-nothing — không partial state) | ❌ Snapshot overhead (copy file before action) |
| ✅ Rollback (undo agent changes → FS pre-action) | ❌ Temp storage (snapshots chiếm disk) |
| ✅ Safe experimentation (agent try → fail → revert) | ❌ Large file cost (big file snapshot slow) |
| ✅ Nested transaction (sub-action reversible) | ❌ Complexity (snapshot + commit + rollback) |

## Khác các hướng gần

| | 467 Staged-Memory | Undo-Stack | RJ: Transactional-Sandbox |
|---|---|---|---|
| Cái gì | Memory staging | Inverse ops | **FS snapshot + rollback** |
| Scope | Memory | Single op | **Batch FS writes** |
| Restore | Discard staging | Apply inverse | **Restore snapshot** |

## Khi nào chọn

- Agent batch writes nhiều file (cần all-or-nothing — không partial)
- Muốn safe experimentation (try → fail → revert FS)
- Cần rollback agent changes (undo batch action)
- Nối FS tools (RJ = transactional wrapper) + 467 staged-memory (RJ = FS-level equivalent); guard snapshot size (chỉ snapshot affected files, không toàn FS) + cleanup (discard snapshot sau commit — tránh leak)
