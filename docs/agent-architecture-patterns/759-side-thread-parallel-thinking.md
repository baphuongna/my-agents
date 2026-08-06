# Hướng ACE: Side-Thread Parallel Thinking — side conversation song song với main agent qua overlay TUI, không derail transcript chính

> **Nguồn gốc:** pi-btw (skills/btw/SKILL.md) | **Coupling:** 🟢 — thêm side-thread channel, main loop không đổi | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có session-branch + intercom overlay — chưa có /btw lifecycle) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-btw** (BTW = "by the way") tạo **side conversation song song** với main agent qua **overlay TUI**: lệnh `/btw` cho aside nhanh (hỏi một câu phụ, không đụng main thread), `/btw:new` kế thừa context của main session (branch — biết chuyện đang nói), `/btw:tangent` chạy **contextless hoàn toàn** (brainstorm tự do, không ràng buộc). Mục đích: **brainstorm / so sánh phương án / hỏi điều tra** mà không làm **derail** hoặc **phình transcript chính** — main thread chỉ thấy kết quả được chọn lọc, không thấy toàn bộ mớ suy nghĩ. Nguyên tắc: **parallel thinking có không gian riêng, kết quả mới được đưa về main**.

## Mô tả

mya side-thread parallel thinking: (1) **3 chế độ tạo side thread** — `aside` (nhanh, không kế thừa), `new` (kế thừa context main session — dùng session-branch), `tangent` (contextless); (2) **overlay TUI** — packages/intercom có UI layer (inline-message, session-list) — side thread hiển thị dạng panel phụ, main transcript không bị ghi thêm; (3) **session riêng** — mỗi side thread là một session branch (core/session-branch.ts đã có Branch child type); (4) **kết quả đưa về main** qua inject/summarize (hướng ACF) — main agent chỉ nhận bản rút gọn hoặc nguyên văn khi cần. Nối ACF (thread-inject-or-summarize) — ACE sinh thread, ACF đưa về.

## Kiến trúc

```
  MAIN AGENT (transcript chính — không phình)
       ├── /btw:aside      ──▶ side thread (không kế thừa context) ──┐
       ├── /btw:new        ──▶ side thread (kế thừa main context)  ──┤
       └── /btw:tangent    ──▶ side thread (contextless)          ──┘
                                    │   overlay TUI (panel phụ)
                                    ▼
                            brainstorm / so sánh / điều tra
                              inject | summarize  (ACF)
                                    ▼
                            MAIN AGENT nhận kết quả chọn lọc
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session-branch.ts — Branch/Delegate child type (nền — /btw:new = branch)
// ✅ packages/core session-utils.ts — EntryKind "custom" + tree-structured JSONL
//   (side thread có thể persist là custom entry)
// ✅ packages/intercom — overlay UI (inline-message, session-list) + session-joined events
//   (nền — side thread panel + presence)
// ✅ packages/agent spawnSubagent — session riêng, history riêng (nền — side thread engine)
// ✅ packages/prompts assembler.ts — 3-tier prompt (side thread có prompt riêng)

// ❌ THIẾU: /btw command surface (aside/new/tangent)
// ❌ THIẾU: overlay panel cho side thread (main transcript không đổi)
// ❌ THIẾU: handoff inject/summarize sang main agent
```
## Implementation
```typescript
// packages/agent/src/side-thread.ts (MỚI)
import { createSession, type Session, type ProviderProfile } from "@my-agent/core";
export type SideThreadMode = "aside" | "new" | "tangent";
export interface SideThread {
  readonly id: string;
  readonly mode: SideThreadMode;
  readonly session: Session;
  /** Main session id — dùng cho /btw:new (kế thừa context). */
  readonly parentSessionId?: string;
  transcript: string[];
}
/** Tạo side thread — không chạm main session. */
export function openSideThread(
  profiles: ProviderProfile[],
  mode: SideThreadMode,
  parent?: Session,
): SideThread {
  const session = createSession({ profiles });
  if (mode === "new" && parent) {
    // Kế thừa context main: copy stable tier + ctxFiles (branch semantics).
    session.stableTier = parent.stableTier;
    session.ctxFiles = [...parent.ctxFiles];
  }
  // tangent: contextless — session trống, không copy gì.
  return {
    id: `side_${crypto.randomUUID().slice(0, 8)}`,
    mode,
    session,
    parentSessionId: mode === "new" ? (parent as { id?: string } | undefined)?.id : undefined,
    transcript: [],
  };
}
/** Ghi turn vào transcript side thread — main transcript KHÔNG đổi. */
export function appendTurn(t: SideThread, role: "user" | "assistant", text: string): void {
  t.transcript.push(`${role}: ${text}`);
}
/** Kết thúc side thread — trả transcript để ACF inject/summarize. */
export function closeSideThread(t: SideThread): string[] {
  const out = [...t.transcript];
  t.transcript = [];
  return out;
}
//        appendTurn(t, "user", "so sánh 2 phương án X vs Y");
//        const raw = closeSideThread(t); // → summarize → main
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Main transcript không phình — chỉ kết quả chọn lọc vào prompt | ❌ Side thread không thấy được main context (trừ /btw:new) |
| ✅ Brainstorm tự do không derail luồng chính | ❌ Kết quả phải handoff thủ công (inject/summarize) |
| ✅ 3 mức context — linh hoạt theo nhu cầu | ❌ Nhiều session song song → tốn memory nếu quên close |
| ✅ Overlay TUI — user thấy side thread tách biệt | ❌ Kế thừa context có thể mang stale state nếu không clone đúng |

## Khác các hướng gần

| | Session branch (session-branch.ts) | ACE: Side Thread |
|---|---|---|
| Mục đích | Phân nhánh luồng chính (compression/delegate) | **Không gian suy nghĩ song song, tách transcript** |
| Kết quả | Branch có thể quay lại làm main | **Chỉ handoff kết quả chọn lọc về main** |
| Context | Kế thừa routing | **3 mức: aside (rỗng) / new (kế thừa) / tangent (trống)** |
| UI | Không có overlay | **Overlay TUI — panel phụ riêng** |

## Khi nào chọn

- Agent cần brainstorm/điều tra song song mà không muốn phình context chính
- User muốn hỏi câu phụ ("btw...") mà không derail task đang chạy
- Muốn so sánh nhiều phương án rồi chỉ đưa kết luận về main
- Guard: mọi side thread phải close (inject/summarize hoặc discard), overlay tách biệt transcript
