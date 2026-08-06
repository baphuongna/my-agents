# Hướng FL: Agent Guardrails Layer — rào chắn an toàn system-level cho agent tự động

> **Nguồn gốc:** arXiv 2601.18491 "AgentDoG: A Diagnostic Guardrail Framework" (18 cites — fine-grained contextual monitoring, diagnose root causes of unsafe actions); IBM "What Are AI Guardrails"; Galileo "AI Agent Guardrails Framework" (system-level safety controls); McKinsey (organizational standards/policies/values)
> **Coupling:** 🟡 — mọi hành động agent phải qua guardrail
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (policy + perms + audit sẵn; thiếu guardrail layer)
> **Effort:** 2-4 tuần

## Nguồn gốc

Guardrails: **rào chắn system-level — chặn hành động vượt ranh giới an toàn trước khi thực thi** — AgentDoG (arXiv 2601.18491, 18 cites): "provides fine-grained and contextual monitoring across agent trajectories — diagnose the root causes of unsafe actions" (guardrail biết chẩn đoán, không chỉ chặn); IBM: "safeguards that keep AI systems operating safely, responsibly and within defined boundaries"; Galileo: "system-level safety controls that constrain autonomous behavior within acceptable operational boundaries"; McKinsey: đảm bảo "reflect organizational standards, policies, and values". Điểm khác **WW policy** (khung luật — tham chiếu khi quyết) và **UUUU perms** (phân quyền — ai được làm gì) — MMMMMMM *chặn chủ động theo thời gian thực*: (1) ranh giới — định nghĩa acceptable boundaries (Galileo: input/output/action/context); (2) check trước khi hành động — tool call/API/file access qua guardrail (IBM defined boundaries); (3) diagnostic — khi chặn: ghi trajectory + chẩn đoán root cause (AgentDoG — không chỉ "không được" mà "tại sao"); (4) escalation — hành động ranh giới mờ → dừng hỏi (CCCC — pause ask confirmation, confidence thấp); (5) tổ chức — phản ánh chính sách công ty (McKinsey values); (6) học — unsafe action log → thêm guardrail (WW policy mở rộng).

## Kiến trúc

```
  HÀNH ĐỘNG agent (tool call/API/file/action)
        │
        ▼
  GUARDRAIL LAYER (Galileo system-level · IBM defined boundaries)
   · INPUT guard: dữ liệu vào (prompt injection — QQQQQ)
   · OUTPUT guard: kết quả (PII, nội dung) 
   · ACTION guard: tool call an toàn (UUUU perms + WW policy)
   · CONTEXT guard: ngữ cảnh (AgentDoG contextual monitoring)
        │
        ├── QUA → thực thi
        ├── CHẶN → AgentDoG diagnostic (root cause + trajectory)
        └── MỜ → CCCC pause ask confirmation (confidence thấp)
        │
        ▼
  HỌC: unsafe log → mở rộng WW policy (McKinsey standards/values)
```

```
mya: WW + UUUU + CCCC + QQQQQ SẸN — thiếu: guardrail enforcement layer
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ WW policy — khung luật (nền ranh giới)
// ✅ UUUU perms — ai làm gì (action guard)
// ✅ CCCC HITL — dừng hỏi người (escalation)
// ✅ QQQQQ prompt injection defense — input guard
// ✅ VV audit — ghi lại hành động (trajectory)
// ✅ QQQQ trace — theo dõi (AgentDoG monitoring)

// ❌ THIẾU: guardrail enforcement layer (check trước mọi action)
// ❌ THIẾU: AgentDoG diagnostic (root cause của unsafe action)
// ❌ THIẾU: guard learning (unsafe log → policy mở rộng)
```

## Implementation

```typescript
// packages/guardrails/src/layer.ts (NEW)
export class Guardrails {
  async check(action: Action, ctx: Context): Promise<Verdict> {
    if (!perms.allow(action, ctx.user)) return block(action, "perms");   // UUUU
    if (inject.detect(ctx.input)) return block(action, "injection");     // QQQQQ
    if (confidence(ctx) < THRESHOLD) return askHuman(action, ctx);       // CCCC
    return allow(action); // Galileo: acceptable operational boundaries
  }
  // AgentDoG: block → diagnose(action, ctx) — root cause + trajectory log
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tự động vẫn an toàn — chặn trước khi hại (Galileo) | ❌ Mọi action qua guardrail — thêm latency/chi phí |
| ✅ Chẩn đoán được gốc rễ unsafe action (AgentDoG) | ❐ Guard quá chặt → agent kẹt — tỷ lệ false positive |
| ✅ Phản ánh chính sách tổ chức (McKinsey) | ❌ Định nghĩa ranh giới khó — vùng mờ |
| ✅ Xây trên WW + UUUU + CCCC + QQQQQ | ❌ Guardrail chỉ chặn đúng cái đã biết |

## Khác các hướng gần

| | WW Policy | UUUU Perms | MMMMMMM: Guardrails |
|---|---|---|---|
| Loại | Khung luật (quyết định) | Phân quyền | **Thực thi chặn real-time** |
| Lúc | Khi plan | Khi gọi | **Mọi hành động** |
| Quan hệ | Nguồn luật | Action guard | **Lớp enforce + diagnose trên cả 2** |

## Khi nào chọn

- Agent tự động có quyền gây hại (tool/API/file — hệ thống quan trọng)
- Cần chặn theo chính sách tổ chức (McKinsey)
- Muốn biết *tại sao* bị chặn (AgentDoG diagnostic)
- Đã có WW + UUUU + CCCC + QQQQQ — thêm enforce + learn