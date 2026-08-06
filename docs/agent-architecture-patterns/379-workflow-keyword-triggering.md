# Hướng NO: Workflow Keyword Triggering — keyword arm orchestrate mode nhưng không ép theo lệnh

> **Nguồn gốc:** pi-dynamic-workflows (keyword trigger); "wake word" / "activation keyword"; "intent detection"; "armed mode" (circuit armed/disarmed); "trigger authorization" (capability token); "soft trigger" vs "hard command"; "conversational routing" (152 intent-router)
> **Coupling:** 🟢 — trigger layer trước workflow tool, không đổi core
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (intent routing sẵn — chưa có keyword-armed workflow mode)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Wake word** (Alexa "Hey Alexa"): keyword "arm" chế độ lắng nghe — nhưng không ép response cụ thể. pi-dynamic-workflows áp dụng: từ **"workflow"** hoặc **"workflows"** (bounded word) trong message → **arm** workflow mode → assistant có quyền dùng workflow tool. Nhưng trigger **authorizes**, không **force** — nếu user chỉ *hỏi về* workflow ("what is a workflow?"), assistant trả lời bình thường (không fan-out). Giống **armed circuit**: keyword "arm" công cụ → tool available, nhưng agent tự quyết dùng hay không. Khác **152 intent-router** (route theo intent) — NO là **authorization gate** (keyword cấp quyền tool, agent tự dùng khi phù hợp). Nguyên lý: **trigger ≠ command** — keyword cho phép, không ép buộc.

## Mô tả

mya workflow keyword triggering: mặc định workflow tool **không available** (không trong tool list). Khi user message chứa bounded keyword "workflow" (word-boundary match, không match `myworkflow`, `workflow_name`, `src/workflow-editor.ts`) → **arm** workflow mode → tool available. Agent tự quyết: dùng workflow nếu task phù hợp (codebase-wide audit, multi-perspective review), hoặc trả lời plain nếu chỉ hỏi về concept. `/workflows run <prompt>` = explicit trigger (bypass keyword). `/workflows-trigger set/off` = config keyword. Nối 152 intent-router + 101 dynamic-tool-selection.

## Kiến trúc

```
  USER MESSAGE arrives
        │
        ▼
  ┌─── KEYWORD DETECTION ─────────────────────────────┐
  │                                                    │
  │  Contains bounded word "workflow" or "workflows"?  │
  │                                                    │
  │  ✅ "Run a workflow to audit auth"  → ARMED        │
  │  ✅ "Use workflows to refactor"     → ARMED        │
  │  ❌ "myworkflow"                    → NOT armed    │
  │  ❌ "src/workflow-editor.ts"        → NOT armed    │
  │  ❌ "workflow_name"                 → NOT armed    │
  │  ❌ "What is a workflow?"           → ARMED but…   │
  │     (agent decides: just answer, don't fan-out)    │
  │                                                    │
  │  Also: /workflows run <prompt> → EXPLICIT (force)  │
  └──────────────────────┬─────────────────────────────┘
                         │
                         ▼
  ┌─── ARMED MODE (tool authorized) ───────────────────┐
  │                                                    │
  │  Workflow tool now AVAILABLE in tool list          │
  │                                                    │
  │  Agent decides:                                    │
  │  · "audit every route" → USE workflow (fan-out)    │
  │  · "what is a workflow?" → DON'T use (just answer) │
  │                                                    │
  │  trigger AUTHORIZES the tool, doesn't FORCE it     │
  └────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 152 intent-router — route by intent (nền — NO = authorize by keyword)
// ✅ 101 dynamic-tool-selection — tool available/unavailable (nền)
// ✅ tool registry — tool list management (sẵn)
// ✅ 336 tool-discovery-gateway — tool discovery (nền)

// ❌ THIẾU: keyword detection (bounded word match, word-boundary)
// ❌ THIẾU: armed mode (workflow tool available when keyword present)
// ❌ THIẾU: identifier exclusion (myworkflow, workflow_name → no trigger)
// ❌ THIẾU: /workflows-trigger config (set keyword, off)
// ❌ THIẾU: explicit trigger (/workflows run <prompt>)
```

## Implementation

```typescript
// packages/workflows/src/keyword-trigger.ts (NEW)
class WorkflowKeywordTrigger {
  private keyword: string = 'workflow';  // configurable
  private enabled: boolean = true;

  // Detect: does message contain the bounded keyword?
  isArmed(userMessage: string): boolean {
    if (!this.enabled) return false;

    // Word-boundary match: \bworkflow\b or \bworkflows\b
    // Excludes: myworkflow, workflow_name, src/workflow-editor.ts
    const pattern = new RegExp(`\\b${this.keyword}s?\\b`, 'i');
    return pattern.test(userMessage);
  }

  // Decide: should workflow tool be available for this message?
  shouldExposeTool(userMessage: string, isExplicitCommand: boolean): boolean {
    // Explicit command (/workflows run) → always expose
    if (isExplicitCommand) return true;
    // Keyword present → arm (expose tool, agent decides whether to use)
    return this.isArmed(userMessage);
  }

  // Config commands
  setKeyword(keyword: string): void { this.keyword = keyword; }
  disable(): void { this.enabled = false; }
  enable(): void { this.enabled = true; }

  // Help text for agent: trigger authorizes, doesn't force
  getTriggerGuidance(): string {
    return [
      'Workflow mode is ARMED (keyword detected).',
      'You may use the workflow tool to fan out across agents.',
      'But you do NOT have to — if the user is only asking about',
      'workflows conceptually, answer plainly without fanning out.',
      'The trigger authorizes the tool; it does not force its use.',
    ].join(' ');
  }
}

// Integration with agent loop:
// const trigger = new WorkflowKeywordTrigger();
// const armed = trigger.shouldExposeTool(userMessage, isSlashCommand);
// const tools = armed ? [...baseTools, workflowTool] : baseTools;
// const guidance = armed ? trigger.getTriggerGuidance() : '';
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tool chỉ available khi relevant (không spam tool list) | ❌ Keyword false trigger (ask about workflow → armed unnecessarily) |
| ✅ Soft trigger (authorize, không force) — agent tự quyết | ❌ Keyword config maintenance (change default word) |
| ✅ Identifier exclusion (myworkflow ≠ trigger) | ❌ User unaware of arming (hidden state) |
| ✅ Explicit override (/workflows run) | ❌ Ambiguity: "what is a workflow" armed but unused |

## Khác các hướng gần

| | 152 Intent-Router | 101 Dynamic-Tool-Selection | 43 Routing | NO: Keyword-Trigger |
|---|---|---|---|---|
| Mục | Route by intent | Tool available | Route request | **Keyword arms workflow mode** |
| Force | ✅ (route) | ❌ | ✅ | **Authorize (soft, agent decides)** |
| Match | Intent classifier | Context | Rule | **Bounded keyword** |

## Khi nào chọn

- Workflow tool nặng (fan-out nhiều agents) → chỉ expose khi relevant
- Muốn soft trigger (keyword cấp quyền, agent tự quyết dùng)
- Tránh accidental workflow fan-out (identifier exclusion)
- Nối 152 intent-router + 376 model-tier-routing (armed → tier-aware workflow) + 375 differential-resume
