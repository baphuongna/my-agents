# Hướng HE: Vector Index Maintenance — cập nhật index tăng dần, reindex nền, chống stale embedding

> **Nguồn gốc:** apxml "Vector Index Updates & Maintenance" (strategies + trade-offs quản lý index updates trong production); Medium "Incremental Indexing Strategies for Large RAG Systems" (update vector DB hiệu quả, giảm cost, real-time); arXiv 2411.00970 "Incremental IVF Index Maintenance for Streaming Vector Databases" (Ada-IVF — nhiệt độ ưu tiên partition hay truy cập, tránh work thừa cho partition hiếm); ACM "Incremental In-Place Update for Billion-Scale Vector Search" (LIRE — reassign vector ở biên partition); Unstructured "Vector Indexing Strategies" ("nếu ingest liên tục — chọn index hỗ trợ incremental inserts + maintenance window dự đoán")
> **Coupling:** 🟡 — chạm tầng index của RAG/memory
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (index dựng 1 lần — chưa vòng update)
> **Effort:** 2-4 tuần

## Nguồn gốc

Index maintenance: **dữ liệu thay đổi (thêm/sửa/xóa) — vector index phải theo; nhưng rebuild toàn bộ là tốn — giải pháp: incremental insert, update partition ưu tiên, reindex nền, TTL xóa stale** — apxml: chọn strategy theo trade-offs (update throughput vs query QPS); Medium: real-time update mà không phải toàn reindex; Ada-IVF (arXiv): dùng nhiệt độ (temperature) ưu tiên partition nóng — "avoid unnecessary work on rarely accessed partitions" — 2-5× higher update throughput; LIRE (ACM): chỉ reassign vectors ở biên partition — low-overhead; Unstructured: ingest liên tục → chọn index incremental. Khác **210 chunking** (cấu trúc index lúc đầu) — FFF là *duy trì theo thời gian*; **38 memory-management** (vòng đời memory — có nét nhưng về agent context); **209 rewrite / 197 retrieval** (phía dùng). Kết nối: **212 embedding-eval** (đổi embedding → bắt buộc reindex — quyết định kiểu nào), **41 eval** (đo recall sau update), **82 memory-consolidation** (nhóm/loại bỏ — cùng tần suất).

## Kiến trúc

```
  DATA CHANGES (doc mới / sửa / xóa — từ ingest, git, web)
        │
        ▼
  CLASSIFY (nóng — ưu tiên / nguội — đợi batch — Ada-IVF nhiệt)
        │
  ┌─────► INCREMENTAL INSERT (vector mới — partition hiện có)
  │      ► UPDATE PARTITION (chỉ partition bị ảnh hưởng — LIRE biên)
  │      ► FULL REINDEX nền (off-peak — khi đổi embedding 212 / drift nhiều)
  │      ► TTL / DELETE stale (doc không còn — xóa khỏi index)
        │
        ▼
  MONITOR (recall@K sau update — 41 · QPS · drift đo)
```

```
mya: index xây 1 lần — khi doc đổi không cập nhật (stale)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 210 chunking — index tạo từ đầu theo chunk
// ✅ 212 embedding eval — khi đổi model → biết cần reindex
// ✅ 41 eval-harness — sẵn đo recall
// ✅ 38 memory-management — có điểm chung (vòng đời)

// ❌ THIẾU: ingest event → update index (thêm/sửa/xóa)
// ❌ THIẾU: phân loại nóng/nguội (ưu tiên partition — Ada-IVF)
// ❌ THIẾU: reindex nền lên lịch + TTL xóa stale
```

## Implementation

```typescript
// packages/indexmaint/src/update.ts (NEW)
export async function onDocChange(ev: DocEvent): Promise<void> {
  if (ev.kind === "delete") return idx.delete(ev.id);          // TTL/xóa stale
  const temp = partitionTemp(ev);                              // nóng vs nguội
  if (temp === "hot") return idx.upsert(embed(ev.doc));        // incremental
  queue.batch(ev);                                             // nguội — đợi batch
}
export async function reindex(plan: { offPeak: boolean }) {
  if (plan.offPeak && !isOffPeak()) return;                    // nền
  await idx.rebuild(newModel);                                 // đổi embedding
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Dữ liệu mới thấy ngay — không stale (real-time) | ❌ Update throughput vs query QPS — trade-off (apxml) |
| ✅ Rẻ hơn rebuild toàn bộ (incremental — Ada-IVF 2-5×) | ❌ Index incremental hỏng nếu thuật toán không hỗ trợ (HNSW cần care) |
| ✅ Phân loại nóng/nguội — ít công thừa | ❌ Vận hành thêm: lịch reindex, TTL, monitor |
| ✅ Xây trên 210/212/41 | ❌ Đổi embedding (212) vẫn phải toàn reindex — không tránh |

## Khác các hướng gần

| | 210 Chunk | 82 Memory | FFFFFFFF: Index-maint |
|---|---|---|---|
| Mục | Chia tài liệu lúc index | Consolidate memory | **Giữ index tươi theo thay đổi** |
| Vị trí | Ingest | Agent loop | **Nền — liên tục theo doc events** |
| Quan hệ | Đầu nguồn | Gần | **Duy trì — sau 210, trước 197 đọc** |

## Khi nào chọn

- Doc liên tục thay đổi (crawl, docs repo, user uploads) — retrieval phải thấy mới
- Rebuild toàn bộ đang quá đắt/mất downtime
- Đã có 210 chunking + 212 embedding — chưa có cập nhật
- Không khi: dữ liệu tĩnh — index dựng 1 lần là đủ (đừng thêm phức)