# Hướng HS: Agent Notification & Alerts — agent chủ động nhắc user qua Slack/email/push khi có chuyện cần

> **Nguồn gốc:** Sequenzy "12 Best Notification APIs for AI Agents 2026" (Knock — "manage product notifications across in-app, email, push, Slack, SMS, chat"); Slack/Wrike "AI Agent Notifications" (agent gửi đến Slack/Teams channels qua connected account); MindStudio community "SMS notify khi pending Input Block" (agent cần input user — gửi SMS kèm nội dung); quickchat "Human Handoff Notification" (ping team Slack khi user cần trợ giúp); Reddit "notification relay hub — MCP endpoint để agent deliver notifications"
> **Coupling:** 🟢 — tách riêng, agent gọi khi cần — một tool
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (thông báo cơ bản — chưa đa kênh)
> **Effort:** 2-4 tuần

## Nguồn gốc

Notifications: **agent chủ động đẩy thông tin/đòi hành động tới user qua nhiều kênh (email/Slack/SMS/push) — không bắt user phải mở session — đúng khi: tác vụ lâu xong, agent cần input, alert quá ngưỡng** — Sequenzy: multi-channel notifications build; quickchat: "ping user khi cần trợ giúp"; Slack: gửi tới channel/connected account; MindStudio: SMS khi cần input. Khác **event-stream 12 / streaming** (đẩy kết quả trong session realtime); TTTT là *đa kênh, không đồng bộ, khi cần sự chú ý người* (out-of-band). Khác **scheduled-agents** (tự chạy định kỳ — không đẩy kênh) — TTTT là đẩy đa kênh. Kết nối: **221 flags** (cho phép), **webhook/Slack** — tích ngoài, mya — thiếu đa kênh (chỉ terminal/log) — cần khi agent chạy nền.

## Kiến trúc

```
  AGENT (tác vụ dài / cần input / đạt ngưỡng / lỗi)
        │
        ▼
  NOTIFY POLICY (khi nào, kênh nào — mức độ, user pref)
        │
  ┌──────► SMS (urgent — input cần)
  │       ► Slack/MS Teams (việc nhóm)
  │       ► Email (tổng kết)
  │       ► Webhook (hệ tích hợp ngoài)
        ▼
  USER (nhận + (nếu cần) trả lời/yêu cầu trong kênh)
```

```
mya: ra kết quả trong terminal — chưa push kênh ngoài
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 12 event-stream — đẩy kết quả trong phiên (nền)
// ✅ scheduled-agents — chạy định kỳ (nền)
// ✅ 129/208 — cần đẩy kết quả nền
// ✅ 132 HITL — khi cần người

// ❌ THIẾU: provider push (Slack/email/SMS/Webhook) — publisher
// ❌ THIẾU: policy kênh (mức ưu tiên tới kênh khác nhau)
// ❌ THIẾU: idempotent — không spam/mass nhắc nhiều lần
```

## Implementation

```typescript
// packages/notify/src/notify.ts (NEW)
export class Notifier {
  async alert(s: SubjectAlert): Promise<void> {
    const ch = selectChannel(s.severity, user.prefs);     // policy — kênh
    await dedup(s);                  // không gửi trùng trong window
    await provider.send(ch, compose(s, { sender: "agent" }));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ User không phải chờ — agent chủ động nhắc (Slack/Wrike) | ❌ Ngộ: spam chuyển nhạt — cần đúng lực, đúng kênh |
| ✅ Đa kênh — input/alert tới đúng nơi user ở (Sequenzy) | ❌ Quản kênh credentials/bảo mật |
| ✅ Tác vụ dài có nghĩa — user rời đi vẫn được bắt | ❌ "Alert fatigue" nếu overuse |
| ✅ Đơn giản — nối các tầng nền có sẵn | ❌ Không khách nếu agent không có gì quan trọng | 

## Khác các hướng gần

| | 132 HITL | 12 Stream | TTTTTTTT: Notify |
|---|---|---|---|
| Mục | Duyệt | Đẩy realtime | **Đa kênh — bất đồng bộ** |
| Kênh | Trong phiên giao | Trong phiên | **Ngoài — Slack/email/SMS** |
| Quan hệ | Điều kiện — trả | Khi chạy | Bổ trợ — khi cần ý người |

## Khi nào chọn

- Agent chạy nền lâu (nghiên cứu, đào, đợi người) — kết quả cần báo
- Người không luôn nhìn terminal/hộp chat
- Task cần sự can thiệp (approval, input mới)
- Không khi: agent tương tác trực tiếp đúng lúc — thông báo là nhiễu