# Hướng VK: Hidden Orchestrator Handoff — khi xong, tiêm follow-up message display:false bảo orchestrator dùng summary, cấm đào search logs

> **Nguồn gốc:** pi-boomerang (hidden orchestrator handoff); "inject display:false follow-up message"; "orchestrator uses summary not raw logs"; "forbid digging search logs"; "invisible handoff via hidden message" | **Coupling:** 🟡 — thêm hidden-message injection vào subagent completion + log-search guard | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent + summary sẵn — chưa có display:false message + log-search block) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi-boomerang** khi worker (VJ) hoàn thành và **collapse** thành summary, cần **bảo** orchestrator: "dùng summary, KHÔNG đào search logs raw". Cách làm: tiêm một **follow-up message** có `display:false` (ẩn, không hiện cho user) vào context orchestrator — nội dung hướng dẫn "kết quả nằm trong summary, không search log raw" + **cấm** dùng search-log tool để đào chi tiết. Nguyên tắc: **handoff ẩn + cấm đào** — summary là nguồn sự thật, raw log chỉ archive phòng hờ; orchestrator không tự ý mở raw (tránh overflow trở lại). Khác **VJ collapse** (nén) — VK **chỉ thị dùng summary**; khác explicit instruction — VK **hidden (display:false)**.

## Mô tả

mya hidden orchestrator handoff: (1) **Completion + collapse**: worker xong → VJ nén thành summary. (2) **Hidden message inject**: tiêm follow-up message `{ role:'system', display:false, content:"Dùng summary làm kết quả. KHÔNG search log raw." }`. (3) **Log-search guard**: block tool search-log khi attempt trên raw archive (trừ case audit rõ ràng). (4) **Invisible**: user không thấy message ẩn (display:false), orchestrator nhận chỉ thị im lặng. mya có subagent + message — VK thêm **display:false field** + **hidden-injector** + **log-search guard**.

## Kiến trúc

```
  WORKER xong → VJ collapse → summary
        │
        ▼
  ┌─── HIDDEN MESSAGE INJECT (display:false) ─────────────┐
  │  { role: "system", display: false,                      │
  │    content: "Kết quả worker nằm trong SUMMARY.          │
  │      KHÔNG dùng search-log để đào raw trace.             │
  │      Summary là nguồn sự thật duy nhất." }               │
  │  → orchestrator context += message (ẨN, user không thấy)│
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── ORCHESTRATOR hành vi ──────────────────────────────┐
  │  đọc summary → hành động theo summary                   │
  │  nếu attempt search-log raw → BLOCK (guard)             │
  │    "raw trace archived, summary là nguồn sự thật"       │
  └─────────────────────────────────────────────────────┘

  USER PERSPECTIVE: thấy orchestrator tiếp tục mượt (không thấy
    message ẩn, không thấy raw flood) → INVISIBLE HANDOFF
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 582 opaque-context-collapse (VJ) — summary (nền — VK = chỉ thị dùng summary)
// ✅ packages/subagents — subagent completion (nền — VK = handoff lúc này)
// ✅ message role system — system message (nền — VK = display:false)

// ❌ THIẾU: display:false field (message ẩn khỏi user)
// ❌ THIẾU: hidden-message injector (follow-up ẩn tới orchestrator)
// ❌ THIẾU: log-search guard (block đào raw trừ audit)
```

## Implementation

```typescript
// packages/agent/src/hidden-handoff.ts (MỚI)
interface HandoffMessage { role: 'system'; display: boolean; content: string }

class HiddenOrchestratorHandoff {
  constructor(
    private inject: (msg: HandoffMessage) => void,
  ) {}

  // tiêm hidden follow-up bảo dùng summary, cấm đào log
  handoff(workerId: string, summaryKey: string): void {
    const msg: HandoffMessage = {
      role: 'system',
      display: false, // ẨN khỏi user
      content:
        `Worker ${workerId} đã hoàn thành. Kết quả nằm trong SUMMARY (${summaryKey}). ` +
        `KHÔNG dùng search-log/grep để đào raw trace. ` +
        `Summary là nguồn sự thật duy nhất. Raw chỉ archive cho audit bắt buộc.`,
    };
    this.inject(msg);
  }
}

// log-search guard (wrap search-log tool)
function makeLogSearchGuard(canAudit: () => boolean): (tool: string, args: unknown) => { block: boolean; reason?: string } {
  return (tool, _args) => {
    if (tool === 'search-log' && !canAudit()) {
      return { block: true, reason: 'raw trace archived — dùng summary, không đào log (audit-only)' };
    }
    return { block: false };
  };
}

// Usage:
// handoff.handoff('worker-1', 'summary/worker-1');  // ẩn, user không thấy
// orchestrator attempt search-log raw → guard block
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Orchestrator dùng summary (không overflow) | ❌ Cản trở debug (cần audit mới thấy raw) |
| ✅ Invisible (user không thấy message ẩn) | ❌ Hidden message khó inspect (khó debug chính nó) |
| ✅ Cấm đào log (guard) → tiết kiệm context | ❌ Guard cản trở đúng lúc (cần raw nhưng bị block) |
| ✅ Summary = single source of truth | ❌ Summary thiếu → orchestrator bí (raw bị khóa) |

## Khác các hướng gần

| | Explicit instruction | VJ collapse | VK: Hidden-Handoff |
|---|---|---|---|
| Thấy | User thấy (display) | ❌ | **❌ display:false (ẩn)** |
| Cấm đào | ⚠️ (nói, không enforce) | ❌ | **✅ guard block** |
| Khi | Mọi lúc | Completion | **Sau collapse** |

## Khi nào chọn

- VJ collapse xong → cần bảo orchestrator dùng summary
- Orchestrator hay tự đào raw log → overflow trở lại
- Muốn handoff ẩn, mượt (user không thấy machinery)
- Nối 582 opaque-context-collapse (VJ, summary) + packages/subagents completion + message role; guard audit-escape (cho phép override khi debug thật sự cần), hidden-message inspectability (dev mode show), và summary completeness (đảm bảo summary đủ, không bí khi raw bị khóa); VK = hidden orchestrator handoff, kết hợp 582 VJ (collapse) + 588 operational-handoff-schema (summary có cấu trúc)
