# Hướng SG: Tool Argument Hallucination Guard — bắt tool_call tước đối số task_id/conversation_id không hợp lệ

> **Nguồn gốc:** openpi (tool argument hallucination); "tool_call stripped required args"; "invalid task_id/conversation_id guard"; "argument schema validation fail-closed"; "hallucinated tool arguments blocked"
> **Coupling:** 🟢 — thêm guard layer giữa LLM tool_call và tool dispatch (validate args → block/guardrail)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool dispatcher + tool.meta schema sẵn — chưa có hallucination guard + arg validator)
> **Effort:** 1-2 tuần

## Nguồn gốc

**openpi** phát hiện: LLM thỉnh thoảng **hallucinate tool_call** — sinh `tool_use` nhưng **tước/biến đổi đối số bắt buộc** (task_id, conversation_id, session_id) hoặc **điền giá trị không hợp lệ** (task_id "123" khi thực tế là UUID, hoặc bỏ trống). Hậu quả: tool chạy với arg sai → crash, hoặc tệ hơn, **hoạt động sai target** (task_id nhầm → ghi vào session khác). **Hallucination guard** validate MỌI đối số tool_call trước dispatch: kiểm tra schema (có đủ required? type đúng?) + kiểm tra giá trị (id có tồn tại? format đúng?) → nếu fail → **fail-closed** (block + trả lỗi, KHÔNG chạy tool hỏng). Nguyên tắc: **tool_call không tin tưởng mù** — validate trước khi dispatch.

## Mô tả

mya tool argument hallucination guard: (1) **Schema check**: mỗi tool_call → check arg theo tool.meta schema (required đủ? type đúng?). (2) **Value check**: id-arg (task_id, conversation_id, session_id) → verify tồn tại + format (UUID? số? trong registry?). (3) **Fail-closed**: nếu schema fail HOẶC value invalid → **block** dispatch, trả `ToolResult { ok: false, output: 'invalid args: ...' }`. (4) **Re-prompt**: lỗi guard → feed lại LLM (báo args sai → sinh lại đúng). (5) **Telemetry**: count hallucination rate (bao nhiêu tool_call bị block). mya có tool dispatcher + tool.meta schema — SG thêm **arg validator** (schema + value) + **fail-closed gate**.

## Kiến trúc

```
  LLM sinh tool_call: { name: "submit_task", args: { task_id: "", content: "..." } }
        │
        ▼
  ┌─── GUARD (trước dispatch) ──────────────────────────┐
  │  SCHEMA CHECK:                                       │
  │    required: [task_id, content]                       │
  │    task_id = "" → MISSING/empty ✗                    │
  │  VALUE CHECK:                                        │
  │    task_id format UUID? "" ✗ (không hợp lệ)          │
  └───────────┬───────────────────┬─────────────────────┘
              │ valid              │ invalid (hallucination)
              ▼                    ▼
  ┌─── DISPATCH ──────────┐  ┌─── FAIL-CLOSED ───────────┐
  │  submit_task chạy     │  │  BLOCK — không dispatch    │
  │  (args đúng)           │  │  return { ok: false,       │
  └───────────────────────┘  │    output: "invalid args:  │
                              │     task_id empty/invalid"}│
                              └────────────┬───────────────┘
                                           ▼
                              RE-PROMPT: báo LLM args sai → sinh lại
                              TELEMETRY: hallucination rate++
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool dispatcher — run tool (nền — SG gate trước nó)
// ✅ tool.meta — schema (name, params) (nền — SG validate theo nó)
// ✅ ToolResult { ok, output } — result shape (nền — SG return fail-closed)

// ❌ THIẾU: arg validator (schema check + value check)
// ❌ THIẾU: fail-closed gate (block dispatch khi args invalid)
// ❌ THIẾU: re-prompt feedback (báo LLM args sai)
// ❌ THIẾU: hallucination telemetry (rate)
```

## Implementation

```typescript
// packages/agent/src/tool-arg-guard.ts (MỚI)
import type { Tool, ToolResult } from './tool-types';

interface ToolCall { name: string; args: Record<string, unknown> }

class ToolArgGuard {
  private blocked = 0;
  private total = 0;

  constructor(private idRegistry?: { has: (id: string) => boolean }) {}

  // validate args trước dispatch → fail-closed nếu invalid
  validate(tool: Tool, call: ToolCall): { ok: true } | { ok: false; reason: string } {
    this.total++;
    const params = tool.meta.params ?? {};
    // schema check: required đủ + type
    for (const [key, spec] of Object.entries(params)) {
      if (spec.required) {
        const val = call.args[key];
        if (val === undefined || val === null || val === '') {
          this.blocked++;
          return { ok: false, reason: `missing required arg: ${key}` };
        }
      }
      // type check (id args: string UUID format)
      if (key.endsWith('_id') && typeof call.args[key] === 'string') {
        const id = call.args[key] as string;
        if (!/^[0-9a-f-]{8,}$/i.test(id)) {
          this.blocked++;
          return { ok: false, reason: `invalid id format: ${key}=${id}` };
        }
        if (this.idRegistry && !this.idRegistry.has(id)) {
          this.blocked++;
          return { ok: false, reason: `unknown id: ${key}=${id} (not in registry)` };
        }
      }
    }
    return { ok: true };
  }

  // gate wrapper: validate → dispatch hoặc fail-closed
  async runGuarded(tool: Tool, call: ToolCall): Promise<ToolResult> {
    const v = this.validate(tool, call);
    if (!v.ok) return { ok: false, output: `[arg-guard] ${v.reason}` };
    return tool.run(call.args);
  }

  hallucinationRate(): number { return this.total === 0 ? 0 : this.blocked / this.total; }
}

// Usage:
// const r = await guard.runGuarded(submitTaskTool, call);
// if (!r.ok) → feed back LLM: "args invalid, regenerate"; telemetry: guard.hallucinationRate()
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fail-closed (tool hỏng không chạy — args sai block) | ❌ False-block (validator quá nghiêm → block call hợp lệ) |
| ✅ Anti-hallucination (LLM bóp args → phát hiện) | ❌ Re-prompt round-trip (block → LLM sinh lại → chậm) |
| ✅ Telemetry (hallucination rate → tune prompt) | ❌ Id registry lookup overhead |
| ✅ Phối tool.meta schema (validation) | ❌ Validator maintenance (schema mới → update) |

## Khác các hướng gần

| | Schema-Only Validate | No Validate | SG: Hallucination-Guard |
|---|---|---|---|
| Schema | ✅ | ❌ | **✅ + value check** |
| Value (id tồn tại?) | ❌ | ❌ | **✅ registry lookup** |
| Khi fail | Reject | Chạy hỏng | **Fail-closed + re-prompt** |

## Khi nào chọn

- Tool có id-arg quan trọng (task_id, session_id — sai = target nhầm)
- LLM hay hallucinate args (bóp/điền sai)
- Muốn fail-closed (không bao giờ chạy tool hỏng)
- Nối tool dispatcher + tool.meta schema; guard validator strictness (block đúng, không false-block) + re-prompt loop (giới hạn round — không vô hạn) + telemetry (rate cao → tune system prompt); phối 507 truncated-tool-call-fail-closed (cùng fail-closed philosophy, khác trigger: SM = cắt cụt, SG = args sai)
