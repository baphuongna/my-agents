# Hướng SM: Truncated Tool Call Fail-Closed — stopReason=length: tool call cắt cụt đánh dấu lỗi, chặn chạy hỏng

> **Nguồn gốc:** pi-agent-core (truncated tool call handling); "stopReason=length tool call truncated"; "fail-closed on incomplete tool_use"; "block partial tool dispatch"; "max_tokens cut tool JSON mid-stream"
> **Coupling:** 🟢 — thêm guard sau LLM stream (check stopReason + tool JSON complete → block/guardrail)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (LLM stream parsing + tool dispatcher sẵn — chưa có truncation detector + fail-closed)
> **Effort:** 1 tuần

## Nguồn gốc

**pi-agent-core** edge case: khi LLM sinh tool_call nhưng **output bị cắt cụt** giữa chừng vì **stopReason=length** (max_tokens hết, hoặc stream ngắt). Kết quả: tool JSON **không hoàn chỉnh** — `{"name": "edit", "arguments": {"path": "src/x.ts", "content": "..."}` (thiếu `}}`, content cắt giữa). Nếu dispatch tool-call cụt này → **JSON parse fail** hoặc tệ hơn parse được một phần nhưng **content sai** (ghi file hỏng, mất dữ liệu). **Fail-closed**: nếu `stopReason === 'length'` VÀ tool_call present → **đánh dấu lỗi** (KHÔNG dispatch), trả `ToolResult { ok: false, output: 'truncated tool call' }`, báo LLM sinh lại (có thể tăng max_tokens). Nguyên tắc: **tool call cụt = tool call hỏng** — không bao giờ chạy.

## Mô tả

mya truncated tool call fail-closed: (1) **Stream parse**: parse LLM stream → detect stopReason. (2) **Truncation check**: nếu `stopReason === 'length'` AND có tool_call content → flag `truncated=true`. (3) **JSON complete check**: parse tool arguments JSON — nếu fail (incomplete) → confirm truncated. (4) **Fail-closed**: truncated → **block dispatch**, return `ToolResult { ok: false, output: '[truncated] tool call incomplete — regen or raise max_tokens' }`. (5) **Re-prompt**: feed back LLM (báo cụt → sinh lại, hoặc tăng max_tokens). mya có LLM stream parsing + tool dispatcher — SM thêm **truncation detector** + **fail-closed gate**.

## Kiến trúc

```
  LLM STREAM (sinh tool_call):
  ┌─────────────────────────────────────────────────────┐
  │  ...{"name":"edit","arguments":{"path":"x.ts",       │
  │  "content":"...long content..."  ← CUT (max_tokens)  │
  │  stopReason: "length"                                 │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── TRUNCATION CHECK ────────────────────────────────┐
  │  stopReason == "length"? → YES                       │
  │  has tool_call? → YES                                │
  │  → truncated = true                                  │
  │  JSON complete? parse {"path":..,"content":..} → ✗   │
  │     (incomplete, thiếu })                             │
  └───────────┬───────────────────┬─────────────────────┘
              │ complete           │ truncated
              ▼                    ▼
  ┌─── DISPATCH ──────────┐  ┌─── FAIL-CLOSED ───────────┐
  │  edit chạy (JSON OK)   │  │  BLOCK — không dispatch   │
  └───────────────────────┘  │  return { ok: false,      │
                              │    output: "[truncated]   │
                              │     tool call — regen" }  │
                              └────────────┬──────────────┘
                                           ▼
                              RE-PROMPT: báo cụt → LLM sinh lại
                              (hoặc tăng max_tokens)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ LLM stream parsing — stopReason (nền — SM check nó)
// ✅ tool dispatcher — run tool (nền — SM gate trước nó)
// ✅ ToolResult { ok, output } — result shape (nền — SM return fail-closed)
// ✅ 501 arg-hallucination-guard — fail-closed (gần — SM = truncation trigger)

// ❌ THIẾU: truncation detector (stopReason=length + tool_call)
// ❌ THIẾU: JSON completeness check (parse args — fail = truncated)
// ❌ THIẾU: fail-closed gate (block dispatch + return error)
```

## Implementation

```typescript
// packages/agent/src/truncated-tool-guard.ts (MỚI)
import type { Tool, ToolResult } from './tool-types';

interface LLMResponse { stopReason: string; toolCalls?: { name: string; arguments: string }[] }

class TruncatedToolGuard {
  // detect truncation: stopReason=length + tool_call present
  isTruncated(res: LLMResponse): boolean {
    if (res.stopReason !== 'length') return false;
    return Array.isArray(res.toolCalls) && res.toolCalls.length > 0;
  }

  // check args JSON complete (parse fail = truncated)
  argsComplete(argsJson: string): boolean {
    try { JSON.parse(argsJson); return true; } catch { return false; }
  }

  // gate: validate → dispatch hoặc fail-closed
  async runGuarded(tool: Tool, res: LLMResponse, call: { name: string; arguments: string }): Promise<ToolResult> {
    if (this.isTruncated(res) || !this.argsComplete(call.arguments)) {
      return { ok: false, output: '[truncated] tool call incomplete (stopReason=length) — regen or raise max_tokens' };
    }
    const args = JSON.parse(call.arguments); // safe — đã check complete
    return tool.run(args);
  }

  // suggest: tăng max_tokens nếu truncation lặp lại
  shouldRaiseMaxTokens(truncationCount: number, threshold = 2): boolean {
    return truncationCount >= threshold;
  }
}

// Usage:
// const guard = new TruncatedToolGuard();
// if (guard.isTruncated(res)) → fail-closed, re-prompt LLM
// const r = await guard.runGuarded(editTool, res, res.toolCalls[0]);
// if (!r.ok) feed back LLM "truncated — regen / raise max_tokens"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fail-closed (tool cụt không chạy — không ghi hỏng) | ❌ False-truncate (stopReason=length nhưng JSON coincidentally complete → vẫn block) |
| ✅ Anti-corruption (content cắt giữa không ghi file sai) | ❌ Re-prompt round-trip (block → regen → chậm) |
| ✅ Clear error (báo cụt → biết tăng max_tokens) | ❌ max_tokens tăng cost (nếu luôn cụt) |
| ✅ Phối 501 arg-guard (cùng fail-closed) | ❌ Stream parsing dependency (cần stopReason reliable) |

## Khác các hướng gần

| | 501 Arg-Hallucination-Guard | JSON-Retry | SM: Truncated-Fail-Closed |
|---|---|---|---|
| Trigger | Args sai schema/value | Parse fail → retry | **stopReason=length (cụt stream)** |
| Khi fail | Block + re-prompt | Retry auto | **Block + re-prompt (raise max_tokens)** |
| Bảo vệ | Target sai | Parse lỗi | **File hỏng (content cắt)** |

## Khi nào chọn

- LLM output dài (tool call lớn — edit content dài) hay cụt max_tokens
- Muốn fail-closed (tool cụt không bao giờ chạy — tránh ghi hỏng)
- Stream parsing có stopReason reliable
- Nối LLM stream parsing + tool dispatcher; guard stopReason reliability (1 số provider không trả length chính xác) + false-truncate (check JSON complete trước block — nếu complete thì dispatch dù stopReason=length) + re-prompt loop (giới hạn round); phối 501 arg-guard (SM = truncation, SG = args sai — cùng fail-closed gate)
