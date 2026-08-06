# Hướng WB: Structured JSON Flow Report — cuối flow, agent parse JSON block từ message cuối (summary/notDone/nextSteps/verdict)

> **Nguồn gốc:** pi-agent-flow (structured JSON flow report); "at end of flow, parse JSON block from final message"; "fields: summary, notDone, nextSteps, verdict"; "machine-parseable flow conclusion"; "deterministic end-of-flow output" | **Coupling:** 🟢 — thêm JSON report block vào flow-end prompt + parser | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (parser + prompt sẵn — chưa có JSON flow-report contract) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-agent-flow** khi **flow kết thúc** (hoặc hết budget), agent output **free-form prose** khó parse — orchestrator không biết chắc flow done hay chưa, còn gì phải làm. Giải pháp **structured JSON flow report**: ép agent emit **JSON block** trong message cuối với **4 field cố định**: **summary** (tóm tắt đã làm), **notDone** (còn gì chưa xong), **nextSteps** (bước tiếp theo nếu tiếp tục), **verdict** (done/incomplete/blocked). Orchestrator **parse JSON** → biết chính xác flow status, có thể spawn flow tiếp theo hoặc báo user. Nguyên tắc: **flow conclusion machine-parseable**. Khác prose conclusion (orchestrator phải đọc hiểu) — WB **deterministic JSON shape**.

## Mô tả

mya structured JSON flow report: (1) **Flow-end prompt**: khi flow sắp kết thúc, inject hướng dẫn ép agent emit JSON block. (2) **4 field**: summary (text), notDone (list), nextSteps (list), verdict (done|incomplete|blocked). (3) **Parse**: orchestrator extract JSON block từ message cuối → structured object. (4) **Decision**: verdict=done → hoàn thành; incomplete → check nextSteps spawn tiếp; blocked → báo user. mya có parser + prompt — WB thêm **JSON flow-report contract** + **flow-end injection**.

## Kiến trúc

```
  FLOW END (budget hết / task hoàn thành)
        │
        ▼ (inject: ép emit JSON block)
  ┌─── AGENT FINAL MESSAGE ────────────────────────────────┐
  │  (prose reasoning...)                                     │
  │                                                            │
  │  ```json                                                  │
  │  {                                                         │
  │    "summary": "Implemented auth + token refresh",         │
  │    "notDone": ["e2e tests", "rate limiting"],             │
  │    "nextSteps": ["write e2e for login", "add rate limit"]│
  │    "verdict": "incomplete"                                 │
  │  }                                                         │
  │  ```                                                      │
  └───────────────┬─────────────────────────────────────────┘
                  │ (parse JSON block)
                  ▼
  ┌─── ORCHESTRATOR DECISION ───────────────────────────────┐
  │  verdict: done       → flow hoàn thành, notify user       │
  │  verdict: incomplete → spawn next flow (nextSteps)        │
  │  verdict: blocked    → report blocker to user             │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows runner.ts — workflow runner (nền — WB flow-end ở đây)
// ✅ packages/agent sdk.ts — agent output (nền — WB parse output)
// ✅ 588 VP operational-handoff — structured handoff (relate — WB = flow conclusion)
// ✅ packages/core canonical-json.ts — JSON canonical (nền — WB parse)

// ❌ THIẾU: JSON flow-report contract (summary/notDone/nextSteps/verdict)
// ❌ THIẾU: flow-end prompt injection (ép emit JSON block)
// ❌ THIẾU: JSON-block parser (extract từ message cuối)
```

## Implementation

```typescript
// packages/workflows/src/json-flow-report.ts (MỚI)
type Verdict = 'done' | 'incomplete' | 'blocked';
interface FlowReport { summary: string; notDone: string[]; nextSteps: string[]; verdict: Verdict }

class StructuredJsonFlowReport {
  // prompt: ép agent emit JSON block ở cuối flow
  static prompt(): string {
    return '# Flow Report — REQUIRED at end\n' +
      'End with JSON block: {"summary":"...","notDone":[...],"nextSteps":[...],"verdict":"done|incomplete|blocked"}\n' +
      '- verdict: done (complete) | incomplete (more work) | blocked (cannot proceed)';
  }

  // parse: extract JSON block cuối cùng từ message → FlowReport
  static parse(message: string): FlowReport | null {
    const blocks = message.match(/```json\s*([\s\S]*?)```/g);
    if (!blocks || blocks.length === 0) return null;
    const jsonStr = blocks[blocks.length - 1]!.replace(/```json\s*/, '').replace(/```/, '').trim();
    try {
      const parsed = JSON.parse(jsonStr);
      return this.validate(parsed) ? parsed as FlowReport : null;
    } catch { return null; }
  }

  // validate: kiểm tra 4 field có đủ + verdict hợp lệ
  static validate(obj: unknown): boolean {
    const o = obj as Record<string, unknown>;
    return typeof o?.['summary'] === 'string' && Array.isArray(o['notDone']) &&
      Array.isArray(o['nextSteps']) && ['done', 'incomplete', 'blocked'].includes(o['verdict'] as string);
  }

  // decision: orchestrator xử lý verdict
  static route(report: FlowReport): { action: string; payload: FlowReport } {
    const actions: Record<Verdict, string> = { done: 'notify-complete', incomplete: 'spawn-next-flow', blocked: 'report-blocker' };
    return { action: actions[report.verdict], payload: report };
  }
}

// Usage:
// flowEndPrompt += StructuredJsonFlowReport.prompt();
// const finalMsg = await llm(...);
// const report = StructuredJsonFlowReport.parse(finalMsg);
// if (report) { const { action } = StructuredJsonFlowReport.route(report); }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Machine-parseable (orchestrator đọc JSON, không prose) | ❌ LLM compliance (không luôn emit valid JSON) |
| ✅ Deterministic shape (luôn 4 field) | ❌ JSON in markdown brittle (fenced block parse) |
| ✅ Routing rõ (verdict → action) | ❌ Field honesty (agent claim done khi thật incomplete) |
| ✅ Continuity (nextSteps → spawn flow tiếp) | ❌ Overhead (JSON block tốn token cuối flow) |

## Khác các hướng gần

| | Prose conclusion | 588 VP handoff | WB: JSON-Flow-Report |
|---|---|---|---|
| Dạng | Văn xuôi | Fixed-text schema | **JSON block (machine-parse)** |
| Verdict | ❌ | ❌ | **done/incomplete/blocked** |
| Routing | Human | Human parse | **verdict → auto action** |

## Khi nào chọn

- Orchestrator cần parse flow conclusion tự động (không đọc prose)
- Flow có continuation (incomplete → spawn nextSteps)
- Muốn verdict rõ (done/incomplete/blocked → routing)
- Nối packages/workflows runner.ts + packages/agent sdk.ts + 588 VP operational-handoff + packages/core canonical-json.ts; guard JSON-validity (fallback + re-prompt nếu malformed), verdict-honesty (spot-check done claim), và block-extraction-robustness (handle ```json fence variants); WB = structured JSON flow report, kết hợp 588 VP (handoff — WB = flow-end variant) + 599 WA evidence-markers (confidence cho summary/verdict)
