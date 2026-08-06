# Hướng BA: A2A Opaque Protocol — capability cards, thay agent drop-in

> **Nguồn gốc:** Google Agent2Agent (A2A) protocol, Linux Foundation (2025)
> **Coupling:** 🟢 Protocol — agent expose AgentCard, không lộ nội bộ
> **Agent-agnostic:** ✅ — chuẩn mở, bất kỳ agent có card
> **Code sẵn:** ⚠️ (1 phần — intercom + rpc là substrate; thiếu AgentCard chuẩn + negotiation)
> **Effort:** 2 tuần

## Nguồn gốc

**A2A** (Agent2Agent, Linux Foundation 2025): giao thức mở để các agents từ *nhà cung cấp khác nhau* cộng tác mà **không cần biết nội bộ nhau**. Mỗi agent publish **AgentCard** — JSON mô tả khả năng (skills, input/output schema) — và giao tiếp qua JSON-RPC chuẩn (message, task, artifact). Agent có thể thay thế agent khác (drop-in) nếu cùng AgentCard shape: consumer chỉ biết card, không biết implementation. Đây là phiên bản chuẩn hóa của Nhóm 2 (protocol bridges) — áp cho *agent* thay vì *tool*.

## Mô tả

Mỗi agent mya (pi, claude, subagent, external) expose **AgentCard**: id, skills, capabilities, input/output schema, permissions (read/write scope). Client tìm agent theo khả năng → nhận card → gửi **task** (structured, không phải prompt tự do) → nhận **artifact/verdict**. Đổi agent = tìm card tương đương → swap → phần còn lại không đổi. Khác ACP (H — giao thức *tool*): A2A là giao thức *agent-to-agent + discovery*.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│              A2A NETWORK (mya)                              │
│                                                            │
│  ┌─────────────┐     JSON-RPC      ┌─────────────┐         │
│  │ client/user │──────────────────►│ AgentCard   │         │
│  │ (orchestr)  │ send task         │ registry    │         │
│  └─────────────┘◄──────────────────┘ (discovery) │         │
│       │        artifacts/verdict    └──────┬──────┘        │
│       ▼                                    │               │
│  ┌────────────────────────────────────┐    │               │
│  │ AgentCard { id, skills[],         │◄───┘               │
│  │   capabilities, in/out schema,    │                    │
│  │   permissions }                   │                    │
│  │  · pi:       [fix, edit, refactor]│                    │
│  │  · claude:   [review, security]   │                    │
│  │  · opencode: [rust, research]     │                    │
│  └────────────────────────────────────┘                    │
│  task = structured ({kind, params, refs})                  │
│  result = artifact / verdict + meta                        │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/intercom — agent↔agent messaging (có thể đóng vai A2A transport)
// ✅ packages/rpc — JSON-RPC giữa tiến trình (đúng giao thức A2A)
// ✅ packages/core/src/roles.ts — role = { prompt, tools, model } (≈ capability)
// ✅ packages/print/src/mya-bridge.ts — registerTool (bridge tương tự card)

// ❌ THIẾU: AgentCard chuẩn (id + schema JSON publish/query) + task negotiation.
//    Hiện agent điều phối qua roles cứng; chưa discovery theo khả năng.
```

## Implementation

```typescript
// packages/gateway/src/agent-card.ts (NEW)
interface AgentCard {
  id: string;                                  // "pi" | "claude" | ...
  skills: string[];                            // [fix, edit, refactor]
  capabilities: { input: JsonSchema; output: JsonSchema };
  permissions: { read: string[]; write: string[] };  // scope
  transport: "intercom" | "rpc" | "stdio";
}

class AgentCardRegistry {
  private cards = new Map<string, AgentCard>();

  register(card: AgentCard): void { this.cards.set(card.id, card); }

  /** Discovery: tìm agent đủ khả năng cho task. */
  find(skill: string, needs: { read: string; write: string }): AgentCard[] {
    return [...this.cards.values()].filter(
      c => c.skills.includes(skill)
        && within(c.permissions.read, needs.read)
        && within(c.permissions.write, needs.write),
    );
  }
}

// task = structured payload theo capabilities.input — không phải prompt tự do
// result = { verdict | artifact, meta: { cost, tokens, auditRef } }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thay agent drop-in (đổi card, không đổi code) | ❌ Schema task phải chuẩn hóa (thêm lớp thiết kế) |
| ✅ Discovery theo khả năng (không hardcode) | ❌ Prompt agent tự do bị ràng buộc structured |
| ✅ Chuẩn mở — tích hợp agent ngoài hệ | ❌ AgentCard lệch khả năng thật → task fail |
| ✅ Kết hợp OO permission vào card | |
| ✅ intercom + rpc sẵn làm transport | |

## Khi nào chọn

- Muốn thay pi/claude/opencode như đổi phích cắm
- Muốn agent ngoài hệ (cộng đồng, remote) tham gia an toàn
- Đã có intercom + rpc + roles
- Muốn discovery tự động theo khả năng (cùng RR routing)
