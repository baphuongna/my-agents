# Hướng TT: Slash Skill Activation — bắt cú pháp /skill-name task trên message thật, inject SKILL.md cho lượt model đó

> **Nguồn gốc:** deer-flow `src/middleware/skill_activation.py` (`SkillActivationMiddleware`); "intercept /skill-name task syntax on real message"; "inject full SKILL.md body for that model turn only"; "middleware layer — before agent loop" | **Coupling:** 🟡 — thêm middleware layer giữa user message → agent loop (parse + inject) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (SkillStore + loadBody sẵn — chưa có middleware parse + per-turn inject) | **Effort:** 2-3 tuần

## Nguồn gốc

**deer-flow** có **SkillActivationMiddleware** — layer giữa user message và agent loop. Khi user gõ **`/cite add citations to this response`** (slash + skill-name + task): (1) **Parse**: middleware bắt cú pháp `/skill-name task` — tách skill name + real task. (2) **Inject**: load SKILL.md body (full instructions) → **inject vào lượt model đó** (system prompt hoặc message prefix cho turn này only). (3) **Forward**: task thật (không slash) → agent loop. Nguyên tắc: **slash = explicit activation** — user nói rõ "dùng skill X cho task Y", middleware load + inject đúng skill, không cần agent guess/route.

## Mô tả

mya slash skill activation: (1) **Middleware parse**: user message `/cite add citations` → parse skillName="cite", task="add citations". (2) **Skill resolve**: skillStore.get("cite") → load body. (3) **Per-turn inject**: inject body vào context cho **turn này only** (system prompt block hoặc message prefix — scoped, không persistent). (4) **Forward task**: "add citations" → agent loop (agent thấy skill body + task). (5) **No slash**: message thường (không slash) → middleware pass-through (agent tự route skill). mya có SkillStore + loadBody — TT thêm **activation middleware** (parse slash + per-turn inject).

## Kiến trúc

```
  USER MESSAGE: "/cite add citations to this response"
        │
        │  SkillActivationMiddleware (parse + inject)
        ▼
  ┌─── PARSE ─────────────────────────────────────────────┐
  │  regex: /^\/(\w+)\s+(.+)$/                               │
  │  skillName = "cite"                                      │
  │  task = "add citations to this response"                 │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── RESOLVE + INJECT (per-turn) ───────────────────────┐
  │  skill = store.get("cite")                              │
  │  body = store.loadBody("cite")  // full SKILL.md        │
  │  inject: system-prompt block hoặc message prefix        │
  │  (SCOPED — turn này only, không persistent)             │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── FORWARD to agent loop ─────────────────────────────┐
  │  task: "add citations to this response"                 │
  │  context includes: cite SKILL.md body (injected)        │
  │  → agent theo cite workflow                             │
  └─────────────────────────────────────────────────────┘

  NO SLASH (pass-through):
  USER: "add citations"  → middleware không match /pattern → pass → agent tự route
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills SkillStore.get/loadBody — skill resolve (nền — TT load body ở đây)
// ✅ packages/prompts stable tier — system prompt (nền — TT inject vào đây)
// ✅ packages/core loop — agent loop (nền — TT middleware trước loop)
// ✅ packages/skills renderIndexBlock — skill index (nền — TT slash thay thế guess)

// ❌ THIẾU: activation middleware (parse /skill-name task)
// ❌ THIẾU: per-turn inject (inject body scoped cho turn, không persistent)
// ❌ THIẾU: skill-not-found handling (slash nhưng skill không tồn tại)
```

## Implementation

```typescript
// packages/agent/src/skill-activation-middleware.ts (MỚI)
import type { SkillStore } from "@my-agent/skills";

interface ParsedActivation { skillName: string; task: string }
interface ActivationResult { task: string; injectedBody: string | null; error?: string }

const SLASH_PATTERN = /^\/(\w[\w-]*)\s+([\s\S]+)$/;  // /skill-name task

class SkillActivationMiddleware {
  constructor(private store: SkillStore) {}

  // parse + inject — return modified task + injected body (or error)
  activate(message: string): ActivationResult {
    const match = SLASH_PATTERN.exec(message);
    if (!match) return { task: message, injectedBody: null }; // no slash → pass-through

    const skillName = match[1]!;
    const task = match[2]!;

    // resolve skill
    const skill = this.store.get(skillName);
    if (!skill) return { task: message, injectedBody: null, error: `skill "${skillName}" not found` };

    // load body (progressive disclosure)
    const body = this.store.loadBody(skillName);
    if (!body) return { task: message, injectedBody: null, error: `skill "${skillName}" has no body` };

    // per-turn inject: body scoped for THIS turn only
    return { task, injectedBody: body };
  }
}

// Usage (trong agent loop, trước runTurn):
// const mw = new SkillActivationMiddleware(skillStore);
// const { task, injectedBody, error } = mw.activate(userMessage);
// if (injectedBody) {
//   // inject body into THIS turn's context (system prompt block, scoped)
//   session.stableTier += `\n\n## Activated Skill: ${skillName}\n${injectedBody}`;
// }
// runTurn({ session, ... });  // agent sees: task + injected skill body
```

## Được

- ✅ Explicit activation (user nói rõ skill — không guess/route)
- ✅ Per-turn scoped (inject body chỉ cho turn này — không persistent bloat)
- ✅ Predictable (slash = chắc chắn skill đó, không routing ambiguity)
- ✅ Progressive disclosure (body inject khi cần — không upfront)

## Mất

- ❌ Syntax burden (user phải biết cú pháp /skill-name)
- ❌ Skill-not-found UX (slash sai tên → error, user confused)
- ❌ Single skill per turn (1 slash = 1 skill — không multi-slash dễ dàng)
- ❌ Inject bloat (body dài → turn token tăng đáng kể)

## Khác

Khác **TS deferred-skill-discovery** (agent call describe_skill để biết metadata) — TT là **user explicit slash** (user biết skill, inject body). Khác **auto-routing** (agent tự suggest skill) — TT **user-driven** (user chọn skill bằng slash). Khác **TJ clean-handoff-ritual** (inject handoff doc) — TT **inject skill body**.

## Khi nào chọn

- User muốn explicit control (chọn skill bằng cú pháp rõ)
- Agent routing không reliable (auto-suggest sai → slash bypass)
- Skill phức tạp cần body đầy đủ (slash → load full body cho turn)
- Nối packages/skills SkillStore.get/loadBody + packages/prompts stable tier + packages/core loop; guard parse precision (regex đúng — không false-match message thường), inject scoping (body chỉ cho turn này — không leak), và not-found UX (error message rõ — suggest skill gần đúng); TT = slash skill activation, kết hợp TS deferred-skill-discovery (discovery) + TP skill-policy-boundary (policy gate vẫn áp dụng cho slash-activated skill)
