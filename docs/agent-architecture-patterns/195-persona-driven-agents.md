# Hướng NNNNNNNN: Persona-Driven Agents — agent có tính cách nhất quán: tone/style/vai trò bền qua phiên

> **Nguồn gốc:** arXiv 2406.17962 "Persona-Driven Role-Playing Agent Framework" (simulate characters qua personalised characteristic features); ACL 2025 "Enhancing Persona Consistency" (Ji — 38 cites — chain of persona, self-questioning); Zylos "AI Agent Persona Design and Behavioral Consistency" (coherent identity, personality, behavioral consistency across sessions); learnprompting (Role prompting — guide style/tone/focus); reddit r/PromptEngineering (personas chủ yếu cho tone & style, không phải expertise)
> **Coupling:** 🟢 — lớp prompt/persona, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (prompt config + agent config sẵn; thiếu persona manager)
> **Effort:** 1-2 tuần

## Nguồn gốc

Persona-driven: **agent có tính cách rõ — persona định nghĩa tone/style/vai trò, giữ nhất quán qua mọi phiên, không "trôi" persona** — arXiv 2406.17962: LLM simulate characters qua personalised characteristic features; ACL 2025 (38 cites): "LLMs are known to drift from their assigned personas — chain of persona để self-questioning, giảm inconsistency 55%+"; Zylos: "maintain coherent identity, personality, and behavioral consistency across sessions, contexts, multi-turn"; learnprompting: role prompting gán persona (teacher/salesperson) để guide style; reddit: "personas are mainly useful for tone and style, not expertise" (đừng nhầm persona với năng lực). Điểm khác **KKKKKK personalization** (nhớ sở thích USER — dữ liệu cá nhân) và **NNNNNNNN? persona** — NNNNNNNN *nhân vật của agent*: (1) persona profile — cấu hình: vai trò (role), tone (ngôn ngữ), style (cách trình bày), ràng buộc giao tiếp (không hứa hẹn, không lạm dụng), persona consistency (Zylos); (2) injection — persona vào system prompt (learnprompting — guide style/tone); (3) consistency guard — agent "trôi" persona khi dài (ACL — chain of persona/self-check), phát hiện + nhắc lại; (4) persona per agent — agent khác nhau persona khác nhau (sales vs support — 172 team config), per user (KHÔNG trộn user prefs — KKKKKK ở lớp khác); (5) eval — đo consistency (PP — test persona qua multi-turn); (6) version — persona là prompt có version (FFFFF + RRRRRRR A/B tone nào tốt). Nối KKKKKK (personalization — phân biệt: user prefs vs agent persona), RRRRRRR (A/B persona), FFFFFF (version), PP (đo consistency), WWWWWW (intent — persona hướng cách trả lời), 172 (team — persona per member), CCCC (HITL — persona trong kênh support).

## Kiến trúc

```
  PERSONA PROFILE (cấu hình — Zylos behavioral consistency)
   · role (learnprompting: teacher/sales) · tone · style · giới hạn giao tiếp
        │
        ▼
  INJECT (learnprompting — role prompting): persona vào system prompt
        │
        ▼
  CONSISTENCY GUARD (ACL 2025 — chain of persona + self-check)
   · multi-turn dài → agent trôi persona → phát hiện + nhắc lại (giảm 55%)
        │
        ▼
  PERSONA PER AGENT (172 — sales/support khác nhau) · per user riêng (KKKKKK)
        │
        ▼
  VERSION + A/B (RRRRRRR — tone nào tốt) · PP đo consistency (multi-turn test)
```

```
mya: prompt config + FFFF SẴN — thiếu: persona manager + consistency guard
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ Prompt config — system prompt (nền chứa persona)
// ✅ FFFFFF versioning — version prompt/persona
// ✅ RRRRRRR A/B — test tone/style nào tốt
// ✅ PP eval — đo (multi-turn consistency test)
// ✅ KKKKKK personalization — user prefs (lớp khác)
// ✅ 172 team config — agent khác nhau (persona per member)

// ❌ THIẾU: persona profile (cấu hình chuẩn hóa — role/tone/style)
// ❌ THIẾU: consistency guard (chống drift — ACL)
// ❌ THIẾU: persona eval (multi-turn — PP chuyên)
```

## Implementation

```typescript
// packages/persona/src/persona.ts (NEW)
export class PersonaManager {
  prompt(p: Persona): SystemPrompt {
    return { role: p.role, tone: p.tone, style: p.style,   // learnprompting
             constraints: p.bounds };                        // giới hạn giao tiếp
  }
  async guard(run: Session, p: Persona): Promise<void> {
    if (drift.detect(run.history, p))                        // ACL: self-questioning
      await remind(run, p);                                  // nhắc lại persona
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Trải nghiệm nhất quán — agent "có tính cách" (Zylos) | ❌ Persona quá chặt → trả lời cứng nhắc |
| ✅ Chống drift — tự nhắc persona khi lệch (ACL −55%) | ❐ Thêm 1 lớp guard — cost mỗi phiên |
| ✅ Tone đúng kênh (support dịu, kỹ thuật ngắn gọn) | ❌ Người mới hiểu nhầm persona = năng lực (reddit) |
| ✅ Xây trên prompt + FFFF + RRRRRRR | ❌ Multi-user — 1 persona không hợp mọi người |

## Khác các hướng gần

| | KKKKKK Personalization | 172 Team | NNNNNNNN: Persona |
|---|---|---|---|
| Đối tượng | Sở thích USER | Vai trò agent | **Tính cách agent (tone/style)** |
| Loại | Dữ liệu | Cấu hình team | **Nhân vật + consistency** |
| Quan hệ | Lớp khác | 1 thành phần | **Bền qua phiên — khác 2 bên** |

## Khi nào chọn

- Sản phẩm cần cá tính — support/assistant với tone nhất định
- Agent trôi persona khi hội thoại dài (cần guard — ACL)
- Nhiều kênh/đối tượng — mỗi kênh 1 persona (A/B tone)
- Đã có prompt config + FFFF + RRRRRRR — thêm manager + guard