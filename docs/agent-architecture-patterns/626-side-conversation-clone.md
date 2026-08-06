# Hướng XB: Side Conversation Clone — lệnh /btw sinh side agent mới không-tool nhận read-only clone conversation chính + lịch sử /btw riêng

> **Nguồn gốc:** rpiv-mono (side conversation); "/btw spawn new side agent no-tools", "read-only clone of main conversation", "separate /btw history" | **Coupling:** 🟡 — thêm side-agent spawn + read-only clone | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent + session sẵn — chưa có /btw no-tool side + read-only clone) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** có lệnh **`/btw`** (by the way) — khi user hỏi phụ "à tiện问...", sinh một **side agent mới**: (1) **No tools** — side agent chỉ **trả lời** (lý thuyết, giải thích, brainstorm), không thể edit/gọi tool (an toàn, không mutate workspace). (2) **Read-only clone** — side agent nhận **bản sao read-only** conversation chính (thấy context đến lúc hỏi, không thay đổi bản gốc). (3) **Lịch sử riêng** — mỗi /btw có **history riêng** (sequence /btw riêng, không lẫn conversation chính). Nguyên tắc: **hỏi phụ cô lập, read-only, no-tool** — không bẩn conversation chính, side agent không thể phá workspace.

## Mô tả

mya side conversation clone: lệnh `/btw <question>` spawn side agent: (1) snapshot conversation chính thành **read-only clone** (2) side agent chạy với **tool set rỗng** (3) trả lời + lưu vào **history /btw riêng**. Conversation chính không thay đổi. mya có subagent + session — XB thêm **/btw spawn** + **read-only clone** + **no-tool side** + **per-btw history**.

## Kiến trúc

```
  MAIN CONVERSATION (có tool, mutate workspace)
  ┌────────────────────────────────────────────────────┐
  │  user: "implement feature X"                         │
  │  agent: [edit code, run tests] ← CÓ TOOL             │
  │  user: "/btw remind me why we chose library Y?"      │  ← lệnh /btw
  └───────────────────────┬────────────────────────────┘
                          │ (snapshot read-only)
                          ▼
  ┌─── SPAWN SIDE AGENT (/btw) ──────────────────────────┐
  │  1. read-only clone main conversation (snapshot)      │
  │  2. tool set = {} (NO TOOLS — chỉ trả lời)            │
  │  3. history = [/btw riêng, không lẫn main]            │
  │  side agent: "chọn Y vì..." (chỉ text, không edit)    │
  └───────────────────────┬───────────────────────────────┘
                          │ (answer tóm tắt)
                          ▼
  MAIN CONVERSATION nhận summary side (không bẩn history chính)
  ┌─── /btw HISTORY (riêng) ─────────────────────────────┐
  │  btw#1: "why Y?" → "vì..."                            │  ← lịch sử riêng
  │  btw#2: "also Z?" → "..."                             │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent subagent — spawn subagent (nền — XB side = subagent variant)
// ✅ packages/core session.ts — session (nền — XB clone session)
// ✅ packages/agent sdk.ts — agent sdk (nền — XB spawn side)

// ❌ THIẾU: /btw command spawn (no-tool side)
// ❌ THIẾU: read-only conversation clone (snapshot immutable)
// ❌ THIẾU: per-btw history (lịch sử riêng)
```

## Implementation

```typescript
// packages/agent/src/side-conversation.ts (MỚI)
interface Message { role: string; content: string }
interface Conversation { messages: Message[] }

class SideConversationManager {
  private btwHistory: Conversation[] = []; // lịch sử /btw riêng

  // spawn side agent: clone read-only + no tool + trả lời
  async btw(
    main: Conversation, question: string,
    askModel: (msgs: Message[], tools: unknown[]) => Promise<string>,
  ): Promise<string> {
    const clone: Conversation = { messages: main.messages.map((m) => ({ ...m })) }; // read-only snapshot
    clone.messages.push({ role: "user", content: question });
    // NO TOOLS — side agent chỉ trả lời
    const answer = await askModel(clone.messages, []);
    this.btwHistory.push({ messages: [{ role: "user", content: question }, { role: "assistant", content: answer }] });
    return answer;
  }

  history(): Conversation[] { return this.btwHistory; }
}

// Usage:
// const mgr = new SideConversationManager();
// const ans = await mgr.btw(mainConv, "why library Y?", askModel);
// → side agent trả lời read-only, không tool, history riêng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hỏi phụ cô lập (không bẩn conversation chính) | ❌ Context duplication (clone tốn token) |
| ✅ No-tool safe (side không thể phá workspace) | ❌ No-action limit (side chỉ trả lời, không thực thi) |
| ✅ Read-only clone (thấy context, không đổi gốc) | ❌ Clone staleness (snapshot cũ khi main update) |
| ✅ History riêng (trace /btw sequence) | ❌ Spawn cost (mỗi /btw = 1 model call) |

## Khác các hướng gần

| | Inline hỏi trong main | Subagent (có tool) | XB: /btw-Side |
|---|---|---|---|
| Tool | có (main) | có (subagent) | **❌ no-tool (safe)** |
| History | lẫn main | subagent riêng | **✅ /btw riêng** |
| Mutate | có risk | có risk | **❌ read-only clone** |

## Khi nào chọn

- User hay hỏi phụ (brainstorm, lý thuyết) cần cô lập khỏi workflow chính
- Muốn side agent an toàn (no-tool, không phá workspace) + history riêng
- Nối packages/agent subagent + packages/core session.ts + packages/agent sdk.ts; guard clone-freshness (snapshot tại thời điểm /btw, không stale), no-tool-enforce (verify side tool set thực rỗng), và btw-cost-budget (giới hạn /btw spawn tránh spam); XB = side conversation clone, kết hợp 625 XA structured-questionnaire-tool (hỏi structured trong side) + 543 TW durable-context-projection (clone durable khi compact)
