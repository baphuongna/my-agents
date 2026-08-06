# Hướng JJJJJJ: Cross-Device Sessions — session/context/env nhất quán khi đổi máy

> **Nguồn gốc:** Ably "Multi-device AI session continuity" (channel-based architecture); Fast.io "AI Agent Offline Sync Guide 2026"; Warp "Agent Session Sharing"; Anthropic Cursor/Claude Code cross-device session requests (x/61398)
> **Coupling:** 🟡 — session state phải tách khỏi máy (transport riêng)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (durable execution + session JSONL + intercom sẵn; thiếu sync + presence)
> **Effort:** 2-3 tuần

## Nguồn gốc

Cross-device sessions: **session/context/env đổi máy vẫn tiếp tục — "git làm repo là hằng số"** — Ably: "Channel-based architecture decouples session state from transport, enabling resumable, multi-device AI conversations with presence tracking"; LinkedIn (Adam G.): "The real gap is continuity. Sessions, context, and environment should persist across devices, just like git made the repo the constant"; Fast.io 2026: "Once synced, state persists across sessions, agents resume exactly where they stopped, even after hours offline"; Anthropic issue x/61398: "Resume the same session from a different device — today impossible, session tied to originating PC". Điểm khác **UUUU durable** (sống sót crash — cùng máy) và **PPPPP memory sync** (memory đa máy) — JJJJJJ *giải phóng khỏi máy*: tách session state khỏi transport (Ably channel), agent đổi máy/đổi client nhận đúng state + presence (ai đang xem). Nối UUUU (durable — nền), QQQQ (artifact — sync kết quả), TT (checkpoint), RRRR (nén context khi sync).

## Mô tả

mya cross-device: (1) **tách state khỏi transport** — session (context, stack, env, cwd, artifacts) thành state riêng (Ably channel/server state) không dính client; (2) **resume từ máy khác** — `resume <session>` trên máy B: nhận state lưu (UUUU durable/checkpoint TT), tiếp tục đúng chỗ kể cả offline trong lúc đổi máy (Fast.io); (3) **presence** — biết ai đang mở session (chỉnh sửa song song — Warp: "view, steer, interact in real time or async"); (4) **sync chọn lọc** — artifacts/context nén (RRRR) đồng bộ qua server/thunder; dữ liệu nhạy cảm giữ local (HHHHHH edge/IIII TEE) nếu policy; (5) **conflict** — 2 máy cùng sửa → merge theo last-write/version (QQQQ MAV version); (6) **an toàn** — session state đi qua mạng → mã hóa (KKKK secret), chỉ user đúng identity truy cập.

## Kiến trúc

```
  MÁY A ──► SESSION STATE (context/stack/env/checkpoint — tách khỏi transport)
        │  (Ably channel / server state — không dính client)
        ▼
  PRESENCE: ai đang mở · ai đang sửa (Warp: view/steer/interact)
        │
        ▼
  MÁY B: resume <session> — nhận state + checkpoint UUUU/TT → tiếp tục đúng chỗ
        │  offline trong lúc đổi máy — vẫn resume (Fast.io 2026)
        ▼
  SYNC CHỌN LỌC: artifact nén (RRRR) · nhạy cảm giữ local policy (IIII/CDC)
        │
        ▼
  CONFLICT: 2 máy sửa → merge theo version (QQQQ MAV) · mã hóa (KKKK)
```

```
mya: durable + session JSONL + intercom SẸN — thiếu: state/transport tách + presence + sync
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ UUUU durable — state sống sót crash (nền resume)
// ✅ TT checkpoint — dừng/tiếp tục (resume đúng chỗ)
// ✅ QQQQ artifact — version output (sync + conflict)
// ✅ RRRR long-context — nén context (sync nhẹ)
// ✅ KKKK secret — mã hóa dữ liệu qua mạng

// ❌ THIẾU: session state tách khỏi máy (channel/server)
// ❌ THIẾU: presence (ai đang mở)
// ❌ THIẾU: sync engine (đẩy/kéo state đa máy)
```

## Implementation

```typescript
// packages/sessions/src/sync.ts (NEW)
export class SessionSync {
  constructor(private store: StateStore) {}
  async resume(id: SessionId, device: Device): Promise<Session> {
    const s = await this.store.load(id);       // state tách transport (Ably)
    presence.on(id, { device });               // ai đang mở
    return s.resume(this.checkpoint(id));      // TT — đúng chỗ đã dừng
  }
  async sync(id: SessionId, device: Device) {
    artifacts.sync(id, compress(ctx));         // RRRR — chọn lọc, nhạy cảm giữ local
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đổi máy không mất context — tiếp tục đúng chỗ | ❌ State qua mạng — cần mã hóa + identity (KKKK) |
| ✅ Offline giữa lúc đổi máy vẫn resume (Fast.io) | ❐ Sync context lớn — tốn (nén RRRR) |
| ✅ Collaboration real-time (presence — Warp) | ❌ Conflict 2 máy sửa — cần merge (QQQQ) |
| ✅ Xây trên durable + checkpoint | ❌ 1 máy 1 người không cần — thêm vận hành |

## Khác các hướng gần

| | UUUU Durable | TT Checkpoint | JJJJJJ: Cross-Device |
|---|---|---|---|
| Phạm vi | Cùng máy | Cùng máy | **Nhiều máy/client** |
| Mục đích | Sống sót crash | Resume | **Tách state khỏi transport + presence** |
| Thêm so với durable | — | — | **Sync + presence + conflict** |

## Khi nào chọn

- Làm việc nhiều máy (work laptop + nhà) — không muốn mất agent session
- Muốn nhìn/điều khiển agent session từ xa (collab)
- Đã có UUUU + TT + QQQQ — thêm sync + presence
- Team dùng chung agent session (Warp-style)