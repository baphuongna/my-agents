# Hướng PL: Idle-Gated Session Messaging — nhắn liên phiên chặn-mở theo idle status, inboundTrigger khi idle

> **Nguồn gốc:** pi-intercom (index.ts — lifecycleStatus idle/thinking/tool, inboundTrigger always/replies/never, sendIncomingMessage trigger/followUp); "idle-gated message delivery"; "cross-session messaging"; "inbound trigger policy"; "lifecycle status gating"
> **Coupling:** 🟡 — thêm idle-gating + inbound trigger policy vào intercom/messaging layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (pi-intercom lifecycleStatus + inboundTrigger + sendIncomingMessage sẵn — chưa có trong mya intercom)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**pi-intercom** (`index.ts`, `config.ts`) nhắn liên phiên theo **idle-gated delivery** — message chỉ **trigger** model turn khi recipient **idle**. `lifecycleStatus` computed: `tool:${activeToolName}` (đang chạy tool), `thinking` (agent đang generate), `idle` (agent rảnh). Khi message đến: `shouldTriggerInboundMessage()` check `inboundTrigger` policy: (1) **always** — trigger luôn (gửi vào context ngay, khởi model turn). (2) **replies** — chỉ trigger nếu là reply. (3) **never** — không trigger (chỉ queue, đợi user ask). `sendIncomingMessage()` quyết định delivery mode: `trigger` (inject + start turn) hay `followUp` (queue, deliver khi agent idle tiếp theo). Khi agent **không idle** (thinking/tool) → message **followUp** (queue), không interrupt. Khi agent **idle** → message **trigger** (inject + turn). Nguyên tắc: **không interrupt agent đang chạy** — message đợi agent rảnh rồi mới trigger. Khác **393 dual-channel** (2 kênh communication) — PL là **idle-gating** (chặn-mở theo status).

## Mô tả

mya idle-gated session messaging: khi message liên phiên đến → **gate theo lifecycle status** — (1) **Status check**: recipient `lifecycleStatus` = idle / thinking / tool. (2) **Idle → trigger**: agent rảnh → inject message vào context + start model turn (agent thấy message ngay). (3) **Busy → followUp**: agent đang think/tool → queue message, deliver khi agent idle tiếp theo (không interrupt). (4) **inboundTrigger policy**: always (trigger mọi message) / replies (chỉ trigger reply) / never (chỉ queue). Agent không bị interrupt giữa chừng — message đợi rảnh rồi mới thấy. mya có intercom/messaging — PL thêm **idle-gating** (lifecycleStatus check + trigger/followUp delivery + inboundTrigger policy).

## Kiến trúc

```
  SESSION A (sender) → MESSAGE → SESSION B (recipient)

  RECIPIENT LIFECYCLE STATUS:
  ┌────────────────────────────────────────────────┐
  │  tool:edit_file  → BUSY (running tool)          │
  │  thinking        → BUSY (generating response)   │
  │  idle            → AVAILABLE (agent rảnh)        │
  └────────────────────────────────────────────────┘

  MESSAGE DELIVERY GATE:
                    ┌─── is recipient IDLE? ────┐
                    │                            │
         YES ───────┤                            ├─────── NO (busy)
                    │                            │
                    ▼                            ▼
           ┌─── TRIGGER ────┐           ┌─── FOLLOWUP ───┐
           │  inject message │           │  queue message  │
           │  into context   │           │  (hold)          │
           │  start model    │           │                  │
           │  turn           │           │  when agent →    │
           │  (agent sees    │           │  idle next:      │
           │   message NOW)  │           │  → deliver as    │
           └─────────────────┘           │    trigger       │
                                         └──────────────────┘

  INBOUND TRIGGER POLICY (config.inboundTrigger):
    "always"  → trigger mọi inbound message (when idle)
    "replies" → chỉ trigger nếu message là reply
    "never"   → không trigger, chỉ queue (user phải ask)

  RESULT: agent KHÔNG bị interrupt giữa chừng
  → message đợi agent rảnh (idle) rồi mới trigger
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ intercom / messaging (packages/intercom) — cross-session messaging (nền — PL = idle-gating)
// ✅ 393 dual-channel-agent-communication — 2 kênh (nền — PL = idle-gating trên 1 kênh)
// ✅ pi-intercom lifecycleStatus + inboundTrigger (source/ — reference impl)

// ❌ THIẾU: lifecycleStatus tracking (idle/thinking/tool per session)
// ❌ THIẾU: idle-gate delivery (idle → trigger, busy → followUp queue)
// ❌ THIẾU: inboundTrigger policy (always/replies/never)
// ❌ THIẾU: followUp flush (when agent → idle, deliver queued messages)
```

## Implementation

```typescript
// packages/agent/src/idle-gated-messaging.ts (MỚI — port từ pi-intercom)
type LifecycleStatus = 'idle' | 'thinking' | string; // string = `tool:${name}`
type InboundTriggerPolicy = 'always' | 'replies' | 'never';
type DeliveryMode = 'trigger' | 'followUp';

interface InboundMessage {
  from: string;
  bodyText: string;
  isReply: boolean;
  replyTo?: string;
}

interface QueuedMessage {
  message: InboundMessage;
  queuedAt: number;
}

class IdleGatedMessenger {
  private agentRunning = false;
  private activeTools = new Set<string>();
  private queue: QueuedMessage[] = [];
  private triggerPolicy: InboundTriggerPolicy = 'always';

  // Compute lifecycle status
  getLifecycleStatus(): LifecycleStatus {
    const activeTool = this.activeTools.values().next().value;
    return activeTool ? `tool:${activeTool}` : this.agentRunning ? 'thinking' : 'idle';
  }

  // Should this message trigger a model turn?
  private shouldTrigger(msg: InboundMessage): boolean {
    if (this.triggerPolicy === 'never') return false;
    if (this.triggerPolicy === 'replies') return msg.isReply;
    return true; // 'always'
  }

  // Receive inbound message — gate by lifecycle status
  receiveMessage(msg: InboundMessage): { delivery: DeliveryMode; queued: boolean } {
    const status = this.getLifecycleStatus();

    if (status === 'idle') {
      // Agent rảnh → trigger (if policy allows)
      if (this.shouldTrigger(msg)) {
        this.deliverAsTrigger(msg);
        return { delivery: 'trigger', queued: false };
      }
    }

    // Agent busy OR policy says don't trigger → followUp (queue)
    this.queue.push({ message: msg, queuedAt: Date.now() });
    return { delivery: 'followUp', queued: true };
  }

  // Called when agent transitions to idle — flush queued messages
  onIdle(): void {
    if (this.queue.length === 0) return;
    // Deliver first queued message as trigger, rest as followUp
    const first = this.queue.shift()!;
    if (this.shouldTrigger(first.message)) {
      this.deliverAsTrigger(first.message);
    }
    // Remaining stay queued for next idle cycle
  }

  // Lifecycle hooks (called by agent runtime)
  onAgentStart(): void { this.agentRunning = true; }
  onAgentEnd(): void {
    this.agentRunning = false;
    this.onIdle(); // flush queue when agent finishes
  }
  onToolStart(name: string): void { this.activeTools.add(name); }
  onToolEnd(name: string): void { this.activeTools.delete(name); }

  private deliverAsTrigger(msg: InboundMessage): void {
    // Inject message into agent context + start model turn
    // (actual injection delegated to agent runtime)
  }
}

// Usage:
// messenger.receiveMessage({ from: "session-A", bodyText: "hey", isReply: false });
// → if idle: trigger (agent sees message now)
// → if busy: followUp (queue, deliver when idle)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không interrupt (agent busy → message queue, không phá flow) | ❌ Latency (message đợi agent idle → chậm) |
| ✅ Policy control (always/replies/never — user kiểm soát) | ❌ Queue overflow (nhiều message → stack, cần cap) |
| ✅ Idle-trigger (agent rảnh → thấy message ngay) | ❌ Race condition (idle check + agent start cùng lúc) |
| ✅ Lifecycle-aware (tool/thinking/idle — granularity) | ❌ FollowUp ordering (queue FIFO có thể sai priority) |

## Khác các hướng gần

| | 393 Dual-Channel | PL: Idle-Gated-Messaging |
|---|---|---|
| Cái gì | 2 kênh communication | **Idle-gating trên messaging** |
| Interrupt | Có thể | **Không (busy → queue)** |
| Policy | ❌ | ✅ always/replies/never |
| Lifecycle | ❌ | ✅ idle/thinking/tool |

## Khi nào chọn

- Cross-session messaging (agent nhận message khi đang chạy)
- Muốn không interrupt (agent busy → message queue, idle → trigger)
- Muốn policy control (always/replies/never — user quyết định)
- Nối 393 dual-channel (PL = idle-gating layer trên messaging channel) + intercom (PL = lifecycle-aware delivery); guard race condition (idle check + agent start cùng lúc → message lost hoặc double-trigger)
