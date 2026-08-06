# Hướng AFK: Monitor Trigger-Events — mode monitor headless: agent chỉ bị đánh thức khi trigger match (cooldown, dedupe exact line, event history có cursor), wake theo sự kiện cấu trúc thay vì khoảng thời gian

> **Nguồn gốc:** pi-interactive-shell (headless-monitor.ts) | **Coupling:** 🟡 — cần trigger source (stream/poll-diff/file-watch) + triggerTurn | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có cron on-interval/once + intercom triggerTurn, thiếu structured-trigger monitor) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-interactive-shell** mode **monitor headless** không poll theo thời gian cố định mà **wake theo sự kiện cấu trúc**: trigger source (stream / poll-diff / file-watch) phát ra event, **chỉ khi event match predicate** thì agent mới bị đánh thức. Ba chống ồn: (1) **cooldown** — sau lần wake phải chờ N giây mới wake lại; (2) **dedupe exact line** — dòng trùng lặp không wake; (3) **event history có cursor** — ghi lại đã xử lý đến đâu để resume không lặp. Nguyên tắc: **wake-on-structured-match**, không wake-on-tick.

## Mô tả

mya monitor-trigger: (1) **trigger source** — file-watch (tools find), poll-diff (so sánh snapshot), hoặc event stream; (2) **match predicate** — regex/glob/function quyết định event "đáng"; (3) **cooldown gate** — `packages/cron` đã có on-interval/once trigger, thêm **cooldown** sau wake; (4) **dedupe exact-line** — set/string-hash bỏ trùng; (5) **event history + cursor** — `packages/cron` đã có history preserved across reconcile, thêm **cursor** để resume; (6) **wake** qua intercom `sendMessage({ triggerTurn: true })`. Nối AFJ (wake agent) và cron (scheduler).

## Kiến trúc (ASCII)

```
  TRIGGER SOURCE ──▶ event flow
   ├─ file-watch (inotify/poll)
   ├─ poll-diff (snapshot compare)
   └─ stream (tail -f)
            │ raw events
            ▼
   ┌────────────────────────────┐
   │ MATCH predicate (regex/glob)│ ◀── bỏ event KHÔNG đáng
   ├────────────────────────────┤
   │ DEDUPE exact-line (set)     │ ◀── bỏ dòng trùng
   ├────────────────────────────┤
   │ COOLDOWN gate (N giây)      │ ◀── bỏ wake dày
   ├────────────────────────────┤
   │ EVENT HISTORY + cursor      │ ◀── resume không lặp
   └─────────────┬──────────────┘
                 ▼   match + pass gate
   sendMessage({ triggerTurn: true })  ──▶ AGENT wake xử lý
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/cron index.ts — TriggerType: cron/on-interval/once + history preserved across reconcile
// ✅ packages/cron scan.ts — dueAt(now) tính job fire
// ✅ packages/intercom intercom.ts — sendMessage({ triggerTurn: true }) wake agent
// ✅ packages/tools find.ts — file-walk (nền cho file-watch/poll-diff)

// ❌ THIẾU: structured-trigger source (file-watch inotify / poll-diff)
// ❌ THIẾU: match predicate + cooldown gate + dedupe exact-line
// ❌ THIẾU: event-history cursor resume
```

## Implementation

```typescript
// packages/cron/src/monitor-trigger.ts (MỚI)
export interface MonitorConfig {
  source: "file-watch" | "poll-diff" | "stream";
  match: RegExp;            // event phải match mới wake
  cooldownMs: number;       // chờ sau lần wake
  cursorKey: string;        // resume key
}
export interface MonitorState {
  lastWake: number;         // epoch ms — cooldown
  seen: Set<string>;        // exact-line dedupe
  cursor: number;           // vị trí đã xử lý trong history
}
/** Lọc event qua match → dedupe → cooldown; trả về wake-worthy events. */
export function filterTriggerEvents(
  events: { line: string; seq: number }[],
  cfg: MonitorConfig,
  state: MonitorState,
  now: number,
): { line: string; seq: number }[] {
  const out: { line: string; seq: number }[] = [];
  for (const e of events) {
    if (e.seq <= state.cursor) continue;            // đã xử lý (resume)
    if (!cfg.match.test(e.line)) continue;          // không match predicate
    if (state.seen.has(e.line)) continue;           // exact-line dedupe
    if (now - state.lastWake < cfg.cooldownMs) continue;  // cooldown gate
    state.seen.add(e.line);
    out.push(e);
  }
  if (out.length) { state.lastWake = now; state.cursor = events.at(-1)?.seq ?? state.cursor; }
  return out;  // caller: if out.length → sendMessage({ triggerTurn: true })
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Wake theo sự kiện cấu trúc — không lãng phí turn | ❌ Predicate sai → miss event quan trọng hoặc wake ồn |
| ✅ Cooldown + dedupe chống bão event | ❌ File-watch phụ thuộc platform (inotify/FSEvents/poll) |
| ✅ Cursor resume — restart không lặp xử lý | ❌ Exact-line dedupe có thể bỏ event cùng nội dung nhưng khác ngữ cảnh |

## Khác các hướng gần

| | AFK Monitor-Trigger | AFJ Dispatch Trigger-Turn | Cron on-interval |
|---|---|---|---|
| Wake khi | Trigger **match** | Session **kết thúc** | **Đến giờ** cố định |
| Chống ồn | cooldown+dedupe+cursor | exit/timeout/quiet | không |
| Phù hợp | Theo dõi thay đổi file/log | Nhận kết quả task nền | Lịch định kỳ |

## Khi nào chọn

- Theo dõi file/log/stream và chỉ phản hồi khi có thay đổi đáng
- Muốn tránh wake dày (cooldown) và trùng lặp (dedupe)
- Cần resume an toàn sau restart (cursor history)
- Guard: match predicate chính xác, cooldown > tick, cursor persist, fail-closed khi source lỗi
