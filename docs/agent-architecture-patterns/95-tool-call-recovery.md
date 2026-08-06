# Hướng CQ: Tool-Call Failure Recovery — agent tự sửa lỗi khi gọi tool

> **Nguồn gốc:** "AI Agent Error Handling & Recovery" (zylos 2026); taskade "Self-Healing Patterns" 2026; agentbase Self-Healing docs
> **Coupling:** 🟡 — bọc tool layer, cần chính sách giới hạn
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (mcp-reliability sẵn transport; thiếu agent-level recovery)
> **Effort:** 1-2 tuần

## Nguồn gốc

Tool-call failure recovery: khi tool call fail (timeout, validation, business error) → **agent-level self-healing**: classify lỗi → quyết định hành động (retry / sửa params / chọn tool khác / fallback) thay vì dừng. zylos 2026: "layered defenses (retries → fallbacks → circuit breakers), self-healing runtimes, explicit error paths"; taskade 2026: "classify failures, retry with backoff and jitter, circuit breakers, fallbacks, checkpoints"; towardsai: hướng dẫn 11-step production agent — "agent should not stop when a tool returns no output or fails" (n8n community 2026). Khác **IQ/mcp-reliability** (retry *kỹ thuật* ở transport: timeout/backoff/circuit — không cần LLM) — RRRR là *agent-level*: LLM nhận lỗi có cấu trúc → *sửa ý định* (đổi param, đổi tool, chia nhỏ). Khác **VVV durable** (checkpoint chạy lại toàn bộ) — RRRR phục hồi tại bước lỗi.

## Mô tả

mya tool layer trả **structured error** (không ném chung): `{kind: timeout|validation|auth|not-found|business, hint, context}` → agent nhận feedback: (1) **timeout/auth** → retry backoff (IQ giữ); (2) **validation** → LLM sửa params từ hint (đổi schema đúng); (3) **not-found** → LLM chọn tool khác / đổi chiến lược (FFFF discovery gợi ý); (4) **business** → fallback (báo user, đổi cách) — cycle giới hạn (SS budget: max 2-3 lần/task). Kết quả phục hồi ghi vào trace (QQQQ) — học pattern lỗi. Chống "loop retry tốn token": circuit-breaker + budget + escalate lên triage (CCC). Nối: IQ (transport) + SS (budget) + VVV (checkpoint sau retry nhiều).

## Kiến trúc

```
  TOOL CALL ──► FAIL ──► STRUCTURED ERROR {kind, hint, context}
        ┌───────────────┴───────────────┐
  timeout/auth ──► retry backoff (IQ) ──► OK
  validation   ──► LLM sửa params ──────► retry (hint làm input)
  not-found    ──► LLM đổi tool/chiến lược (FFFF) ──► retry
  business     ──► fallback: báo user / đổi cách
        │
  cycle count > BUDGET (SS: 2-3) ──► circuit breaker ──► escalate triage (CCC)
        ▼
  phục hồi thành công ──► trace (QQQQ) ──► học pattern lỗi
```

```
mya: gateway/mcp-reliability SẴN (transport retry/backoff/circuit — IQ)
     thiếu: structured error + agent-level recovery (LLM sửa params)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ gateway/mcp-reliability.ts — retry/backoff/circuit (IQ — tầng dưới)
// ✅ gateway/mcp-client.ts — gọi tool (nơi thêm structured error)
// ✅ SS budget — giới hạn cycle retry (chống loop tốn token)
// ✅ FFFF discovery — gợi ý tool khác khi not-found
// ✅ CCC handoff — escalate khi không phục hồi được
// ✅ QQQQ trace — ghi pattern lỗi (học)

// ❌ THIẾU: structured error schema (kind/hint)
// ❌ THIẾU: agent-level recovery (LLM nhận hint → sửa params)
// ❌ THIẾU: cycle counter + circuit-breaker agent-level
```

## Implementation

```typescript
// packages/tools/src/recovery.ts (NEW)
type ToolFailure = {
  kind: "timeout" | "validation" | "auth" | "not-found" | "business";
  hint: string;            // thông tin để LLM sửa
  context: unknown;
};

async function callWithRecovery(
  tool: ToolSpec, args: unknown, budget: { maxCycles: number },
): Promise<ToolResult> {
  let cycle = 0;
  while (cycle++ < budget.maxCycles) {
    const res = await tool.run(args);
    if (res.ok) return res;
    const failure = classify(res.error);            // structured error
    const plan = failure.kind === "timeout" || failure.kind === "auth"
      ? { retry: true }                              // IQ giữ
      : await llmRepair(failure, tool.meta);         // LLM sửa params/tool
    if (!plan.retry) return recover(failure, plan);  // fallback/escalate
    args = plan.fixedArgs ?? args;
  }
  return circuitBreak(tool);                         // budget cạn → CCC
}

// học: pattern lỗi → trace (QQQQ) → gợi ý sau (skill)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent không dừng khi tool fail (n8n 2026) | ❌ LLM repair tốn token (SS budget chặn) |
| ✅ Sửa params/chọn tool thông minh hơn retry cứng | ❐ Structured error cần thiết kế schema |
| ✅ Layered: transport (IQ) + agent (RRRR) | ❌ Loop retry → tốn tiền + latency (breaker) |
| ✅ Học pattern lỗi qua trace (QQQQ) | ❌ Repair sai có thể làm sai hơn |
| ✅ Nguồn: zylos/taskade/agentbase 2026 | |

## Khác các hướng gần

| | IQ MCP Reliability | VVV Durable | RRRR: Recovery |
|---|---|---|---|
| Cấp độ | Transport (không LLM) | Task checkpoint | **Agent-level (LLM sửa)** |
| Hành động | Retry/backoff | Chạy lại | **Sửa params/đổi tool** |
| Mối quan hệ | Tầng dưới của RRRR | Sau khi RRRR cạn | **Trên IQ, trước VVV** |

## Khi nào chọn

- Tool hay fail (MCP remote, API bên ngoài)
- Fail do params sai — LLM sửa được (validation/not-found)
- Đã có IQ reliability + SS budget — thêm agent-level layer
- Muốn agent tự phục hồi thay vì báo user giữa chừng