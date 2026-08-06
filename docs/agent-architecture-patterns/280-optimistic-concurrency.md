# Hướng JT: Optimistic Concurrency — version state, write bị stale thì retry, không lock

> **Nguồn gốc:** Wikipedia "Optimistic concurrency control"; HTTP ETag/If-Match (RFC 7232); CAS (compare-and-swap); DynamoDB conditional write; Git optimistic merge; "optimistic locking" (version column); Pessimistic vs Optimistic locking
> **Coupling:** 🟡 — thêm version field + retry-on-stale
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (SQLite — chưa có version/CAS retry)
> **Effort:** 1-2 tuần

## Nguồn gốc

Optimistic concurrency control (OCC): thay vì *lock* trước khi ghi (pessimistic), agent **đọc version → ghi kèm "if version still X"** — nếu version đổi (ai đó ghi giữa chừng) → *stale* → retry đọc lại + áp dụng lại. HTTP ETag/If-Match: conditional write — server chỉ chấp nhận nếu ETag khớp. DynamoDB conditional write / CAS: atomic compare-and-swap. Git optimistic merge: mỗi người làm local, merge phát hiện conflict → resolve. Đối với agent: nhiều agent sửa cùng record (task, memory) — lock (HU 229) tốn + deadlock risk; OCC assume *conflict hiếm* → thử ghi, retry khi stale — throughput cao khi ít xung đột. Khác **HU (229) distributed locking** (pessimistic — lock trước) — JT optimistic — *không lock, retry nếu stale*; khác **JS (279) CRDT** (merge luôn ok) — JT *phát hiện conflict* rồi retry; khác **HV (230) event sourcing** (append log) — JT *update in-place có version*.

## Mô tả

mya optimistic concurrency: mỗi state record có `version` (mono tăng). Agent read → nhớ version → write kèm `WHERE version = X`. Nếu bị stale (version đổi) → retry read-modify-write. Hợp khi conflict hiếm (agent hiếm sửa cùng record). mya hiện SQLite update in-place — JT thêm version column + conditional write + retry wrapper.

## Kiến trúc

```
  AGENT reads state (version = V)
        │
        ▼
  local compute (modify)
        │
        ▼
  WRITE: UPDATE … WHERE id=? AND version=V   (CAS — conditional)
        │
   ┌────┴────┐
   │         │
  ok        stale (version changed — ai đó ghi giữa)
   │         │
   ▼         ▼
  DONE     RETRY: re-read (new version) → re-apply → re-write  (bounded — GU 203)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ kanban-sqlite — state in-place (sản nền để thêm version)
// ✅ GU (203) retry loops — retry backbone (sản)
// ✅ HV (230) event sourcing — event log (có thể dùng)
// ✅ 231 HW DLQ — poison khi retry hết (bổ sung)

// ❌ THIẾU: version column (mono tăng mỗi record)
// ❌ THIẾU: conditional write (CAS — WHERE version=V)
// ❌ THIẾU: retry-on-stale wrapper (re-read → re-apply → re-write)
```

## Implementation

```typescript
// packages/occ/src/index.ts (NEW)
async function updateTask(id: string, mutate: (t: Task) => Task): Promise<Task> {
  for (let attempt = 0; attempt < 5; attempt++) {                 // bounded retry (GU)
    const t = await db.get("SELECT * FROM task WHERE id=?", id);  // read + version
    const next = mutate(t);                                        // re-apply logic
    const res = await db.run(
      "UPDATE task SET status=?, data=?, version=version+1 WHERE id=? AND version=?",
      next.status, next.data, id, t.version);                      // CAS conditional
    if (res.changes > 0) return next;                             // ok
    // stale — version đổi → loop retry (re-read new version)
  }
  throw new StaleError(id);                                       // DLQ (231) khi hết retry
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không lock → throughput cao khi ít conflict (OCC) | ❌ Conflict nhiều → retry bão, tệ hơn lock (HU) |
| ✅ Không deadlock (không giữ lock) | ❌ Re-apply logic phải idempotent/replay-safe |
| ✅ Đơn giản hơn lock phân tán (HU) | ❌ Retry bạo khi contention cao |
| ✅ HTTP ETag/DynamoDB proven | ❌ Retry có hạn — hết → DLQ (231) |

## Khác các hướng gần

| | HU Distributed Lock | JS CRDT | HV Event Sourcing | JT: Optimistic |
|---|---|---|---|---|
| Conflict | Tránh (lock) | Không có (merge) | Append (không) | **Detect → retry** |
| Lock | Có | No | No | **No (CAS)** |
| Khi hợp | Conflict nhiều | Always converge | Audit/replay | **Conflict hiếm** |

## Khi nào chọn

- Conflict hiếm (agent hiếm sửa cùng record) — OCC throughput cao
- Không muốn lock overhead/deadlock risk (HU quá nặng)
- Re-apply logic idempotent — retry an toàn
- Không dùng khi: contention cao (lock HU tốt hơn), hoặc cần merge song song (CRDT JS)
