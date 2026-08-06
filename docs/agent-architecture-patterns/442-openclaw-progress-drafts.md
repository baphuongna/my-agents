# Hướng PZ: Progress Drafts — 1 message trạng thái sửa tại chỗ thay vì spam tin

> **Nguồn gốc:** OpenClaw (progress drafts); "in-place status editing"; "single live message pattern"; "streaming status bar"; "mutable assistant message"
> **Coupling:** 🟢 — thêm mutable-message + edit-in-place layer trên transport
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (message editing + streaming sẵn — chưa có progress-draft lifecycle + in-place mutation)
> **Effort:** 1-2 tuần

## Nguồn gốc

**OpenClaw** giải quyết vấn đề **progress spam**: agent gửi 5-10 message "đang đọc file...", "đang sửa...", "đang chạy test..." → user bị ngập tin. **Progress drafts**: agent duy trì **1 message duy nhất** (progress draft) và **sửa tại chỗ** (edit-in-place) thay vì gửi mới. Giống **status bar** (mutable, single slot) và **progress indicator** (updates in place). Nguyên tắc: **status = mutable, result = immutable** — tiến trình sửa tại chỗ, kết quả mới gửi message mới. Khác **99 progressive-disclosure** (curate what to show) — PZ là **how to show** (mutate vs spam); khác streaming (token-by-token append) — PZ là **semantic update** (thay cả block status).

## Mô tả

mya progress drafts: agent tạo **1 draft message** khi bắt đầu task multi-step. Mỗi bước hoàn thành → **edit message tại chỗ** (update status: "✅ Step 1 done → Step 2..."). Khi task hoàn tất → **finalize** (draft → immutable result message). Transport cần hỗ trợ **message edit** (patch content). User thấy 1 message "sống" (cập nhật liên tục) thay vì 10 tin rời. Nối agent-loop (turn output) + transport message-edit + 401 observability (visible progress).

## Kiến trúc

```
  WITHOUT progress drafts (SPAM):
  [agent] "Reading auth.ts..."          ← msg 1
  [agent] "Found the bug in line 42"    ← msg 2
  [agent] "Fixing..."                   ← msg 3
  [agent] "Running tests..."            ← msg 4
  [agent] "Done! All tests pass."       ← msg 5
  → 5 messages, user ngập tin

  WITH progress drafts (1 MUTABLE MESSAGE):
  ┌─────────────────────────────────────────────┐
  │  [agent] 📋 Progress                        │  ← draft (mutable)
  │  ───────────────────────────                │
  │  ✅ Reading auth.ts          (done)         │
  │  ✅ Found bug in line 42     (done)         │
  │  ✅ Fixing...                (done)         │
  │  ✅ Running tests...         (done)         │
  │  ✅ Done! All tests pass.    (final)        │
  │                                             │
  │  ↑ EDITED IN PLACE 5 times                 │
  │    (1 message slot, not 5 messages)        │
  └─────────────────────────────────────────────┘
  → 1 message, user thấy 1 "live status"
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ agent-loop — turn output (nền — PZ adds mutable output)
// ✅ message editing — transport hỗ trợ edit (nền — PZ uses for progress)
// ✅ streaming — token streaming (relate — PZ = semantic, not token-level)
// ✅ 401 observability-driven-harness — visible progress (relate)

// ❌ THIẾU: progress-draft lifecycle (create → update → finalize)
// ❌ THIẾU: in-place mutation API (edit existing message content)
// ❌ THIếU: status template (checklist / progress bar format)
// ❌ THIẾU: finalization protocol (draft → immutable result)
```

## Implementation

```typescript
// packages/agent/src/progress-draft.ts (NEW)
interface ProgressStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

class ProgressDraft {
  private steps: ProgressStep[] = [];
  private messageId: string | null = null;
  private finalized = false;

  constructor(private transport: { edit: (id: string, content: string) => Promise<void>; send: (content: string) => Promise<string> }) {}

  async begin(title: string, stepLabels: string[]): Promise<void> {
    this.steps = stepLabels.map((label) => ({ label, status: 'pending' as const }));
    this.messageId = await this.transport.send(this.render(title));
  }

  async update(stepIndex: number, status: ProgressStep['status']): Promise<void> {
    if (this.finalized || !this.messageId) return;
    this.steps[stepIndex]!.status = status;
    await this.transport.edit(this.messageId, this.render());
  }

  async finalize(title: string): Promise<void> {
    if (!this.messageId) return;
    this.finalized = true;
    await this.transport.edit(this.messageId, this.render(title));
    // Draft becomes immutable result
  }

  private render(title?: string): string {
    const header = title ? `📋 ${title}\n` : '📋 Progress\n';
    const body = this.steps
      .map((s) => {
        const icon = s.status === 'done' ? '✅' : s.status === 'active' ? '🔄' : s.status === 'error' ? '❌' : '⬜';
        return `${icon} ${s.label}`;
      })
      .join('\n');
    return `${header}${'─'.repeat(30)}\n${body}`;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không spam user (1 message thay vì N) | ❌ Transport phải hỗ trợ message edit (không phải tất cả) |
| ✅ UX sạch (live status, dễ theo dõi) | ❌ Mất history từng bước (chỉ thấy final state) |
| ✅ Tiết kiệm token (edit thay vì resend) | ❌ Race condition nếu edit đến khi user đã scroll |
| ✅ Progress visible (checklist trực quan) | ❌ Phức tạp nếu user cần log đầy đủ từng bước |

## Khác các hướng gần

| | 99 Progressive-Disclosure | Streaming | 401 Observability | PZ: Progress-Drafts |
|---|---|---|---|---|
| Trọng tâm | What to show | How to stream | What to observe | **How to show (mutate)** |
| Cơ chế | Tiered loading | Token append | Harness visibility | **Edit-in-place** |
| Message count | N (curated) | 1 (growing) | N (logs) | **1 (mutable)** |

## Khi nào chọn

- Agent chạy task multi-step (đọc → sửa → test → deploy)
- User bị ngập progress message (spam)
- Transport hỗ trợ message edit (web, desktop — không phải CLI raw)
- Muốn UX sạch (1 live status thay vì log dải dài)
- Nối agent-loop + 401 observability-driven-harness + transport message-edit
