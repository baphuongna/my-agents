# Hướng AAP: Cross-Harness Blocking Ask — dùng blocking question tool theo platform, fallback chat khi không có tool

> **Nguồn gốc:** compound-engineering-plugin (plugins/compound-engineering/skills/ce-plan/SKILL.md) | **Coupling:** 🟢 — thêm question-tool adapter, không đụng agent core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có approval channel — chưa có question tool registry theo platform) | **Effort:** 1-2 tuần

## Nguồn gốc

**compound-engineering-plugin** dùng **blocking question tool theo platform**: **AskUserQuestion** cho Claude Code, **request_user_input** cho Codex, **ask_user** cho Gemini/Pi. Khi cần hỏi người dùng (clarify, chọn hướng), agent **bắt buộc dùng tool blocking** — **chỉ fallback ra chat khi không có tool** — **không bao giờ skip câu hỏi** (hỏi xong mới làm tiếp). Nguyên tắc: **hỏi đúng tool = chờ được + parse được đáp án**; chat fallback chỉ khi tool không tồn tại, và không được âm thầm đoán thay người dùng.

## Mô tả

mya cross-harness blocking ask: packages/tools approval.ts đã có ApprovalChannel (humanPrompt callback). AAP thêm **question tool registry**: `{ platform, ask(question, options) → Answer }` — adapter cho AskUserQuestion (Claude Code), request_user_input (Codex), ask_user (Gemini/Pi), và mya native (approval channel / TUI modal). Khi plan/review cần clarify: **chọn tool theo platform đang chạy** (detect từ runtime env), gọi blocking — chờ đáp án; không có tool → fallback chat message nhưng **đánh dấu rõ "cần trả lời"** và không tiếp tục với giả định. Never skip: nếu câu hỏi chưa trả lời, loop dừng (không đoán).

## Kiến trúc

```
  PLAN/REVIEW CẦN CLARIFY
        │
        ▼
  ┌─── QUESTION TOOL REGISTRY ─────────────────────────┐
  │  detect platform (runtime env):                     │
  │   ├─ Claude Code → AskUserQuestion                  │
  │   ├─ Codex       → request_user_input               │
  │   ├─ Gemini/Pi   → ask_user                         │
  │   └─ mya native  → approval channel / TUI modal     │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── BLOCKING ASK ──────────────────────────────────┐
  │  await answer — loop DỪNG chờ đáp án               │
  │  tool không có → fallback chat + đánh dấu "cần trả lời" │
  │  NEVER SKIP: không đoán thay người dùng             │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools approval.ts — ApprovalChannel + humanPrompt (nền ask)
// ✅ packages/print — TUI modal surface (nền mya native ask)
// ✅ packages/intercom — channel ask (nền chat fallback)
// ✅ packages/core types — RuntimeEvent {kind:"approval"} (nền blocking event)
// ✅ packages/gateway approval-relay.ts — approval routing (nền relay)

// ❌ THIẾU: question tool registry (platform → adapter)
// ❌ THIẾU: platform detection (runtime env)
// ❌ THIẾU: never-skip guard (loop dừng khi chưa trả lời)
```

## Implementation

```typescript
// packages/tools/src/question-tool.ts (NEW)
export interface AskQuestion {
  question: string;
  options?: string[];   // options rỗng = free-text
  timeoutMs?: number;   // blocking nhưng có giới hạn
}

export interface Answer { text: string; optionIndex?: number; cancelled: boolean }

export type Platform = "claude-code" | "codex" | "gemini" | "pi" | "mya-native";

/** Adapter: mỗi platform một cách ask. */
export type AskAdapter = (q: AskQuestion) => Promise<Answer>;

/** Registry: platform → adapter. Đăng ký lúc boot (runtime detect). */
export class QuestionToolRegistry {
  private readonly adapters = new Map<Platform, AskAdapter>();

  register(platform: Platform, ask: AskAdapter): void { this.adapters.set(platform, ask); }

  /** Detect platform từ env — nền cho việc chọn adapter. */
  static detectPlatform(env: NodeJS.ProcessEnv = process.env): Platform {
    if (env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_PROJECT_DIR) return "claude-code";
    if (env.CODEX_ENTRYPOINT) return "codex";
    if (env.GEMINI_CLI) return "gemini";
    if (env.PI_SESSION_ID) return "pi";
    return "mya-native";
  }

  /** Blocking ask — throw nếu platform không có adapter (bắt buộc xử lý). */
  async ask(platform: Platform, q: AskQuestion): Promise<Answer> {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`no question tool for ${platform} — fallback chat + chờ trả lời`);
    return adapter(q); // await — loop dừng chờ đáp án
  }
}

/** Never-skip guard: câu hỏi chưa trả lời → không đoán, báo blocker. */
export function requireAnswer(a: Answer, question: string): string {
  if (a.cancelled || !a.text.trim()) {
    throw new Error(`BLOCKER: cần trả lời "${question}" — không tự đoán thay người dùng`);
  }
  return a.text.trim();
}
// Usage: const ans = await registry.ask(platform, { question: "chọn hướng?", options: ["A", "B"] });
//        const choice = requireAnswer(ans, "chọn hướng"); // skip → throw
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hỏi đúng tool platform — chờ + parse được | ❌ Mỗi platform một adapter — duy trì nhiều |
| ✅ Never skip — không đoán thay người dùng | ❌ Blocking có thể kẹt nếu tool không trả lời (timeout) |
| ✅ Fallback chat rõ ràng (đánh dấu cần trả lời) | ❌ Platform detection heuristic có thể sai |
| ✅ Dùng approval channel sẵn cho mya-native | ❌ Chat fallback không đảm bảo parse đáp án |

## Khác các hướng gần

| | Approval channel | AAP: Question Tool |
|---|---|---|
| Mục đích | Cho phép hành động nguy hiểm | **Clarify plan/review** |
| Format | Allow/Deny + token | **Free-text + options** |
| Platform | mya-native | **Đa platform (registry)** |
| Mối quan hệ | Nền | **Mở rộng thành question registry** |

## Khi nào chọn

- Agent chạy trên nhiều harness (Claude Code/Codex/Gemini/Pi) cần hỏi người dùng
- Không chấp nhận agent tự đoán khi thiếu thông tin
- Đã có approval channel — thêm registry + platform detect + never-skip guard
- Guard: timeout mọi ask (không kẹt vô hạn), detect platform test, requireAnswer bắt cancelled
