# Hướng QB: Channel Docking — chuyển phiên giữa chừng sang kênh khác, lịch sử giữ nguyên

> **Nguồn gốc:** OpenClaw (channel docking); "session migration across transports"; "live session handoff"; "stateful session transfer"; "cross-channel continuity"
> **Coupling:** 🟡 — cần session serialization + cross-transport handoff
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session store + transport layer sẵn — chưa có docking protocol + state transfer)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenClaw** cho phép **dock** (chuyển) phiên giữa chừng từ kênh này sang kênh khác: đang chat trên **web** → muốn tiếp tục trên **CLI** hoặc **mobile**. Toàn bộ **lịch sử + agent state** được serialize → transfer → restore trên kênh đích. User không mất context, agent tiếp tục y như chưa đổi kênh. Giống **mobile handoff** (cellular network: chuyển tower giữa chừng) và **session migration** (cloud: move VM giữa host). Nguyên tắc: **session = portable state**, không gắn vào transport. Khác **93 hybrid-local-cloud** (split compute) — QB là **session transfer** (move toàn bộ); khác transport layer (deliver message) — QB là **session lifecycle** (serialize/restore).

## Mô tả

mya channel docking: session có **dock token** (unique ID). Khi user muốn đổi kênh → **serialize** (message history + agent state + memory refs → dock payload) → user mang token sang kênh đích → **restore** (dock payload → new session trên transport đích). Agent tiếp tục với state đầy đủ. Dock payload bao gồm: (1) message history (full), (2) agent working state (pending tool calls, plan), (3) memory references (which memories loaded). Nối transport layer + session store + 93 hybrid-local-cloud.

## Kiến trúc

```
  CHANNEL A (web):
  ┌──────────────────────────────────┐
  │  Session #42                     │
  │  [user] fix the auth bug         │
  │  [agent] found it, fixing...     │
  │  [agent] ✅ fixed + test pass    │
  │  ── DOCK REQUEST ──              │
  │  serialize → dock payload        │
  └──────────────┬───────────────────┘
                 │  dock token: "abc-123"
                 │  payload: { history, state, memRefs }
                 ▼
  ┌─── DOCK PROTOCOL ────────────────────────┐
  │  1. SERIALIZE session → payload          │
  │  2. GENERATE dock token                  │
  │  3. TRANSFER payload to target channel   │
  │  4. RESTORE on target → new session      │
  └──────────────┬───────────────────────────┘
                 │
                 ▼
  CHANNEL B (CLI):
  ┌──────────────────────────────────┐
  │  mya --dock abc-123              │
  │  → RESTORE dock payload          │
  │  Session #42 (continued)         │
  │  [user] great, now deploy it     │  ← continue seamlessly
  │  [agent] deploying...            │
  └──────────────────────────────────┘
  → history + state preserved, 0 context loss
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session store — session persistence (nền — QB adds dock protocol)
// ✅ transport layer — multi-transport (web/CLI/desktop) (nền — QB = session transfer)
// ✅ 93 hybrid-local-cloud — split compute (relate — QB = full transfer)
// ✅ message history — full history available (serialize source)

// ❌ THIẾU: dock token (unique transfer ID)
// ❌ THIẾU: dock payload serialization (history + state + memRefs)
// ❌ THIẾU: dock restore protocol (payload → new session on target transport)
// ❌ THIẾU: transport capability negotiation (target supports all features?)
```

## Implementation

```typescript
// packages/agent/src/channel-docking.ts (NEW)
import { randomUUID } from 'node:crypto';

interface DockPayload {
  sessionId: string;
  messageHistory: { role: string; content: string; timestamp: number }[];
  agentState: {
    pendingToolCalls: unknown[];
    currentPlan: string | null;
    loadedMemoryRefs: string[];
  };
  metadata: { sourceChannel: string; dockedAt: number };
}

class ChannelDocker {
  // Serialize current session → dock payload + token
  async dock(
    sessionId: string,
    history: DockPayload['messageHistory'],
    agentState: DockPayload['agentState'],
    sourceChannel: string,
  ): Promise<string> {
    const token = randomUUID();
    const payload: DockPayload = {
      sessionId, messageHistory: history, agentState,
      metadata: { sourceChannel, dockedAt: Date.now() },
    };
    await this.store.set(`dock:${token}`, JSON.stringify(payload), 300); // 5 min TTL
    return token;
  }

  // Restore dock payload → new session on target transport
  async undock(token: string): Promise<DockPayload> {
    const raw = await this.store.get(`dock:${token}`);
    if (!raw) throw new Error(`Dock token ${token} expired or invalid`);
    await this.store.del(`dock:${token}`); // one-time use
    return JSON.parse(raw) as DockPayload;
  }

  // Negotiate: does target channel support all features from source?
  negotiate(payload: DockPayload, targetCapabilities: string[]): boolean {
    // Check if target transport supports all required features
    return true;
  }

  private store = { // injected session store abstraction
    async get(_k: string): Promise<string | null> { return null; },
    async set(_k: string, _v: string, _ttl: number): Promise<void> {},
    async del(_k: string): Promise<void> {},
  };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cross-channel continuity (web → CLI → mobile, 0 context loss) | ❌ Serialization cost (full history + state → payload) |
| ✅ User flexibility (đổi kênh khi tiện, không phải lại từ đầu) | ❌ Transport capability mismatch (target thiếu feature) |
| ✅ Portable session (session = data, không gắn transport) | ❌ Security (dock token = session access, cần protect) |
| ✅ Handoff smooth (giống mobile handoff) | ❌ TTL expiry (token hết hạn nếu chờ quá lâu) |

## Khác các hướng gần

| | 93 Hybrid-Local-Cloud | Transport Layer | Session Store | QB: Channel-Docking |
|---|---|---|---|---|
| Trọng tâm | Split compute | Deliver message | Persist session | **Transfer session** |
| Khi | Compute offload | Every message | End of session | **Mid-session move** |
| Transfer | Partial (compute) | Message only | — | **Full (history + state)** |

## Khi nào chọn

- User cần đổi kênh giữa chừng (web → CLI, desktop → mobile)
- Cần cross-channel continuity (0 context loss)
- Session phải portable (không gắn vào 1 transport)
- Nối transport layer + session store + 93 hybrid-local-cloud
