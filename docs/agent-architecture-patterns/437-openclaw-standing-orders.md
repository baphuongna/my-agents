# Hướng PU: Openclaw Standing Orders — lệnh thường trực 1 lần (scope+trigger+approval) áp dụng mọi phiên

> **Nguồn gốc:** openclaw (persisted instructions, global-state.ts, config schema, exec-approvals-allow-always); "standing orders"; "persistent instructions"; "one-time rules"; "global agent directives"; "scope+trigger+approval"
> **Coupling:** 🟡 — thêm standing-order store + trigger engine vào agent config/instruction layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (openclaw persisted config + exec-approvals-allow-always sẵn — chưa có formal standing-order engine trong mya)
> **Effort:** 2-2.5 tuần

## Nguồn gốc

**openclaw** (`global-state.ts`, config schema, `exec-approvals-allow-always`) có khái niệm **standing orders** — lệnh thường trực user đặt **1 lần**, áp dụng **mọi phiên sau đó**. `exec-approvals-allow-always` — persistent always-allow execution approval rules (user approve 1 lần → apply mọi phiên). Config persisted (`global-state.ts`) — instructions/config survive restart. Nguyên tắc **standing order**: (1) **One-time definition**: user đặt rule 1 lần ("luôn dùng vitest, không jasmine"). (2) **Scope**: rule áp dụng trong scope nào (global / project / agent-specific). (3) **Trigger**: khi nào rule kích hoạt (every-turn / on-tool-call / on-error / on-file-pattern). (4) **Approval**: rule cần approval hay không (auto-apply / confirm-first). (5) **Cross-session**: rule persisted — apply mọi phiên sau đó (không cần lặp lại). Khác **124 dynamic-permissions** (per-tool auth) — PU là **standing instruction** (persistent rule); khác **402 OL request-type-auth** (per-intent) — PU là **per-rule persistent**.

## Mô tả

mya openclaw standing orders: user đặt rule **1 lần** → áp dụng **mọi phiên** — (1) **Define**: user nói "từ giờ luôn dùng pnpm, không npm" → agent tạo standing order. (2) **Scope**: order có scope (global / project / agent). (3) **Trigger**: order kích hoạt khi nào (every-turn inject vào system prompt / on-tool-call check before execute / on-error auto-retry / on-file-pattern apply lint rule). (4) **Approval**: order auto-apply (trusted) hoặc confirm-first (hazardous). (5) **Persist**: order saved → survive restart → apply mọi phiên sau đó. Agent **không cần nhắc lại** — "luôn dùng pnpm" 1 lần, mãi mãi. mya có config/prompt layer — PU thêm **standing-order store + trigger engine + cross-session persistence**.

## Kiến trúc

```
  USER (one-time): "From now on, always use pnpm, never npm"
        │
        ▼
  ┌─── STANDING ORDER DEFINITION ────────────────────────┐
  │                                                       │
  │  order: {                                              │
  │    id: "pkg-manager",                                  │
  │    rule: "Use pnpm instead of npm for all commands",   │
  │    scope: "project",           ← global/project/agent  │
  │    trigger: "on-tool-call",    ← when to activate       │
  │    approval: "auto",           ← auto/confirm           │
  │    action: "rewrite-npm-to-pnpm",  ← what to do         │
  │    createdAt: "2024-...",                              │
  │    persistent: true             ← survive restart       │
  │  }                                                     │
  │                                                       │
  │  → SAVED to global-state (persisted)                   │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼ (every session, every turn)
  ┌─── TRIGGER ENGINE ───────────────────────────────────┐
  │                                                       │
  │  TRIGGER TYPES:                                        │
  │                                                        │
  │  every-turn:                                           │
  │    inject order into system prompt                     │
  │    → agent always knows "use pnpm"                     │
  │                                                        │
  │  on-tool-call:                                         │
  │    before bash execute → check order                   │
  │    agent tries: npm install                            │
  │    → order matches "npm" → REWRITE to "pnpm install"   │
  │                                                        │
  │  on-error:                                             │
  │    if error contains "jasmine" → suggest vitest        │
  │                                                        │
  │  on-file-pattern:                                      │
  │    if editing *.ts → enforce lint rule                 │
  │                                                        │
  │  APPROVAL:                                             │
  │    auto → apply silently (trusted rule)                │
  │    confirm → ask user first (hazardous rule)           │
  │                                                        │
  └───────────────────────────────────────────────────────┘

  CROSS-SESSION: order persisted → next session loads it → applies automatically
  (user NEVER needs to repeat "use pnpm")
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ config / prompt layer (packages/core, packages/prompts) — system prompt (nền — PU = standing order inject)
// ✅ 124 dynamic-permissions — per-tool auth (nền — PU = persistent instruction)
// ✅ 402 OL request-type-auth — per-intent auth (nền — PU = per-rule persistent)
// ✅ openclaw global-state + exec-approvals-allow-always (source/ — reference impl)

// ❌ THIẾU: standing-order store (persistent rule definition + scope)
// ❌ THIẾU: trigger engine (every-turn / on-tool-call / on-error / on-file-pattern)
// ❌ THIẾU: approval gate (auto / confirm-first)
// ❌ THIẾU: cross-session persistence (load orders on session start)
```

## Implementation

```typescript
// packages/agent/src/standing-orders.ts (MỚI)
type OrderScope = 'global' | 'project' | 'agent';
type OrderTrigger = 'every-turn' | 'on-tool-call' | 'on-error' | 'on-file-pattern';
type OrderApproval = 'auto' | 'confirm';

interface StandingOrder {
  id: string;
  rule: string;                    // human-readable instruction
  scope: OrderScope;
  trigger: OrderTrigger;
  approval: OrderApproval;
  action: OrderAction;             // what to do when triggered
  filePattern?: string;            // for on-file-pattern
  createdAt: string;
  persistent: boolean;
}

type OrderAction =
  | { type: 'inject-prompt'; text: string }           // add to system prompt
  | { type: 'rewrite-command'; from: RegExp; to: string } // npm → pnpm
  | { type: 'suggest'; text: string }                  // suggest alternative
  | { type: 'enforce-lint'; rule: string };            // enforce lint rule

class StandingOrderEngine {
  private orders: StandingOrder[] = [];

  // Load persisted orders (on session start)
  load(stateDir: string): void {
    this.orders = readPersistedOrders(stateDir);
  }

  // Define new order (one-time, from user)
  define(rule: string, scope: OrderScope, trigger: OrderTrigger, action: OrderAction,
    approval: OrderApproval = 'auto'): void {
    const order: StandingOrder = {
      id: generateId(), rule, scope, trigger, approval, action,
      createdAt: new Date().toISOString(), persistent: true,
    };
    this.orders.push(order);
    this.persist();
  }

  // Trigger: every-turn → inject into system prompt
  getPromptInstructions(): string {
    return this.orders
      .filter((o) => o.trigger === 'every-turn')
      .map((o) => o.action.type === 'inject-prompt' ? o.action.text : o.rule)
      .join('\n');
  }

  // Trigger: on-tool-call → check/rewrite before execute
  checkToolCall(tool: string, args: Record<string, unknown>): { rewritten?: Record<string, unknown>; blocked?: boolean } {
    for (const order of this.orders.filter((o) => o.trigger === 'on-tool-call')) {
      if (order.action.type === 'rewrite-command' && tool === 'bash') {
        const command = args.command as string;
        if (order.action.from.test(command)) {
          if (order.approval === 'confirm' && !awaitConfirm(order.rule)) continue;
          return { rewritten: { ...args, command: command.replace(order.action.from, order.action.to) } };
        }
      }
    }
    return {};
  }

  // Trigger: on-error → suggest
  onError(error: string): string[] {
    return this.orders
      .filter((o) => o.trigger === 'on-error' && o.action.type === 'suggest')
      .map((o) => o.action.text);
  }

  // Persist orders (survive restart)
  private persist(): void {
    writePersistedOrders(this.orders);
  }
}

// Usage:
// engine.load(stateDir); // load on session start
// engine.define("Use pnpm not npm", "project", "on-tool-call",
//   { type: "rewrite-command", from: /\bnpm\b/g, to: "pnpm" });
// // Every session: agent tries npm → engine rewrites to pnpm automatically
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ One-time setup (đặt 1 lần, apply mãi — không nhắc lại) | ❌ Order conflict (2 orders mâu thuẫn — npm→pnpm vs npm→yarn) |
| ✅ Cross-session (persisted — survive restart) | ❌ Scope creep (quá nhiều orders → noise trong prompt) |
| ✅ Trigger types (every-turn/on-tool-call/on-error/on-pattern — flexible) | ❌ Approval friction (confirm-first → interrupt UX) |
| ✅ Auto-rewrite (npm→pnpm transparent — agent không cần biết) | ❌ Stale orders (order cũ không còn relevant — cần cleanup) |

## Khác các hướng gần

| | 124 Dynamic-Permissions | 402 OL Request-Type-Auth | PU: Standing-Orders |
|---|---|---|---|
| Cái gì | Per-tool auth | Per-intent auth | **Persistent instruction** |
| Persistent | ❌ (per-session) | ❌ | ✅ (cross-session) |
| Trigger | Tool call | Request classify | **every-turn/tool/error/pattern** |
| Action | Allow/deny | Allow/deny | **inject/rewrite/suggest/enforce** |

## Khi nào chọn

- User muốn đặt rule 1 lần (không lặp lại mỗi phiên)
- Muốn cross-session persistence (rule survive restart)
- Muốn trigger types (every-turn inject, on-tool-call rewrite, on-error suggest)
- Nối 124 dynamic-permissions (PU = persistent instruction, 124 = per-session auth) + 402 OL request-type-auth (PU = per-rule, OL = per-intent) + prompts (PU = every-turn inject); guard order conflict (priority + dedup + user alert)
