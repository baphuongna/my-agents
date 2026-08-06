# Hướng FFFFF: Simulated User Testing — LLM đóng vai người dùng tương tác live với agent

> **Nguồn gốc:** UXAgent (arXiv 2504.09407); langwatch User Simulator Agent; galtea Conversation Simulator 2026
> **Coupling:** 🟢 — tầng test đối ngoại, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval sẵn; thiếu sim user)
> **Effort:** 1-2 tuần

## Nguồn gốc

Simulated user testing: **một LLM đóng vai người dùng, tương tác live đa lượt với agent đang test** — không phải case tĩnh 1 lượt. UXAgent (arXiv 2504.09407): "simulate usability testing — thousands of simulated users, generates Simulation Replay and Agent Interview" (agent interview: hỏi agent "tại sao làm thế" để hiểu fail); langwatch User Simulator: "instead of writing scripted user messages" — sim realistic user behavior; galtea Conversation Simulator 2026: "testing conversational AI in realistic dialogue scenarios — prevent real-world failure". Khác **NNNN synthetic data** (sinh case tĩnh — câu hỏi đơn) — FFFFF là *session đa lượt động*: user trả lời/đổi ý/cắt lời/yêu cầu lại — agent phải thích ứng (multi-turn, sửa hiểu lầm — RRRR/AAAAA trong tương tác). Phát hiện fail về *hành vi*: hỏi lại sai, hiểu sai intent, bỏ sót ràng buộc, phản hồi không thích hợp.

## Mô tả

mya user-sim layer (nối eval/SSSS): (1) **persona pool** — tham số user (mục tiêu, độ kỹ, ngôn ngữ, mức kiên nhẫn — kết hợp NNNN personas); (2) **session runner** — sim user ↔ mya (CLI/TUI/intercom) nhiều lượt: user hỏi → mya trả/action → user feedback (đổi ý, làm rõ) — sinh realistic dialogue (langwatch); (3) **self-report & interview** — sau task: hỏi agent "đã hiểu gì, tại sao chọn X" (UXAgent Agent Interview) → chẩn đoán lỗi quyết định; (4) **metrics** — task success (53), số lượt cần, lượt hiểu nhầm, bỏ sót yêu cầu (JJJ); (5) **use** — chạy trong SSSS CI (nhánh chậm) + khi drift (ZZZZ) + cuando sửa prompt. Chống: sim user phải "ưa" như user thật (không phải dễ tính/khó tính bất kỳ — calibration NNNN/G).

## Kiến trúc

```
  PERSONA POOL (mục tiêu · trình độ · ngôn ngữ · kiên nhẫn)
        │
        ▼
  SESSION RUNNER (đa lượt — langwatch/galtea)
    user ──► mya (CLI/TUI/intercom) ──► action/trả lời
    user: đổi ý · hỏi lại · làm rõ · cắt lời (realistic)
        │
        ▼
  AFTER: AGENT INTERVIEW (UXAgent — "tại sao làm thế") → chẩn đoán quyết định
        │
        ▼
  METRICS: task success (53) · lượt cần · hiểu nhầm · bỏ sót yêu cầu (JJJ)
        │
  USE: SSSS CI (nhánh chậm) · ZZZZ drift trigger · đổi prompt — run sim
```

```
mya: eval + CLI/TUI sẵn — thiếu: user-sim runner + persona pool + interview
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval + 53 — task success (nơi chấm session)
// ✅ NNNN personas — persona pool bổ trợ
// ✅ CLI/TUI + intercom — giao diện tương tác (sim chạy trên đó)
// ✅ SSSS CI + ZZZZ drift — nơi chạy sim định kỳ
// ✅ QQQQ replay — xem session lại khi fail
// ✅ GGGG judge — chấm hội thoại (interview/multi-turn)

// ❌ THIẾU: session runner (LLM đóng user đa lượt)
// ❌ THIẾU: agent interview hook
// ❌ THIẾU: metric hiểu nhầm/bỏ sót yêu cầu
```

## Implementation

```typescript
// packages/eval/src/user-sim.ts (NEW)
interface SimUser { respond(message: string, ctx: SimCtx): string; assert(): Check[]; }

function runSession(user: SimUser, agent: Mya, steps = 20): SessionReport {
  let msg = user.firstTurn();                    // user mở
  for (let i = 0; i < steps; i++) {
    const reply = await agent.respond(msg);      // mya trả (CLI/TUI/intercom)
    msg = await user.respond(reply.output, { agentState: reply.state });
    if (user.done()) break;
  }
  const interview = await agent.selfExplain();   // UXAgent Agent Interview
  return { success: verify(agent.artifacts, 53), misunderstandings: user.flags, interview };
}
// persona pool: mục tiêu/độ kỹ/ngôn ngữ/kiên nhẫn (NNNN)
// use: SSSS nhánh chậm + ZZZZ (drift) + đổi prompt — chạy sim
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bắt lỗi hành vi đa lượt (case tĩnh không thấy) | ❌ Tốn LLM calls (session dài × personas) |
| ✅ Agent interview — hiểu "tại sao" (UXAgent) | ❐ Sim user ≠ user thật (cần calibrate) |
| ✅ Test UX hội thoại trước khi user phàn nàn | ❌ Session non-deterministic (n seeds — SSSS) |
| ✅ Nối NNNN/GGGG/SSSS/ZZZZ thành vòng đầy đủ | ❌ Interview thêm chi phí không luôn cần |

## Khác các hướng gần

| | NNNN Synthetic Case | UUUU Tool Mock | FFFFF: Sim User |
|---|---|---|---|
| Hình thức | Câu hỏi tĩnh | Tool giả | **Session đa lượt động** |
| Đổi gì | Case | Tool output | **Cả tương tác người dùng** |
| Mối quan hệ | Persona cung cấp | Chạy trong session | **Mở rộng cả hai** |

## Khi nào chọn

- Agent đối thoại với user nhiều (hoặc CLI wizard-like)
- Case tĩnh pass nhưng UX thật fail (hoigh)
- Đã có eval + CI — thêm sim runner
- Muốn hiểu "tại sao" agent làm sai (interview)