# Hướng LY: Context-Aware Tool Recommendation — gợi ý tool phù hợp ngữ cảnh hiện tại

> **Nguồn gốc:** Recommender system (collaborative filtering, content-based); "you might also need" suggestions; IDE intellisense context suggestion; "next-action prediction"; tool co-occurrence analysis; contextual bandit
> **Coupling:** 🟡 — thêm recommendation engine vào agent context
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (tool list sẵn — chưa có context-based recommendation)
> **Effort:** 1.5-2.5 tuần

## Nguồn gốc

**Recommender system** (Netflix, Amazon): dựa trên context/historic → gợi ý item phù hợp. **Content-based filtering**: match context hiện tại với metadata item. **Collaborative filtering**: "người dùng tool A thường cũng dùng tool B". **Contextual bandit**: explore-exploit tradeoff — recommend tool, đo outcome, học. **IDE intellisense**: theo ngữ cảnh code → gợi ý method. Đối với agent: theo task/context hiện tại (đang đọc file PDF, đang debug) → gợi ý tool phù hợp tiếp theo (pdf-reader, debugger) thay vì list toàn bộ tool. Khác **101 dynamic-tool-selection** (chọn từ list) — LY **recommend** (gợi ý proactively); khác **336 discovery** (tìm tool) — LY **chọn tool nào phù hợp**.

## Mô tả

mya context-aware tool recommendation: phân tích context hiện tại (task description, tool vừa dùng, file type, error state) → rank tool theo relevance → suggest top-K tool phù hợp. Agent xem suggest (hoặc auto-select) → giảm thời gian tìm tool. Reco engine học từ telemetry (tool co-occurrence: dùng `read-file` rồi thường dùng `edit-file`). Nối 338 tool-usage-insights (mining co-occurrence) — LY dùng insight đó để recommend.

## Kiến trúc

```
  AGENT CONTEXT (hiện tại):
   task: "refactor auth module"
   lastTool: read-file (auth.ts)
   fileType: .ts
   errorState: type error
        │
        ▼
  ┌─── RECOMMENDATION ENGINE ───────────────┐
  │                                         │
  │  SIGNALS:                               │
  │   · context keywords → match tool desc  │
  │   · tool co-occurrence (338 mining):    │
  │     read-file → 72% edit-file            │
  │     type-error → 65% type-checker        │
  │   · task-type match (refactor → rename) │
  │         │                               │
  │         ▼ rank by composite score        │
  │  TOP-K:                                  │
  │   1. edit-file (score 0.91)             │
  │   2. type-checker (score 0.78)          │
  │   3. rename-symbol (score 0.65)         │
  │         │                               │
  │   suggest to agent (or auto-select #1)  │
  └─────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 101 dynamic-tool-selection — chọn tool (nền — LY recommend proactively)
// ✅ 40 tool-registry — tool metadata (reco input)
// ✅ 111 tool-description-engineering — tool description (reco matching)
// ✅ 336 LX tool-discovery-gateway — find tool (reco sau discovery)
// ✅ 338 LZ tool-usage-insights — co-occurrence data (reco signal)
// ✅ 230 HV event-sourcing — tool call log (reco training)

// ❌ THIẾU: recommendation engine (context → ranked tool list)
// ❌ THIẾU: tool co-occurrence model (learned from telemetry)
// ❌ THIẾU: context feature extractor (task/file/error → features)
// ❌ THIẾU: suggest UI/API (top-K to agent)
```

## Implementation

```typescript
// packages/tools/src/recommend.ts (NEW)
interface AgentContext {
  task: string;
  lastTool?: string;
  fileType?: string;
  errorState?: string;
  history: string[]; // tool call sequence
}

interface ToolScore { toolId: string; score: number; reason: string; }

class ToolRecommender {
  // Co-occurrence matrix: toolA → { toolB: probability }
  private coOccurrence = new Map<string, Map<string, number>>();

  trainFromHistory(sessions: string[][]): void {
    for (const session of sessions) {
      for (let i = 0; i < session.length - 1; i++) {
        const curr = session[i]!;
        const next = session[i + 1]!;
        if (!this.coOccurrence.has(curr)) this.coOccurrence.set(curr, new Map());
        const probs = this.coOccurrence.get(curr)!;
        probs.set(next, (probs.get(next) ?? 0) + 1);
      }
    }
    // Normalize to probability
    for (const probs of this.coOccurrence.values()) {
      const total = [...probs.values()].reduce((a, b) => a + b, 0);
      for (const [k, v] of probs) probs.set(k, v / total);
    }
  }

  recommend(ctx: AgentContext, toolMeta: Map<string, string>): ToolScore[] {
    const scores = new Map<string, number>();

    // Signal 1: co-occurrence from last tool
    if (ctx.lastTool) {
      const probs = this.coOccurrence.get(ctx.lastTool);
      if (probs) for (const [tool, p] of probs) scores.set(tool, (scores.get(tool) ?? 0) + p * 0.5);
    }

    // Signal 2: keyword match — task keywords vs tool description
    const taskWords = ctx.task.toLowerCase().split(/\s+/);
    for (const [tool, desc] of toolMeta) {
      const match = taskWords.filter(w => desc.toLowerCase().includes(w)).length;
      if (match > 0) scores.set(tool, (scores.get(tool) ?? 0) + match * 0.1);
    }

    // Signal 3: error-state → relevant tool
    if (ctx.errorState === 'type-error') {
      scores.set('type-checker', (scores.get('type-checker') ?? 0) + 0.6);
    }

    return [...scores.entries()]
      .map(([toolId, score]) => ({ toolId, score, reason: `score: ${score.toFixed(2)}` }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tìm tool nhanh (recommend phù hợp) | ❌ Co-occurrence model cần training data |
| ✅ Học từ telemetry (cải thiện theo thời gian) | ❌ Cold-start (tool mới chưa có data) |
| ✅ Giảm cognitive load (top-K thay vì all) | ❌ False recommend → agent mất thời gian |
| ✅ Nối 338 insights → recommendation signal | ❌ Privacy: history có thể leak info |

## Khác các hướng gần

| | 101 Dynamic Selection | 336 Discovery Gateway | LY: Context Reco |
|---|---|---|---|
| Cái gì | Chọn từ list | Tìm từ multi-source | **Gợi ý proactively** |
| Khi | Agent yêu cầu | Agent hỏi | **Tự suggest** |
| Learn | ❌ | ❌ | ✅ co-occurrence |
| Top-K | ❌ (all) | ❌ (all match) | ✅ ranked |

## Khi nào chọn

- Tool nhiều → agent cần gợi ý phù hợp (không list all)
- Có telemetry đủ (tool call history) để train co-occurrence
- Muốn giảm thời gian agent tìm tool
- Kết hợp 336 discovery (tìm nguồn) + 338 insights (co-occurrence data); bảo mật history (privacy 347)
