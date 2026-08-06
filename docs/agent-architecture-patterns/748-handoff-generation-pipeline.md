# Hướng ABT: Handoff Generation Pipeline — lệnh /handoff tạo oneshot handoff doc qua model từ live messages + system prompt + tools, guard tối thiểu 2 messages

> **Nguồn gốc:** gajae-code (docs/handoff-generation-pipeline.md) | **Coupling:** 🟡 — thêm handoff command + generator vào session layer | **Agent-agnostic:** ⚠️ (dùng model để sinh doc) | **Code sẵn:** ⚠️ (có session JSONL + exporter — chưa có handoff generator) | **Effort:** 1-2 tuần

## Nguồn gốc

**gajae-code** có lệnh **`/handoff`** tạo **oneshot handoff doc** — chuyển giao context giữa session có cấu trúc: (1) **input**: **live messages** (JSONL session hiện tại) + **system prompt** + **tools** (danh sách tool đang dùng); (2) **generation**: qua **model** — model đọc input rồi sinh handoff doc (tóm tắt trạng thái, việc còn dở, context cần thiết); (3) **guard**: **tối thiểu 2 messages** — nếu session có ít hơn 2 messages thì **từ chối tạo handoff** (không đủ context — doc sẽ vô nghĩa), guard nằm ở **cả UI lẫn session layer** (không chỉ UI chặn, session layer cũng chặn — defense in depth). Nguyên tắc: **handoff là oneshot doc (không phải live state), input đủ (messages + prompt + tools), guard 2-message ở 2 lớp**.

## Mô tả

mya handoff generation pipeline: lệnh `/handoff` (hoặc API) — (1) thu **live messages** từ session JSONL + **system prompt** hiện tại + **tool list**; (2) guard: `< 2 messages` → từ chối (cả UI lẫn session layer); (3) gọi model sinh **handoff doc** (state summary, TODO, context, tools); (4) trả doc — user/session khác đọc là tiếp tục được. mya có packages/core session.ts + spill.ts (session JSONL) + packages/agent exporters.ts (export context) — ABT thêm **handoff command** + **doc generator** (model) + **2-message guard** (2 lớp).

## Kiến trúc

```
  /handoff (UI layer)
       │
       ▼
  GUARD LỚP 1 (UI)  session.messages.length < 2 → từ chối (UI block)
       │
       ▼
  GUARD LỚP 2 (session layer)  < 2 messages → từ chối (defense in depth)
       │
       ▼
  INPUT THU (live + prompt + tools)
    ├─ live messages (session JSONL)
    ├─ system prompt (hiện tại)
    └─ tools (danh sách tool đang dùng)
       │
       ▼
  MODEL GENERATION (oneshot — sinh handoff doc)
    ├─ state summary
    ├─ công việc còn dở (TODO)
    └─ context cần thiết + tools
       ▼
  HANDOFF DOC (đọc là tiếp tục được)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session.ts — session JSONL (nền — ABT input source)
// ✅ packages/core spill.ts — context spill (nền — ABT input lớn)
// ✅ packages/agent exporters.ts — export context (nền — ABT doc output analog)
// ✅ packages/print pi-subagent.ts — subagent context (liên quan — ABT handoff giữa session)

// ❌ THIẾU: handoff command (/handoff — UI + session layer)
// ❌ THIẾU: doc generator (model sinh từ messages + prompt + tools)
// ❌ THIẾU: 2-message guard (chặn ở cả UI lẫn session layer)
```

## Implementation

```typescript
// packages/agent/src/handoff.ts (MỚI)
import type { ProviderProfile, History } from "@my-agent/core";

export interface HandoffInput { messages: Array<{ role: string; content: string }>; systemPrompt: string; tools: string[] }
export interface HandoffDoc { summary: string; todos: string[]; context: string; tools: string[] }

const MIN_MESSAGES = 2; // guard: tối thiểu 2 messages

/** Guard: từ chối tạo handoff nếu < 2 messages (cả UI lẫn session layer gọi hàm này). */
export function guardHandoff(input: HandoffInput): { ok: true } | { ok: false; reason: string } {
  if (input.messages.length < MIN_MESSAGES) {
    return { ok: false, reason: `handoff: cần tối thiểu ${MIN_MESSAGES} messages (hiện có ${input.messages.length})` };
  }
  return { ok: true };
}

/** Pipeline: guard → input → model → handoff doc (oneshot). */
export async function generateHandoff(input: HandoffInput, provider: ProviderProfile, systemPrompt: string): Promise<HandoffDoc> {
  const guard = guardHandoff(input);
  if (!guard.ok) throw new Error(guard.reason); // session layer chặn (lớp 2)
  const history: History = {
    system: [{ role: "system", content: `${systemPrompt}\n\nTạo handoff doc: tóm tắt trạng thái, TODO, context, tools.` }],
    messages: input.messages,
  };
  const { events } = await provider.stream({ history, system: history.system, model: provider.model });
  const text = events.filter(e => e.kind === "text").map(e => (e as { text: string }).text).join("\n");
  return {
    summary: text.split("\n").find(l => l.startsWith("## Summary"))?.slice(11) ?? text.slice(0, 200),
    todos: text.split("\n").filter(l => l.startsWith("- [ ]")).map(l => l.slice(6)),
    context: text,
    tools: input.tools,
  };
}
// Usage:
// const uiGuard = guardHandoff(input);   // lớp 1 (UI block)
// const doc = await generateHandoff(input, provider, sys); // lớp 2 (session layer chặn nếu < 2)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chuyển giao có cấu trúc (doc đọc là tiếp tục được) | ❌ Model cost (mỗi /handoff 1 lần gọi model) |
| ✅ Guard 2 lớp (UI + session — không tạo doc vô nghĩa) | ❌ Doc stale (handoff tạo xong, session đổi tiếp → doc cũ) |
| ✅ Oneshot rõ (không phải live state — snapshot tại thời điểm) | ❌ Parse fragile (model output format lệch → parse sai) |
| ✅ Input đủ (messages + prompt + tools — context đầy đủ) | ❌ Length (session dài → input lớn, tốn token) |

## Khác các hướng gần

| | Copy raw session | Summary tay (user tự viết) | ABT: Handoff Pipeline |
|---|---|---|---|
| Cấu trúc | không (raw) | tùy user | **doc chuẩn (summary/todos/context/tools)** |
| Guard | không | không | **2-message (2 lớp)** |
| Chi phí | 0 | 0 (công user) | **1 model call** |
| Độ tươi | luôn | tùy | **oneshot snapshot** |

## Khi nào chọn

- Agent chuyển session (nghỉ, sang máy khác, giao cho agent khác) — cần doc chuyển giao
- Muốn guard (không tạo handoff khi chưa đủ context)
- Đã có session JSONL + provider (packages/core + ai) — chỉ thêm command + generator
- Nối packages/core session.ts + spill.ts + packages/agent exporters.ts + packages/ai (provider); guard min-messages (guard ở cả UI lẫn session layer — defense in depth), doc-freshness (handoff là snapshot — ghi rõ timestamp), và parse-robust (model output parse linh hoạt — fallback raw text); ABT = handoff generation pipeline, kết hợp 747 ABS autonomous-memory-pipeline (handoff doc có thể nạp vào memory) + 597 VY sanitized-context-fork (handoff doc = sanitized context cho session kế)
