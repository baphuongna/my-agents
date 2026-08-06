# Hướng RS: Real-Conversation Import Gate — chặn import: chỉ thành công khi có event hội thoại thật provider viết

> **Nguồn gốc:** ctx (ctx.rs; `provider_event_is_real_conversation_message`; "contained no real conversation messages"; `filter_provider_capture_lines_without_real_session_messages`; "session_message authoritative only when they contain real conversational content")
> **Coupling:** 🟢 — import gate pure filter chèn vào importer (không can thiệp core)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session import/library sẵn — chưa có real-conversation-message gate)
> **Effort:** 1-1.5 tuần

## Nguồn gốc

**ctx** (ctx.rs) import lịch sử agent session vào SQLite để search. Vấn đề: nhiều file session provider chứa **metadata/lifecycle/UI stream** chứ **không phải hội thoại thật** (event system, status, empty session, chỉ tool-call không message). Nếu import những session này → index đầy "rác" → search trả kết quả vô nghĩa, tốn dung lượng. Giải pháp: **real-conversation import gate** — trước khi import, **lọc session**: chỉ giữ session có **ít nhất 1 event là "real conversation message"** (user/assistant message thật do provider viết, không phải lifecycle/metadata/tool-only). Session **không có real message** → **reject toàn bộ** (bỏ cả event + file-touch của session đó). Nếu **toàn bộ source không có session nào có real message** → **import fail** với lỗi `"no real conversation message"`. Nguyên tắc: **chỉ index hội thoại thật** — session rỗng/metadata-only không có giá trị search. Khác **424 PH cross-agent-session-library** (index chung multi-provider) — RS **gate chất lượng trước khi index**; khác **466 QX citation** — RS **gate import, không citation**.

## Mô tả

mya real-conversation import gate: (1) **Read provider session**: parse file session provider (JSONL/SQLite/JSON). (2) **Classify event**: mỗi event → `isRealConversationMessage` (user/assistant message thật) hay không (lifecycle/metadata/tool-only/empty). (3) **Per-session filter**: gom event theo session key → session **không có real message** → **reject** (xóa event + file-touch của session đó, đếm skipped). (4) **Source-level fail**: nếu **sau lọc không còn session nào** có real message → `summary.failed++` + failure `"provider source contained no real conversation message"`. (5) **Import remainder**: chỉ import session có real message → index sạch. mya có session import/library — RS thêm **real-conversation gate** (pure filter).

## Kiến trúc

```
  PROVIDER SESSION FILES (JSONL / SQLite / JSON)
        │  parse → captures (event + file-touch)
        ▼
  ┌─── CLASSIFY EVENT ──────────────────────────────────┐
  │  mỗi event → isRealConversationMessage?              │
  │    user message / assistant message → REAL ✅        │
  │    lifecycle / metadata / tool-only / empty → NOT ❌ │
  └───────────────────────┬─────────────────────────────┘
                          ▼
  ┌─── PER-SESSION FILTER (gate) ───────────────────────┐
  │  group event theo session key                        │
  │  for each session:                                   │
  │    có ≥1 real message?                               │
  │      NO  → REJECT session (xóa event + file-touch)   │
  │      YES → KEEP (import)                             │
  │  skipped_sessions++, skipped_events++                │
  └───────────────────────┬─────────────────────────────┘
                          ▼
  ┌─── SOURCE-LEVEL FAIL CHECK ─────────────────────────┐
  │  còn session nào có real message sau lọc?            │
  │    NO  → summary.failed++                            │
  │           failure: "no real conversation message"    │
  │    YES → import remainder (session sạch) ✅           │
  └──────────────────────────────────────────────────────┘
                          ▼
  INDEX (chỉ hội thoại thật — không metadata rác)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session import (packages/*) — parse/import session (nền — RS = gate trước import)
// ✅ 424 PH cross-agent-session-library — index chung (nền — RS = quality gate cho library)
// ✅ 425 PI session-branch-tree — tái dựng nhánh (đối chiếu — RS = gate message thật)
// ✅ 466 QX citation-attribution — citation (đối chiếu — RS = gate import)

// ❌ THIẾU: isRealConversationMessage classifier (user/assistant thật vs lifecycle/metadata)
// ❌ THIẾU: per-session filter (reject session không real message)
// ❌ THIẾU: source-level fail ("no real conversation message" khi toàn rỗng)
```

## Implementation

```typescript
// packages/agent/src/conversation-import-gate.ts (MỚI)
interface ProviderCapture {
  sessionKey: string;
  event: { role: string; content: string; isLifecycle?: boolean; isToolOnly?: boolean } | null;
}
interface ProviderFileTouch { sessionKey: string }
interface ImportSummary {
  skipped: number; skippedEvents: number; skippedSessions: number;
  failed: number; failures: { line: number; error: string }[];
}

// classify: event có phải real conversation message (provider viết thật)?
function isRealConversationMessage(ev: ProviderCapture["event"]): boolean {
  if (!ev) return false;                                    // không event
  if (ev.isLifecycle) return false;                         // lifecycle (start/stop)
  if (ev.isToolOnly) return false;                          // chỉ tool-call, không message
  if (ev.role !== "user" && ev.role !== "assistant") return false;  // không phải hội thoại
  if (ev.content.trim().length === 0) return false;         // empty
  return true;
}

// gate: lọc session không có real message → reject toàn session
function filterSessionsWithoutRealMessages(
  captures: ProviderCapture[],
  filesTouched: ProviderFileTouch[],
  summary: ImportSummary,
): { captures: ProviderCapture[]; filesTouched: ProviderFileTouch[] } {
  const allKeys = new Set(captures.map(c => c.sessionKey));
  const realKeys = new Set(
    captures.filter(c => isRealConversationMessage(c.event)).map(c => c.sessionKey)
  );
  const rejected = [...allKeys].filter(k => !realKeys.has(k));
  if (rejected.length === 0) return { captures, filesTouched };

  summary.skippedSessions += rejected.length;
  const keep = captures.filter(c => {
    if (!rejected.includes(c.sessionKey)) return true;
    summary.skipped++; if (c.event) summary.skippedEvents++;
    return false;
  });
  const keepFiles = filesTouched.filter(f => {
    if (!rejected.includes(f.sessionKey)) return true;
    summary.skipped++; return false;
  });

  // source-level fail: không còn session nào có real message
  if (realKeys.size === 0 && summary.failed === 0) {
    summary.failed++;
    summary.failures.push({ line: 0, error: "provider source contained no real conversation message" });
  }
  return { captures: keep, filesTouched: keepFiles };
}

// Usage:
// const { captures, filesTouched } = filterSessionsWithoutRealMessages(raw, files, summary);
// if (summary.failed) reportError(summary.failures); else importToIndex(captures);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Index sạch (chỉ hội thoại thật, không metadata rác) | ❌ Phải classify event chính xác (miss real message → reject nhầm) |
| ✅ Tiết kiệm dung lượng (bỏ session rỗng/metadata-only) | ❌ Provider khác nhau khác định nghĩa "real message" |
| ✅ Search chất lượng (kết quả có giá trị) | ❌ Có thể bỏ session chỉ tool-call (một số case vẫn hữu ích) |
| ✅ Source-level fail rõ ràng ("no real conversation") | ❌ Reject toàn session (không cứu vãn event riêng lẻ) |

## Khác các hướng gần

| | 424 Cross-Agent-Session-Library | 425 Session-Branch-Tree | RS: Import-Gate |
|---|---|---|---|
| Cái gì | Index chung multi-provider | Tái dựng cây nhánh | **Gate chất lượng trước import** |
| Khi | Import | Resume | **Trước khi index** |
| Lọc | ❌ (import tất cả) | ❌ | **Reject session không real message** |

## Khi nào chọn

- Import lịch sử session provider vào index (file có thể chứa metadata/lifecycle rác)
- Muốn chỉ index hội thoại thật (user/assistant message), bỏ session rỗng
- Cần source-level fail rõ ràng khi toàn source không có hội thoại thật
- Nối session import (RS = gate trước index) + 424 PH library (RS = quality gate cho library); guard classify chính xác (miss real → reject nhầm tốt session) + provider-specific (mỗi provider khác schema event) + reject granularity (toàn session, không cứu event lẻ) + source-fail message (rõ ràng "no real conversation message")
