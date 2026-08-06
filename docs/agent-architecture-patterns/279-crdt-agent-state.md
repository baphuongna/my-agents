# Hướng JS: CRDT Agent State — trạng thái merge tự động không xung đột khi nhiều agent/replica

> **Nguồn gốc:** Shapiro et al. "A comprehensive study of Convergent and Commutative Replicated Data Types" (2011); Wikipedia "Conflict-free replicated data type"; Riak CRDTs; Automerge (local-first CRDT); Yjs (collab editor CRDT); Redis CRDT (Active-Active); Martin Kleppmann local-first software
> **Coupling:** 🟡 — thay đổi cách agent state được lưu/merge
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (SQLite state — chưa có CRDT merge)
> **Effort:** 3-6 tuần

## Nguồn gốc

CRDT (Shapiro et al. 2011): cấu trúc dữ liệu mà các bản sao (replica) merge **luôn hội tụ** (convergent) không cần coordination — op commutative/associative/idempotent. Riak/Redis dùng cho multi-region. Automerge/Yjs dùng cho collaborative editor (nhiều người sửa cùng lúc → merge không xung đột). Kleppmann local-first: state trên nhiều thiết bị merge không master. Đối với agent: khi nhiều agent (hoặc device) sửa cùng state (task board, memory, shared doc) offline/parallel → merge mà không lock (HU 229) hay conflict-resolve thủ công. Khác **HU (229) distributed locking** (mutual exclusion — serialize write) — JS merge *song song không lock*; khác **HV (230) event sourcing** (event log replay) — JS dùng *op-based/state-based merge* tự hội tụ; khác **JT (280) optimistic concurrency** (detect conflict → retry) — JS *không có conflict* (merge luôn ok).

## Mô tả

mya CRDT state: dùng CRDT cho state chia sẻ (task board, shared memory, collaborative doc) — mỗi replica sửa local, merge khi sync → luôn hội tụ không xung đột. Hợp multi-agent (199) song song, multi-device (139), offline-first. VD: task board CRDT — 2 agent cùng chuyển task sang status khác → merge giữ cả update (last-writer hoặc set-union). mya hiện SQLite single-source — JS thêm CRDT layer cho state cần merge phân tán.

## Kiến trúc

```
  REPLICA A (agent 1)            REPLICA B (agent 2)
   local edit                      local edit
      │                               │
      ▼                               ▼
   CRDT op-log                     CRDT op-log
      │                               │
      └────────── SYNC/MERGE ─────────┘
                    │
                    ▼ (op commutative + assoc + idempotent)
              CONVERGED STATE (cả 2 giống nhau — KHÔNG conflict)
                    │
        types: G-Counter, OR-Set, LWW-Map, RGA-sequence…
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ HV (230) event sourcing — event log (nền — có thể build CRDT trên)
// ✅ 199 delegation — multi-agent (nền nhu cầu)
// ✅ kanban-sqlite — task state (state cần CRDT)
// ✅ 139 cross-device sessions — sync (nhu cầu)

// ❌ THIẾU: CRDT type (G-Counter/OR-Set/LWW-Map)
// ❌ THIẾU: merge protocol (sync op-log giữa replica)
// ❌ THIẾU: tombstone/GC (CRDT mập — cần dọn)
```

## Implementation

```typescript
// packages/crdt/src/index.ts (NEW) — dùng Yjs/Automerge hoặc tự viết
import * as Y from "yjs";
class CrdtTaskBoard {
  private doc = new Y.Doc();
  private tasks = this.doc.getMap("tasks");            // Y.Map — CRDT
  setStatus(id: string, status: string, ts: number): void {
    this.tasks.set(id, { status, ts });                // local edit — LWW
  }
  encode(): Uint8Array { return Y.encodeStateAsUpdate(this.doc); }   // op-log để sync
  merge(update: Uint8Array): void { Y.applyUpdate(this.doc, update); } // luôn hội tụ
}
// 2 replica merge(update) → state giống nhau không xung đột — không cần lock (HU)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Merge không xung đột — không lock (Shapiro/Kleppmann) | ❌ Tombstone bloat — CRDT không xóa hẳn (cần GC) |
| ✅ Offline-first — sửa local, sync sau (Automerge) | ❌ CRDT type hạn chế (không phải mọi struct CRDT được) |
| ✅ High availability — không phụ thuộc master | ❌ Phức hơn SQLite single-source |
| ✅ Song song nhiều agent/设备 không coordination | ❌ LWW có thể mất update (cần OR-Set cho set) |

## Khác các hướng gần

| | HU Distributed Lock | HV Event Sourcing | JT Optimistic | JS: CRDT |
|---|---|---|---|---|
| Conflict | Tránh (serialize) | Resolve replay | Detect → retry | **Không có (merge luôn ok)** |
| Lock | Có | No | No | **No** |
| Mục | Mutual exclusion | Replay/state | Retry stale | **Converge phân tán** |

## Khi nào chọn

- Multi-agent/multi-device sửa cùng state song song offline (199, 139)
- Không muốn coordination/lock overhead (HU quá nặng)
- Cần always-available — chấp nhận eventual consistency
- Không dùng khi: state đơn nguồn (SQLite đủ), hoặc cần strong consistency tức thì
