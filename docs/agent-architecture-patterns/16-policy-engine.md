# Hướng O: Policy Engine — mya là guard rails

> **Coupling:** 🟢 Zero — agents run freely, mya says YES/NO
> **Agent-agnostic:** ✅ — bất kỳ agent check policy
> **Effort:** 1 tuần

## Mô tả

mya KHÔNG quản lý agents. mya ENFORCES POLICIES. Agents chạy tự do (own loop, own tools, own LLM). Trước mỗi action, agent hỏi mya: "can I do X?" → mya checks policy → YES/NO. Giống OPA (Open Policy Agent) cho AI agents.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   Agent runs FREELY (own loop, own tools, own LLM)      │
│                                                          │
│   BUT before every action:                               │
│     agent → mya.authorize(action)                        │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │  mya Policy Engine                               │   │
│   │                                                  │   │
│   │  Rules (evaluated per action):                   │   │
│   │  · tool access: pi → [read,write,bash] ✅        │   │
│   │                 claude → [read] ✅ bash ❌       │   │
│   │  · file access: *.env ❌  src/* ✅               │   │
│   │  · cost limit: $5 remaining                      │   │
│   │  · time limit: 30 min remaining                  │   │
│   │  · approval: "rm -rf" → human approval required  │   │
│   │  · rate limit: max 100 tool calls / turn         │   │
│   │  · anomaly: unusual pattern → flag for review    │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
│   mya is OPA (Open Policy Agent) for AI agents.         │
│   Agent doesn't know about other agents.                 │
│   Agent doesn't know about mya's features.              │
│   mya only says YES or NO.                               │
└──────────────────────────────────────────────────────────┘
```

## Policy language (Rego-like)

```yaml
# ~/.mya/policies.yaml
- name: allow-readwrite-src
  match:
    agent: "*"
    tool: ["read", "write", "edit"]
    path: "src/**"
  action: allow

- name: deny-env-files
  match:
    tool: ["read", "write", "edit"]
    path: [".env", ".env.*", "**/secrets/**"]
  action: deny
  reason: "Sensitive files are read-only"

- name: bash-requires-approval
  match:
    tool: "bash"
    command: ["rm *", "sudo *", "curl * | *", "wget *"]
  action: require_approval
  reason: "Destructive commands require human approval"

- name: cost-limit
  condition:
    session.cost > 5.00
  action: deny
  reason: "Budget exceeded ($5 limit)"

- name: time-limit
  condition:
    session.duration > 1800
  action: deny
  reason: "Time limit exceeded (30 min)"

- name: rate-limit
  condition:
    turn.toolCalls > 100
  action: deny
  reason: "Rate limit exceeded (100 tool calls/turn)"

- name: role-tool-filter
  match:
    role: "reviewer"
  filter:
    allowed_tools: ["read", "grep", "find", "ls"]
  action: enforce
  reason: "Reviewer role is read-only"
```

## API

```typescript
// POST /policy/authorize
// Request:
{
  "agent": "pi-session-001",
  "role": "coder",
  "tool": "bash",
  "input": { "command": "rm -rf /tmp/old-build" },
  "session": { "cost": 2.50, "duration": 1200, "toolCalls": 15 }
}

// Response (allowed):
{
  "allowed": true,
  "reason": "OK"
}

// Response (denied):
{
  "allowed": false,
  "reason": "Destructive commands require human approval",
  "action": "require_approval",
  "approvalId": "apr-123"
}

// Response (after human approves):
{
  "allowed": true,
  "approvedBy": "user@example.com",
  "approvalId": "apr-123"
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agents run completely free | ❌ Agents must CHECK (cooperation) |
| ✅ Simple API (just YES/NO) | ❌ Can't inject (memory, skills) |
| ✅ Agent-agnostic (any agent checks policy) | ❌ Policy evaluation latency |
| ✅ Human-in-the-loop natural (approval flow) | ❌ Agent can bypass (if not checking) |
| ✅ Cost/time/rate limits enforced | |
| ✅ Role-based access control | |

## Khi nào chọn

- Muốn agents chạy hoàn toàn tự do
- Chỉ cần safety guard rails (deny dangerous actions)
- Want cost/time/rate limits
- OK với agents phải cooperate (check policy)
- Need human-in-the-loop approval for risky actions
