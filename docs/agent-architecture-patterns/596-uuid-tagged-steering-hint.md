# Hướng VX: UUID-Tagged Steering Hint — mỗi turn inject steering hint system message với định danh UUID; xóa trong phiên riêng để không dirty history

> **Nguồn gốc:** pi-agent-flow (uuid-tagged steering hint); "inject steering hint as system message each turn"; "each hint has UUID identifier"; "delete in separate session to avoid dirtying history"; "ephemeral steering via UUID lifecycle" | **Coupling:** 🟢 — thêm UUID-tagged system message injection vào turn boundary | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (system message + steer sẵn — chưa có UUID lifecycle + delete) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-agent-flow** bơm **steering hint** vào agent mỗi turn (vd "focus on error handling", "you're at step 3 of 5"). Vấn đề: hint **tích lũy trong history** → context bẩn (nhiều hint cũ không còn liên quan). Giải pháp **UUID-tagged steering hint**: mỗi hint có **UUID định danh**, được inject như **system message** (không phải user message — tách khỏi conversation). Khi hết tác dụng, **xóa hint trong phiên riêng** (separate cleanup session) bằng UUID → **history sạch**, không dirty. Nguyên tắc: **steering ephemeral via UUID lifecycle** — inject có tag, delete có tag, history không vĩnh viễn mang hint. Khác permanent system message (cứng mãi) — VX **ephemeral + UUID cleanup**.

## Mô tả

mya UUID-tagged steering hint: (1) **Inject**: mỗi turn, tạo hint (steering context) + UUID → inject như system message. (2) **UUID tag**: hint message có metadata UUID (định danh duy nhất). (3) **Agent sees**: agent thấy hint như guidance, không biết UUID (transparent). (4) **Delete**: khi hint hết tác dụng, **phiên riêng** (cleanup session) xóa message theo UUID → history không còn hint cũ. (5) **Clean history**: conversation chỉ giữ user/assistant message + hint hiện tại, hint cũ bị dọn. mya có system message + steer — VX thêm **UUID lifecycle** + **separate-delete-session**.

## Kiến trúc

```
  TURN N
  ┌─── INJECT steering hint (UUID-tagged system message) ───┐
  │  system: { uuid: "a1b2-c3d4", text: "Step 3/5: focus auth" }│
  │  user:   "continue working"                                │
  │  → agent thấy hint (steer), không thấy UUID                │
  └───────────────┬───────────────────────────────────────────┘
                  ▼
  TURN N+1 (hint mới, hint cũ hết tác dụng)
  ┌─── INJECT new hint ────────────────────────────────────┐
  │  system: { uuid: "e5f6-g7h8", text: "Step 4/5: focus tests"}│
  └───────────────┬───────────────────────────────────────────┘
                  ▼
  CLEANUP SESSION (phiên riêng, xóa hint cũ)
  ┌─── DELETE by UUID ─────────────────────────────────────┐
  │  delete message uuid "a1b2-c3d4" (hint cũ, hết tác dụng) │
  │  → history sạch: chỉ giữ hint hiện tại                    │
  │  → không dirty (không tích lũy hint cũ)                   │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core loop.ts — agent loop (nền — VX inject ở turn boundary)
// ✅ packages/prompts — system message (nền — VX hint = system message)
// ✅ packages/core session.ts — session (nền — VX cleanup session)
// ✅ 592 VT hook-steer-contract — steer injection (relate — VX = UUID lifecycle cho steer)

// ❌ THIẾU: UUID-tagged system message (hint + UUID metadata)
// ❌ THIẾU: separate delete session (xóa hint theo UUID)
// ❌ THIẾU: hint lifecycle (inject → active → delete → clean history)
```

## Implementation

```typescript
// packages/agent/src/uuid-steering-hint.ts (MỘT)
import { randomUUID } from 'node:crypto';

interface SteeringHint {
  uuid: string;
  role: 'system';
  content: string;
  active: boolean;
}

class UuidTaggedSteeringHint {
  private hints = new Map<string, SteeringHint>();

  // inject: tạo hint + UUID → system message (mỗi turn)
  inject(text: string): SteeringHint {
    const hint: SteeringHint = { uuid: randomUUID(), role: 'system', content: text, active: true };
    this.hints.set(hint.uuid, hint);
    return hint;
  }

  // agent context: chỉ hint active (agent không thấy UUID)
  activeHints(): { role: 'system'; content: string }[] {
    return [...this.hints.values()]
      .filter(h => h.active)
      .map(h => ({ role: 'system' as const, content: h.content }));
  }

  // delete in separate session: xóa hint theo UUID (history sạch)
  delete(uuid: string): boolean {
    return this.hints.delete(uuid);  // xóa khỏi history
  }

  // cleanup: dọn tất cả hint inactive (phiên riêng)
  cleanupInactive(): number {
    let count = 0;
    for (const [uuid, hint] of this.hints) {
      if (!hint.active) { this.hints.delete(uuid); count++; }
    }
    return count;
  }

  // mark inactive (sẵn sàng delete, nhưng chưa xóa)
  deactivate(uuid: string): void {
    const hint = this.hints.get(uuid);
    if (hint) hint.active = false;
  }
}
// Usage:
// const steer = new UuidTaggedSteeringHint();
// const h1 = steer.inject('Step 3/5: focus auth');   // turn N
// const h2 = steer.inject('Step 4/5: focus tests');   // turn N+1
// steer.deactivate(h1.uuid);                          // hint cũ hết tác dụng
// // cleanup session (riêng):
// steer.delete(h1.uuid);  // history sạch, không dirty
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Clean history (hint cũ bị xóa, không tích lũy) | ❌ Session management (phiên riêng để delete) |
| ✅ Ephemeral steering (inject/delete linh hoạt) | ❌ UUID overhead (mỗi hint thêm metadata) |
| ✅ Transparent (agent thấy hint, không thấy UUID) | ❌ Delete timing (quên delete → hint tồn đọng) |
| ✅ Lifecycle rõ (inject → active → delete) | ❌ Race condition (delete khi agent đang dùng hint) |

## Khác các hướng gần

| | Permanent system msg | Ephemeral steer (no UUID) | VX: UUID-Steering-Hint |
|---|---|---|---|
| Lifecycle | Vĩnh viễn | Inject only | **inject → delete (UUID)** |
| History | Bẩn (tích lũy) | ⚠ (khó dọn) | **✅ clean (delete by UUID)** |
| Cleanup | ❌ | Manual | **separate session** |

## Khi nào chọn

- Steering hint thay đổi mỗi turn (step progress, focus shift)
- Muốn history sạch (hint cũ không tích lũy, dirty context)
- Cần lifecycle rõ (inject → active → delete)
- Nối packages/core loop.ts + packages/prompts + session.ts + 592 VT hook-steer-contract; guard delete-safety (không delete hint đang active), cleanup-timing (delete đúng lúc — sau khi agent xử lý), và uuid-stability (UUID không trùng, durable qua session); VX = UUID-tagged steering hint, kết hợp 592 VT (steer injection — VX thêm UUID lifecycle) + 597 VY sanitized-context-fork (xóa steer trong fork relate)
