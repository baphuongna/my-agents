# Hướng BT: LLM Red Teaming — tấn công chủ động để đo phòng thủ

> **Nguồn gốc:** Microsoft PyRIT (2024); arXiv 2605.04019 "Redefining AI Red Teaming in the Agentic Era" (2026); garak; Cloud Security Alliance
> **Coupling:** 🟢 — harness ngoài, không đụng core
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval + audit sẵn; thiếu attack harness + attack library)
> **Effort:** 1-2 tuần

## Nguồn gốc

LLM red teaming — **tấn công có chủ đích** agent để phát hiện lỗ hổng bảo mật *trước khi attacker thật*: jailbreak (vượt rào), prompt injection (trực tiếp + gián tiếp), refusal bypass, exfiltration, tool abuse. Microsoft PyRIT (2024): framework mở tự động hóa — orchestrates **multi-turn adversarial dialogue**, sinh attack prompts, scoring, logging, chạy trong CI/CD. arXiv 2605.04019 (2026) "Redefining AI Red Teaming in the Agentic Era": trong hệ agentic, attack không chỉ ở prompt — nhắm cả **tool call, memory, inter-agent communication**. Khác **RRR Firewall** (phòng thủ — chặn) — red team là *tấn công* để kiểm tra phòng thủ; khác **OOO Chaos** (lỗi hạ tầng/độ chịu lỗi) — red team nhắm **bảo mật** và có thể làm đối thủ thông minh (LLM tấn công LLM).

## Mô tả

mya chạy **attack campaigns** (gắn PP + OOO): attack agent đóng vai attacker (có thể là LLM riêng, tier small qua RR) sinh ra các **attack sequence** — prompt injection ẩn trong dữ liệu tool trả về (gián tiếp), jailbreak cho lệnh nguy hiểm, ép đọc secret (nối KKK), ép tool ngoài scope (OO) — chạy qua agent thật trong môi trường test → **scoring**: agent có làm theo lệnh độc không? có lộ secret không? có escalate quyền không? → log vào audit → **so sánh sau khi vá** (red team lại để chứng minh phòng thủ hoạt động). PyRIT-style: attack prompts sinh tự động + multi-turn, không chỉ 1 prompt. Kết quả nuôi RRR firewall rules + VV anti-patterns.

## Kiến trúc

```
  ATTACK HARNESS (ngoài, định kỳ — cron)
  ├─ ATTACKER AGENT (LLM riêng): sinh attack sequence
  │    jailbreak · injection trực tiếp · injection gián tiếp
  │    (ẩn trong tool output) · exfiltration ép đọc secret · tool abuse
  │    multi-turn: đáp lại từng phản hồi của agent (PyRIT-style)
  ▼
  AGENT THẬT (test env, tool call thật nhưng an toàn)
      │  bị quan sát: làm theo lệnh độc? lộ secret? gọi tool ngoài scope?
      ▼
  SCORING + AUDIT (packages/audit)
      │  kết quả → rào thêm cho RRR firewall · VV playbook · OO rules
      ▼
  VÁ LỖ HỔNG ──► RED TEAM LẠI (chứng minh đã vá)
```

```
mya: packages/eval (chạy campaign) + packages/audit (ghi) + RRR/OO (đối tượng đo) sẵn
     thiếu: attack harness (multi-turn) + attack prompt library + scoring
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — chạy campaign (nền harness)
// ✅ packages/audit — ghi toàn bộ hành vi (nơi phân tích hậu attack)
// ✅ OO roles + RRR firewall — đối tượng cần đo (đã có phòng thủ)
// ✅ KKK credential broker — secret không chạm agent (attack này phải fail)
// ✅ OOO chaos — cùng harness, khác loại lỗi (hạ tầng vs bảo mật)

// ❌ THIẾU: attacker agent (LLM sinh attack + multi-turn)
// ❌ THIẾU: attack library (jailbreak/injection/exfiltration templates) + scoring
// ❌ THIẾU: CI gate — tái attack sau mỗi vá lỗi
```

## Implementation

```typescript
// packages/eval/src/redteam.ts (NEW)
interface Attack {
  kind: "jailbreak" | "direct-injection" | "indirect-injection" | "exfiltration" | "tool-abuse";
  turns: string[];                     // multi-turn sequence (PyRIT-style)
}

interface RedTeamResult {
  followedMalicious: boolean;          // agent làm theo lệnh độc?
  leakedSecret: boolean;               // lộ secret? (KKK phải chặn)
  calledOutOfScope: boolean;           // tool ngoài quyền? (OO)
  score: number;
}

async function redTeam(agent, suite: Attack[]): Promise<RedTeamResult[]> {
  return suite.map(async (a) => {
    const conv = await agent.dialogue(a.turns, { safeTools: true });
    return score(conv, a);             // audit log + scoring
  });
  // CI gate: score tụt → chặn release (giống OOO masking gate)
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện lỗ hổng trước attacker thật | ❌ Attack suite phải cập nhật theo tấn công mới |
| ✅ Multi-turn (PyRIT) — bắt lỗi 1-prompt không thấy | ❌ False alarm: agent từ chối hợp lệ bị tính "bị tấn công" |
| ✅ Đo trực tiếp RRR/OO/KKK có hoạt động | ❌ Test env phải an toàn thật (tool call thật nhưng không gây hại) |
| ✅ Audit sẵn — tái hiện attack từng bước | ❌ Attacker LLM sinh attack chất lượng thấp → kết quả ảo |
| ✅ Sau vá → red team lại chứng minh | |

## Khác các hướng gần

| | RRR Firewall | OOO Chaos | UUU: Red Teaming |
|---|---|---|---|
| Vai trò | Phòng thủ | Đo chịu lỗi | **Tấn công chủ động** |
| Nhắm gì | Injection vào luồng | Lỗi hạ tầng | **Bảo mật** (jailbreak, lộ secret) |
| Đối thủ | Không | Fault template | **LLM attacker multi-turn** |
| Mối quan hệ | Đối tượng được đo | Cùng harness | Kết quả nuôi RRR + VV |

## Khi nào chọn

- Agent đọc dữ liệu không tin cậy (web/MCP) — nguy cơ indirect injection
- Muốn chứng minh RRR/OO/KKK hoạt động bằng số liệu
- Muốn CI gate bảo mật (tái attack sau mỗi vá lỗi)
- Đã có eval + audit — thêm harness + attacker