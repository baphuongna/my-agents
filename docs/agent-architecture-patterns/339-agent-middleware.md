# Hướng MA: Agent Middleware — interceptor chain transform/validate/route message giữa agent

> **Nguồn gốc:** Middleware pattern (Express, Koa, Django); interceptor chain (gRPC); "pipeline of handlers"; "chain of responsibility" (GoF); message broker filter; Express `app.use()`
> **Coupling:** 🟡 — thêm middleware layer vào message path
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent loop sẵn — chưa có pluggable middleware chain)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Middleware pattern** (Express `app.use`, Koa `ctx`): mỗi request đi qua chuỗi handler — mỗi handler transform/validate/log/route, rồi gọi `next()`. **Chain of Responsibility** (GoF): handler xử lý hoặc chuyển cho handler kế. **gRPC interceptor**: intercept call trước/sau — auth, logging, retry, metrics. Nguyên tắc: **tách concern thành middleware** — logging, validation, auth, rate-limit không nằm trong business logic, mà ở middleware chain. Agent có thể thêm/bỏ middleware không sửa core. Khác **294 message-contracts** (schema compat) — MA là **execution chain**; khác **332 policy-enforcement** (1 rule check) — MA là **composable chain**; khác **292 lifecycle-hooks** (hook event) — MA **intercept message flow**.

## Mô tả

mya agent middleware: mỗi message (agent→tool, parent→subagent, agent→LLM) đi qua **middleware chain** — logging (198), validation (290), auth (124), rate-limit (196), policy (332), transform (compress/prompt-rewrite). Mỗi middleware: pre-process → call next → post-process. Agent config chuỗi middleware theo cần. Tách concern — core agent loop không chứa logging/validation, chỉ middleware.

## Kiến trúc

```
  MESSAGE (agent → tool / subagent / LLM)
        │
        ▼
  ┌──── MIDDLEWARE CHAIN ────────────────────┐
  │                                         │
  │  [logging]  → log msg                   │
  │      │                                  │
  │  [auth]     → check permission (124)     │
  │      │                                  │
  │  [validate] → schema check (290)         │
  │      │                                  │
  │  [rate-limit] → throttle (196)           │
  │      │                                  │
  │  [policy]   → enforce rule (332)         │
  │      │                                  │
  │  [transform] → compress/rewrite          │
  │      │                                  │
  │      ▼                                  │
  │  HANDLER (execute)                       │
  │      │                                  │
  │      ▼ post-process                      │
  │  [transform] ← post                      │
  │  [logging]   ← log result                │
  └─────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 198 GP audit — logging (middleware concern)
// ✅ 124 DT permissions — auth (middleware concern)
// ✅ 290 KD precondition — validation (middleware concern)
// ✅ 196 rate-limiting — throttle (middleware concern)
// ✅ 332 LT policy-enforcement — policy (middleware concern)
// ✅ 294 KH message-contracts — schema (middleware concern)
// ✅ 292 agent-lifecycle-hooks — hooks (related)

// ❌ THIẾU: pluggable middleware chain (Express-style app.use)
// ❌ THIẾU: middleware registry (add/remove middleware runtime)
// ❌ THIẾU: pre/post hook per middleware (onion model)
```

## Implementation

```typescript
// packages/agent/src/middleware.ts (NEW)
interface MiddlewareContext {
  message: unknown;
  metadata: Record<string, unknown>;
  result?: unknown;
}

type Next = () => Promise<void>;
type Middleware = (ctx: MiddlewareContext, next: Next) => Promise<void>;

class MiddlewareChain {
  private middlewares: Middleware[] = [];

  use(mw: Middleware): this { this.middlewares.push(mw); return this; }

  async run(message: unknown, handler: (ctx: MiddlewareContext) => Promise<unknown>): Promise<unknown> {
    const ctx: MiddlewareContext = { message, metadata: {} };

    // Onion model — compose chain
    const compose = (index: number): Next => async () => {
      if (index < this.middlewares.length) {
        await this.middlewares[index]!(ctx, compose(index + 1));
      } else {
        ctx.result = await handler(ctx); // core handler at bottom
      }
    };

    await compose(0)();
    return ctx.result;
  }
}

// Usage — composable, pluggable
const chain = new MiddlewareChain();
chain
  .use(async (ctx, next) => { audit.log(ctx.message); await next(); })       // logging (198)
  .use(async (ctx, next) => { await auth.check(ctx.message); await next(); }) // auth (124)
  .use(async (ctx, next) => { validate(ctx.message); await next(); })         // validation (290)
  .use(async (ctx, next) => { await rateLimiter.acquire(); await next(); })   // rate-limit (196)
  .use(async (ctx, next) => { policy.enforce(ctx.message); await next(); });  // policy (332)

const result = await chain.run(msg, (ctx) => tool.run(ctx.message));
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tách concern — core clean (Express proven) | ❌ Overhead mỗi msg qua N middleware |
| ✅ Composable — add/remove không sửa core | ❌ Debug khó (chain sâu — onion) |
| ✅ Pre/post (onion model — transform cả 2 chiều) | ❌ Order dependency (middleware A cần trước B) |
| ✅ Nối 198/124/290/196/332 thành 1 chain | ❌ Error propagation cần cẩn thận |

## Khác các hướng gần

| | 294 Message Contracts | 332 Policy Enforcement | 292 Lifecycle Hooks | MA: Middleware |
|---|---|---|---|---|
| Cái gì | Schema compat | 1 rule check | Hook event | **Composable chain** |
| Multi | ❌ (1 contract) | ❌ (1 policy) | ❌ | ✅ N middleware |
| Pluggable | ❌ | ❌ | Partial | ✅ runtime add/remove |
| Pre+Post | ❌ | Pre only | Event only | ✅ onion |

## Khi nào chọn

- Nhiều concern (logging/auth/validate/policy/transform) trên message path
- Muốn composable — add/remove middleware không sửa core
- Pre/post processing cần (transform request + response)
- Kết hợp 198/124/290/196/332 — mỗi concern là 1 middleware; cẩn thận order + error propagation
