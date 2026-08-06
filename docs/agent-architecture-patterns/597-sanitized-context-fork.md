# Hướng VY: Sanitized Context Fork — agent con nhận sanitized JSONL snapshot từ parent: steering/reasoning bỏ đi, tool output ghi summary

> **Nguồn gốc:** pi-agent-flow (sanitized context fork); "child agent receives sanitized JSONL snapshot from parent"; "strip steering/reasoning messages"; "tool output replaced with summary"; "minimal clean context for subagent" | **Coupling:** 🟡 — thêm context-sanitizer vào subagent spawn (JSONL snapshot) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent + redact sẵn — chưa có full context sanitization) | **Effort:** 2 tuần

## Nguồn gốc

**pi-agent-flow** khi spawn **subagent** (agent con), **không truyền nguyên context parent** — quá lớn + rác (steering hint, reasoning chain, raw tool output). Thay vào đó, **sanitize JSONL snapshot** từ parent: (1) **Bỏ steering/reasoning** message (chỉ giữ fact, không giữ suy luận). (2) **Tool output → summary** (thay raw output dài bằng tóm tắt ngắn). Kết quả: subagent nhận **minimal clean context** — đủ hiểu task, không bị noise. Nguyên tắc: **subagent sees facts, not parent's internal process**. Khác full-context-inherit (subagent thấy hết) — VY **sanitized fork**; khác no-context (subagent trắng) — VY **curated facts summary**.

## Mô tả

mya sanitized context fork: (1) **JSONL snapshot**: parent context là JSONL (mỗi dòng 1 message). (2) **Sanitize**: lọc — bỏ steering hint (system steer), bỏ reasoning (assistant chain-of-thought), tool output → summary (raw → 1 dòng tóm tắt). (3) **Fork**: subagent nhận sanitized snapshot (clean, minimal). (4) **Subagent task**: làm việc với fact summary, không bị nhiễu parent internals. mya có subagent + redact — VY thêm **context-sanitizer** (strip steer/reasoning, summarize tool output).

## Kiến trúc

```
  PARENT CONTEXT (JSONL, đầy đủ + noise)
  ┌─────────────────────────────────────────────────────────┐
  │  {"role":"system","kind":"steer","text":"focus auth"}    │  ← STRIP (steering)
  │  {"role":"assistant","kind":"reasoning","text":"if I..."}│  ← STRIP (reasoning)
  │  {"role":"user","text":"fix login bug"}                   │  ← KEEP (fact)
  │  {"role":"tool","name":"grep","output":"300 lines..."}    │  ← SUMMARIZE
  │  {"role":"assistant","text":"found bug in token.ts:42"}   │  ← KEEP (conclusion)
  └───────────────────────────┬─────────────────────────────┘
                              │ (sanitize: strip + summarize)
                              ▼
  SANITIZED FORK (subagent nhận — clean, minimal)
  ┌─────────────────────────────────────────────────────────┐
  │  {"role":"user","text":"fix login bug"}                   │
  │  {"role":"tool","name":"grep","summary":"3 matches"}      │  ← summarized
  │  {"role":"assistant","text":"found bug in token.ts:42"}   │
  │  → subagent thấy facts, không thấy steer/reasoning/raw    │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent subagent.ts — subagent spawn (nền — VY fork ở đây)
// ✅ packages/core redact.ts — redaction (nền — VY sanitize relate)
// ✅ packages/core spill.ts — context spill JSONL (nền — VY snapshot)
// ✅ 582 VJ opaque-context-collapse — context collapse (relate — VY = sanitize trước collapse)

// ❌ THIẾU: context-sanitizer (strip steer/reasoning, summarize tool)
// ❌ THIẾU: JSONL snapshot fork (parent → sanitized → subagent)
// ❌ THIẾU: tool-output-summarizer (raw output → 1 dòng summary)
```

## Implementation

```typescript
// packages/agent/src/sanitized-context-fork.ts (MỚI)

type Msg =
  | { role: 'system'; kind: 'steer' | 'system'; content: string }
  | { role: 'assistant'; kind?: 'reasoning' | 'text'; content: string }
  | { role: 'user'; content: string }
  | { role: 'tool'; name: string; content: string };

type SanitizedMsg =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; name: string; summary: string };

class SanitizedContextFork {
  constructor(private maxToolSummaryLen: number = 100) {}

  // sanitize: strip steering/reasoning, summarize tool output
  sanitize(messages: Msg[]): SanitizedMsg[] {
    const out: SanitizedMsg[] = [];
    for (const msg of messages) {
      if (msg.role === 'system' && msg.kind === 'steer') continue;   // STRIP steering
      if (msg.role === 'assistant' && msg.kind === 'reasoning') continue; // STRIP reasoning
      if (msg.role === 'tool') {
        out.push({ role: 'tool', name: msg.name, summary: this.summarize(msg.content) });
      } else if (msg.role === 'user') {
        out.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        out.push({ role: 'assistant', content: msg.content });
      } else if (msg.role === 'system') {
        out.push({ role: 'system', content: msg.content });
      }
    }
    return out;
  }

  // summarize: raw tool output → 1 dòng ngắn
  private summarize(raw: string): string {
    const lines = raw.split('\n');
    if (lines.length <= 3) return raw.trim();
    return `${lines.length} lines. First: ${lines[0]!.trim().slice(0, this.maxToolSummaryLen)}`;
  }

  // fork: JSONL snapshot → sanitize → subagent context
  fork(parentJsonl: string): SanitizedMsg[] {
    const messages: Msg[] = parentJsonl
      .trim().split('\n')
      .map(line => JSON.parse(line) as Msg);
    return this.sanitize(messages);
  }
}
// Usage:
// const fork = new SanitizedContextFork();
// const subagentCtx = fork.fork(parentContextJsonl);
// spawn subagent with subagentCtx  // clean, minimal — facts only
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Minimal context (subagent thấy facts, không noise) | ❌ Info loss (summarize bỏ chi tiết cần thiết) |
| ✅ No steering leak (subagent không thấy parent steer) | ❌ Summarize quality (tóm tắt kém → subagent thiếu ngữ cảnh) |
| ✅ Token efficient (snapshot nhỏ, rẻ hơn full context) | ❌ Sanitize rules (phải biết strip cái gì — brittle) |
| ✅ Clean separation (parent internals ẩn khỏi subagent) | ❌ Consistency (summary cũ nếu parent update sau) |

## Khác các hướng gần

| | Full context inherit | No context (blank) | VY: Sanitized-Fork |
|---|---|---|---|
| Subagent thấy | Hết (noise + leak) | Không gì | **Curated facts (sanitized)** |
| Token | Cao (full) | 0 | **Thấp (minimal)** |
| Steering leak | ✅ (subagent thấy steer) | ❌ | **❌ (stripped)** |

## Khi nào chọn

- Subagent cần context parent nhưng không cần steering/reasoning/raw output
- Muốn minimal token (snapshot nhỏ, rẻ)
- Cần clean separation (parent internals ẩn khỏi subagent)
- Nối packages/agent subagent.ts + packages/core redact.ts + spill.ts + 582 VJ opaque-collapse; guard summary-quality (tóm tắt đủ thông tin cho subagent), strip-completeness (không leak steer/reasoning), và snapshot-freshness (fork ngay trước spawn, không stale); VY = sanitized context fork, kết hợp 596 VX uuid-steering-hint (strip steer = xóa UUID hint) + 582 VJ (collapse — VY sanitize trước collapse)
