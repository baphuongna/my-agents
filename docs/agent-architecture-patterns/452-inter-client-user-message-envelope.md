# Hướng QJ: Inter-Client User Message Envelope — JSON envelope trong user message giả, chuyển Cloud→Desktop→CLI

> **Nguồn gốc:** MyAgents (inter-client user message envelope); "fake user message carrier"; "JSON metadata envelope in user-role message"; "cross-client session transfer payload"; "steganographic session handoff"
> **Coupling:** 🟡 — cần envelope parser + cross-client transfer protocol
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (transport + message handling sẵn — chưa có envelope format + fake-user-message carrier)
> **Effort:** 2-3 tuần

## Nguồn gốc

**MyAgents** chuyển phiên giữa client (Cloud → Desktop → CLI) bằng **JSON envelope** giấu trong **user message giả**. Vì nhiều API chỉ cho **2 role** (user/assistant), metadata transfer (session state, context, client info) phải "đóng gói" trong **user-role message**. Envelope = JSON block trong message content, agent (hoặc client đích) parse ra metadata. Giống **steganography** (giấu data trong channel hiện có). Nguyên tắc: **tận dụng user-role slot** — không cần role mới, chỉ cần envelope parse. Khác **444 QB channel-docking** (serialize + dock token) — QJ là **envelope carrier** (giấu trong message); khác transport layer — QJ là **cross-client metadata tunnel**.

## Mô tả

mya inter-client envelope: client A (Cloud) muốn chuyển sang client B (Desktop). Client A đóng gói **session metadata** (history ref, context summary, client capabilities) → JSON envelope → **inject vào user message** (fake: `[user] {"_envelope": {...}}`). Client B nhận message → **parse envelope** → restore context. Agent thấy user message nhưng biết là envelope (marker `_envelope`). Cho phép transfer metadata mà không cần API role mới hay side-channel. Nối transport layer + 444 channel-docking + session store.

## Kiến trúc

```
  CLIENT A (Cloud) → CLIENT B (Desktop):
  ┌──────────────────────────────────────────────────────┐
  │                                                        │
  │  CLIENT A packs session metadata:                      │
  │  {                                                     │
  │    "_envelope": {                                      │
  │      "type": "session-transfer",                       │
  │      "from": "cloud",                                  │
  │      "sessionId": "sess-42",                           │
  │      "contextSummary": "fixing auth bug, step 3/5",    │
  │      "historyRef": "commit-abc123",                    │
  │      "capabilities": ["file-edit", "bash"]             │
  │    }                                                   │
  │  }                                                     │
  │                                                        │
  │  → INJECT as fake user message:                        │
  │  [user] {"_envelope":{"type":"session-transfer",...}} │
  │                                                        │
  │  → TRANSFER to Client B (Desktop)                      │
  │                                                        │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌─── CLIENT B (Desktop) ────────────────────────────────┐
  │                                                        │
  │  RECEIVE user message → DETECT envelope marker:        │
  │  [user] {"_envelope":{...}}   ← has _envelope key     │
  │                                                        │
  │  PARSE envelope → extract metadata:                    │
  │  sessionId: sess-42                                    │
  │  contextSummary: "fixing auth bug, step 3/5"           │
  │  capabilities: [file-edit, bash]                       │
  │                                                        │
  │  RESTORE context → continue session seamlessly         │
  │  → agent knows: "fixing auth bug, step 3/5"            │
  │                                                        │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ transport layer — multi-transport (nền — QJ = cross-client tunnel)
// ✅ message handling — user/assistant message (nền — QJ = envelope in user msg)
// ✅ 444 channel-docking — session transfer (relate — QJ = envelope carrier)
// ✅ session store — session persistence (nền — QJ = metadata carrier)

// ❌ THIẾU: envelope format (JSON schema for session-transfer metadata)
// ❌ THIẾU: fake-user-message injection (pack metadata into user-role msg)
// ❌ THIẾU: envelope parser (detect _envelope marker → extract metadata)
// ❌ THIẾU: cross-client capability negotiation (from → to capabilities)
```

## Implementation

```typescript
// packages/agent/src/message-envelope.ts (NEW)
interface SessionEnvelope {
  _envelope: {
    type: 'session-transfer' | 'capability-query' | 'state-sync';
    from: string;
    to?: string;
    sessionId: string;
    contextSummary?: string;
    historyRef?: string;
    capabilities?: string[];
    timestamp: number;
  };
}

class MessageEnvelope {
  // Pack session metadata → fake user message with envelope
  pack(metadata: Omit<SessionEnvelope['_envelope'], 'timestamp'>): string {
    const envelope: SessionEnvelope = {
      _envelope: { ...metadata, timestamp: Date.now() },
    };
    return JSON.stringify(envelope);
  }

  // Detect + parse envelope from user message
  parse(userMessage: string): SessionEnvelope['_envelope'] | null {
    try {
      const parsed = JSON.parse(userMessage);
      if (parsed && typeof parsed === 'object' && '_envelope' in parsed) {
        return (parsed as SessionEnvelope)._envelope;
      }
    } catch {
      // Not JSON → regular user message, no envelope
    }
    return null;
  }

  // Check if user message is an envelope (not real user input)
  isEnvelope(userMessage: string): boolean {
    return this.parse(userMessage) !== null;
  }

  // Negotiate: does target client support all capabilities from source?
  negotiateCapabilities(envelope: SessionEnvelope['_envelope'], targetCaps: string[]): { supported: boolean; missing: string[] } {
    const required = envelope.capabilities ?? [];
    const missing = required.filter((c) => !targetCaps.includes(c));
    return { supported: missing.length === 0, missing };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Transfer metadata mà không cần API role mới | ❌ Hacky (fake user message = workaround) |
| ✅ Tận dụng user-role slot (2-role API compatible) | ❌ Agent confusion (thấy JSON thay vì text) |
| ✅ Cross-client continuity (Cloud → Desktop → CLI) | ❌ Security (envelope = session access, cần protect) |
| ✅ Capability negotiation (from → to compatibility check) | ❌ Size limit (envelope lớn → message quá dài) |

## Khác các hướng gần

| | 444 Channel-Docking | Transport Layer | Session Store | QJ: Message-Envelope |
|---|---|---|---|---|
| Trọng tâm | Session transfer | Deliver message | Persist session | **Metadata tunnel** |
| Carrier | Dock token + payload | Transport protocol | Disk | **Fake user message** |
| API role | New protocol | Existing | — | **User-role (no new role)** |

## Khi nào chọn

- API chỉ cho 2 role (user/assistant), cần transfer metadata
- Cross-client transfer (Cloud → Desktop → CLI)
- Muốn tận dụng user-role slot (không cần role mới hay side-channel)
- Nối transport layer + 444 channel-docking + session store
