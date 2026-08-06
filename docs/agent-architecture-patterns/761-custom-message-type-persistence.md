# Hướng ACG: Custom Message Type Persistence — extension định nghĩa custom message types để persist trạng thái thread vào transcript, khôi phục và inspect được

> **Nguồn gốc:** pi-btw (extensions/btw.ts) | **Coupling:** 🟢 — extension-level, core session chỉ cần custom entry kind | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có EntryKind "custom" + JSONL tree — chưa có typed custom message) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-btw** định nghĩa các **custom message types riêng** — `btw-note`, `btw-thread-entry`, `btw-thread-reset`, `btw-model-override` — để **persist trạng thái thread vào transcript**. Thay vì giữ side-thread state trong memory của extension process (mất khi restart), trạng thái được ghi vào **chính transcript session** dưới dạng message có type riêng, nhờ đó: (1) **khôi phục được** — restart session vẫn thấy thread cũ; (2) **inspect được** — user/agent đọc transcript thấy lịch sử đầy đủ của side conversation như một phần của session; (3) `btw-model-override` cho phép thread chạy model khác main. Nguyên tắc: **state của extension = message trong transcript** — không có state ẩn ngoài session.

## Mô tả

mya custom message type persistence: (1) **typed custom entries** — core/session-utils.ts đã có `EntryKind = "custom"` với `content: unknown` — ACG thêm **discriminated union** cho nội dung custom: `{ kind: "btw-note" | "btw-thread-entry" | "btw-thread-reset" | "btw-model-override", payload }`; (2) **persist** — mỗi hành động side-thread ghi một custom entry vào history (thread mở → `btw-thread-entry`, reset → `btw-thread-reset`); (3) **rehydrate** — khi session load lại, quét custom entries để dựng lại trạng thái thread (thread đang mở, model override đang áp dụng); (4) **inspect** — transcript hiển thị custom entries dạng readable (không phải JSON thô). Nối ACE/ACF — ACG là lớp persist cho side-thread.

## Kiến trúc

```
  SIDE THREAD ACTION
       ▼
  CUSTOM MESSAGE (typed — discriminated union)
    ├─ btw-note          — ghi chú nhanh (không phải turn)
    ├─ btw-thread-entry  — một turn của side thread
    ├─ btw-thread-reset  — thread đã close/reset (sau handoff thành công)
    └─ btw-model-override— side thread chạy model khác main
       ▼
  TRANSCRIPT (session-utils EntryKind "custom" — JSONL tree)
       ├─ RESTART → quét custom entries → rehydrate trạng thái thread
       └─ INSPECT → render custom entries readable (không JSON thô)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session-utils.ts — EntryKind "custom" + tree-structured JSONL
//   (nền — ACG persist custom message)
// ✅ packages/core session.ts — History.append (entries lưu mọi kind)
// ✅ packages/intercom extension-api.ts — IntercomExtensionState {revision, payload}
//   (nền — extension state sync, nhưng chưa vào transcript)
// ✅ packages/intercom types.ts — Message + Attachment ("context" type) (nền wire)

// ❌ THIẾU: discriminated union cho custom entry content
// ❌ THIẾU: rehydrate trạng thái từ custom entries khi restart
// ❌ THIẾU: render readable custom entries (inspect)
```
## Implementation
```typescript
// packages/intercom/src/custom-message.ts (MỚI)
import type { SessionEntry } from "@my-agent/core";
/** Discriminated union — custom message types của extension. */
export type CustomMessage =
  | { kind: "btw-note"; text: string; ts: number }
  | { kind: "btw-thread-entry"; threadId: string; role: "user" | "assistant"; text: string }
  | { kind: "btw-thread-reset"; threadId: string; reason: "handoff" | "discard" }
  | { kind: "btw-model-override"; threadId: string; model: string };
export function isCustomMessage(v: unknown): v is CustomMessage {
  if (typeof v !== "object" || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  return (
    k === "btw-note" || k === "btw-thread-entry" ||
    k === "btw-thread-reset" || k === "btw-model-override"
  );
}
/** Ghi một custom message vào transcript (persist). */
export function persistCustom(append: (e: SessionEntry) => void, msg: CustomMessage): void {
  append({
    id: crypto.randomUUID(),
    parentId: null,
    kind: "custom",
    role: "system",
    content: msg,
  });
}
/** Rehydrate: quét custom entries dựng lại trạng thái thread. */
export function rehydrateThreads(entries: readonly SessionEntry[]): Map<string, CustomMessage[]> {
  const threads = new Map<string, CustomMessage[]>();
  for (const e of entries) {
    if (e.kind !== "custom") continue;
    const msg = e.content;
    if (!isCustomMessage(msg)) continue;
    if (msg.kind === "btw-thread-entry" || msg.kind === "btw-thread-reset" ||
        msg.kind === "btw-model-override") {
      const list = threads.get(msg.threadId) ?? [];
      list.push(msg);
      threads.set(msg.threadId, list);
    }
  }
  return threads;
}
/** Render custom message readable — không phải JSON thô. */
export function renderCustom(msg: CustomMessage): string {
  switch (msg.kind) {
    case "btw-note": return `📝 note: ${msg.text}`;
    case "btw-thread-entry": return `🧵 [${msg.threadId}] ${msg.role}: ${msg.text}`;
    case "btw-thread-reset": return `♻️ [${msg.threadId}] reset (${msg.reason})`;
    case "btw-model-override": return `🤖 [${msg.threadId}] model → ${msg.model}`;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ State extension nằm trong transcript — restart không mất | ❌ Transcript nhiều entry custom — cần lọc khi render prompt |
| ✅ Khôi phục + inspect được như phần của session | ❌ Entry custom có thể bị compression xử lý sai nếu không đánh dấu |
| ✅ Model override persist — thread tiếp tục đúng model | ❌ Discriminated union phải mở rộng khi thêm type mới |
| ✅ Nối JSONL tree — audit thấy toàn bộ hành động | ❌ Custom content phải validate (isCustomMessage) trước khi dùng |

## Khác các hướng gần

| | IntercomExtensionState (extension-api.ts) | ACG: Custom Message |
|---|---|---|
| Nơi lưu | Extension registry (revision + payload) | **Transcript session (EntryKind custom)** |
| Tuổi thọ | Sống theo extension process | **Persist cùng session JSONL** |
| Inspect | Snapshot riêng | **Đọc được trong transcript** |
| Phục hồi | Re-register lại | **Rehydrate từ custom entries** |

## Khi nào chọn

- Extension có trạng thái cần sống sót qua restart session (side thread, model override)
- Muốn toàn bộ hành động agent nằm trong transcript để audit/inspect
- Muốn nhiều extension cùng dùng cơ chế custom entry (không đập vào core)
- Guard: validate mọi custom content, render readable, đánh dấu để compression không nuốt
