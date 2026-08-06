# Hướng DH: Learning from User Corrections — agent ngày càng hợp ý người dùng

> **Nguồn gốc:** "Learning Personalized Agents from Human Feedback" (Meta AI PAHF); RLHF → online preference 2026
> **Coupling:** 🟡 — vòng học cần cổng quyết định
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit/prompts sẵn; thiếu preference capture)
> **Effort:** 1-2 tuần

## Nguồn gốc

RLHF gốc (IBM/toloka): huấn luyện reward model từ feedback người → dùng tối ưu model. Với production agent 2026: ít ai retrain liên tục — thay bằng **online preference incorporation**: Meta **PAHF** — "continual personalization: agents learn online from live feedback"; ICLR 2026: "Agent Metric Induction from Open-Ended Human Feedback". Cách nhẹ không cần RL: **ghi correction → biến thành quy tắc/preference** (skill/prompt/memory) → áp dụng lần sau — gần "system prompt as reward function" (Anthropic/OpenAI/DeepSeek 2026 trend). Khác **BBBBB self-improve** (học từ eval/fail tự động — data *có cấu trúc*) — IIIII học từ *chỉnh sửa của người dùng* (phản hồi tự nhiên, hơi mơ hồ — "không, làm cách khác", sửa file, đổi params); khác **AAAAA negotiation** (thương lượng task) — IIIII là *điều chỉnh hành vi tương lai*.

## Mô tả

mya correction layer: (1) **capture** — nơi user chỉnh: chọn output khác, sửa artifact, xóa tool call, nói "sai cách", cho "thà thế kia" (khi dùng CLI/TUI/intercom — ghi row); (2) **classify** — correction về gì: format/style/phương pháp/đơn vị/ràng buộc/khẩu vị → loại preference; (3) **lưu** — preference có điều kiện áp dụng (task type, domain, str anchor) vào: prompt overrides (P), skill (YY — tạo skill "cách user thích"), memory (MM — ppc của user); (4) **consistency** — mâu thuẫn: preference mới vs cũ → ưu mới hơn/đúng ngữ cảnh, verify không phá task khác (BBBBB gate nhỏ); (5) **đo** — tỷ lệ phải chỉnh lại cùng 1 loại giảm dần (đỏ JJJ — nếu user vẫn chỉnh hoài = chưa học được). Hạn chế: không ghi đè ràng buộc an toàn (OO permissions, RRR rules — preference user không phủ policy).

## Kiến trúc

```
  USER CHỈNH (CLI/TUI/intercom — chọn output khác · sửa artifact · nói "sai cách")
        │
        ▼
  CAPTURE ──► CLASSIFY: format? method? unit? constraint? taste?
        │
        ▼
  LƯU PREFERENCE (kèm điều kiện áp dụng — task type/domain/ngữ cảnh)
    ├─ prompt overrides (P)
    ├─ skill mới (YY — "cách user thích X")
    └─ memory (MM — preference của user)
        │
  CONSISTENCY: mâu thuẫn? → ưu mới/đúng ngữ cảnh; không phá task khác (BBBBB gate)
        │
  ĐO: cùng loại correction lặp lại ↓ (JJJ) — học hiệu quả chưa
  RANH GIỚI: preference KHÔNG ghi đè OO permissions / RRR safety rules
```

```
mya: audit + prompts + memory SẸN — thiếu capture + classify + apply
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ VV audit + intercom — nguồn ghi hành vi chỉnh sửa
// ✅ P prompts + YY skills + MM memory — nơi lưu preference
// ✅ BBBBB gate — verify preference không vỡ task khác
// ✅ JJJ telemetry — đo correction lặp lại
// ✅ OO + RRR — ranh giới an toàn (preference không phủ)

// ❌ THIẾU: capture hook (bắt user chỉnh — đâu/sửa gì)
// ❌ THIẾU: classify preference (loại + điều kiện áp dụng)
// ❌ THIẾU: apply layer (overrides/skill/memory)
```

## Implementation

```typescript
// packages/personal/src/correction.ts (NEW)
type Correction = {
  when: string;            // bối cảnh task (QO trace link)
  whatChanged: string;     // user sửa gì (output/artifact/tham số)
  kind: "format" | "method" | "unit" | "constraint" | "taste";
};

function classify(c: Correction): Preference {
  return {                                   // LLM classify (PPPP rẻ)
    kind: c.kind,
    rule: verbalize(c.whatChanged),          // "luôn dùng đơn vị MB khi..."
    applies: condition(c.when),              // task type/domain/ngữ cảnh
  };
}

function apply(p: Preference, guard: { permissions; safety }): void {
  if (guard.safety.contains(p.rule.toAction()))
    return deny();                           // không phủ OO/RRR
  upsertPromptOverride(p);                   // P overrides
  createOrUpdateSkill(p);                    // YY core preference
}
// đo: corrections lặp cùng kind ↓ theo t (JJJ) — hiệu quả
// Meta PAHF: continual personalization — học online không cần RL nặng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent ngày càng hợp ý — ít phải nhắc lại (RLHF goal) | ❌ Correction mơ hồ — classify sai → áp dụng sai |
| ✅ Không cần RL/retrain (production 2026 style) | ❐ Mâu thuẫn preference cần policy rõ |
| ✅ Nối prompt override + skill + memory (nền có) | ❌ Có thể overfit 1-2 lần chỉnh (kỷ luật gate) |
| ✅ Ranh giới an toàn giữ (không phủ OO/RRR) | ❌ Đo "hết phải chỉnh" cần thời gian (JJJ trend) |

## Khác các hướng gần

| | BBBBB Self-Improve | MM Memory | IIIII: Corrections |
|---|---|---|---|
| Feedback | Eval/fail (cấu trúc) | Lịch sử | **User chỉnh (tự nhiên)** |
| Cơ chế | Gate+apply | Ghi/đọc | **Classify → preference → apply** |
| Vai trò | Kỹ thuật | Lưu | **Cá nhân hóa hành vi** |

## Khi nào chọn

- Người dùng phải sửa đi sửa lại 1 việc (JJJ detect)
- Có channel ghi hành vi chỉnh sửa (CLI/TUI/intercom)
- Nền prompt/skill/memory sẵn — thêm capture+classify
- Chấp nhận gate để preference không vỡ task khác