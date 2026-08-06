# Hướng AIB: Bounded-Context-Inheritance — khi `inherit_context` bật, parent conversation được trích text (bỏ toolResult quá verbose) và nén thành section `# Parent Conversation Context`; compaction summary được giữ lại vì đã cô đọng — subagent nhận bản tóm tắt có chọn lọc chứ không phải full transcript

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟡 — context passing | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có compaction + format-context; chưa có selective extract + inherit_context gate) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-subagent3** khi **`inherit_context`** bật, parent conversation được **trích text** (bỏ toolResult quá verbose) và **nén** thành section `# Parent Conversation Context`; **compaction summary được giữ nguyên** vì đã cô đọng — subagent nhận **bản tóm tắt có chọn lọc** chứ không phải full transcript. Nguyên tắc: **selective extract** — text giữ, toolResult verbose bỏ (giảm token); **compaction preserved** — summary đã cô đọng, không nén tiếp; **bounded handoff** — subagent nhận context hữu ích nhưng bounded, không full transcript phình.

## Mô tả

Với mya, pattern = **bounded context inheritance**: (1) mya đã có **compaction** (memory dream-cycle) + **format-context** (intercom); (2) mya có session transcript (JSONL); (3) AIB thêm **`inherit_context` gate** — spawnSubagent option; (4) khi bật: **extract text** từ parent transcript (user/assistant text giữ, toolResult bỏ hoặc rút gọn); (5) **compaction summary** (nếu parent đã compact) giữ nguyên; (6) nén thành section `# Parent Conversation Context` inject vào subagent system prompt — trái ngược AHO (isolation hoàn toàn).

## Kiến trúc (ASCII)

```
  PARENT TRANSCRIPT (JSONL)
    ├─ user: "refactor auth module"
    ├─ assistant: "đọc src/auth.ts..." (TEXT — giữ)
    ├─ toolResult: { 5000 dòng } (VERBOSE — BỎ hoặc rút gọn)
    ├─ [COMPACTION SUMMARY: "đã review auth, quyết định X"] (CÔ ĐỌNG — giữ nguyên)
    └─ assistant: "kế hoạch..." (TEXT — giữ)
         │
         ▼ extract (text ✓, toolResult ✗, compaction ✓)
         │
         ▼ nén → section
  # Parent Conversation Context
    user: refactor auth module
    [compaction summary]: đã review auth, quyết định X
    assistant: kế hoạch...
         │
         ▼ inject vào SUBAGENT system prompt (inherit_context: true)
  (selective + bounded — không phải full transcript)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom format-context.ts — format context (nền extract)
// ✅ packages/memory dream-cycle.ts — compaction summary (cô đọng sẵn)
// ✅ packages/agent — session transcript JSONL (nguồn extract)
// ✅ packages/agent pool.ts — AgentSessionEntry (transcript access)

// ❌ THIẾU: inherit_context gate (spawnSubagent option)
// ❌ THIẾU: selective extract (text ✓ toolResult ✗)
// ❌ THIẾU: # Parent Conversation Context section inject
```

## Implementation

```typescript
// packages/agent/src/context-inheritance.ts (NEW)
export interface TranscriptTurn { role: "user" | "assistant" | "tool"; text: string; isCompaction?: boolean }

/** Extract text có chọn lọc — bỏ toolResult verbose, giữ compaction summary. */
export function extractParentContext(turns: TranscriptTurn[], maxChars = 4000): string {
  const kept: string[] = [];
  let total = 0;
  for (const t of turns) {
    let line: string;
    if (t.isCompaction) {
      line = `[compaction summary]: ${t.text}`;        // cô đọng — giữ nguyên
    } else if (t.role === "tool") {
      continue;                                          // verbose — BỎ
    } else {
      line = `${t.role}: ${t.text}`;                    // text — giữ
    }
    if (total + line.length > maxChars) break;          // bounded
    kept.push(line);
    total += line.length;
  }
  return `# Parent Conversation Context\n${kept.join("\n")}`;
}
// spawnSubagent(goal, { inheritContext: true }): nếu bật → extract từ parent
// transcript → inject vào subagent system prompt. Trái ngược AHO (isolation).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Subagent có context hữu ích (không mù) | ❌ Bỏ toolResult có thể mất chi tiết quan trọng |
| ✅ Bounded — không phình context window | ❌ maxChars cắt có thể mất ngữ cảnh cuối |
| ✅ Compaction summary giữ (cô đọng sẵn) | ❌ Extract thêm overhead per spawn |
| ✅ Nối format-context + compaction | ❌ Trái AHO — chọn isolation hay inherit |

## Khác các hướng gần

| | AIB Bounded-Context-Inheritance | AHO Recursive-Context-Isolation | AHN Output-Head-Truncation |
|---|---|---|---|
| Trọng tâm | Subagent NHẬN context (nén) | Subagent KHÔNG nhận context | Bound output subagent |
| Cơ chế | Extract text + compaction + section | Separate process + scout | Head-truncate + path |
| Quan hệ | Đầu vào (cha→con) | Cực isolation (trái) | Đầu ra (con→cha) |

## Khi nào chọn

- Subagent cần context parent nhưng không muốn phình (bounded)
- Parent đã compact → muốn giữ summary cô đọng
- Chọn inherit (AIB) thay vì isolation (AHO) khi task cần ngữ cảnh
- Guard: inherit_context opt-in, selective extract (text✓ tool✗), maxChars bound, compaction preserved
