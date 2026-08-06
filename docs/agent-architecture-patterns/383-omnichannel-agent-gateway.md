# Hướng NS: Omnichannel Agent Gateway — 1 agent phục vụ ~22 kênh chat (WhatsApp/Telegram/Zalo/Signal)

> **Nguồn gốc:** Omnichannel customer engagement (Twilio/Zendesk); transport-agnostic gateway; "channel adapter"; "chatops"; openclaw; adapter pattern (GoF)
> **Coupling:** 🟡 — thêm channel adapters + identity bridge vào gateway
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (gateway + channel-adapters sẵn — chưa phủ đầy đủ 22 kênh)
> **Effort:** 3-5 tuần

## Nguồn gốc

**Omnichannel** (Twilio, Zendesk, Intercom): 1 backend phục vụ nhiều kênh (SMS, WhatsApp, web chat, email) — user chọn kênh, hệ thống normalize về 1 format nội bộ. **Transport-agnostic gateway**: agent không biết/care kênh nào — gateway dịch kênh ↔ agent message. **Channel adapter** (adapter pattern): mỗi kênh (WhatsApp/Telegram/Zalo/Signal/Messenger) có adapter riêng (API, auth, format, rate limit) → normalize về common schema. **ChatOps**: agent tương tác qua chat platform. Nguyên tắc: **tách agent khỏi kênh** — agent chỉ thấy common message; gateway lo đa kênh + identity. Khác **381 broker** (session↔session cùng hệ thống) — NS là **kênh ngoài ↔ agent**.

## Mô tả

mya omnichannel gateway: 1 agent (hoặc N agent) phục vụ ~22 kênh chat. Mỗi kênh có **channel adapter** (WhatsApp Business API, Telegram Bot, Zalo OA, Signal, Messenger, Slack, Discord, …) → normalize inbound (text/media) về common message → forward agent → agent reply → adapter translate outbound về kênh. **Channel identity bridge**: user trên nhiều kênh → map về 1 identity (session continuity). mya `packages/gateway` ĐÃ CÓ channel-adapters + channel-bridge + channel-identity (1 phần — chưa đủ 22 kênh).

## Kiến trúc

```
   WHATAPP   TELEGRAM   ZALO   SIGNAL   SLACK   ... (~22 kênh)
      │         │         │       │        │
      ▼         ▼         ▼       ▼        ▼
   ┌── CHANNEL ADAPTERS ────────────────────────────┐
   │  mỗi adapter: API auth, format, rate limit,    │
   │  media download, webhook receive               │
   │      │ normalize inbound → common message      │
   └──────┼─────────────────────────────────────────┘
          ▼
   ┌── CHANNEL BRIDGE ──────────────────────────────┐
   │  · identity map (kênh user → mya identity)     │
   │  · session continuity (cùng user nhiều kênh)   │
   │  · message queue / backpressure               │
   └──────┬─────────────────────────────────────────┘
          ▼ inbound (common message)
       AGENT (agent-agnostic, không biết kênh)
          │ outbound (common reply)
          ▼
   CHANNEL BRIDGE → ADAPTER → kênh tương ứng → user
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/gateway — channel-adapters.ts, channel-adapters-extra.ts
// ✅ packages/gateway — channel-bridge.ts (bridge kênh ↔ agent)
// ✅ packages/gateway — channel-identity.ts (identity map)
// ✅ packages/gateway — approval-relay.ts
// ✅ packages/channels — channel primitives

// ❌ THIẾU: đầy đủ 22 kênh (WhatsApp/Telegram/Zalo/Signal/...)
// ❌ THIẾU: media normalization đa kênh (image/voice/file)
// ❌ THIẾU: per-kênh rate limit + retry
// ❌ THIẾU: webhook ingress đa kênh (1 endpoint nhận tất cả)
```

## Implementation

```typescript
// packages/gateway/src/omnichannel.ts (MỚI — mở rộng channel-adapters)
interface CommonMessage {
  channelId: string;        // 'whatsapp' | 'telegram' | ...
  externalUserId: string;   // ID trong kênh đó
  identityId: string;       // mya identity (qua channel-identity)
  text?: string;
  media?: MediaAttachment[];
  timestamp: number;
}

interface ChannelAdapter {
  channelId: string;
  receiveWebhook(raw: unknown): CommonMessage[];    // normalize inbound
  send(identityId: string, reply: CommonReply): Promise<void>; // translate outbound
}

class OmnichannelGateway {
  constructor(
    private adapters: Map<string, ChannelAdapter>,
    private identity: ChannelIdentity,
    private bridge: ChannelBridge,
  ) {}

  // Inbound — từ bất kỳ kênh → agent
  async inbound(raw: unknown, channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) throw new Error(`no adapter for ${channelId}`);
    for (const msg of adapter.receiveWebhook(raw)) {
      const identityId = this.identity.resolve(msg.channelId, msg.externalUserId);
      await this.bridge.toAgent({ ...msg, identityId });
    }
  }

  // Outbound — agent reply → kênh
  async outbound(identityId: string, reply: CommonReply): Promise<void> {
    const channelId = this.identity.preferredChannel(identityId);
    const adapter = this.adapters.get(channelId);
    await adapter.send(identityId, reply);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 1 agent phục vụ nhiều kênh (reach rộng) | ❌ 22 adapter maintain (mỗi kênh API khác) |
| ✅ Agent không biết kênh (decoupled) | ❌ Webhook ingress phức tạp (auth từng kênh) |
| ✅ Identity continuity (cùng user nhiều kênh) | ❌ Rate limit / format khác nhau mỗi kênh |
| ✅ Thêm kênh = thêm adapter (mở rộng) | ❌ Media normalization (voice/image/file) khó |

## Khác các hướng gần

| | 381 Message Broker | channels pkg | gateway pkg | NS: Omnichannel |
|---|---|---|---|---|
| Cái gì | Session↔session nội bộ | Channel primitives | Bridge 1 phần | **22 kênh ngoài ↔ agent** |
| Ngoài hệ thống | ❌ | 1 phần | 1 phần | ✅ đa kênh |
| Identity map | ❌ | ❌ | 1 phần | ✅ cross-kênh |
| Agent-agnostic | ✅ | ❌ | ✅ | ✅ |

## Khi nào chọn

- Muốn agent reach nhiều kênh chat (WhatsApp/Telegram/Zalo/Signal/...)
- Cần session continuity (cùng user qua nhiều kênh)
- Muốn agent agent-agnostic (không code per-kênh)
- Kết hợp packages/gateway (channel-adapters + channel-bridge + channel-identity); thêm adapter từng kênh + media normalization; kết hợp 384 daemon (gateway always-on)
