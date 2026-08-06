# Hướng WW: BDI + 3-Stage Commitment — beliefs, desires, intentions, reconsideration

> **Nguồn gốc:** Rao & Georgeff BDI (1995); Wray/Kirk/Laird — "Applying Cognitive Design Patterns to General LLM Agents" (arXiv:2505.07087)
> **Coupling:** 🟡 — beliefs/intentions là state dùng chung
> **Agent-agnostic:** ⚠️ — agents phải ghi beliefs + nhận intentions
> **Code sẵn:** ⚠️ (1 phần — brain = beliefs, kanban = intentions; thiếu reconsideration)
> **Effort:** 1-2 tuần

## Nguồn gốc

**BDI** (Rao & Georgeff, 1995): agent gồm Beliefs (nhận định về thế giới), Desires (mục tiêu mong muốn), Intentions (cam kết hành động). Điểm tinh tế nhất là **3-stage commitment**: (1) sinh *candidates* → (2) chọn/commit 1 → (3) **reconsideration** định kỳ — giữ, hạ cấp (deselect) hoặc hủy (retract) cam kết. Wray/Kirk/Laird (2025) chỉ ra: LLM agents hiện nay gần như **không có reconsideration** — chat LLM kháng đổi hướng (non-monotonic) — và đây là gap lớn nhất để áp dụng pattern này.

## Mô tả

Map thẳng lên mya: **beliefs** = brain facts (đã grounded — governance), **desires** = backlog task chưa chốt, **intentions** = task đang in-flight trên kanban. Reconsideration = định kỳ (mỗi N turn / khi sự kiện) đánh giá từng intention: còn khả thi? còn đáng làm? → giữ / demote về backlog / hủy + ghi lý do. Đây là luận cứ lý thuyết cho việc mya nên có cơ chế *hủy cam kết có kỷ luật* thay vì để agent bám task chết.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│              BDI LOOP (mya)                                 │
│                                                            │
│  beliefs (brain)     desires (backlog)    intentions (kanban)│
│  ┌──────────┐        ┌───────────┐        ┌──────────────┐ │
│  │ grounded │        │ task chưa │        │ task in-flight│ │
│  │ facts    │        │ chốt      │        │ + owner + stage│ │
│  └──────────┘        └───────────┘        └──────┬───────┘ │
│                                                  │         │
│  ┌───────────────────────────────────────────────┴───────┐ │
│  │ RECONSIDERATION (định kỳ / theo event)                │ │
│  │  for intention in intentions:                         │ │
│  │    if !viable(intention, beliefs):                    │ │
│  │      retract  → cancel + reason log                   │ │
│  │    elif priority đã đổi:                              │ │
│  │      demote   → về backlog (deselect)                 │ │
│  │    else: reaffirm → tiếp tục                          │ │
│  └───────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ Beliefs: packages/memory — brain-store (facts, grounding, governance)
//    fact phải nối vào source (grounded) = BDI belief hợp lệ
// ✅ Intentions: packages/tools/src/kanban-sqlite.ts — task, stage, owner
// ✅ Desires: kanban backlog (chưa assign)

// ❌ THIẾU: reconsideration loop — đánh giá định kỳ intention:
//    viable? (beliefs có mâu thuẫn task không) → retract/demote/reaffirm.
//    ❌ THIẾU: trace "task này từng cam kết rồi bị hủy, vì sao".
```

## Implementation

```typescript
// packages/gateway/src/reconsideration.ts (NEW)
type Verdict = "reaffirm" | "demote" | "retract";

class Reconsideration {
  async run(brain: Brain, kanban: Kanban): Promise<Verdict[]> {
    const verdicts: Verdict[] = [];
    for (const task of kanban.inFlight()) {
      const conflicting = brain.factsAgainst(task.goal);   // beliefs mâu thuẫn?
      const staleDays = nowMs() - task.startedAt;

      if (conflicting.length > 0) {
        verdicts.push("retract");                           // hủy + lý do
        kanban.cancel(task.id, `beliefs conflict: ${conflicting.map(f => f.id)}`);
      } else if (task.priority < kanban.backlogTopPriority() && staleDays > 3) {
        verdicts.push("demote");                            // hạ cấp về backlog
      } else {
        verdicts.push("reaffirm");
      }
    }
    log(`[bdi] ${verdicts.join(",")}`);
    return verdicts;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lý thuyết chặt: agent có cam kết có trách nhiệm | ❌ Reconsideration thêm 1 loop định kỳ |
| ✅ Hủy task vô ích có kỷ luật + audit | ❌ Quyết định "viable?" cần heuristic/LLM |
| ✅ Map 1-1 lên brain + kanban sẵn có | ❌ Demote nhầm → task quan trọng bị trì hoãn |
| ✅ Bù lỗ hổng lớn nhất của LLM agents (paper) | |
| ✅ Trace cam kết → hủy (provenance) | |

## Khi nào chọn

- Nhiều task in-flight cùng lúc (kanban dày)
- Muốn tránh agent bám task chết vô ích
- Muốn lý thuyết hóa memory + kanban thành BDI
- Muốn audit được "tại sao task bị hủy"
