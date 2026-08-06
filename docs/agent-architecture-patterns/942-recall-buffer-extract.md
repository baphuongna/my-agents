# Hướng AJF: Recall-Buffer-Extract — luồng chính: Recall (trước session, inject memory vào system prompt) → Buffer (sau mỗi turn, tích lũy) → Extract (LLM call định kỳ dùng structured outputs); orchestrated bởi single orchestrator

> **Nguồn gốc:** remnic | **Coupling:** 🟡 — orchestration memory lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (recall + buffer + extract rời rạc; thiếu single orchestrator) | **Effort:** 2 tuần

## Nguồn gốc

**remnic** luồng chính memory: **Recall** (trước session, inject memory vào system prompt) → **Buffer** (sau mỗi turn, tích lũy cho tới trigger) → **Extract** (LLM call định kỳ dùng **OpenAI Responses API structured outputs**) — orchestrated bởi **single orchestrator** (không phải nhiều hook rời rạc). Ba giai đoạn có nhịp khác nhau: recall mỗi session, buffer mỗi turn, extract định kỳ theo trigger.

Nguyên tắc: **memory lifecycle là pipeline có orchestrator duy nhất** — không phải các hook độc lập ghi lung tung; **mỗi giai đoạn có trigger riêng** — recall trước session (inject), buffer sau turn (tích lũy), extract khi đủ trigger (LLM structured output — không heuristic thô); **structured outputs** — extract trả schema chuẩn (memory type + importance + content) thay vì free text.

## Mô tả

Với mya, pattern = **memory orchestrator**: (1) **Recall** — mya đã có `before_agent_start` hook (print/mya-bridge) gọi `sqliteMemory.recall` → inject `[memory]` block vào system prompt — đúng giai đoạn Recall; (2) **Buffer** — `turn_end` hook đã có (pendingUserPrompt + lastAssistantTextCapture) — đúng buffer; (3) **Extract** — mya đang dùng **autoCapture heuristic** (pattern regex) — AJF thêm **LLM extract định kỳ**: khi buffer đạt trigger (N turn / N chars) → LLM call structured output (nối `packages/ai` — provider có schema/response format; mya `consolidationFn` trong dream-cycle đã dùng structured decision — pattern có sẵn); (4) **single orchestrator** — gom các hook rời thành `MemoryOrchestrator` (class duy nhất quản lý 3 giai đoạn + trigger + thứ tự) — thay vì hook trải rải trong mya-bridge; (5) **structured output** — extract trả `{ memories: [{ type, content, importance }] }` — nối sqlite-manager.record + AJE staging. Trigger config: N turn, N chars, idle (nối idle-trigger prompts pattern).

## Kiến trúc (ASCII)

```
  MEMORY ORCHESTRATOR (single — quản lý 3 giai đoạn + trigger)
    │
    ├─ RECALL ──► trước session (before_agent_start)
    │    └─ sqliteMemory.recall(query) ──► inject [memory] vào system prompt
    │
    ├─ BUFFER ──► sau mỗi turn (turn_end)
    │    └─ pendingUserPrompt + lastAssistantText (tích lũy)
    │
    └─ EXTRACT ──► khi đủ trigger (N turn / N chars / idle)
         ├─ LLM call STRUCTURED OUTPUT
         │    └─ { memories: [{ type, content, importance }] }
         ├─ nối AJE staging (importance gate + dedup)
         └─ sqlite-manager.record (Primitive)
  (không phải hook rời rạc ghi lung tung — một nơi điều phối)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print mya-bridge.ts — before_agent_start recall + inject [memory]
//   (giai đoạn Recall — đã có)
// ✅ packages/print mya-bridge.ts — turn_end capture (pendingUserPrompt +
//   lastAssistantTextCapture — giai đoạn Buffer — đã có)
// ✅ packages/memory auto-capture.ts — heuristic extract (có sẵn — AJF thêm LLM)
// ✅ packages/memory dream-cycle.ts — consolidationFn (LLM structured decision —
//   pattern structured output có sẵn)
// ✅ packages/ai — providers + model-routing (nền LLM extract)
// ✅ packages/prompts idle-trigger.ts — idle trigger (nền extract trigger)

// ❌ THIẾU: MemoryOrchestrator (single class điều phối 3 giai đoạn)
// ❌ THIẾU: LLM extract structured output (hiện chỉ heuristic)
// ❌ THIẾU: trigger config rõ (N turn / N chars / idle)
```

## Implementation

```typescript
// packages/memory/src/orchestrator.ts (NEW)
import type { ProviderProfile, MemoryType } from "@my-agent/core";

export interface ExtractTrigger { maxTurns: number; maxChars: number; idleMs: number }
export interface ExtractedMemory { type: MemoryType; content: string; importance: number }

/** Single orchestrator — Recall + Buffer + Extract có trigger riêng. */
export class MemoryOrchestrator {
  private buffer: Array<{ role: "user" | "assistant"; text: string }> = [];
  private turnCount = 0;
  private bufferChars = 0;
  constructor(
    private readonly recall: (q: string) => unknown[],           // sqlite recall
    private readonly record: (m: ExtractedMemory) => string,      // sqlite record
    private readonly llmExtract: (text: string) => Promise<ExtractedMemory[]>,
    private readonly trigger: ExtractTrigger,
  ) {}

  /** Giai đoạn 1: RECALL — trước session, inject vào system prompt. */
  recallForPrompt(query: string): string {
    const hits = this.recall(query) as Array<{ content: string; tier: string }>;
    if (hits.length === 0) return "";
    return `[memory]\n${hits.map((h) => `- [${h.tier}] ${h.content}`).join("\n")}`;
  }

  /** Giai đoạn 2: BUFFER — sau mỗi turn, tích lũy. */
  bufferTurn(role: "user" | "assistant", text: string): void {
    this.buffer.push({ role, text });
    this.turnCount++;
    this.bufferChars += text.length;
  }

  /** Giai đoạn 3: EXTRACT — khi đủ trigger, LLM structured output. */
  async maybeExtract(now: number, lastTurnAt: number): Promise<number> {
    const due = this.turnCount >= this.trigger.maxTurns ||
      this.bufferChars >= this.trigger.maxChars ||
      (this.trigger.idleMs > 0 && now - lastTurnAt > this.trigger.idleMs);
    if (!due || this.buffer.length === 0) return 0;
    const text = this.buffer.map((b) => `${b.role}: ${b.text}`).join("\n\n");
    const memories = await this.llmExtract(text);       // structured output
    let stored = 0;
    for (const m of memories) {
      if (m.importance >= 0.5) { this.record(m); stored++; }   // gate + record
    }
    this.buffer = [];
    this.turnCount = 0;
    this.bufferChars = 0;
    return stored;
  }
}
// mya-bridge: thay các hook rời bằng orchestrator instance —
// before_agent_start → recallForPrompt; turn_end → bufferTurn + maybeExtract.
// llmExtract: provider prompt yêu cầu JSON schema { memories: [...] } (structured).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một nơi điều phối — hook rời không ghi lung tung | ❌ LLM extract tốn token so với heuristic thuần |
| ✅ Trigger rõ (turn/chars/idle) — extract đúng lúc | ❌ Structured output phụ thuộc provider support |
| ✅ Nối Recall có sẵn + AJE staging | ❌ Orchestrator phải sync với lifecycle (shutdown flush) |
| ✅ Idle extract — tận dụng lúc rảnh | ❌ Trigger config phải calibrate (quá ít → mất, quá nhiều → tốn) |

## Khác các hướng gần

| | AJF Recall-Buffer-Extract | AJE Trace→Primitive | AJI Dreams Consolidation |
|---|---|---|---|
| Trọng tâm | Luồng orchestrate 3 giai đoạn | 3 giai đoạn capture | Consolidation nền |
| Cơ chế | Single orchestrator + LLM extract | Judge + staging + commit | Phase light/REM/deep |
| Quan hệ | Orchestrate capture | Chi tiết giai đoạn 2-3 | Nâng cấp sau extract |

## Khi nào chọn

- Memory hooks đang rải rác (mya-bridge) — muốn một orchestrator điều phối
- Heuristic extract (autoCapture) thiếu chính xác — thêm LLM structured output
- Muốn trigger linh hoạt (turn/chars/idle) thay vì extract mỗi turn
- Guard: flush khi shutdown, trigger calibrate, LLM fail → fallback heuristic, gate importance