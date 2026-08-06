# Hướng QY: Staged Memory Writes — memory qua staging file rồi async apply, review/rollback được

> **Nguồn gốc:** Leaks Codex/Anthropic (memory versioning, `memver_...`); "staged memory writes"; "memory mutations via staging file"; "async apply with review/rollback"; "immutable memory versions"; "pending → applied → rolled-back"
> **Coupling:** 🟡 — thêm staging layer trước memory commit (write staging → review → apply/rollback)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/memory brain-store sẵn — chưa có staging file + version rollback)
> **Effort:** 3-4 tuần

## Nguồn gốc

**Leaks Anthropic managed-agents-memory** mô tả: mỗi memory mutation tạo **immutable memory version** (`memver_...`) — **audit trail** + **point-in-time rollback/redact**. **Staged memory writes** mở rộng: agent không ghi memory trực tiếp — viết vào **staging file** (pending), rồi **async apply** (review → commit) hoặc **rollback** (discard). Nguyên tắc: **memory write không tức thời** — qua staging để **review** (correct? safe? duplicate?) trước khi commit; nếu sai → rollback (staging discard, memory nguyên vẹn). Khác **082 memory-consolidation** (snapshot) — QY là **staging gate**; khác write-thẳng — QY **deferred + reversible**.

## Mô tả

mya staged memory writes: (1) **Stage**: agent muốn ghi memory → viết vào staging file (`memory.staging.jsonl`), trạng thái `pending`. (2) **Review**: (async hoặc auto) kiểm tra staging entry — đúng? trùng? an toàn? (3) **Apply**: nếu OK → commit vào memory store (tạo version `memver_...`, immutable). (4) **Rollback**: nếu sai/trùng → discard staging (memory nguyên vân). (5) **Version log**: mỗi apply tạo version → có thể rollback point-in-time (revert về version cũ). mya có `packages/memory` (brain-store, sqlite) — QY thêm **staging file** + **reviewer** (correctness/dup check) + **version log** (rollback).

## Kiến trúc

```
  AGENT muốn ghi memory: "deploy steps: 1.build 2.test 3.push"
        │
        ▼
  ┌─── STAGE (write staging file) ──────────────────────┐
  │  memory.staging.jsonl:                               │
  │  { id, status: "pending", entry: "deploy steps..." } │
  └───────────────────────┬─────────────────────────────┘
                          │ (async review)
                          ▼
  ┌─── REVIEWER ────────────────────────────────────────┐
  │  check: correct? (có logic không)                    │
  │          duplicate? (trùng entry cũ?)                │
  │          safe? (không leak secret?)                  │
  └───────────┬───────────────────────────┬─────────────┘
              │ OK                        │ FAIL/ DUP
              ▼                           ▼
  ┌─── APPLY (commit) ───────┐  ┌─── ROLLBACK (discard) ─┐
  │  memory store += entry    │  │  staging entry deleted │
  │  version memver_abc ← imm │  │  memory nguyên vẹn     │
  │  (point-in-time rollback) │  │  (no change)           │
  └───────────────────────────┘  └────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory brain-store — memory store (nền — QY = staging trước)
// ✅ packages/memory brain-sqlite-store — sqlite (nền — QY version log)
// ✅ 082 memory-consolidation — snapshot (nền — QY = staging gate)

// ❌ THIẾU: staging file (memory.staging.jsonl, status pending)
// ❌ THIẾU: reviewer (correctness/dup/secret check)
// ❌ THIẾU: version log (memver_..., immutable, point-in-time rollback)
// ❌ THIẾU: async apply worker (drain staging → review → commit/rollback)
```

## Implementation

```typescript
// packages/memory/src/staged-writes.ts (MỚI)
type StageStatus = 'pending' | 'applied' | 'rolled-back';

interface StageEntry { id: string; status: StageStatus; entry: string; createdAt: number; version?: string }

class StagedMemory {
  private staging: StageEntry[] = [];
  private versions: { version: string; entry: string; at: number }[] = [];

  constructor(private brain: BrainStore) {}

  // stage (agent writes here, NOT directly to brain)
  async stage(entry: string): Promise<string> {
    const id = `stage-${Date.now()}`;
    this.staging.push({ id, status: 'pending', entry, createdAt: Date.now() });
    return id;
  }

  // async review → apply or rollback
  async reviewAndApply(id: string, validate: (e: string) => { ok: boolean; reason?: string }): Promise<{ applied: boolean; reason?: string }> {
    const s = this.staging.find(e => e.id === id && e.status === 'pending');
    if (!s) return { applied: false, reason: 'not found' };
    const check = validate(s.entry);
    if (!check.ok) { s.status = 'rolled-back'; return { applied: false, reason: check.reason }; }
    // duplicate check against existing memory
    if (await this.brain.has(s.entry)) { s.status = 'rolled-back'; return { applied: false, reason: 'duplicate' }; }
    // apply: immutable version
    const version = `memver_${cryptoRandom()}`;
    await this.brain.set(s.entry);
    s.status = 'applied'; s.version = version;
    this.versions.push({ version, entry: s.entry, at: Date.now() });
    return { applied: true };
  }

  // point-in-time rollback (revert to old version)
  async rollbackTo(version: string): Promise<void> {
    const idx = this.versions.findIndex(v => v.version === version);
    if (idx < 0) return;
    // remove entries after idx
    for (const v of this.versions.slice(idx + 1)) {
      await this.brain.delete(v.entry);
    }
    this.versions = this.versions.slice(0, idx + 1);
  }
}

// Usage:
// const id = await staged.stage("deploy steps: build→test→push");
// const r = await staged.reviewAndApply(id, validateEntry);  // async
// if (!r.applied) → rolled back, memory nguyên vẹn
// await staged.rollbackTo("memver_abc");  // revert point-in-time
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Review trước commit (memory sai không vào store) | ❌ Latency (async apply — memory trễ mới lên) |
| ✅ Rollback (discard staging hoặc revert version) | ❌ Staging file phình (nhiều pending) |
| ✅ Immutable version (audit trail, point-in-time) | ❌ Reviewer sai (block memory đúng / accept sai) |
| ✅ Anti-duplicate (check trước apply) | ❌ Complexity (staging + version + worker) |

## Khác các hướng gần

| | 082 Memory-Consolidation | Direct-Write | QY: Staged-Writes |
|---|---|---|---|
| Cái gì | Snapshot cuối | Ghi trực tiếp | **Stage → review → apply/rollback** |
| Khi | Cuối task | Tức thời | **Async (deferred)** |
| Reversible | Snapshot only | ❌ | **Version rollback (memver)** |

## Khi nào chọn

- Memory quan trọng (sai memory → agent học sai)
- Muốn review trước commit (correctness/dup/secret check)
- Cần audit + rollback (point-in-time revert)
- Nối packages/memory brain-store + brain-sqlite-store (version log) + 082 consolidation; guard reviewer quality (auto-check correctness/dup/secret) + staging drain (worker async) + version immutability (rollback chính xác)
