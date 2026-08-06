# Hướng LZ: Tool Usage Insights — mining pattern tool usage từ telemetry

> **Nguồn gốc:** Process mining (event log → workflow); "usage analytics"; clickstream analysis; sequential pattern mining (PrefixSpan, GSP); "toolchain optimization"; Google Analytics behavior flow; APM trace analysis
> **Coupling:** 🟢 — thêm analytics pipeline đọc telemetry
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit log/telemetry sẵn — chưa có pattern mining)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Process mining** (Celonis, ProM): từ event log → phát hiện workflow pattern (ai làm gì theo thứ tự nào). **Sequential pattern mining** (PrefixSpan, GSP): tìm chuỗi lặp lại trong sequence data. **Clickstream analysis** (Google Analytics behavior flow): user journey — page A → B → C phổ biến. **APM trace analysis** (Datadog, Jaeger): từ distributed trace → phát hiện bottleneck. Đối với agent: từ tool call log → mining pattern: "90% session bắt đầu bằng read-file", "tool X luôn trước tool Y", "tool Z fail 30% — cần fix". Nối 230 event-sourcing (log source) — LZ **mine insight** từ log.

## Mô tả

mya tool usage insights: thu thập tool call telemetry (230 event log, 198 audit) → mining: frequency (tool nào dùng nhiều), sequence pattern (tool A → B phổ biến), failure rate (tool nào fail nhiều), idle tool (tool có nhưng ít dùng → có thể bỏ). Insight dùng cho: 337 recommendation (co-occurrence), optimize toolchain (bỏ tool chết), prioritize fix (tool fail cao). Khác 198 audit (record) — LZ **analyze**; khác 296 diagnostics-cli (debug) — LZ **aggregate insight**.

## Kiến trúc

```
  TOOL CALL TELEMETRY (event log — 230/198)
   { sessionId, toolId, args_hash, result, duration, timestamp }
        │
        ├──► FREQUENCY: tool dùng bao nhiêu lần / tuần
        │     read-file: 12,450 | edit-file: 8,200 | deploy: 45
        │
        ├──► SEQUENCE PATTERN (PrefixSpan):
        │     read-file → edit-file → type-check (62% sessions)
        │     shell → read-file (41%)
        │
        ├──► FAILURE RATE:
        │     deploy: 18% fail (⬆ investigate)
        │     read-file: 0.2% fail (✅ healthy)
        │
        ├──► IDLE TOOL (dùng < 5 lần / tháng):
        │     old-parser: 2 lần → candidate remove
        │
        └──► INSIGHTS REPORT → feed 337 reco + optimize + prioritize fix
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 198 GP audit — record tool call (telemetry source)
// ✅ 230 HV event-sourcing — event log (telemetry source)
// ✅ 296 agent-diagnostics-cli — debug (nền — LZ aggregate)
// ✅ 297 golden-trace-replay — trace (replay source)

// ❌ THIẾU: frequency analysis (tool call count)
// ❌ THIẾU: sequential pattern mining (PrefixSpan/GSP)
// ❌ THIẾU: failure rate per tool
// ❌ THIẾU: idle tool detection (low usage → remove candidate)
```

## Implementation

```typescript
// packages/analytics/src/tool-insights.ts (NEW)
interface ToolCall {
  sessionId: string;
  toolId: string;
  success: boolean;
  durationMs: number;
  timestamp: number;
}

interface Insight {
  type: 'frequency' | 'sequence' | 'failure' | 'idle';
  data: unknown;
  actionable: string;
}

class ToolUsageMiner {
  constructor(private calls: ToolCall[]) {}

  frequency(): Map<string, number> {
    const freq = new Map<string, number>();
    for (const c of this.calls) freq.set(c.toolId, (freq.get(c.toolId) ?? 0) + 1);
    return new Map([...freq].sort((a, b) => b[1] - a[1]));
  }

  // Sequential pattern mining — simplified PrefixSpan
  sequencePatterns(minSupport = 0.3): { pattern: string[]; support: number }[] {
    const sessions = new Map<string, string[]>();
    for (const c of this.calls) {
      if (!sessions.has(c.sessionId)) sessions.set(c.sessionId, []);
      sessions.get(c.sessionId)!.push(c.toolId);
    }
    const total = sessions.size;
    const pairCounts = new Map<string, number>();
    for (const seq of sessions.values()) {
      for (let i = 0; i < seq.length - 1; i++) {
        const pair = `${seq[i]}→${seq[i + 1]}`;
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      }
    }
    return [...pairCounts.entries()]
      .filter(([, count]) => count / total >= minSupport)
      .map(([pair, count]) => ({ pattern: pair.split('→'), support: count / total }))
      .sort((a, b) => b.support - a.support);
  }

  failureRate(): Map<string, number> {
    const byTool = new Map<string, { total: number; fail: number }>();
    for (const c of this.calls) {
      const entry = byTool.get(c.toolId) ?? { total: 0, fail: 0 };
      entry.total++;
      if (!c.success) entry.fail++;
      byTool.set(c.toolId, entry);
    }
    return new Map([...byTool].map(([tool, { total, fail }]) => [tool, fail / total]));
  }

  idleTools(threshold = 5): string[] {
    const freq = this.frequency();
    return [...freq.entries()].filter(([, count]) => count < threshold).map(([tool]) => tool);
  }

  report(): Insight[] {
    const insights: Insight[] = [];
    const failures = this.failureRate();
    for (const [tool, rate] of failures) {
      if (rate > 0.1) insights.push({ type: 'failure', data: { tool, rate }, actionable: `investigate ${tool} (${(rate * 100).toFixed(0)}% fail)` });
    }
    insights.push({ type: 'idle', data: this.idleTools(), actionable: 'consider removing idle tools' });
    return insights;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện tool fail cao (prioritize fix) | ❌ Cần volume telemetry đủ |
| ✅ Sequence pattern → feed 337 reco | ❌ Mining compute cost (PrefixSpan) |
| ✅ Idle tool → clean up toolchain | ❌ Privacy: args hash có thể leak |
| ✅ Coupling thấp (🟢 — chỉ đọc log) | ❌ Insight stale nếu log cũ |

## Khác các hướng gần

| | 198 Audit Log | 296 Diagnostics CLI | 337 Reco | LZ: Usage Insights |
|---|---|---|---|---|
| Cái gì | Record | Debug 1 session | Recommend tool | **Mine aggregate pattern** |
| Scope | 1 event | 1 trace | Context | **All sessions** |
| Output | Log | Debug info | Top-K tool | **Frequency/sequence/failure** |
| Actionable | ❌ | ❌ | Tool list | ✅ fix/idle/pattern |

## Khi nào chọn

- Có volume tool telemetry → muốn insight (frequency, pattern, failure)
- Muốn prioritize fix (tool fail cao)
- Muốn clean toolchain (bỏ idle tool)
- Feed 337 recommendation (co-occurrence) + 198 audit (log source); anonymize args hash (privacy 347)
