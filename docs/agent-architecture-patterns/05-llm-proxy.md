# Hướng E: LLM Proxy — mya = man-in-the-middle ở API level

> **Coupling:** 🟢 Zero — agent chỉ thấy OpenAI-compatible endpoint
> **Agent-agnostic:** ✅ — bất kỳ agent hỗ trợ custom API endpoint
> **Effort:** 1 tuần

## Mô tả

mya sits giữa agent và LLM provider. Agent đổi `OPENAI_BASE_URL=http://localhost:3000/v1`. mya intercept API requests: inject memory/skills vào system prompt, filter tools per role, log audit. Forward đến real LLM API. Stream response về agent.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  User                                                            │
│    │                                                             │
│    ▼                                                             │
│  ┌──────────┐    ┌───────────────────────┐    ┌──────────────┐  │
│  │ pi TUI   │───►│     mya LLM Proxy     │───►│ LLM Provider │  │
│  │ (native) │    │  localhost:3000/v1    │    │ (OpenAI,     │  │
│  │          │◄───│                       │◄───│  Anthropic,  │  │
│  │ own tools│    │  mya intercepts:      │    │  Google...)  │  │
│  │ own TUI  │    │  · system prompt +=   │    └──────────────┘  │
│  │          │    │    memory context     │                      │
│  └──────────┘    │  · system prompt +=   │                      │
│                  │    skills             │                      │
│  ┌──────────┐    │  · tools array filter │                      │
│  │ claude   │───►│    (roles)            │                      │
│  │ CLI      │    │  · log requests       │                      │
│  │ (native) │◄───│    (Merkle audit)     │                      │
│  └──────────┘    │  · token counting     │                      │
│                  │    (cost)             │                      │
│  ┌──────────┐    │  · fallback routing   │                      │
│  │ opencode │───►│    (if A fails → B)   │                      │
│  │ TUI      │◄───│                       │                      │
│  └──────────┘    └───────────────────────┘                      │
│                                                                  │
│  Agent chỉ cần đổi:                                              │
│    OPENAI_BASE_URL=http://localhost:3000/v1                     │
│                                                                  │
│  Agent KHÔNG BIẾT mya tồn tại.                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Tại sao hoạt động: Function calling ĐI QUA API

```
1. Agent → POST /v1/chat/completions { messages, tools: [...] }
   mya proxy thấy:
   · tools array → filter per role (remove bash for reviewer)
   · messages → extract user/assistant text → autoCapture → Brain
   · inject memory context vào system prompt:
     "## Memory\n{brain.recall(last_user_message)}"
   · inject skills:
     "## Active Skills\n{skillStore.active()}"

2. LLM ← response { tool_call: { name: "read", args: {...} } }
   mya proxy thấy:
   · tool_call → Merkle audit log
   · track cost (tokens in response)

3. Agent executes tool locally (own implementation)
   Agent → POST /v1/chat/completions { messages: [..., tool_result] }
   mya proxy thấy:
   · tool_result → audit log
   · continue streaming
```

## mya controls ĐỦ để thay thế extension injection

| Tính năng | Extension (hiện tại) | LLM Proxy |
|---|---|---|
| Memory inject | mya-bridge thêm vào system prompt | ✅ Proxy sửa messages[0].content |
| Skills inject | mya-bridge thêm vào system prompt | ✅ Proxy sửa messages[0].content |
| Audit (tool calls) | Hook tool_call/tool_result events | ✅ Thấy tool_call trong LLM response |
| Roles (tool filter) | setActiveTools() trong extension | ✅ Sửa tools array trong request |
| Cost tracking | Hook usage events | ✅ Đếm tokens trong API response |
| Fallback | streamWithFallback trong agent | ✅ Proxy tự retry provider khác |
| Memory autoCapture | Hook turn_end | ✅ Parse messages trong request |

## Code cần thêm

```typescript
// packages/gateway/src/llm-proxy.ts (NEW)
// POST /v1/chat/completions — OpenAI-compatible proxy

async function handleChatCompletions(req, res) {
  const body = await readBody(req);
  let { messages, tools, model, stream } = body;

  // 1. Inject memory context into system prompt
  const lastUserMsg = messages.filter(m => m.role === "user").pop();
  const memoryHits = await brain.recall(lastUserMsg.content);
  if (memoryHits.length > 0) {
    messages[0].content += "\n\n## Memory Context\n" +
      memoryHits.map(h => h.text).join("\n");
  }

  // 2. Inject skills
  const activeSkills = await skillStore.getActive();
  if (activeSkills.length > 0) {
    messages[0].content += "\n\n## Active Skills\n" +
      activeSkills.map(s => s.body).join("\n");
  }

  // 3. Filter tools per role
  if (currentRole === "reviewer") {
    tools = tools.filter(t => ["read", "grep", "find"].includes(t.function.name));
  }

  // 4. Forward to real LLM API
  const llmRes = await fetch(realProviderUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: realApiKey },
    body: JSON.stringify({ messages, tools, model, stream }),
  });

  // 5. Stream response back, log audit + cost
  for await (const chunk of llmRes.body) {
    const parsed = parseSSEChunk(chunk);
    if (parsed.choices?.[0]?.delta?.tool_calls) {
      auditLog.append({ kind: "tool_call", ...parsed.choices[0].delta.tool_calls });
    }
    res.write(chunk); // pass through to agent
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero coupling — agent chỉ thấy API endpoint | ❌ Không execute tools (agent tự execute — nhưng ĐÚNG) |
| ✅ Agent-agnostic (OpenAI-compatible = tất cả) | ❌ Không control TUI |
| ✅ Memory + skills inject transparent | ❌ Proxy phải parse SSE (fragile nếu format đổi) |
| ✅ Audit tại API level (mọi request logged) | ❌ Latency thêm (proxy hop) |
| ✅ Cost tracking chính xác (token counting) | ❌ Streaming backpressure handling |
| ✅ Fallback routing (provider A fail → B) | |
| ✅ System prompt modification = inject everything | |

## Tất cả agents hỗ trợ custom endpoint

| Agent | Custom endpoint? | Cách config |
|---|---|---|
| pi | ✅ | `auth.json` → baseUrl |
| claude | ✅ | `ANTHROPIC_BASE_URL` |
| aider | ✅ | `--openai-api-base` |
| opencode | ✅ | config file |
| cursor | ✅ | settings |

## Khi nào chọn

- Muốn inject memory/skills KHÔNG cần agent internals
- OK với việc agent execute tools riêng
- Muốn fallback routing ở proxy level
- Muốn cost tracking chính xác
