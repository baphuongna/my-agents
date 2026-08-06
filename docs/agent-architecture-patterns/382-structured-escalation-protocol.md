# Hướng NR: Structured Escalation Protocol — taxonomy 3 lý do: need_decision / interview_request / progress_update

> **Nguồn gốc:** Escalation taxonomy (incident management — SEV1/SEV2); "structured handoff"; "blocking vs non-blocking escalation"; pi-intercom contact_supervisor; delegation protocol
> **Coupling:** 🟢 — tool trên broker (381), không chạm core
> **Agent-agnostic:** ✅
> **Code sẵn:** ✅ (packages/intercom đã có contact_supervisor với 3-reason taxonomy)
> **Effort:** 0.5 tuần (đã có — tài liệu hóa)

## Nguồn gốc

**Escalation taxonomy** (incident management / ITIL): mỗi escalation có **reason** khác nhau → response khác nhau (SEV1 = blocking cần decision ngay, SEV3 = info only). **Structured handoff**: thay vì escalate "freestyle", dùng **enum lý do cố định** → supervisor biết ngay mức độ + cần làm gì. **Blocking vs non-blocking**: `need_decision` / `interview_request` = **blocking** (chờ reply, treo subagent), `progress_update` = **non-blocking** (gửi xong đi tiếp). Nguyên tắc: subagent escalate supervisor qua **taxonomy cố định** → supervisor phân loại nhanh, chặn abuse (không escalate trivial). Khác **331 escalation** (deadline → escalate) — NR là **protocol taxonomy** (3 lý do); khác **327 interruptible** (interrupt) — NR là subagent **proactively ask up**.

## Mô tả

mya structured escalation protocol: subagent có tool `contact_supervisor` với 3 reason cố định. (1) **`need_decision`** — blocked, uncertain, cần approval, scope/API decision → **blocking** (chờ supervisor reply). (2) **`interview_request`** — cần nhiều structured answers trong 1 lần → **blocking** (gửi questions, chờ reply). (3) **`progress_update`** — discovery quan trọng thay đổi plan → **non-blocking** (gửi xong đi tiếp, không chờ). Rule cứng: **không** dùng contact_supervisor cho routine completion handoff (return result bình thường). mya `packages/intercom` ĐÃ CÓ tool này.

## Kiến trúc

```
   SUBAGENT (đang làm task)
        │
        │  gặp vấn đề / cần input
        ▼
   ┌── contact_supervisor(reason=?) ──────────────────┐
   │                                                    │
   │   ┌─ need_decision ──────┐  ┌─ interview_request ┐│
   │   │ blocked / uncertain  │  │ multiple questions ││
   │   │ need approval        │  │ structured Q&A     ││
   │   │ scope/API decision   │  │ 1 blocking exchange││
   │   │ → BLOCKING (wait)    │  │ → BLOCKING (wait)  ││
   │   └──────────────────────┘  └────────────────────┘│
   │                                                    │
   │   ┌─ progress_update ────────────────────────────┐│
   │   │ discovery thay đổi plan                       ││
   │   │ → NON-BLOCKING (fire-and-forget)              ││
   │   └───────────────────────────────────────────────┘│
   └────────────────────┬───────────────────────────────┘
                        │
                        ▼
            BROKER (381) → SUPERVISOR
                        │
            ❌ routine completion → return result (KHÔNG escalate)
```

## mya ĐÃ CÓ (đầy đủ)

```typescript
// ✅ packages/intercom/src/intercom.ts — tool contact_supervisor
// ✅ 3-reason taxonomy — "need_decision" | "progress_update" | "interview_request"
// ✅ need_decision → blocking (chờ reply)
// ✅ interview_request → blocking (structured questions + chờ reply)
// ✅ progress_update → non-blocking (fire-and-forget)
// ✅ anti-abuse rule — "Do not use for routine completion handoffs"
// ✅ chạy trên broker 381 (ask/reply timeout)

// ✅ 331 LS escalation — deadline → escalate (nền — NR là protocol taxonomy)
// ✅ 327 interruptible-agents — interrupt (nền)
// ✅ 328 deferred-questions — defer question (nền — NR interview_request tương tự nhưng blocking)
```

## Implementation

```typescript
// packages/intercom/src/intercom.ts (ĐÃ CÓ — minh họa cấu trúc)
type ContactSupervisorReason = "need_decision" | "progress_update" | "interview_request";

const contactSupervisorTool = defineTool({
  name: "contact_supervisor",
  description:
    "Subagent-only tool. Use need_decision when blocked, uncertain, needing approval, " +
    "or facing a product/API/scope decision before continuing; this waits for the reply. " +
    "Use interview_request when multiple structured questions need supervisor answers; " +
    "this also waits for a reply. Use progress_update only for meaningful progress or " +
    "unexpected discoveries that change the plan; this does not wait for a reply. " +
    "Do not use for routine completion handoffs.",
  params: {
    reason: StringEnum(["need_decision", "progress_update", "interview_request"] as const, {
      description:
        "'need_decision' waits for reply; 'interview_request' sends structured questions " +
        "and waits for reply; 'progress_update' sends a non-blocking update",
    }),
    message: z.string(),
    questions: z.array(z.object({ /* structured interview */ })).optional(),
  },
  async run(args, ctx) {
    if (reason !== "need_decision" && reason !== "progress_update" && reason !== "interview_request") {
      return { ok: false, output: "invalid reason" };
    }
    // need_decision + interview_request → blocking ask (qua broker 381, timeout)
    // progress_update → non-blocking send
    const blocking = reason === "need_decision" || reason === "interview_request";
    if (blocking) {
      return await broker.ask(ctx.supervisorId, payload, getAskTimeoutMs()); // chờ reply
    }
    broker.send(ctx.supervisorId, payload); // fire-and-forget
    return { ok: true, output: "progress update sent" };
  },
});
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Supervisor phân loại nhanh (enum reason) | ❌ Subagent có thể over-escalate (abuse) |
| ✅ Blocking/non-blocking tách bạch (không treo sai) | ❌ need_decision treo subagent (block resource) |
| ✅ Anti-abuse rule (không escalate trivial) | ❌ Taxonomy cố định — thiếu reason mới phải đổi |
| ✅ Chạy trên broker 381 (timeout chặn treo) | ❌ interview_request phức tạp (structured Q&A schema) |

## Khác các hướng gần

| | 331 Escalation | 327 Interruptible | 328 Deferred Q | NR: Escalation Protocol |
|---|---|---|---|---|
| Cái gì | Deadline → escalate | Interrupt agent | Defer question | **3-reason taxonomy** |
| Hướng | ↑ (deadline) | ↓ (interrupt) | ↔ (defer) | ↑ (subagent→supervisor) |
| Blocking | ❌ | ❌ | ❌ | ✅ cần_decision/interview |
| Taxonomy | ❌ | ❌ | ❌ | ✅ enum cố định |

## Khi nào chọn

- Subagent cần escalate supervisor (decision, interview, progress)
- Muốn taxonomy cố định (không freestyle escalation)
- Muốn tách blocking/non-blocking (không treo sai)
- mya ĐÃ CÓ (packages/intercom contact_supervisor) — kết hợp 381 broker (timeout) + 331 escalation (deadline); guard over-escalation bằng anti-abuse rule
