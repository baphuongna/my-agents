# Hướng OL: Request Type Authorization — autonomy matrix: answer/diagnose/change/monitor

> **Nguồn gốc:** Leaks Codex (autonomy matrix); "request-type-based authorization"; "least-privilege per intent"; "action taxonomy: answer / diagnose / change / monitor"; "scoped autonomy levels"
> **Coupling:** 🟢 — thêm intent-classification + autonomy-scoping layer trước tool dispatch
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (permission-prompt + dynamic-permissions sẵn — chưa có request-type classifier + autonomy matrix)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Leaks Codex** mô tả **autonomy matrix**: mỗi user request được phân loại thành **request type** — (1) **answer** (trả lời câu hỏi — read-only, no side-effect), (2) **diagnose** (phân tích vấn đề — read + inspect, no change), (3) **change** (sửa code/config — write, side-effect), (4) **monitor** (theo dõi/quan sát lâu dài — read periodic, no change). Mỗi type có **autonomy level** khác nhau: answer/diagnose → **autonomous** (không cần confirm — safe read-only), change → **gated** (confirm trước khi write), monitor → **scoped** (limited scope, periodic). Nguyên tắc: **quyền = theo intent request**, không theo tool — "diagnose" không được write dù có tool write available. Khác **124 dynamic-permissions** (per-tool auth) — OL là **per-intent auth**; khác **391 OA biometric** (physical gate) — OL là **intent-scoped autonomy**.

## Mô tả

mya request type authorization: classify user request → **request type** (answer/diagnose/change/monitor) → áp **autonomy matrix**: (1) **answer** → autonomous, read-only tools (read/grep/find), no confirm. (2) **diagnose** → autonomous, read + inspect tools (read/test-run/log-analyze), no confirm. (3) **change** → gated, write tools (write/edit/bash), confirm required (nối 391 OA biometric cho hazardous). (4) **monitor** → scoped, periodic read tools, bounded scope/time. Agent **chỉ dùng tools được phép** cho request type đó — "diagnose" không write dù có tool write. mya có `124 dynamic-permissions` + permission-prompt — OL thêm **request-type classifier** + **autonomy matrix** + **intent-scoped tool filter**.

## Kiến trúc

```
  USER REQUEST:
  "Why is the auth module slow?" / "Fix the bug" / "Watch for errors"
        │
        ▼
  ┌─── REQUEST TYPE CLASSIFIER ───────────────────────┐
  │                                                     │
  │  "Why is X slow?"   → DIAGNOSE (analyze, no change) │
  │  "What does Y do?"  → ANSWER   (explain, read-only) │
  │  "Fix the bug"      → CHANGE   (modify code)        │
  │  "Watch for errors" → MONITOR  (observe periodic)   │
  └───────────────────────┬─────────────────────────────┘
                          │ (request type)
                          ▼
  ┌─── AUTONOMY MATRIX ───────────────────────────────┐
  │                                                     │
  │  ┌──────────┬───────────────┬────────┬───────────┐ │
  │  │ TYPE     │ TOOLS ALLOWED │ GATE   │ AUTONOMY  │ │
  │  ├──────────┼───────────────┼────────┼───────────┤ │
  │  │ ANSWER   │ read/grep/find│ NONE   │ fully auto│ │
  │  │ DIAGNOSE │ + test/log    │ NONE   │ fully auto│ │
  │  │ CHANGE   │ + write/edit  │ CONFIRM│ gated     │ │
  │  │ MONITOR  │ read periodic │ SCOPED │ bounded   │ │
  │  └──────────┴───────────────┴────────┴───────────┘ │
  │                                                     │
  │  intent-scoped: "diagnose" CANNOT write            │
  │  even if write tool is available                    │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── TOOL DISPATCH (filtered by matrix) ────────────┐
  │                                                     │
  │  diagnose request + agent tries write_file:        │
  │    → BLOCKED (write not allowed for diagnose)      │
  │  change request + agent tries write_file:          │
  │    → CONFIRM prompt → if yes → execute             │
  │  answer request + agent tries grep:                │
  │    → ALLOWED (read-only, autonomous)               │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 124 dynamic-permissions — per-tool auth (nền — OL = per-intent auth)
// ✅ permission-prompt — confirm dialog (nền — OL gate for change)
// ✅ 391 OA biometric-gate — hazardous gate (nền — OL change → OA hazardous)
// ✅ 123 explainable-actions — explain before act (nền)
// ✅ tool registry — available tools (nền — OL filters by intent)

// ❌ THIẾU: request-type classifier (answer/diagnose/change/monitor)
// ❌ THIẾU: autonomy matrix (type → tools allowed + gate level)
// ❌ THIẾU: intent-scoped tool filter (block tools not allowed for type)
// ❌ THIẾU: monitor scope bounds (time limit, scope limit for periodic)
```

## Implementation

```typescript
// packages/agent/src/request-type-auth.ts (MỚI)
type RequestType = 'answer' | 'diagnose' | 'change' | 'monitor';
type GateLevel = 'none' | 'confirm' | 'scoped';

interface AutonomyRule {
  type: RequestType;
  allowedTools: string[];   // tool names permitted
  blockedTools: string[];   // explicitly blocked
  gate: GateLevel;
  autonomous: boolean;      // no human confirm needed
  scopeLimit?: { maxDurationMs?: number; maxCalls?: number }; // for monitor
}

class RequestTypeAuth {
  private matrix: Record<RequestType, AutonomyRule> = {
    answer: {
      type: 'answer',
      allowedTools: ['read_file', 'grep', 'find', 'list'],
      blockedTools: ['write_file', 'edit', 'bash', 'rm'],
      gate: 'none',
      autonomous: true,
    },
    diagnose: {
      type: 'diagnose',
      allowedTools: ['read_file', 'grep', 'find', 'list', 'run_tests', 'analyze_log'],
      blockedTools: ['write_file', 'edit', 'bash', 'rm', 'deploy'],
      gate: 'none',
      autonomous: true,
    },
    change: {
      type: 'change',
      allowedTools: ['read_file', 'grep', 'find', 'write_file', 'edit', 'bash'],
      blockedTools: [],
      gate: 'confirm',
      autonomous: false,
    },
    monitor: {
      type: 'monitor',
      allowedTools: ['read_file', 'grep', 'find', 'watch'],
      blockedTools: ['write_file', 'edit', 'bash', 'rm', 'deploy'],
      gate: 'scoped',
      autonomous: true,
      scopeLimit: { maxDurationMs: 60_000, maxCalls: 100 },
    },
  };

  // Classify user request → request type
  classify(request: string): RequestType {
    if (/watch|monitor|observe|alert|notify when/i.test(request)) return 'monitor';
    if (/fix|change|update|modify|add|remove|delete|deploy/i.test(request)) return 'change';
    if (/why|debug|diagnose|investigate|analyze|what.?s wrong/i.test(request)) return 'diagnose';
    return 'answer'; // default — explain/read-only
  }

  // Check if tool is allowed for request type
  authorize(
    requestType: RequestType,
    tool: string,
    confirm: () => Promise<boolean>,
  ): { allowed: boolean; reason: string } {
    const rule = this.matrix[requestType];

    if (rule.blockedTools.includes(tool)) {
      return { allowed: false, reason: `"${tool}" blocked for ${requestType} (intent-scoped)` };
    }

    if (!rule.allowedTools.includes(tool)) {
      return { allowed: false, reason: `"${tool}" not in allowed tools for ${requestType}` };
    }

    // Gate check
    if (rule.gate === 'confirm' && !rule.autonomous) {
      // confirm() called by caller — if denied, block
      // (actual confirm delegated to 124 permission-prompt / 391 OA biometric)
    }

    return { allowed: true, reason: `allowed for ${requestType}` };
  }

  // Get autonomy rule for a request type
  rule(type: RequestType): AutonomyRule {
    return this.matrix[type];
  }
}

// Usage:
// const reqType = auth.classify(userRequest);     // → 'diagnose'
// const rule = auth.rule(reqType);
// if (!rule.allowedTools.includes('write_file')) → agent CANNOT write (diagnose)
// change request → gate 'confirm' → 124 permission-prompt / 391 OA
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Least-privilege theo intent (diagnose không write dù có tool) | ❌ Classifier miss (change request → classified answer = agent không sửa) |
| ✅ Answer/diagnose autonomous (no confirm — smooth UX) | ❌ Ambiguous intent (request vừa answer vừa change) |
| ✅ Change gated (confirm — safety) | ❌ Matrix maintenance (new tool → update matrix per type) |
| ✅ Monitor scoped (bounded time/calls — không chạy vô hạn) | ❌ Over-restrictive (answer muốn suggest code → blocked write) |

## Khác các hướng gần

| | 124 Dynamic-Permissions | 391 OA Biometric-Gate | 123 Explainable-Actions | OL: Request-Type-Auth |
|---|---|---|---|---|
| Cái gì | Per-tool auth | Biometric gate | Explain before act | **Per-intent auth** |
| Scope | Tool | Physical action | Transparency | **Request type** |
| Autonomy | Per rule | Step-up | Always | **Matrix per type** |
| Intent | ❌ | ❌ | ❌ | ✅ answer/diagnose/change/monitor |

## Khi nào chọn

- User request có intent rõ (answer / diagnose / change / monitor)
- Muốn least-privilege (diagnose không write dù có tool write available)
- Muốn UX smooth (answer/diagnose autonomous, change gated)
- Nối 124 dynamic-permissions (OL = per-intent layer on top) + 391 OA biometric-gate (change hazardous → biometric) + 123 explainable-actions (explain intent classification); classifier phải chính xác — guard ambiguous intent (hỏi user clarify nếu không rõ type)
