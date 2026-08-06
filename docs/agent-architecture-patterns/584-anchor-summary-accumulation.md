# Hướng VL: Anchor-Summary Accumulation — user chỉ một anchor; summary nhiều turn accumulate vào cùng anchor → chia sẻ context giữa nhiệm vụ

> **Nguồn gốc:** pi-boomerang (anchor summary accumulation); "single anchor for multiple task summaries"; "accumulate summaries into one anchor"; "share context across tasks via anchor"; "sticky running-summary point" | **Coupling:** 🟢 — thêm anchor store + accumulation merge vào summary pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (memory + summary sẵn — chưa có anchor accumulation) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi-boomerang** cho rằng các **summary** từ nhiều nhiệm vụ/turn nên **accumulate** vào **một anchor** duy nhất do user chỉ định — thay vì mỗi summary rải rác riêng lẻ. Anchor là **điểm dính** (sticky running-summary): mỗi nhiệm vụ xong → summary **merge** vào anchor → anchor chứa **ngữ cảnh tích lũy** của nhiều nhiệm vụ. Nhiệm vụ mới có thể **đọc anchor** để chia sẻ context (biết nhiệm vụ trước đã làm gì). Nguyên tắc: **một anchor, nhiều summary, ngữ cảnh dùng chung** — không lặp, không quên (anchor nhớ). Khác **summary rời rạc** (mỗi nhiệm vụ 1 note) — VL **accumulate 1 anchor**; khác global memory — VL **user-pinned anchor** (rõ ràng, có chủ đích).

## Mô tả

mya anchor-summary accumulation: (1) **Anchor pin**: user chỉ định anchor (vd "project-alpha"). (2) **Summary append**: mỗi nhiệm vụ xong → summary (VJ) **accumulate** vào anchor. (3) **Merge**: anchor merge summary mới vào running-context (cập nhật, không chỉ thêm đuôi). (4) **Share**: nhiệm vụ mới đọc anchor → có context tất cả nhiệm vụ trước. (5) **Durable**: anchor sống qua nhiều session (chỉ người dùng clear). mya có memory + summary — VL thêm **anchor store** + **accumulate merger** + **anchor-read injection**.

## Kiến trúc

```
  USER chỉ anchor: "project-alpha"  (PIN)
        │
  nhiệm vụ A xong → summary A ──┐
  nhiệm vụ B xong → summary B ──┤  ACCUMULATE
  nhiệm vụ C xong → summary C ──┘  (merge vào anchor)
        │
        ▼
  ┌─── ANCHOR: project-alpha (running-summary) ───────────┐
  │  summary A: "setup auth"                                │
  │  summary B: "added rate-limit"                          │
  │  summary C: "fixed token refresh"                       │
  │  → ngữ cảnh tích lũy (3 nhiệm vụ, 1 anchor)             │
  └───────────────────────┬─────────────────────────────┘
                          │ (nhiệm vụ D đọc anchor)
                          ▼
  ┌─── SHARE CONTEXT ─────────────────────────────────────┐
  │  nhiệm vụ D inject anchor vào context:                  │
  │    "A:auth / B:rate-limit / C:token-refresh"            │
  │  → D biết 3 nhiệm vụ trước làm gì → không lặp            │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 582 opaque-context-collapse (VJ) — summary (nền — VL = accumulate summary)
// ✅ packages/memory brain-store — durable store (nền — VL = anchor store)
// ✅ context injection — inject context (relate — VL = anchor-read)

// ❌ THIẾU: anchor store (user-pinned anchor)
// ❌ THIẾU: accumulate merger (summary mới → merge running)
// ❌ THIẾU: anchor-read injection (nhiệm vụ mới đọc anchor)
```

## Implementation

```typescript
// packages/agent/src/anchor-accumulation.ts (MỚI)
interface TaskSummary { taskId: string; outcome: string; ts: number }

class AnchorSummaryAccumulation {
  private anchors = new Map<string, TaskSummary[]>();

  // user pin anchor (hoặc tự tạo khi thiếu)
  pinAnchor(id: string): void { if (!this.anchors.has(id)) this.anchors.set(id, []); }

  // accumulate: merge summary mới vào anchor
  accumulate(anchorId: string, summary: TaskSummary): void {
    const list = this.anchors.get(anchorId) ?? [];
    // dedup: replace nếu cùng taskId (re-run), else append
    const idx = list.findIndex(s => s.taskId === summary.taskId);
    if (idx >= 0) list[idx] = summary; else list.push(summary);
    this.anchors.set(anchorId, list);
  }

  // share: nhiệm vụ mới đọc anchor → context
  read(anchorId: string): string {
    const list = this.anchors.get(anchorId) ?? [];
    return list.map(s => `${s.taskId}: ${s.outcome}`).join(' / ');
  }

  // clear (user only)
  clear(anchorId: string): void { this.anchors.delete(anchorId); }
}

// Usage:
// acc.pinAnchor('project-alpha');
// acc.accumulate('project-alpha', { taskId:'A', outcome:'setup auth', ts:now });
// acc.accumulate('project-alpha', { taskId:'B', outcome:'rate-limit', ts:now });
// const ctx = acc.read('project-alpha');  // "A: setup auth / B: rate-limit"
//   → inject vào nhiệm vụ C (chia sẻ context)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chia sẻ context giữa nhiệm vụ (không lặp) | ❌ Anchor phình (nhiều summary → dài) |
| ✅ User-pin (rõ ràng, có chủ đích) | ❌ Merge conflict (summary mâu thuẫn) |
| ✅ Durable (nhớ qua session) | ❌ Anchor stale (nhiệm vụ cũ không còn relevant) |
| ✅ Single source (1 anchor thay vì rời rạc) | ❌ Đọc overhead (nhiệm vụ nào cũng load anchor) |

## Khác các hướng gần

| | Summary rời rạc | Global memory | VL: Anchor-Accumulation |
|---|---|---|---|
| Lưu | Mỗi nhiệm vụ 1 note | Tự do (không cấu trúc) | **1 anchor accumulate** |
| Share | ❌ | ⚠️ | **✅ đọc anchor** |
| Pin | ❌ | ❌ | **✅ user chỉ định** |

## Khi nào chọn

- Nhiều nhiệm vụ liên quan → cần chia sẻ context (không lặp)
- User muốn 1 điểm theo dõi (anchor) thay vì rời rạc
- Cần nhớ qua session (durable running-summary)
- Nối 582 opaque-context-collapse (VJ, summary) + packages/memory brain-store (durable) + context injection; guard anchor size (cap + compress summary cũ), merge correctness (mâu thuẫn → flag), và anchor freshness (prune nhiệm vụ cũ irrelevant); VL = anchor-summary accumulation, kết hợp 582 VJ (summary source) + 588 operational-handoff-schema (summary có cấu trúc → merge sạch)
