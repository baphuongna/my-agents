# Hướng NNNNNNN: Self-Healing & Error Recovery — agent tự phục hồi, lỗi rẻ, hồi phục nhanh

> **Nguồn gốc:** Zylos "AI Agent Self-Healing and Auto-Recovery Patterns" (60% downtime reduction; 67% failures từ context); arXiv 2605.06737 "A Self-Healing Framework for Reliable LLM-based Agents" (failure detection + recovery); Union.ai "How to Build Self-Healing Agents" ("Don't aim for failure-proof. Aim for cheap failures and fast recovery"); Taskade "Error Handling & Self-Healing Patterns" (try-catch + classify + route)
> **Coupling:** 🟡 — runtime phải báo lỗi chi tiết qua pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (retry + circuit breaker + audit sẵn; thiếu auto-recovery)
> **Effort:** 2-4 tuần

## Nguồn gốc

Self-healing: **agent phát hiện lỗi, phân loại, tự chọn đường phục hồi — không cần người** — Zylos: "Self-healing implementations achieve an average 60% reduction in system downtime, while 67% of AI system failures stem from context issues"; arXiv 2605.06737: "reliability-aware self-healing framework — integrates failure detection..."; Union.ai: "Don't aim for failure-proof. Aim for cheap failures and fast recovery — feedback loop between failure and recovery, with full context"; Taskade: "wrapping every action in a try-catch loop, classifying the failure, routing it to the right handler". Điểm khác **RRR retry** (thử lại đơn giản — mạng/lỗi tạm) và **NN circuit breaker** (ngắt nguồn lỗi — chống nổ) — NNNNNNN *toàn diện hơn*: classify (Taskade — lỗi gì: context 67% — Zylos, tool lỗi, model, API), route (lỗi context → tóm tắt/lấy lại ngữ cảnh — gốc rễ 67%); fallback (tool A lỗi → tool B — ai-agentsplus), degrade (task khó → model nhỏ + retry; GGG routing), self-heal state (state hỏng → rebuild từ log — GGGGGG TTD), học (lỗi lặp lại → sửa prompt/workflow vĩnh viễn — 147/RRRRRR feedback). "Cheap failures + fast recovery" (Union) là triết lý: không chống lỗi mà chế lỗi rẻ.

## Kiến trúc

```
  LỖI ──► TRY-CATCH quanh mọi action (Taskade)
        │
        ▼
  CLASSIFY (Taskade): context (67% — Zylos) · tool · model · API
        │
        ▼
  ROUTE (đúng handler):
   · context → rebuild/summarize (gốc rễ 67% — arXiv 2605.06737)
   · tool → fallback tool B (ai-agentsplus)
   · model → degrade (GGG) · API → retry (RRR)
   · state hỏng → rebuild từ log (GGGGGG TTD)
        │
        ▼
  CHEAP FAILURE + FAST RECOVERY (Union — full context loop)
   · lỗi lặp → học: sửa prompt/workflow vĩnh viễn (RRRRRR/147)
   · metric: downtime giảm 60% (Zylos)
```

```
mya: RRR + NN + VV SẸN — thiếu: classify + route + auto-recovery
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ RRR retry — thử lại (lỗi tạm)
// ✅ NN circuit breaker — ngắt nguồn lỗi
// ✅ GGG routing — hạ model (degrade)
// ✅ GGGGGG TTD — rebuild từ log (state hỏng)
// ✅ VV audit + YYY observability — phát hiện lỗi
// ✅ 147 + RRRRRR — học từ lỗi lặp

// ❌ THIẾU: classify layer (lỗi gì — Taskade)
// ❌ THIẾU: route (mỗi loại lỗi → handler riêng)
// ❌ THIẾU: context recovery (67% lỗi là context — Zylos)
```

## Implementation

```typescript
// packages/recovery/src/selfheal.ts (NEW)
export class SelfHeal {
  async run(task: Task): Promise<Out> {
    return retry.withPolicy(async () => {            // Taskade try-catch
      try { return await task.execute(); }
      catch (e) { return recover(classify(e)); }      // route đúng handler
    });
  }
  async recover(kind: Failure): Promise<Out> {
    switch (kind.type) {
      case "context": return rebuildContext(kind);   // 67% lỗi (Zylos)
      case "tool":    return fallback(kind.tool);    // tool B
      case "state":   return ttd.rebuild(kind);      // GGGGGG
      default:        return degrade(kind);          // GGG hạ model
    } // Union: cheap failure + fast recovery — feedback full context
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm 60% downtime (Zylos) — agent không chết khi lỗi | ❌ Tự chữa sai → càng tệ (dark side — reddit) |
| ✅ Xử đúng gốc: 67% lỗi là context — recover riêng | ❐ Cần giới hạn: loop retry vô hạn |
| ✅ Lỗi rẻ — fail nhanh, phục hồi nhanh (Union) | ❌ Học sai từ lỗi một lần |
| ✅ Xây trên RRR + NN + GGG + GGGGGG | ❌ Che lỗi thật — lỗi cần người mới phát hiện |

## Khác các hướng gần

| | RRR Retry | NN Circuit Breaker | NNNNNNN: Self-Healing |
|---|---|---|---|
| Cách | Thử lại | Ngắt nguồn | **Phân loại + chọn đường hồi phục** |
| Mức | 1 hành động | 1 nguồn | **Toàn pipeline** |
| Quan hệ | 1 handler | 1 handler | **Lớp classify + route + learn** |

## Khi nào chọn

- Agent dài hạn quan trọng — không thể chết giữa task (downtime)
- Nhiều nguồn lỗi (context, tool, model, API) — cần phân loại đúng
- Đã có RRR + NN + GGG + GGGGGG — thêm classify + route
- "Cheap failures and fast recovery" (Union — triết lý phù hợp)