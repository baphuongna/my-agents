# Hướng AHQ: Intercom-Supervisor-Bridge — subagent được tiêm template `contact_supervisor` (reason chuẩn: `need_decision`, `progress_update`) để liên lạc orchestrator qua kênh riêng; quy tắc reference-only: không tiếp tục conversation supervisor, không hỏi clarification khi conflict chỉ là review-only/no-edit

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟡 — inter-agent messaging | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có broker + client + skills; chưa có contact_supervisor template + reference-only rule) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents** tiêm template **`contact_supervisor`** vào subagent với các reason chuẩn (`need_decision`, `progress_update`) để liên lạc orchestrator qua **kênh riêng** (intercom). Kèm quy tắc **reference-only**: không tiếp tục conversation của supervisor, không hỏi clarification khi conflict chỉ là review-only/no-edit. Nguyên tắc: **structured escalation** — subagent chỉ liên lạc với lý do chuẩn, không tự do chat; **reference-only context** — context kế thừa là tham chiếu, không phải continuation; **no-clarification-when-no-edit** — khi task không cho edit, hỏi clarification là lãng phí.

## Mô tả

Với mya, pattern = **supervisor contact qua intercom**: (1) mya đã có **intercom broker + IntercomClient** (packages/intercom) cho inter-agent messaging — đúng kênh riêng; (2) mya có **skills** dir + extension-api — nền tiêm template; (3) AHQ thêm **`contact_supervisor` skill/tool** — subagent gọi với `{ reason: "need_decision" | "progress_update", message }`; (4) **reference-only rule** trong system prompt subagent: "Context supervisor là reference-only — không continue conversation, không hỏi clarification nếu task review-only"; (5) orchestrator nhận message qua intercom, trả decision (không mở thread chat).

## Kiến trúc (ASCII)

```
  SUBAGENT (worker)
    │ cần decision / muốn report progress
    │ ──contact_supervisor({ reason: "need_decision", message })──┐
    ▼                                                              │
  INTERCOM (kênh RIÊNG — broker) ◄─────────────────────────────────┘
    │
    ▼
  ORCHESTRATOR (supervisor)
    │ nhận structured message (reason + message)
    │ └─► trả DECISION (không mở thread chat)
    ▼
  SUBAGENT ◄──decision (qua intercom)
  Quy tắc REFERENCE-ONLY: context supervisor = reference, KHÔNG continue
  Không hỏi clarification khi conflict = review-only / no-edit
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom broker — broker.ts (kênh riêng inter-agent)
// ✅ packages/intercom — IntercomClient (gửi/nhận message)
// ✅ packages/intercom skills — dir skill (nền tiêm template)
// ✅ packages/intercom extension-api.ts — IntercomExtensionRegistration
// ✅ packages/intercom reply-tracker.ts — track reply (nền decision round-trip)
// ✅ packages/intercom format-context.ts — format context (nền reference-only)

// ❌ THIẾU: contact_supervisor skill/template (reason chuẩn)
// ❌ THIẾU: reference-only rule trong system prompt
// ❌ THIẾU: no-clarification-when-no-edit gating
```

## Implementation

```typescript
// packages/intercom/src/skills/contact-supervisor.ts (NEW)
import { IntercomClient } from "../broker/client.js";

export type SupervisorReason = "need_decision" | "progress_update";

/** Subagent liên lạc orchestrator qua kênh riêng — reason chuẩn, không chat tự do. */
export function makeContactSupervisor(client: IntercomClient, supervisorId: string) {
  return async function contactSupervisor(
    reason: SupervisorReason,
    message: string,
  ): Promise<string> {
    const reply = await client.sendAndWait({
      to: supervisorId,
      body: `[${reason}] ${message}`,
      // reply-tracker chờ decision, KHÔNG mở thread
    });
    return reply.body; // decision — reference-only, không continue conversation
  };
}
// System prompt subagent (nối format-context): "Context supervisor = REFERENCE-ONLY.
// Không continue conversation supervisor. Nếu task review-only/no-edit → KHÔNG hỏi
// clarification, chỉ report finding qua contact_supervisor."
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Structured escalation — reason chuẩn, không chat lung tung | ❌ Subagent bị giới hạn — không hỏi tự do |
| ✅ Reference-only — context không rò rỉ thành continuation | ❌ Cần phân biệt review-only vs edit task (gating) |
| ✅ Nối intercom broker sẵn | ❌ Round-trip decision chậm hơn tự quyết |
| ✅ No-clarification-when-no-edit giảm lãng phí | ❌ Reason chuẩn phải cover đủ case |

## Khác các hướng gần

| | AHQ Intercom-Supervisor-Bridge | AHO Recursive-Context-Isolation | AIA Group-Join-Consolidated-Notify |
|---|---|---|---|
| Trọng tâm | Subagent → supervisor escalation | Subagent không kế thừa context | Notify gộp nhiều agent |
| Cơ chế | contact_supervisor + reference-only | Separate process + scout | Batch 30s + straggler |
| Quan hệ | Channel ngược (con→cha) | Channel xuôi (cha→con) | Channel ra (notify) |

## Khi nào chọn

- Subagent cần escalate decision về orchestrator qua kênh riêng
- Muốn reference-only — context không thành continuation
- Tránh clarification spam khi task review-only/no-edit
- Guard: reason chuẩn enum, reference-only trong prompt, gating review-vs-edit, decision qua reply-tracker
