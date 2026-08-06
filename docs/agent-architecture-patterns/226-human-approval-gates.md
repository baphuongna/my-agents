# Hướng SSSSSSSS: Human Approval Gates — agent dừng ở cổng duyệt trước hành động rủi ro, không tự submit/pay/sign

> **Nguồn gốc:** MindStudio "The Gate Pattern — Prepare, Don't Submit" ("gate pattern stops AI agents before they submit, pay, or sign — why essential for high-trust agentic"); agentic-patterns "Human-in-the-Loop Approval Framework" ("insert human approval gates for designated high-risk functions while maintaining autonomy for safe ops"); LangGraph HITL (state-managed interruptions — agent pause for human approval); StackAI "Approval Workflows" ("keep workflows fast for low-risk — enforce approval gates for high-risk"); Nylas "Build HITL Email Agent" (approval gate = review script: list drafts, wait reviewer)
> **Coupling:** 🟡 — chạm những nơi hành động có tác động (submit/pay)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (HITL cơ bản — chưa approval gate chuẩn)
> **Effort:** 2-4 tuần

## Nguồn gốc

Approval gates: **phân loại hành động theo rủi ro: việc an toàn agent tự làm; *critical* (pay, submit, sign, delete) dừng lại — tạo bản xem trước, chờ người duyệt, chỉ apply khi đồng ý** — MindStdio: "prepare, not submit" — gate cho submit/pay/sign; agentic-patterns: "insert approval gates for high-risk functions, maintain autonomy for safe ops"; LangChain: "state-managed interruptions — pause for approval"; StackAI: "fast for low-risk, strict gates high-risk"; Facebook: "biggest risks come from missing approval gates, not bad prompts". Khác **HITL (có trong repo 48-HITL?)** (human trong vòng mọi lúc) — SSSSS *chỉ hành động rủi ro*, phần còn lại tự chạy; **escalation-tree** (khi lỗi — nhấp người) — SSSS trước khi hành động; **199 delegation** (phạm vi — khác). Kết nối: **198 audit** (duyệt ghi dấu ai duyệt), **199 delegation** (người giao quyền), **64 trust**; mya tool có nhiều thao tác — đã cần gate ở chi, xóa.

## Kiến trúc

```
  AGENT HÀNH ĐỘNG ─► CLASSIFY (rủi ro)
        ├── low-ok → tự làm (audit ghi)
        └── high (submit/pay/sign/xóa) → HOLD
              │
              ▼
  PREVIEW (bản chuẩn bị: draft/cam kết/ảnh hưởng — "prepare not submit")
              │
              ▼
  APPROVAL (user review + Duyệt | Sửa | Từ chối)
              │
              ▼
  APPLY (chỉ khi duyệt — ghi audit: ai, lúc nào, tóm tắt)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ HITL cơ bản — khi module cần
// ✅ 124 approval cho mọi "summit"/"understand" (vài tool)
// ✅ 221 flags — đối soát hành vi (nền)
// ✅ 214 PII — dữ liệu xử trước (nền)

// ❌ THIẾU: phân loại rủi ro (auto-label high-risk actions)
// ❌ THIẾU: pre-approval review mẫu (preview chuẩn — ai duyệt thấy gì)
// ❌ THIẾU: luồng duyệt chuyên (reviewer xem => mà kết quả to convenc lai)
```

## Implementation

```typescript
// packages/approval/src/gate.ts (NEW)
export async function gated(action: Action, risk: RiskPolicy): Promise<Result> {
  if (!risk.high(action)) return execute(action);          // tự chạy — low-risk
  const preview = await preparePreview(action);           // "prepare, not submit"
  const v = await review.wait(preview, { role: risk.reviewer }); // gate
  if (v.kind === "approve") return execute(action);       // duyệt → apply
  if (v.kind === "edit") return gated(v.edited, risk);    // sửa lại
  return { declined: true };                               // chặn — audit ghi
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ An toàn với submit/pay/sign — người kiểm mọi critical (MindStudio) | ❌ Chậm — việc "gấp" phải chờ người duyệt |
| ✅ Tự động tốt chỗ low-risk — chỉ chậm high-risk | ❌ Preview không đủ — người duyệt "tiện" dễ qua loa |
| ✅ Trách nhiệm rõ — audit "ai duyệt gì" | ❌ Nếu agent quét nhầm high→loạn giấy |
| ✅ Xây trên 132/198/221 | ❌ Vận hành cổng — nhiều sản cho cần quản lý |

## Khác các hướng gần

| | 132 HITL | Escalation | SSSSSSSS: Gate |
|---|---|---|---|
| Mục | Con người trong vòng | Chuyển khi lỗi | Chặn trước hành động rủi ro |
| Vị trí | Toàn bộ/phê | Lỗi xảy ra | Trước hành động rủi ro |
| Quan hệ | Tổng quát | Sau | **Đúng cửa — cao giá trị** |

## Khi nào chọn

- Agent có thể gửi email thanh toán/submit ghép, delete — một lần sai là hại
- Đã có HITL/audit — muốn chuẩn hoá ở điểm quyết định
- Khi nào: xóa vĩnh viễn, chuyển tiền, phát hành công chúng
- Luôn: preview đủ (nhìn thấy cái gì sẽ xảy ra) — không hỏi mù