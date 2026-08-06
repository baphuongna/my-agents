# Hướng AJH: Synthesis-Timeline Entity Format — entity file hai lớp: `## Synthesis` (current truth mutable — surface recall mặc định) và `## Timeline` (evidence append-only với provenance `[source=extraction] [session=...]`); synthesis stale khi timeline entry mới hơn `synthesis_updated_at`

> **Nguồn gốc:** remnic | **Coupling:** 🟢 — định dạng dữ liệu memory | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có facts/takes/pages; chưa có synthesis/timeline hai lớp) | **Effort:** 1 tuần

## Nguồn gốc

**remnic** entity file **hai lớp**: **`## Synthesis`** — **current truth mutable** (surface recall mặc định — câu trả lời hiện tại đã chốt) và **`## Timeline`** — **evidence append-only** với provenance (`[source=extraction] [session=...]` — mỗi entry ghi nguồn/session). **Synthesis stale khi có timeline entry mới hơn `synthesis_updated_at`** — nếu timeline có bằng chứng mới hơn bản tổng hợp, synthesis không còn tin cậy → phải regenerate.

Nguyên tắc: **tách current truth (mutable, dùng để trả lời) khỏi evidence (append-only, dùng để kiểm chứng)** — trộn làm mất khả năng truy vết; **provenance bắt buộc** trên mọi evidence entry (source + session — ai nói, khi nào); **staleness theo timestamp** — synthesis_updated_at so với timeline entry mới nhất — mutable chỉ đúng khi không có bằng chứng mới hơn.

## Mô tả

Với mya, pattern = **entity format hai lớp trong memory**: (1) **BrainPage (memory/brain.ts) hiện có** `compiledTruth` — gần Synthesis (current truth); thiếu Timeline + provenance; (2) AJH thêm **entity record hai lớp**: `{ synthesis: { text, updatedAt }, timeline: [{ text, source, sessionId, at }] }` — lưu trong sqlite (episodic/facts) hoặc BrainPage mở rộng; (3) **surface recall** — trả Synthesis (đã chốt, ngắn gọn) mặc định; (4) **staleness check** — `max(timeline.at) > synthesis.updatedAt` → synthesis stale → đánh dấu (recall trả cả timeline evidence thay vì synthesis cũ); (5) **nối capture** — mỗi extraction (AJE staging → primitive) ghi timeline entry kèm provenance (source=auto-capture/session=...); khi đủ bằng chứng mới → regenerate synthesis (LLM — nối AJF extract); (6) **nối supersession** — conflict detection (sqlite conflict.ts) hoạt động trên timeline; synthesis là phép chiếu. Định dạng YAML+markdown tương ứng metadata (source/session) + text.

## Kiến trúc (ASCII)

```
  ENTITY FILE (two-layer)
    │
    ├─ ## SYNTHESIS (current truth — MUTABLE, surface recall mặc định)
    │    text: "Alice prefers dark mode"
    │    synthesis_updated_at: <ts>
    │
    └─ ## TIMELINE (evidence — APPEND-ONLY, mọi entry có provenance)
         [source=extraction] [session=s1] at=1000: "Alice: I prefer dark mode"
         [source=auto-capture] [session=s2] at=1500: "Alice switched to light mode"
         │
         ▼ STALENESS CHECK
         max(timeline.at)=1500 > synthesis_updated_at=1000
         └─► SYNTHESIS STALE ──► recall trả timeline evidence (không dùng synthesis cũ)
              └─► regenerate synthesis khi đủ bằng chứng (LLM — nối AJF)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory brain.ts — BrainPage { compiledTruth, source, version }
//   (gần Synthesis — thiếu Timeline + provenance)
// ✅ packages/memory tree.ts — L2 pages (compiledTruth là current truth)
// ✅ packages/memory sqlite-store.ts — supersede + summary_of (nền timeline quản lý)
// ✅ packages/memory conflict.ts — Jaccard conflict detection (nền trên timeline)
// ✅ packages/memory auto-capture.ts — source field (nền provenance)
// ✅ packages/memory sqlite-manager.ts — record/recall (nền entity lưu trữ)

// ❌ THIẾU: timeline array + provenance (source/session) per entry
// ❌ THIẾU: synthesis_updated_at + staleness check
// ❌ THIẾU: recall surface synthesis vs stale→timeline
```

## Implementation

```typescript
// packages/memory/src/synthesis-timeline.ts (NEW)
export interface TimelineEntry {
  text: string;
  source: string;      // "extraction" | "auto-capture" | "user" ...
  sessionId: string;
  at: number;
}
export interface EntityRecord {
  id: string;
  synthesis: { text: string; updatedAt: number } | null;
  timeline: TimelineEntry[];   // append-only
}

/** Append evidence — mọi entry phải có provenance. */
export function appendTimeline(
  rec: EntityRecord,
  entry: Omit<TimelineEntry, "at">,
  now: number,
): EntityRecord {
  return { ...rec, timeline: [...rec.timeline, { ...entry, at: now }] };
}

/** Stale? — timeline entry mới hơn synthesis_updated_at. */
export function isSynthesisStale(rec: EntityRecord): boolean {
  if (!rec.synthesis) return true;
  const newest = rec.timeline.reduce((m, e) => Math.max(m, e.at), 0);
  return newest > rec.synthesis.updatedAt;
}

/** Surface recall — synthesis nếu fresh, timeline evidence nếu stale. */
export function surfaceForRecall(rec: EntityRecord): string {
  if (!isSynthesisStale(rec) && rec.synthesis) return rec.synthesis.text;
  // Stale → trả evidence kèm provenance để agent tự đánh giá.
  return rec.timeline
    .map((e) => `- ${e.text} [source=${e.source}] [session=${e.sessionId}]`)
    .join("\n");
}
// sqlite-manager: lưu EntityRecord (synthesis + timeline JSON) per entity;
// recall trả surfaceForRecall; capture mới → appendTimeline (provenance).
// Đủ bằng chứng mới → regenerate synthesis (nối AJF LLM extract).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Current truth ngắn gọn cho recall — không phải đọc hết evidence | ❌ Timeline append-only phình to — cần retention (nối sqlite-consolidate) |
| ✅ Provenance truy vết được — ai nói gì khi nào | ❌ Staleness theo timestamp — clock lệch có thể sai |
| ✅ Stale → evidence thay vì synthesis sai | ❌ Regenerate synthesis tốn LLM — cần trigger rõ |
| ✅ Nối supersession/conflict | ❌ Hai lớp phải sync — synthesis quên update = stale liên tục |

## Khác các hướng gần

| | AJH Synthesis-Timeline | AJE Trace→Primitive | AJI Dreams Consolidation |
|---|---|---|---|
| Trọng tâm | Format entity 2 lớp | 3 giai đoạn capture | Consolidation nền |
| Cơ chế | Synthesis + timeline + stale | Judge + staging + commit | Phase light/REM/deep |
| Quan hệ | Định dạng primitive | Sinh timeline entries | Regenerate synthesis |

## Khi nào chọn

- Memory cần vừa trả lời nhanh (synthesis) vừa kiểm chứng được (timeline evidence)
- Quan tâm provenance — biết memory từ đâu ra (session/source)
- Đã có BrainPage.compiledTruth — nâng thành entity hai lớp
- Guard: provenance bắt buộc, staleness check theo timestamp, retention cho timeline, trigger regenerate rõ