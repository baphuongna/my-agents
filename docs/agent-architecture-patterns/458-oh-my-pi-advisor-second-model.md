# Hướng QP: Advisor Second-Model — model 2 chạy mọi lượt context riêng, góp ý, agent chính từ chối được

> **Nguồn gốc:** oh-my-pi (pi-coding-agent); "shadow advisor model"; "second-model review every turn"; "advisor critiques in isolated context"; "primary agent may reject advice"; "LLM-as-judge variant"
> **Coupling:** 🟡 — thêm advisor sub-loop song song với main loop (mỗi lượt → advisor context riêng)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/council multi-model + 079 hindsight sẵn — chưa có per-turn advisor shadow loop)
> **Effort:** 3-4 tuần

## Nguồn gốc

**oh-my-pi** giới thiệu **advisor second-model**: một model thứ 2 (thường rẻ hơn hoặc khác gia đình) **chạy mọi lượt** nhưng trong **context riêng** (không ôm toàn bộ lịch sử — chỉ snapshot quyết định hiện tại). Advisor **góp ý** (đánh giá bước tiếp theo: an toàn? đúng? tối ưu?). **Agent chính có quyền từ chối** lời khuyên — advisor là **cố vấn, không phải chốt**. Nguyên tắc: **tách critique khỏi execution** — model thực thi không tự phê (confirmation bias), model cố vấn nhìn từ context gọn hơn nên thấy cái model chính bỏ sót. Khác **084 llm-as-judge** (judge cuối task) — QP là **per-turn shadow**; khác **375 council** (đa model bỏ phiếu) — QP là **1 primary + 1 advisor, primary quyết**.

## Mô tả

mya advisor second-model: (1) **Shadow**: mỗi lượt agent chính sắp hành động → snapshot (user-request + bước dự định + context tối thiểu) gửi tới advisor. (2) **Critique**: advisor (model rẻ như haiku, hoặc model mạnh hơn cho critical step) trả lời "OK" / "cảnh báo: X" / "đề xuất: Y". (3) **Gate**: nếu advisor báo **risk** (destruction, hallucination, off-track) → agent chính **dừng hoặc hỏi user**. (4) **Reject-able**: agent chính **có thể từ chối** ("advisor khuyên đổi tool nhưng tôi đã xác nhận path đúng"). (5) **Cost control**: advisor context nhỏ (snapshot, không full history) → rẻ. mya có `packages/council` (multi-model) + `079 hindsight` — QP thêm **per-turn shadow loop** + **advice gating** + **primary-reject mechanism**.

## Kiến trúc

```
  MAIN LOOP (agent chính, full context):
  ┌─────────────────────────────────────────────────────┐
  │  turn N: agent quyết định "rm -rf build/"            │
  └───────────────────────┬─────────────────────────────┘
                          │ (snapshot: intent + planned action)
                          ▼
  ┌─── ADVISOR SHADOW (model 2, context riêng, gọn) ───┐
  │  input: { goal, planned: "rm -rf build/", cwd }    │
  │  advisor: "⚠ CẢNH BÁO: rm -rf có thể xóa ngoài      │
  │   scope nếu cwd sai. Đề xuất: dùng 'cargo clean'    │
  │   hoặc rm build/* cụ thể"                            │
  └───────────────────────┬─────────────────────────────┘
                          │ (advice)
                          ▼
  ┌─── GATE (primary agent đánh giá lời khuyên) ────────┐
  │  advisor RISK? → YES → primary quyết:               │
  │    · ACCEPT  → đổi action ("cargo clean")            │
  │    · DEFER   → hỏi user confirm                       │
  │    · REJECT  → "đã verify cwd, tiếp tục" (có lý do)   │
  │  advisor OK?  → YES → proceed original action        │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/council — multi-model coordination (nền — QP = 1+1 shadow)
// ✅ 079 hindsight — post-hoc review (nền — QP = pre/turn review)
// ✅ 394 safeguard-tiering — model tiering (nền — QP advisor = tier khác)
// ✅ 124 dynamic-permissions — gate (nền — QP advice → gate)

// ❌ THIẾU: per-turn shadow loop (snapshot mỗi lượt → advisor)
// ❌ THIẾU: advice gating (risk → stop/ask; ok → proceed)
// ❌ THIẾU: primary-reject mechanism (agent chính override advice + lý do)
// ❌ THIẾU: snapshot compactor (full context → advisor minimal context)
```

## Implementation

```typescript
// packages/agent/src/advisor-shadow.ts (MỚI)
type Advice = { verdict: 'ok' | 'warn' | 'block'; reason: string; suggestion?: string };

interface AdvisorShadow {
  advisorModel: string;  // e.g. 'haiku' (cheap) or 'opus' (critical)
  // Snapshot = minimal context (không full history)
  snapshot(turn: AgentTurn): { goal: string; planned: string; cwd: string };
}

async function runAdvisor(
  advisor: AdvisorShadow,
  turn: AgentTurn,
  query: (model: string, prompt: string) => Promise<string>,
): Promise<Advice> {
  const snap = advisor.snapshot(turn);
  const prompt = `You are a safety advisor. Critique this planned action.
Goal: ${snap.goal}
Planned: ${snap.planned}
CWD: ${snap.cwd}
Reply JSON: { "verdict": "ok"|"warn"|"block", "reason": "...", "suggestion": "..." }
Be concise. Flag destruction, off-track, or hallucination risk only.`;
  const raw = await query(advisor.advisorModel, prompt);
  return JSON.parse(raw) as Advice;
}

// Gate logic in main loop
async function applyAdvice(
  advice: Advice,
  execute: () => Promise<void>,
  askUser: (msg: string) => Promise<boolean>,
): Promise<{ acted: boolean; rejected?: string }> {
  if (advice.verdict === 'ok') {
    await execute();
    return { acted: true };
  }
  if (advice.verdict === 'block') {
    const ok = await askUser(`Advisor blocked: ${advice.reason}. Proceed anyway?`);
    if (!ok) return { acted: false };
  }
  // warn → primary decides; reject allowed with reason
  await execute();
  return { acted: true, rejected: advice.suggestion }; // primary may ignore suggestion
}

// Usage:
// const advice = await runAdvisor(advisor, currentTurn, provider.query);
// await applyAdvice(advice, () => runTool('bash', cmd), confirm);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát confirmation-bias (model chính không tự phê tốt) | ❌ Chi phí (mỗi lượt +1 call advisor) |
| ✅ Advisor context gọn → thấy cái primary bỏ sót | ❌ Advisor sai → noise/false-alarm (primary từ chối liên tục) |
| ✅ Primary giữ quyền chốt (không bị advisor cướp quyền) | ❌ Latency (+1 round-trip mỗi lượt) |
| ✅ Cost control (advisor = cheap tier + minimal context) | ❌ Snapshot lỗi (thiếu context → advice mơ hồ) |

## Khác các hướng gần

| | 084 LLM-as-Judge | 375 Council | 079 Hindsight | QP: Advisor-Shadow |
|---|---|---|---|---|
| Khi | Cuối task | Quyết định khó | Post-hoc | **Mỗi lượt** |
| Quyền | Chấm điểm | Bỏ phiếu | Phân tích | **Cố vấn, primary chốt** |
| Context | Đầu ra | Shared | Full trace | **Snapshot riêng (gọn)** |

## Khi nào chọn

- Agent dễ confirmation-bias (model tự tin sai, không tự phê)
- Task rủi ro (destruction, irreversible) cần second opinion mỗi bước
- Có budget cho advisor (cheap tier + minimal context)
- Nối packages/council (advisor = 1 member shadow) + 394 safeguard-tiering (advisor tier) + 124 dynamic-permissions (advice → gate); primary-reject mechanism quan trọng — advisor cố vấn, không chốt; guard snapshot quality + false-alarm
